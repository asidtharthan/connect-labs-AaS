"""
Step 1: extract per-(session, qid) answer rows from OCS session messages.

Direct port of Neal's R `extract_session_answers()` from `interviews_step1.r`.
Each session is walked once: AI messages get tagged with their parent_qid via
word-overlap matching; the conversation window between two parent-question
intros is the FLW's answer to that parent question.

Single-part questions: concatenate FLW turns with " | ", count words, mark
completed if any turn has > SHORT_TURN_THRESHOLD words.

Multi-part questions (e.g. A.5 has sub-questions A.5a/b/c/d): split via a
positional heuristic — the i-th FLW turn becomes the answer to the i-th
sub-question. If there are more turns than sub-questions, the last
sub-question absorbs the extras (joined with " | "). If there are fewer
turns than sub-questions, trailing sub-questions are marked unanswered.
This is pure-Python (no LLM) per Ali's "python script, not LLM" directive
for the V1 dashboard. The LLM-based splitter is still available behind
`use_llm_for_multipart=True` AND `ANTHROPIC_API_KEY` being configured.

Returns a list of dicts matching the InterviewAnswer model schema.
"""

import logging
import time
from datetime import datetime, timezone
from typing import Any

from .question_matching import build_parent_question_list, extract_sub_answers_llm, match_parent_question

logger = logging.getLogger(__name__)

# Same as the R script. A "turn" with more than this many words counts as a
# substantive answer; otherwise the question is treated as not completed.
SHORT_TURN_THRESHOLD = 3

# Delay between LLM calls (matches R's 0.5s pause).
LLM_DELAY_SECONDS = 0.5


def _anthropic_key_configured() -> bool:
    """Quick check so we can skip LLM calls (and their delay) entirely when
    the API key isn't set. Avoids paying the per-question sleep penalty in
    environments without Anthropic access."""
    from django.conf import settings

    key = getattr(settings, "ANTHROPIC_API_KEY", None)
    return bool(key) and len(key) > 10


def _word_count(text: str) -> int:
    if not text:
        return 0
    return len(text.split())


def _parse_timestamp(value: Any) -> datetime | None:
    """OCS returns ISO-8601 strings. Be tolerant of missing/garbage values."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    try:
        # Strip trailing Z (UTC marker) since fromisoformat handles +00:00 better
        s = str(value).replace("Z", "+00:00")
        return datetime.fromisoformat(s)
    except (ValueError, TypeError):
        return None


def _seconds_between(a: Any, b: Any) -> float | None:
    """Seconds between two timestamps, or None if either is unparseable."""
    da, db = _parse_timestamp(a), _parse_timestamp(b)
    if da is None or db is None:
        return None
    return (da - db).total_seconds()


def _make_answer_row(
    *,
    session_id: str,
    participant_id: str,
    qid: str,
    parent_qid: str,
    question_text: str,
    topic: str,
    answer_text: str | None,
    asked: bool,
    completed: bool,
    num_turns: int | None,
    word_count: int,
    time_to_answer_seconds: float | None,
    extraction_method: str,
) -> dict:
    return {
        "session_id": session_id,
        "participant_id": participant_id or "",
        "qid": qid,
        "parent_qid": parent_qid,
        "question_text": question_text or "",
        "topic": topic or "",
        "answer_text": answer_text,
        "asked": asked,
        "completed": completed,
        "num_turns": num_turns,
        "word_count": word_count,
        "time_to_answer_seconds": time_to_answer_seconds,
        "extraction_method": extraction_method,
    }


def _normalize_messages(messages: list[dict]) -> list[dict]:
    """Sort by timestamp, normalize role names, strip content. Returns new list."""
    normalized: list[dict] = []
    for m in messages:
        role = (m.get("role") or m.get("type") or "").lower()
        if role == "assistant":
            role = "ai"
        elif role == "user":
            role = "human"
        normalized.append(
            {
                "role": role,
                "content": (m.get("content") or "").strip(),
                "created_at": m.get("created_at") or m.get("timestamp"),
            }
        )
    # Sort by timestamp; messages without timestamps go to the end (preserve order)
    normalized.sort(key=lambda m: _parse_timestamp(m["created_at"]) or datetime.max.replace(tzinfo=timezone.utc))
    return normalized


def extract_session_answers(
    *,
    session_id: str,
    participant_id: str,
    messages: list[dict],
    questions: list[dict],
    use_llm_for_multipart: bool = True,
    interview_type: str | None = None,
) -> list[dict]:
    """Extract answer rows for a single session.

    Args:
        session_id: OCS session UUID
        participant_id: FLW identifier
        messages: list of dicts with 'role' (ai/human or assistant/user),
                  'content', 'created_at'
        questions: rows from questions_round3_expanded.csv as dicts
        use_llm_for_multipart: if False, multi-part questions get blank rows
                               (Phase B mode). True for full Step 1.
        interview_type: optional cohort filter (A/B/C/D/E). None = match all.

    Returns:
        list of dicts matching the InterviewAnswer model schema. May be empty
        if no questions were matched in the session.
    """
    if not messages:
        return []

    msgs = _normalize_messages(messages)
    parent_list = build_parent_question_list(questions, interview_type)

    # Tag each AI message with its matched parent_qid
    matched: list[tuple[int, str, str]] = []  # (msg_index, parent_qid, topic)
    for i, m in enumerate(msgs):
        if m["role"] != "ai":
            continue
        match = match_parent_question(m["content"], parent_list)
        pq = match.get("parent_qid")
        if pq:
            matched.append((i, pq, match.get("topic") or ""))

    if not matched:
        return []

    # Build a per-parent_qid index of all sub-questions (for multi-part handling)
    sub_qs_by_parent: dict[str, list[dict]] = {}
    for q in questions:
        pq = q.get("parent_qid", "").strip()
        if not pq:
            continue
        sub_qs_by_parent.setdefault(pq, []).append(q)

    results: list[dict] = []
    seen_parents: set[str] = set()

    # Walk matched AI messages in order; first occurrence of each parent_qid wins
    for idx, (msg_idx, parent_qid, topic) in enumerate(matched):
        if parent_qid in seen_parents:
            continue
        seen_parents.add(parent_qid)

        q_time = msgs[msg_idx]["created_at"]

        # Window end = the next AI message whose parent_qid is NOT yet seen,
        # i.e. the next "new" parent question intro
        next_msg_idx = len(msgs)  # end of session
        for j in range(idx + 1, len(matched)):
            future_pq = matched[j][1]
            if future_pq not in seen_parents:
                next_msg_idx = matched[j][0]
                break

        # Window: from this AI msg (inclusive) to next_msg_idx (exclusive)
        window = msgs[msg_idx:next_msg_idx]
        human_turns = [m for m in window if m["role"] == "human"]

        # Sub-questions for this parent (1 if single-part, N if multi-part)
        sub_qs = sub_qs_by_parent.get(parent_qid, [])
        if not sub_qs:
            # Shouldn't happen if matching is consistent with the questions file
            logger.warning(f"Matched parent_qid={parent_qid} but no sub-questions found")
            continue

        # Determine if this is multi-part: more than 1 row OR the only row's qid != parent_qid
        is_multi = len(sub_qs) > 1 or sub_qs[0].get("qid") != parent_qid

        if not is_multi:
            # Single-part question
            sub_q = sub_qs[0]
            qid = sub_q.get("qid", parent_qid)
            q_text = sub_q.get("question_text", "")

            if not human_turns:
                results.append(
                    _make_answer_row(
                        session_id=session_id,
                        participant_id=participant_id,
                        qid=qid,
                        parent_qid=parent_qid,
                        question_text=q_text,
                        topic=topic,
                        answer_text=None,
                        asked=True,
                        completed=False,
                        num_turns=0,
                        word_count=0,
                        time_to_answer_seconds=None,
                        extraction_method="word_overlap",
                    )
                )
                continue

            answer_text = " | ".join(t["content"] for t in human_turns)
            num_turns = len(human_turns)
            word_count = _word_count(answer_text)
            time_to_answer = _seconds_between(human_turns[0]["created_at"], q_time)
            completed = any(_word_count(t["content"]) > SHORT_TURN_THRESHOLD for t in human_turns)

            results.append(
                _make_answer_row(
                    session_id=session_id,
                    participant_id=participant_id,
                    qid=qid,
                    parent_qid=parent_qid,
                    question_text=q_text,
                    topic=topic,
                    answer_text=answer_text,
                    asked=True,
                    completed=completed,
                    num_turns=num_turns,
                    word_count=word_count,
                    time_to_answer_seconds=time_to_answer,
                    extraction_method="word_overlap",
                )
            )

        else:
            # Multi-part question. Two extraction strategies:
            #   1. POSITIONAL (default, no LLM): map human_turns[i] -> sub_qs[i] by index.
            #      If there are fewer turns than sub-questions, trailing sub-questions
            #      are marked unanswered. If there are MORE turns than sub-questions,
            #      the last sub-question absorbs all remaining turns joined with " | ".
            #   2. LLM: send the conversation window to Claude to split into sub-answers.
            #      Only used when use_llm_for_multipart=True AND ANTHROPIC_API_KEY is set.
            #
            # Positional is the V1 default per Ali's directive that landing-page metrics
            # be "calculated with python script (not LLM)". It is deterministic, costs
            # nothing, and reflects the typical OCS pattern where the bot asks sub-parts
            # in order and the FLW answers each in a separate turn.
            if not human_turns:
                # No FLW answers — mark every sub-question asked-but-not-answered
                for sub_q in sub_qs:
                    results.append(
                        _make_answer_row(
                            session_id=session_id,
                            participant_id=participant_id,
                            qid=sub_q["qid"],
                            parent_qid=parent_qid,
                            question_text=sub_q.get("question_text", ""),
                            topic=topic,
                            answer_text=None,
                            asked=True,
                            completed=False,
                            num_turns=0,
                            word_count=0,
                            time_to_answer_seconds=None,
                            extraction_method="positional",
                        )
                    )
                continue

            # Pick a strategy
            sub_answers: dict[str, str] = {}
            extraction_method = "positional"
            if use_llm_for_multipart and _anthropic_key_configured():
                sub_q_list = [
                    {"qid": sq.get("qid", ""), "question_text": sq.get("question_text", "")} for sq in sub_qs
                ]
                llm_result = extract_sub_answers_llm(
                    parent_qid=parent_qid,
                    sub_questions=sub_q_list,
                    conversation_segment=window,
                )
                time.sleep(LLM_DELAY_SECONDS)
                if llm_result:
                    extraction_method = "llm"
                    for k, v in llm_result.items():
                        if v is None or (isinstance(v, float) and v != v):
                            continue
                        s = str(v).strip()
                        if s:
                            sub_answers[k] = s

            # Positional fallback (also the default when LLM is disabled/unavailable)
            if extraction_method == "positional":
                n_subs = len(sub_qs)
                n_turns = len(human_turns)
                for i, sub_q in enumerate(sub_qs):
                    qid = sub_q.get("qid", "")
                    if not qid or i >= n_turns:
                        continue
                    if i == n_subs - 1 and n_turns > n_subs:
                        # Last sub-question absorbs all remaining turns
                        text = " | ".join(t["content"] for t in human_turns[i:])
                    else:
                        text = human_turns[i]["content"]
                    text = (text or "").strip()
                    if text:
                        sub_answers[qid] = text

            time_to_answer = _seconds_between(human_turns[0]["created_at"], q_time)

            for sub_q in sub_qs:
                qid = sub_q.get("qid", "")
                q_text = sub_q.get("question_text", "")

                answer_text = sub_answers.get(qid) or None
                is_answered = bool(answer_text)
                word_count = _word_count(answer_text or "")

                # Positional uses the same word-count threshold as single-part (matches
                # Neal's R script semantics). LLM extraction already filters by content,
                # so any non-empty LLM answer is treated as completed.
                if extraction_method == "positional":
                    completed = is_answered and word_count > SHORT_TURN_THRESHOLD
                else:
                    completed = is_answered

                results.append(
                    _make_answer_row(
                        session_id=session_id,
                        participant_id=participant_id,
                        qid=qid,
                        parent_qid=parent_qid,
                        question_text=q_text,
                        topic=topic,
                        answer_text=answer_text,
                        asked=True,
                        completed=completed,
                        num_turns=1 if (extraction_method == "positional" and is_answered) else None,
                        word_count=word_count,
                        time_to_answer_seconds=time_to_answer,
                        extraction_method=extraction_method,
                    )
                )

    return results
