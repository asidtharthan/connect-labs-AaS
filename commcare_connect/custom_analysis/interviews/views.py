import logging
import os
import re
from datetime import datetime

from celery.result import AsyncResult
from django.contrib.auth.mixins import LoginRequiredMixin
from django.core.cache import cache
from django.http import FileResponse, HttpResponse, JsonResponse
from django.urls import reverse
from django.utils import timezone
from django.views import View
from django.views.generic import TemplateView

from commcare_connect.labs.integrations.ocs.api_client import OCSAPIError, OCSDataAccess

from .data_access import DEFAULT_NAME_PATTERN, InterviewsDataAccess
from .pipeline.excel_export import build_answers_xlsx, build_cohort_xlsx
from .tasks import DEFAULT_INTERVIEW_BOT_ID, sync_interview_sessions_task

logger = logging.getLogger(__name__)

COHORT_CACHE_TTL_SECONDS = 5 * 60  # 5 minutes


def _parse_date(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s)
    except (ValueError, TypeError):
        return None


class InterviewsDashboardView(LoginRequiredMixin, TemplateView):
    template_name = "custom_analysis/interviews/dashboard.html"

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context["cohort_metrics_api_url"] = reverse("interviews:api_cohort_metrics")
        context["sync_trigger_url"] = reverse("interviews:api_sync_trigger")
        context["sync_status_url"] = reverse("interviews:api_sync_status")
        context["answers_xlsx_url"] = reverse("interviews:api_answers_xlsx")
        context["cohort_xlsx_url"] = reverse("interviews:api_cohort_xlsx")
        context["per_session_xlsx_url"] = reverse("interviews:api_per_session_xlsx")
        context["experiment_id"] = self.request.GET.get("experiment_id") or DEFAULT_INTERVIEW_BOT_ID
        context["name_pattern"] = self.request.GET.get("name_pattern", DEFAULT_NAME_PATTERN.pattern)
        return context


class InterviewsMetricsView(LoginRequiredMixin, View):
    """Top-level session counts (reads from InterviewSessionStatus).

    NOTE: Currently unused by the dashboard frontend — cohort-metrics endpoint
    provides the same data in a richer per-cohort breakdown. Retained for ad-hoc
    API use and potential future bot-picker UI.
    """

    def get(self, request):
        experiment_id = request.GET.get("experiment_id") or None
        data_access = InterviewsDataAccess(request=request)
        metrics = data_access.get_session_metrics(experiment_id=experiment_id)
        return JsonResponse(
            {
                "total_sessions": metrics["total_sessions"],
                "unique_participants": metrics["unique_participants"],
                "error": metrics["error"],
            }
        )


class InterviewsBotsView(LoginRequiredMixin, View):
    """List available OCS bots so the user can pick the right one.

    NOTE: Currently unused by the dashboard frontend — experiment_id is passed
    via URL param. Retained for future bot-picker dropdown UI.
    """

    def get(self, request):
        try:
            with OCSDataAccess(request=request) as ocs:
                if not ocs.check_token_valid():
                    return JsonResponse({"bots": [], "error": "OCS not authorized."})
                experiments = ocs.list_experiments()
            bots = [{"id": e.get("public_id") or e.get("id"), "name": e.get("name", "Unnamed")} for e in experiments]
            return JsonResponse({"bots": bots, "error": None})
        except OCSAPIError as e:
            return JsonResponse({"bots": [], "error": str(e)})
        except Exception:
            logger.exception("Error listing OCS bots")
            return JsonResponse({"bots": [], "error": "Unexpected error."})


class InterviewsCohortMetricsView(LoginRequiredMixin, View):
    """Per-cohort metrics. Hybrid: Connect for funnel, InterviewAnswer for interviews.

    Cached for 5 minutes per (user, pattern, dates). Pass `?refresh=1` to bust.
    """

    def get(self, request):
        name_pattern_raw = request.GET.get("name_pattern", DEFAULT_NAME_PATTERN.pattern)
        try:
            name_pattern = re.compile(name_pattern_raw, re.IGNORECASE)
        except re.error:
            name_pattern = DEFAULT_NAME_PATTERN

        max_cohorts_raw = request.GET.get("max_cohorts")
        try:
            max_cohorts = int(max_cohorts_raw) if max_cohorts_raw else None
        except (TypeError, ValueError):
            max_cohorts = None

        start_date = _parse_date(request.GET.get("start_date"))
        end_date = _parse_date(request.GET.get("end_date"))

        cache_key = (
            f"interviews:cohort_metrics_v4:{request.user.pk}:"
            f"{name_pattern.pattern}:{max_cohorts}:{start_date}:{end_date}"
        )
        force_refresh = request.GET.get("refresh") == "1"

        if not force_refresh:
            cached = cache.get(cache_key)
            if cached is not None:
                return JsonResponse({**cached, "from_cache": True})

        data_access = InterviewsDataAccess(request=request)
        result = data_access.get_per_cohort_metrics(
            name_pattern=name_pattern,
            max_cohorts=max_cohorts,
            start_date=start_date,
            end_date=end_date,
        )
        if not result.get("error"):
            cache.set(cache_key, result, COHORT_CACHE_TTL_SECONDS)
        return JsonResponse({**result, "from_cache": False})


class InterviewsSyncTriggerView(LoginRequiredMixin, View):
    """POST → kick off the incremental Step 1 sync as a Celery task. Returns task_id."""

    def post(self, request):
        # Get OCS token from the user's session and pass it to the task
        ocs_oauth = request.session.get("ocs_oauth", {})
        token = ocs_oauth.get("access_token")
        if not token:
            return JsonResponse({"error": "OCS not authorized."}, status=400)

        experiment_id = request.POST.get("experiment_id") or DEFAULT_INTERVIEW_BOT_ID
        force_refresh = request.POST.get("force_refresh") == "1"
        max_sessions_raw = request.POST.get("max_sessions")
        try:
            max_sessions = int(max_sessions_raw) if max_sessions_raw else None
        except (TypeError, ValueError):
            max_sessions = None

        async_result = sync_interview_sessions_task.delay(
            experiment_id=experiment_id,
            force_refresh=force_refresh,
            max_sessions=max_sessions,
            ocs_oauth_token=token,
        )

        # Note: cache busting is handled client-side — after sync completes,
        # the dashboard JS calls loadCohortMetrics(true) which passes ?refresh=1,
        # bypassing the cache in InterviewsCohortMetricsView.get().

        return JsonResponse(
            {
                "task_id": async_result.id,
                "status": "started",
            }
        )


class InterviewsSyncStatusView(LoginRequiredMixin, View):
    """GET → poll a Celery task's progress. Used by the dashboard's refresh UI.

    Returns: {state, message, processed, total, result, error}
    """

    def get(self, request):
        task_id = request.GET.get("task_id")
        if not task_id:
            return JsonResponse({"error": "task_id required"}, status=400)

        result = AsyncResult(task_id)
        info = result.info if isinstance(result.info, dict) else {}
        return JsonResponse(
            {
                "state": result.state,
                "message": info.get("message", ""),
                "processed": info.get("processed"),
                "total": info.get("total"),
                "current_stage": info.get("current_stage"),
                "total_stages": info.get("total_stages"),
                "result": info.get("result"),
                "error": info.get("error") if result.state == "FAILURE" else None,
                "ready": result.ready(),
                "successful": result.successful() if result.ready() else None,
            }
        )


class InterviewsAnswersXlsxView(LoginRequiredMixin, View):
    """GET → stream the answers dataset as an Excel file (.xlsx).

    Schema mirrors Neal's R Step 1 answers.xlsx output exactly.
    Honors filters: ?cohort_pattern=...&start_date=...&end_date=...
    """

    def get(self, request):
        # Determine FLW usernames to filter by (if cohort filter provided)
        cohort_pattern_raw = request.GET.get("cohort_pattern")
        flw_usernames: list[str] | None = None

        if cohort_pattern_raw:
            try:
                pattern = re.compile(cohort_pattern_raw, re.IGNORECASE)
            except re.error:
                pattern = DEFAULT_NAME_PATTERN
            # Get FLW usernames from matching cohort opportunities
            from .data_access import _fetch_cohort_funnel, _fetch_opportunities, _get_connect_token

            token = _get_connect_token(request)
            if token:
                opps = _fetch_opportunities(token)
                cohort_opps = [o for o in opps if pattern.search(o.get("name", ""))]
                flw_usernames = []
                for opp in cohort_opps:
                    f = _fetch_cohort_funnel(opp, token)
                    flw_usernames.extend(f["flw_usernames"])

        start_date = _parse_date(request.GET.get("start_date"))
        end_date = _parse_date(request.GET.get("end_date"))

        data_access = InterviewsDataAccess(request=request)
        rows = data_access.get_answer_rows(
            flw_usernames=flw_usernames,
            start_date=start_date,
            end_date=end_date,
        )

        xlsx_bytes = build_answers_xlsx(rows)

        filename = f"interviews_answers_{timezone.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        response = HttpResponse(
            xlsx_bytes,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response


class InterviewsPerSessionXlsxView(LoginRequiredMixin, View):
    """GET → stream the pre-built one-row-per-session dataset.

    Source of truth is the OCS UI's CSV export (manually downloaded by
    whoever has admin access in OCS), which carries the rich
    Participant Data + Session State blobs that the public OCS API
    doesn't expose. The build script
    `build_per_session_dataset.py` (at repo root) reads that CSV and
    produces the XLSX served here. To refresh:

      1. Export sessions from OCS UI → drop the CSV at the path encoded
         in build_per_session_dataset.INPUT_CSV.
      2. Run `python build_per_session_dataset.py`.
      3. The XLSX it produces is what this view streams.
    """

    DATASET_PATH = os.path.join(os.path.dirname(__file__), "data", "per_session_dataset.xlsx")

    def get(self, request):
        if not os.path.exists(self.DATASET_PATH):
            return JsonResponse(
                {
                    "error": "Per-session dataset not yet generated. Run "
                    "build_per_session_dataset.py from the repo root."
                },
                status=404,
            )
        filename = f"per_session_dataset_{timezone.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        response = FileResponse(
            open(self.DATASET_PATH, "rb"),
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response


class InterviewsCohortXlsxView(LoginRequiredMixin, View):
    """GET → stream the per-cohort rollup table as an Excel file.

    Same columns as the dashboard's "Per-Cohort Metrics" table. Honors the same
    cohort regex + date filters the dashboard supports so what you download
    matches what you see. Used by Ali to do A/B comparison analysis offline.
    """

    def get(self, request):
        name_pattern_raw = request.GET.get("name_pattern", DEFAULT_NAME_PATTERN.pattern)
        try:
            name_pattern = re.compile(name_pattern_raw, re.IGNORECASE)
        except re.error:
            name_pattern = DEFAULT_NAME_PATTERN

        start_date = _parse_date(request.GET.get("start_date"))
        end_date = _parse_date(request.GET.get("end_date"))

        data_access = InterviewsDataAccess(request=request)
        result = data_access.get_per_cohort_metrics(
            name_pattern=name_pattern,
            start_date=start_date,
            end_date=end_date,
        )
        if result.get("error"):
            return JsonResponse({"error": result["error"]}, status=400)

        xlsx_bytes = build_cohort_xlsx(result.get("cohorts", []), totals=result.get("totals"))
        filename = f"interviews_cohort_metrics_{timezone.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
        response = HttpResponse(
            xlsx_bytes,
            content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        return response
