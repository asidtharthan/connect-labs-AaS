"""
Question matching utilities for Connect Interviews Step 1.

Two main capabilities:
1. **Word-overlap matching**: tag each AI message in a session with the
   canonical question (parent_qid) it most closely matches. Used for both
   single-part and multi-part question detection.
2. **LLM sub-question extraction**: for multi-part parent questions (e.g. A.5
   with sub-parts a/b/c/d), call Claude to split the conversation window into
   per-sub-question answers.

Direct port of the algorithm from `interviews_step1.r`. The prompts are copied
verbatim — they're tuned and shouldn't be modified without testing.
"""

import json
import logging
import re

from .llm_client import call_llm

logger = logging.getLogger(__name__)

# Same threshold as the R script. 0.65 = 65% of canonical question words must
# appear in the AI message for it to be considered a match.
SIMILARITY_THRESHOLD = 0.65

# AI messages that are pure follow-up probes etc. typically aren't full
# question intros. We split AI message text on sentence boundaries and prefer
# sentences ending with a "?".
SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


# Verbatim from the R script's STEP1_SYSTEM_PROMPT
SUB_QUESTION_SYSTEM_PROMPT = (
    "You are an expert at analyzing interview transcripts. "
    "You will be given a conversation segment between an AI interviewer and a frontline health worker (FLW), "
    "along with a list of sub-questions that should have been asked in this segment. "
    "Your job is to map each FLW response to the correct sub-question. "
    "Important rules: "
    "1. The first FLW response after the question is introduced typically answers the FIRST sub-question. "
    "2. Each subsequent FLW response typically answers the next sub-question in order. "
    "3. If the FLW corrects themselves (e.g. 'sorry, I meant X'), use the corrected value. "
    "4. If a sub-question was genuinely not answered, return null for that sub-question. "
    "5. Copy text verbatim from the FLW responses \u2014 do not paraphrase or summarize. "
    "6. Even very short answers like 'about 150' or 'malaria' are valid \u2014 extract them. "
    "CRITICAL: Respond ONLY with a valid JSON object. No explanation, no reasoning, no text before or after the JSON. "
    "Output the JSON object and nothing else. Do not write 'Wait' or any commentary after the JSON. "
    'Example output: {"A.5a": "about 150 children", "A.5b": "maybe 10 died", '
    '"A.5c": "malaria and diarrhea", "A.5d": null}'
)


def normalize_text(text: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace. Same as R's normalize_text."""
    if not text:
        return ""
    text = text.lower()
    text = re.sub(r"[^\w\s]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def word_overlap(asked: str, canonical: str) -> float:
    """Fraction of canonical's words that appear in asked.

    Same as R's word_overlap: `sum(b %in% a) / length(b)` where b = canonical words.
    """
    a_words = set(normalize_text(asked).split())
    b_words = normalize_text(canonical).split()
    if not b_words:
        return 0.0
    return sum(1 for w in b_words if w in a_words) / len(b_words)


def build_parent_question_list(
    questions: list[dict],
    interview_type: str | None = None,
) -> list[dict]:
    """Build deduped list of parent-level questions for matching.

    questions: rows from questions_round3_expanded.csv as dicts with keys
               'qid', 'topic', 'parent_qid', 'parent_question_text', 'alt_match_texts'
    interview_type: optional cohort filter (A/B/C/D/E). If set, only include
                    parent questions whose qid starts with this letter.

    Returns: list of {'qid': parent_qid, 'topic': ..., 'question_text': ...}
             where question_text may be parent_question_text OR an alt_match_text.
    """
    seen_parents: set[str] = set()
    primary: list[dict] = []
    alt: list[dict] = []

    for row in questions:
        parent_qid = row.get("parent_qid", "").strip()
        if not parent_qid:
            continue
        if interview_type and not parent_qid.startswith(interview_type):
            continue

        if parent_qid not in seen_parents:
            seen_parents.add(parent_qid)
            primary.append(
                {
                    "qid": parent_qid,
                    "topic": row.get("topic", ""),
                    "question_text": row.get("parent_question_text", ""),
                }
            )

        # alt match texts are pipe-delimited
        alt_texts = row.get("alt_match_texts", "")
        if alt_texts:
            for piece in alt_texts.split("|"):
                piece = piece.strip()
                if piece:
                    alt.append(
                        {
                            "qid": parent_qid,
                            "topic": row.get("topic", ""),
                            "question_text": piece,
                        }
                    )

    # Primary first, alts second — same order as the R version
    return primary + alt


def match_parent_question(
    ai_message: str,
    parent_list: list[dict],
    threshold: float = SIMILARITY_THRESHOLD,
) -> dict:
    """Match an AI message to a canonical parent question via word overlap.

    Tries sentence fragments (with a "?") first, then the full message. Returns
    the best match above threshold, or {'parent_qid': None, 'topic': None}.
    """
    if not ai_message:
        return {"parent_qid": None, "topic": None}

    msg = ai_message.strip()
    sentences = SENTENCE_SPLIT_RE.split(msg)
    candidates = [s for s in sentences if "?" in s]
    candidates.append(msg)
    # Dedup while preserving order
    seen = set()
    candidates = [c for c in candidates if not (c in seen or seen.add(c))]

    best_overlap = 0.0
    best = {"parent_qid": None, "topic": None}

    for cand in candidates:
        for parent in parent_list:
            overlap = word_overlap(cand, parent["question_text"])
            if overlap >= threshold and overlap > best_overlap:
                best_overlap = overlap
                best = {"parent_qid": parent["qid"], "topic": parent["topic"]}

    return best


def extract_sub_answers_llm(
    parent_qid: str,
    sub_questions: list[dict],
    conversation_segment: list[dict],
) -> dict | None:
    """Use Claude to split a conversation window into per-sub-question answers.

    parent_qid: the parent question id (e.g. 'A.5')
    sub_questions: list of dicts with 'qid' and 'question_text' for each sub-part
    conversation_segment: list of message dicts with 'role' (ai/human) and 'content'

    Returns dict like {'A.5a': 'answer', 'A.5b': 'answer', 'A.5c': None, ...}
    or None on failure.
    """
    sub_q_text = "\n".join(f"{sq['qid']}: {sq['question_text']}" for sq in sub_questions)

    conv_lines = []
    for msg in conversation_segment:
        role = msg.get("role", "").lower()
        speaker = "INTERVIEWER" if role in ("ai", "assistant") else "FLW"
        content = (msg.get("content") or "").strip()
        conv_lines.append(f"[{speaker}] {content}")
    conv_text = "\n".join(conv_lines)

    user_prompt = (
        f"Parent question: {parent_qid}\n\n"
        f"Sub-questions to extract:\n{sub_q_text}\n\n"
        f"Conversation:\n{conv_text}\n\n"
        f"Map each sub-question ID to the FLW's answer. Return JSON only."
    )

    try:
        raw = call_llm(SUB_QUESTION_SYSTEM_PROMPT, user_prompt, max_tokens=2500)
    except Exception as e:
        logger.warning(f"[step1 LLM {parent_qid}] API error: {e}")
        return None

    return _parse_sub_answers_json(raw, parent_qid)


def _parse_sub_answers_json(raw: str, parent_qid: str) -> dict | None:
    """Pull the first JSON object from the LLM response and parse it."""
    if not raw:
        return None
    clean = raw.replace("```json", "").replace("```", "").strip()

    # Try direct parse first
    try:
        result = json.loads(clean)
        if isinstance(result, dict):
            return result
    except json.JSONDecodeError:
        pass

    # Extract the first {...} block — handles models that wrap in commentary
    match = re.search(r"\{.*\}", clean, re.DOTALL)
    if not match:
        logger.warning(f"[step1 LLM {parent_qid}] No JSON object in response: {clean[:80]}")
        return None
    try:
        result = json.loads(match.group(0))
        if isinstance(result, dict):
            return result
    except json.JSONDecodeError as e:
        logger.warning(f"[step1 LLM {parent_qid}] JSON parse failed: {e} | {clean[:80]}")
    return None
