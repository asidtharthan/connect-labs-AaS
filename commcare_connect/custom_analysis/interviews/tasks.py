"""
Celery tasks for the Connect Interviews pipeline.

The main task is `sync_interview_sessions_task` which performs an incremental
sync of OCS sessions:

1. Looks at `InterviewSessionStatus` to find what's already processed
2. Pages through OCS sessions newest-first
3. **Stops as soon as it hits a session_id we've already processed** (so a
   "refresh" only fetches truly new sessions, not all 3700+)
4. For each new session, runs `extract_session_answers` and persists rows

The task uses `set_task_progress()` so the dashboard can stream progress via SSE.
"""

import csv
import logging
import os
import time
from datetime import datetime

import httpx
from django.db import transaction

from commcare_connect.labs.integrations.ocs.api_client import OCSAPIError, OCSDataAccess
from commcare_connect.utils.celery import set_task_progress
from config import celery_app

from .pipeline.llm_client import get_token_usage, reset_token_usage
from .pipeline.models import InterviewAnswer, InterviewSessionStatus
from .pipeline.step1_extract import extract_session_answers

logger = logging.getLogger(__name__)

# Default OCS bot for the Connect Interviews program.
DEFAULT_INTERVIEW_BOT_ID = "cc01d032-5931-4bdd-a4b2-6f05f4f72f88"

# Path to the questions file bundled with the app.
QUESTIONS_CSV_PATH = os.path.join(os.path.dirname(__file__), "questions_round3_expanded.csv")
QUESTIONS_VERSION = "round3_expanded"

# Pipeline version — bump when prompts/algorithm change to keep historical results.
PIPELINE_VERSION = "1.0"


def _load_questions() -> list[dict]:
    with open(QUESTIONS_CSV_PATH, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def _parse_iso(s) -> datetime | None:
    if not s:
        return None
    if isinstance(s, datetime):
        return s
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


def _list_sessions_newest_first(
    ocs: OCSDataAccess,
    experiment_id: str,
    known_session_ids: set[str],
    max_pages: int = 250,
    max_sessions: int | None = None,
    progress_cb=None,
) -> list[dict]:
    """Page through OCS sessions newest-first; stop on first known session_id.

    Returns the list of NEW (unknown) sessions found before hitting a known one.
    If max_sessions is set, stop after collecting that many (useful for testing).
    """
    if not ocs.check_token_valid():
        raise OCSAPIError("OCS OAuth not configured or expired.")

    url = f"{ocs.base_url}/api/sessions/"
    params = {"ordering": "-created_at", "page_size": 50, "experiment": experiment_id}

    new_sessions: list[dict] = []
    page = 0
    while url and page < max_pages:
        page += 1
        try:
            if page == 1:
                resp = ocs.http_client.get(url, params=params)
            else:
                resp = ocs.http_client.get(url)
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            logger.warning(f"Sessions page {page} failed ({e.response.status_code}); stopping pagination")
            break

        data = resp.json()
        results = data.get("results", []) or []

        for sess in results:
            sid = sess.get("id")
            if not sid:
                continue
            if sid in known_session_ids:
                logger.info(f"Hit known session {sid} on page {page}; stopping pagination")
                return new_sessions
            new_sessions.append(sess)
            # Test mode: stop early once we have enough sessions
            if max_sessions and len(new_sessions) >= max_sessions:
                logger.info(f"Reached max_sessions={max_sessions} on page {page}; stopping pagination")
                return new_sessions

        if progress_cb:
            progress_cb(page, len(new_sessions))

        url = data.get("next")

    return new_sessions


def _persist_session_results(
    *,
    session_id: str,
    participant_id: str,
    experiment_id: str,
    session_created_at: datetime | None,
    answer_rows: list[dict],
    total_messages: int,
    llm_calls: int,
    input_tokens: int,
    output_tokens: int,
    error_message: str = "",
    opportunity_id: int | None = None,
    cohort_name: str = "",
) -> None:
    """Atomically persist a single session's answer rows + status row.

    Per-session token counts are passed in as deltas (caller computes by
    snapshotting get_token_usage() before/after each session).

    opportunity_id / cohort_name: optional Connect cohort attribution. Populated
    when the caller has built a participant→cohort mapping (requires Connect token).
    """
    # A session counts as "processed" only if at least one answer row crosses the
    # completion threshold (>3 word substantive response). Sessions where the bot
    # asked questions but the FLW gave only short/empty answers are functionally
    # identical to "no questions matched" — re-classify as skipped to keep the
    # status field a useful signal of "real engagement happened here".
    status = InterviewSessionStatus.STATUS_PROCESSED
    if error_message:
        status = InterviewSessionStatus.STATUS_FAILED
    elif not answer_rows or not any(r.get("completed") for r in answer_rows):
        status = InterviewSessionStatus.STATUS_SKIPPED

    with transaction.atomic():
        # Wipe any prior rows for this (session_id, pipeline_version) — re-runs upsert
        InterviewAnswer.objects.filter(
            session_id=session_id,
            pipeline_version=PIPELINE_VERSION,
        ).delete()

        # Insert fresh rows
        InterviewAnswer.objects.bulk_create(
            [
                InterviewAnswer(
                    session_id=row["session_id"],
                    participant_id=row["participant_id"],
                    qid=row["qid"],
                    parent_qid=row["parent_qid"],
                    question_text=row["question_text"],
                    topic=row["topic"],
                    answer_text=row["answer_text"],
                    asked=row["asked"],
                    completed=row["completed"],
                    num_turns=row["num_turns"],
                    word_count=row["word_count"],
                    time_to_answer_seconds=row["time_to_answer_seconds"],
                    extraction_method=row["extraction_method"],
                    experiment_id=experiment_id,
                    questions_version=QUESTIONS_VERSION,
                    pipeline_version=PIPELINE_VERSION,
                    opportunity_id=opportunity_id,
                    cohort_name=cohort_name,
                )
                for row in answer_rows
            ]
        )

        # Upsert the status row
        defaults = {
            "participant_id": participant_id,
            "experiment_id": experiment_id,
            "pipeline_version": PIPELINE_VERSION,
            "status": status,
            "error_message": error_message,
            "total_messages": total_messages,
            "answer_rows_created": len(answer_rows),
            "llm_calls_made": llm_calls,
            "total_input_tokens": input_tokens,
            "total_output_tokens": output_tokens,
            "session_created_at": session_created_at,
        }
        if opportunity_id is not None:
            defaults["opportunity_id"] = opportunity_id
        InterviewSessionStatus.objects.update_or_create(
            session_id=session_id,
            defaults=defaults,
        )


@celery_app.task(bind=True)
def sync_interview_sessions_task(
    self,
    *,
    experiment_id: str = DEFAULT_INTERVIEW_BOT_ID,
    force_refresh: bool = False,
    max_sessions: int | None = None,
    ocs_oauth_token: str | None = None,
):
    """Incrementally sync OCS sessions into the InterviewAnswer table.

    Args:
        experiment_id: OCS bot UUID
        force_refresh: if True, re-process all sessions (ignore InterviewSessionStatus)
        max_sessions: optional cap on # of sessions to process (for testing)
        ocs_oauth_token: OCS Bearer token. Required because Celery doesn't have
                         access to the user's session/cookies.

    Stats are surfaced via Celery task progress (set_task_progress).
    """
    t0 = time.time()
    set_task_progress(self, "Starting sync...", current_stage=1, total_stages=4)

    if not ocs_oauth_token:
        set_task_progress(self, "Error: no OCS token provided", is_complete=True, error="missing_token")
        return {"error": "OCS OAuth token required", "new_sessions": 0}

    # Load questions once
    questions = _load_questions()

    # Known session IDs (skip these unless force_refresh)
    known_ids: set[str] = set()
    if not force_refresh:
        known_ids = set(
            InterviewSessionStatus.objects.filter(
                experiment_id=experiment_id, pipeline_version=PIPELINE_VERSION
            ).values_list("session_id", flat=True)
        )
    logger.info(f"Known sessions: {len(known_ids)}")

    # Build a minimal request-shaped object so OCSDataAccess can read the token.
    # OCSDataAccess only uses request.session.get("ocs_oauth", {}).get("access_token")
    class _FakeSession:
        def get(self, key, default=None):
            if key == "ocs_oauth":
                return {
                    "access_token": ocs_oauth_token,
                    "expires_at": time.time() + 3600,  # assume valid for the task duration
                }
            return default

    class _FakeRequest:
        session = _FakeSession()

    set_task_progress(self, "Fetching session list from OCS...", current_stage=2, total_stages=4)

    # List new sessions
    reset_token_usage()
    new_sessions: list[dict] = []
    try:
        with OCSDataAccess(request=_FakeRequest()) as ocs:

            def _list_progress(page, found_so_far):
                set_task_progress(
                    self,
                    f"Listing sessions: page {page}, {found_so_far} new found...",
                    current_stage=2,
                    total_stages=4,
                    processed=found_so_far,
                    total=None,
                )

            new_sessions = _list_sessions_newest_first(
                ocs,
                experiment_id=experiment_id,
                known_session_ids=known_ids,
                max_sessions=max_sessions,
                progress_cb=_list_progress,
            )
            logger.info(f"Found {len(new_sessions)} new sessions to process")

            if not new_sessions:
                set_task_progress(
                    self,
                    "No new sessions to process.",
                    is_complete=True,
                    new_sessions=0,
                    elapsed_seconds=time.time() - t0,
                )
                return {"new_sessions": 0, "rows_created": 0, "elapsed_seconds": time.time() - t0}

            # Process each session
            set_task_progress(
                self,
                f"Processing {len(new_sessions)} new sessions...",
                current_stage=3,
                total_stages=4,
                processed=0,
                total=len(new_sessions),
            )

            total_rows = 0
            for i, sess_summary in enumerate(new_sessions, start=1):
                sid = sess_summary.get("id")
                participant_id = (sess_summary.get("participant", {}) or {}).get("identifier", "")
                session_created_at = _parse_iso(sess_summary.get("created_at"))

                # Snapshot LLM token usage BEFORE processing this session
                before = get_token_usage()

                # Fetch full session (for messages)
                error_msg = ""
                rows: list[dict] = []
                msg_count = 0
                try:
                    full = ocs.get_session(sid)
                    if full:
                        messages = full.get("messages", []) or []
                        msg_count = len(messages)
                        rows = extract_session_answers(
                            session_id=sid,
                            participant_id=participant_id,
                            messages=messages,
                            questions=questions,
                            use_llm_for_multipart=True,
                        )
                except OCSAPIError as e:
                    error_msg = f"OCS error: {e}"
                    logger.warning(f"Session {sid}: {error_msg}")
                except Exception as e:
                    error_msg = f"Unexpected: {e}"
                    logger.exception(f"Session {sid}: unexpected error")

                # Compute token delta for THIS session only
                after = get_token_usage()
                session_calls = after["calls"] - before["calls"]
                session_input = after["input"] - before["input"]
                session_output = after["output"] - before["output"]

                _persist_session_results(
                    session_id=sid,
                    participant_id=participant_id,
                    experiment_id=experiment_id,
                    session_created_at=session_created_at,
                    answer_rows=rows,
                    total_messages=msg_count,
                    llm_calls=session_calls,
                    input_tokens=session_input,
                    output_tokens=session_output,
                    error_message=error_msg,
                )
                total_rows += len(rows)

                # Progress every 5 sessions or on last
                if i % 5 == 0 or i == len(new_sessions):
                    set_task_progress(
                        self,
                        f"Processed {i}/{len(new_sessions)} sessions ({total_rows} answer rows)...",
                        current_stage=3,
                        total_stages=4,
                        processed=i,
                        total=len(new_sessions),
                    )

    except OCSAPIError as e:
        set_task_progress(self, f"OCS error: {e}", is_complete=True, error=str(e))
        return {"error": str(e), "new_sessions": 0}
    except Exception as e:
        logger.exception("sync_interview_sessions_task failed")
        set_task_progress(self, f"Unexpected error: {e}", is_complete=True, error=str(e))
        return {"error": str(e), "new_sessions": 0}

    elapsed = time.time() - t0
    usage = get_token_usage()
    summary = {
        "new_sessions": len(new_sessions),
        "rows_created": total_rows,
        "llm_calls": usage.get("calls", 0),
        "input_tokens": usage.get("input", 0),
        "output_tokens": usage.get("output", 0),
        "elapsed_seconds": round(elapsed, 1),
    }
    set_task_progress(
        self,
        f"Done. {len(new_sessions)} new sessions, {total_rows} answer rows, "
        f"{usage.get('calls', 0)} LLM calls in {elapsed:.0f}s.",
        is_complete=True,
        result=summary,
    )
    return summary
