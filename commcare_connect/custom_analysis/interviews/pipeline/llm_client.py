"""
Anthropic Claude wrapper for the Connect Interviews pipeline.

Wraps the `anthropic` SDK with retry/error-handling logic. Used by Step 1's
multi-part question extraction and (later) Step 2's scoring.

Mirrors the R script's `generate_response()` from transcript.r — same simple
"system prompt + user prompt → text" interface.
"""

import logging
import threading
import time

from anthropic import Anthropic, APIError, APITimeoutError
from django.conf import settings

logger = logging.getLogger(__name__)

# Default model — Claude Haiku for cost/speed (Step 1 doesn't need top-tier reasoning)
DEFAULT_MODEL = "claude-haiku-4-5-20251001"

# Retry config
MAX_RETRIES = 3
RETRY_BACKOFF_SECONDS = [2, 5, 10]  # Exponential-ish

# Token tracking (process-local; resets on restart)
_token_lock = threading.Lock()
_token_usage = {"input": 0, "output": 0, "calls": 0}


def reset_token_usage() -> None:
    with _token_lock:
        _token_usage["input"] = 0
        _token_usage["output"] = 0
        _token_usage["calls"] = 0


def get_token_usage() -> dict:
    with _token_lock:
        return dict(_token_usage)


def call_llm(
    system_prompt: str,
    user_prompt: str,
    max_tokens: int = 2500,
    model: str = DEFAULT_MODEL,
) -> str:
    """Call Claude with a system prompt + user prompt. Returns raw text response.

    Raises RuntimeError after retries are exhausted.
    """
    api_key = getattr(settings, "ANTHROPIC_API_KEY", None)
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not configured in settings.")

    client = Anthropic(api_key=api_key)

    last_error: Exception | None = None
    for attempt in range(MAX_RETRIES):
        try:
            response = client.messages.create(
                model=model,
                max_tokens=max_tokens,
                system=system_prompt,
                messages=[{"role": "user", "content": user_prompt}],
            )

            # Track token usage (thread-safe for gthread workers)
            usage = response.usage
            with _token_lock:
                _token_usage["input"] += getattr(usage, "input_tokens", 0)
                _token_usage["output"] += getattr(usage, "output_tokens", 0)
                _token_usage["calls"] += 1

            # Concatenate text blocks
            text_parts = [block.text for block in response.content if hasattr(block, "text")]
            return "".join(text_parts)

        except APITimeoutError as e:
            last_error = e
            backoff = RETRY_BACKOFF_SECONDS[min(attempt, len(RETRY_BACKOFF_SECONDS) - 1)]
            logger.warning(f"Anthropic timeout (attempt {attempt + 1}/{MAX_RETRIES}); retrying in {backoff}s")
            time.sleep(backoff)
        except APIError as e:
            last_error = e
            # 5xx is retryable; 4xx isn't
            status = getattr(e, "status_code", 0)
            if status >= 500 and attempt < MAX_RETRIES - 1:
                backoff = RETRY_BACKOFF_SECONDS[min(attempt, len(RETRY_BACKOFF_SECONDS) - 1)]
                logger.warning(
                    f"Anthropic {status} error (attempt {attempt + 1}/{MAX_RETRIES}); retrying in {backoff}s"
                )
                time.sleep(backoff)
            else:
                raise RuntimeError(f"Anthropic API error: {e}") from e

    raise RuntimeError(f"Anthropic call failed after {MAX_RETRIES} retries: {last_error}")
