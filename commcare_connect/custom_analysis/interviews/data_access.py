"""
Data access for the Connect Interviews dashboard.

Each cohort = a separate Connect opportunity. We use a HYBRID source strategy:

- **FLW funnel** (claimed, assessment done) comes from Connect production APIs —
  those are Connect platform events, authoritative there.
- **Interview metrics** (≥1 interview, total interviews, completion rate, median
  message length) come from our `InterviewAnswer` Postgres table populated by
  the Step 1 pipeline. This is Neal's `answers.csv` substrate — the same
  dataset feeds future Steps 2-6 metrics.

Why hybrid: claims/assessments only exist in Connect; interviews are the
substance of OCS chat sessions and need per-question parsing. Reading from one
place each removes ambiguity.
"""

import csv
import io
import logging
import re
import statistics
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

import httpx
from django.conf import settings
from django.db.models import Sum
from django.http import HttpRequest

from .pipeline.models import InterviewAnswer, InterviewSessionStatus

logger = logging.getLogger(__name__)

# Default name pattern: only bracketed cohort-tagged opportunities under
# COWACDI or EHA partners that are explicitly Interviews opps.
# Matches: "[01TRS] COWACDI Interviews", "[1ABT1EA1] EHA Interviews"
# Rejects: "[TEST] COWACDI CHC 50k", "[Test] EHA - Kangaroo Mother Care", etc.
DEFAULT_NAME_PATTERN = re.compile(r"^\[[^\]]+\]\s*(COWACDI|EHA)\b[^\[]*\binterview", re.IGNORECASE)

# Concurrency for parallel cohort fetches (Connect /user_data/).
COHORT_FETCH_CONCURRENCY = 8


def _get_connect_token(request: HttpRequest) -> str | None:
    from django.utils import timezone

    labs = request.session.get("labs_oauth", {})
    if timezone.now().timestamp() >= labs.get("expires_at", 0):
        return None
    return labs.get("access_token")


def _fetch_csv(url: str, token: str, timeout: float = 60.0) -> list[dict]:
    """Fetch a CSV from Connect and return list of dict rows."""
    headers = {"Authorization": f"Bearer {token}"}
    try:
        with httpx.Client(headers=headers, timeout=timeout, follow_redirects=True) as client:
            resp = client.get(url)
            resp.raise_for_status()
    except httpx.HTTPError as e:
        logger.warning(f"CSV fetch failed for {url}: {e}")
        return []
    return list(csv.DictReader(io.StringIO(resp.text)))


def _fetch_opportunities(token: str) -> list[dict]:
    """Fetch the full list of opportunities the user has access to."""
    headers = {"Authorization": f"Bearer {token}"}
    url = f"{settings.CONNECT_PRODUCTION_URL}/export/opp_org_program_list/"
    try:
        with httpx.Client(headers=headers, timeout=30, follow_redirects=True) as client:
            resp = client.get(url)
            resp.raise_for_status()
    except httpx.HTTPError as e:
        logger.error(f"Failed to fetch opportunity list: {e}")
        return []
    data = resp.json()
    if isinstance(data, dict):
        return data.get("opportunities", []) or []
    return data or []


def _max_visits_from_claim_limits(raw: str) -> int:
    """Parse the claim_limits column: sum of all max_visits across payment units."""
    if not raw:
        return 0
    matches = re.findall(r"'max_visits':\s*(\d+)", raw)
    return sum(int(m) for m in matches) if matches else 0


def _fetch_cohort_funnel(opp: dict, token: str) -> dict:
    """Fetch FLW funnel + Connect visits for one opportunity.

    Pulls two sources:
    - /user_data/ → claim/assessment counts and the claimed-FLW list
    - /user_visits/ → Connect's authoritative (FLW, date) → cohort attribution.
      Each row in user_visits is a delivered service tied to *this* opportunity_id.
      We use the (username, visit_date) pairs to canonically attribute OCS sessions
      to a single cohort (option A in the cross-check), eliminating the per-cohort
      double-counting that occurs when a FLW is claimed in multiple cohorts.
    """
    opp_id = opp.get("id")
    name = opp.get("name", "")
    base = settings.CONNECT_PRODUCTION_URL

    user_data_rows = _fetch_csv(f"{base}/export/opportunity/{opp_id}/user_data/", token, timeout=30)
    user_visits = _fetch_csv(f"{base}/export/opportunity/{opp_id}/user_visits/", token, timeout=30)

    flws_claimed = sum(1 for r in user_data_rows if r.get("date_claimed", "").strip())
    flws_completed_assessment = sum(1 for r in user_data_rows if r.get("completed_learn_date", "").strip())
    total_expected_interviews = sum(_max_visits_from_claim_limits(r.get("claim_limits", "")) for r in user_data_rows)
    flw_usernames = [r["username"] for r in user_data_rows if r.get("username") and r.get("date_claimed", "").strip()]

    # Connect's authoritative attribution: every (username, visit_date) here belongs
    # to THIS cohort. We'll match OCS sessions to these pairs in the rollup.
    visit_user_dates: set[tuple[str, str]] = set()
    for v in user_visits:
        u = v.get("username")
        d = (v.get("visit_date") or "")[:10]  # YYYY-MM-DD prefix
        if u and d:
            visit_user_dates.add((u, d))

    # Connect's count of services delivered for THIS cohort (= visit_count on the
    # opp metadata page; matches the dashboard the user showed me).
    connect_services_delivered = opp.get("visit_count", len(user_visits))
    connect_approved = sum(1 for v in user_visits if v.get("status") == "approved")
    connect_over_limit = sum(1 for v in user_visits if v.get("status") == "over_limit")

    return {
        "opportunity_id": opp_id,
        "cohort": name,
        "flws_claimed": flws_claimed,
        "flws_completed_assessment": flws_completed_assessment,
        "total_expected_interviews": total_expected_interviews,
        "flw_usernames": flw_usernames,
        "connect_services_delivered": connect_services_delivered,
        "connect_approved": connect_approved,
        "connect_over_limit": connect_over_limit,
        "visit_user_dates": visit_user_dates,
    }


def _interview_metrics_from_db(
    flw_usernames: list[str],
    visit_user_dates: set[tuple[str, str]] | None = None,
    pipeline_version: str = "1.0",
    start_date: datetime | None = None,
    end_date: datetime | None = None,
) -> dict:
    """Roll up InterviewAnswer rows for one cohort.

    `visit_user_dates` (Connect's user_visits as (username, date) pairs) is
    accepted for future use but NOT used for filtering — investigation showed
    that strict (username, date) matching drops 38% of OCS sessions because
    Connect's visit_count counts service deliveries via any path (bot, mobile
    app form, etc.), while OCS only records bot conversations. The two numbers
    are surfaced side-by-side instead of being reconciled into one.
    """
    if not flw_usernames:
        return {
            "flws_with_completed_interview": 0,
            "interviews_completed": 0,
            "completed_qids": 0,
            "asked_qids": 0,
            "median_message_length": 0,
        }

    base_qs = InterviewAnswer.objects.filter(
        participant_id__in=flw_usernames,
        pipeline_version=pipeline_version,
    )

    # Optional date filter: join through InterviewSessionStatus.session_created_at
    if start_date or end_date:
        session_qs = InterviewSessionStatus.objects.filter(
            pipeline_version=pipeline_version,
        )
        if start_date:
            session_qs = session_qs.filter(session_created_at__gte=start_date)
        if end_date:
            session_qs = session_qs.filter(session_created_at__lte=end_date)
        valid_session_ids = list(session_qs.values_list("session_id", flat=True))
        base_qs = base_qs.filter(session_id__in=valid_session_ids)

    # FLWs with at least one completed answer
    flws_with_completed = base_qs.filter(completed=True).values("participant_id").distinct().count()

    # Distinct sessions where at least one row is completed = "interviews completed"
    completed_session_ids = base_qs.filter(completed=True).values_list("session_id", flat=True).distinct()
    interviews_completed = len(completed_session_ids)

    # Completion rate (qid-level): completed / asked
    completed_qids = base_qs.filter(completed=True).count()
    asked_qids = base_qs.filter(asked=True).count()

    # Median word count per *parent question answered*. Multi-part questions
    # generate N sub-rows (e.g. A.5 → A.5a/b/c/d), each holding a fragment of the
    # FLW's answer. Naively medianing every row biases low because fragments
    # outnumber whole single-part answers. Grouping by (session_id, parent_qid)
    # and summing word_count first treats one multi-part answer as a single
    # "response" — matching Ali's "median word count per response" intent.
    parent_word_counts = list(
        base_qs.filter(completed=True, word_count__gt=0)
        .values("session_id", "parent_qid")
        .annotate(total_wc=Sum("word_count"))
        .values_list("total_wc", flat=True)
    )
    median_msg = round(statistics.median(parent_word_counts), 1) if parent_word_counts else 0

    return {
        "flws_with_completed_interview": flws_with_completed,
        "interviews_completed": interviews_completed,
        "completed_qids": completed_qids,
        "asked_qids": asked_qids,
        "median_message_length": median_msg,
    }


class InterviewsDataAccess:
    """Hybrid data access: Connect for FLW funnel, InterviewAnswer for interview metrics."""

    def __init__(self, request: HttpRequest):
        self.request = request

    def get_per_cohort_metrics(
        self,
        name_pattern: re.Pattern[str] = DEFAULT_NAME_PATTERN,
        max_cohorts: int | None = None,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
    ) -> dict:
        """Compute per-cohort metrics. Connect for funnel, InterviewAnswer for interviews.

        Args:
            name_pattern: regex matching opportunity names
            max_cohorts: optional cap (for testing)
            start_date: optional lower bound on session_created_at
            end_date: optional upper bound on session_created_at
        """
        t0 = time.time()
        token = _get_connect_token(self.request)
        if not token:
            return {"cohorts": [], "totals": {}, "error": "Connect not authorized."}

        # Discover cohort opportunities
        all_opps = _fetch_opportunities(token)
        cohort_opps = [o for o in all_opps if isinstance(o, dict) and name_pattern.search(o.get("name", ""))]
        # Sort alphabetically by cohort name for stable order ([01TRS] before [02TRS] etc.)
        cohort_opps.sort(key=lambda o: o.get("name", ""))
        if max_cohorts:
            cohort_opps = cohort_opps[:max_cohorts]
        logger.info(
            f"Cohort metrics: matched {len(cohort_opps)}/{len(all_opps)} opps "
            f"with pattern {name_pattern.pattern!r}"
        )

        # Fetch FLW funnel (Connect) for each cohort in parallel
        funnel_rows: list[dict] = []
        with ThreadPoolExecutor(max_workers=COHORT_FETCH_CONCURRENCY) as executor:
            futures = {executor.submit(_fetch_cohort_funnel, opp, token): opp.get("id") for opp in cohort_opps}
            for fut in as_completed(futures):
                try:
                    funnel_rows.append(fut.result())
                except Exception:
                    logger.exception(f"Funnel fetch failed for opp {futures[fut]}")

        # For each cohort, roll up interview metrics from InterviewAnswer.
        # Pass `visit_user_dates` from Connect's /user_visits/ for canonical
        # session→cohort attribution (eliminates 28% over-counting from FLWs
        # claimed in multiple cohorts; see cross_check.py).
        rows: list[dict] = []
        for funnel in funnel_rows:
            interview_metrics = _interview_metrics_from_db(
                flw_usernames=funnel["flw_usernames"],
                visit_user_dates=funnel.get("visit_user_dates"),
                start_date=start_date,
                end_date=end_date,
            )
            total_expected = funnel["total_expected_interviews"]
            interviews_completed = interview_metrics["interviews_completed"]
            connect_services_delivered = funnel.get("connect_services_delivered", 0)
            completion_rate = round(100.0 * interviews_completed / total_expected, 1) if total_expected > 0 else 0.0
            rows.append(
                {
                    "opportunity_id": funnel["opportunity_id"],
                    "cohort": funnel["cohort"],
                    "flws_claimed": funnel["flws_claimed"],
                    "flws_completed_assessment": funnel["flws_completed_assessment"],
                    "flws_with_completed_interview": interview_metrics["flws_with_completed_interview"],
                    "interviews_completed": interviews_completed,
                    "connect_services_delivered": connect_services_delivered,
                    "connect_approved": funnel.get("connect_approved", 0),
                    "connect_over_limit": funnel.get("connect_over_limit", 0),
                    "total_expected_interviews": total_expected,
                    "completion_rate": completion_rate,
                    "median_message_length": interview_metrics["median_message_length"],
                }
            )

        rows.sort(key=lambda r: r["cohort"])

        # Aggregate totals
        totals = {
            "total_cohorts": len(rows),
            "total_flws_claimed": sum(r["flws_claimed"] for r in rows),
            "total_flws_completed_assessment": sum(r["flws_completed_assessment"] for r in rows),
            "total_flws_with_completed_interview": sum(r["flws_with_completed_interview"] for r in rows),
            "total_interviews_completed": sum(r["interviews_completed"] for r in rows),
            "total_connect_services_delivered": sum(r["connect_services_delivered"] for r in rows),
            "total_expected_interviews": sum(r["total_expected_interviews"] for r in rows),
        }
        if totals["total_expected_interviews"] > 0:
            totals["overall_completion_rate"] = round(
                100.0 * totals["total_interviews_completed"] / totals["total_expected_interviews"], 1
            )
        else:
            totals["overall_completion_rate"] = 0.0

        # Sync status indicator: latest session we've processed
        latest_status = InterviewSessionStatus.objects.order_by("-processed_at").first()
        last_synced = latest_status.processed_at.isoformat() if latest_status else None
        sessions_processed = InterviewSessionStatus.objects.count()

        elapsed = time.time() - t0
        logger.info(f"Cohort metrics computed in {elapsed:.1f}s for {len(rows)} cohorts")

        return {
            "cohorts": rows,
            "totals": totals,
            "last_synced_at": last_synced,
            "sessions_processed": sessions_processed,
            "error": None,
        }

    def get_answer_rows(
        self,
        flw_usernames: list[str] | None = None,
        start_date: datetime | None = None,
        end_date: datetime | None = None,
        pipeline_version: str = "1.0",
    ) -> list[dict]:
        """Return InterviewAnswer rows as dicts, optionally filtered.

        Used by the XLSX export endpoint. Schema mirrors Neal's answers.xlsx.
        """
        qs = InterviewAnswer.objects.filter(pipeline_version=pipeline_version).order_by("session_id", "qid")
        if flw_usernames:
            qs = qs.filter(participant_id__in=flw_usernames)
        if start_date or end_date:
            session_qs = InterviewSessionStatus.objects.filter(pipeline_version=pipeline_version)
            if start_date:
                session_qs = session_qs.filter(session_created_at__gte=start_date)
            if end_date:
                session_qs = session_qs.filter(session_created_at__lte=end_date)
            valid_session_ids = list(session_qs.values_list("session_id", flat=True))
            qs = qs.filter(session_id__in=valid_session_ids)

        return list(
            qs.values(
                "session_id",
                "participant_id",
                "qid",
                "parent_qid",
                "question_text",
                "topic",
                "answer_text",
                "asked",
                "completed",
                "num_turns",
                "word_count",
                "time_to_answer_seconds",
                "extraction_method",
            )
        )

    def get_session_metrics(self, experiment_id: str | None = None) -> dict:
        """Top-level session counts. Reads from local InterviewSessionStatus table."""
        qs = InterviewSessionStatus.objects.all()
        if experiment_id:
            qs = qs.filter(experiment_id=experiment_id)
        total = qs.count()
        unique_participants = qs.values("participant_id").distinct().count()
        return {
            "total_sessions": total,
            "unique_participants": unique_participants,
            "error": None,
        }
