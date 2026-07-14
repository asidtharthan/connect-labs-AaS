"""Pull LIVE OCS sessions (with Session State) -> _ocs_state_cache.json. ALWAYS re-pulls (overwrites).

Standalone (no Django) so the daily job can run it headless.
OCS bearer key from env OCS_API_KEY (CI secret) or untracked .ocs_creds.json locally — never hardcoded.
Output shape matches what build_master_4src.py reads: {sid, pid, interview, interview_status, created_at}.
"""
import json
import os
import time
from pathlib import Path

import httpx

BASE = os.environ.get("OCS_BASE_URL", "https://www.openchatstudio.com")
EXP = os.environ.get("OCS_EXPERIMENT", "cc01d032-5931-4bdd-a4b2-6f05f4f72f88")

# OCS occasionally returns a transient 5xx (e.g. 502 Bad Gateway) or drops the connection mid-pagination.
# A single blip should NOT abort the whole daily refresh, so retry idempotent GETs with exponential backoff.
RETRY_STATUS = {429, 500, 502, 503, 504}
MAX_RETRIES = 6


def _get_with_retry(client, url, params):
    """GET a page, retrying transient 5xx / network errors with exponential backoff. Raises on 4xx or exhaustion."""
    delay = 2.0
    last_exc = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = client.get(url, params=params)
            if r.status_code in RETRY_STATUS and attempt < MAX_RETRIES:
                print(f"    OCS {r.status_code} on attempt {attempt}/{MAX_RETRIES}; retrying in {delay:.0f}s...", flush=True)
                time.sleep(delay)
                delay = min(delay * 2, 60.0)
                continue
            r.raise_for_status()
            return r
        except (httpx.TransportError, httpx.TimeoutException) as e:  # connection reset, read timeout, etc.
            last_exc = e
            if attempt >= MAX_RETRIES:
                break
            print(f"    OCS network error on attempt {attempt}/{MAX_RETRIES} ({type(e).__name__}); retrying in {delay:.0f}s...", flush=True)
            time.sleep(delay)
            delay = min(delay * 2, 60.0)
    if last_exc:
        raise last_exc
    raise SystemExit(f"OCS still failing after {MAX_RETRIES} attempts: {url}")


def _ocs_key():
    k = os.environ.get("OCS_API_KEY")
    if k:
        return k
    p = Path(".ocs_creds.json")
    if p.exists():
        return json.loads(p.read_text()).get("ocs_api_key")
    raise SystemExit('No OCS key: set env OCS_API_KEY or add .ocs_creds.json {"ocs_api_key": "..."}')


KEY = _ocs_key()
CACHE = Path("_ocs_state_cache.json")


def pull():
    c = httpx.Client(headers={"Authorization": f"Bearer {KEY}"}, timeout=90.0)
    out = []
    url = f"{BASE}/api/sessions/"
    params = {"experiment": EXP, "ordering": "-created_at", "page_size": 200}
    page = 0
    while url:
        page += 1
        r = _get_with_retry(c, url, params if page == 1 else None)
        d = r.json()
        for s in d.get("results", []):
            st = s.get("state") if isinstance(s.get("state"), dict) else {}
            p = s.get("participant") or {}
            out.append(
                {
                    "sid": s.get("id"),
                    "pid": p.get("identifier") if isinstance(p, dict) else None,
                    "interview": (st or {}).get("interview"),
                    "interview_status": (st or {}).get("interview_status"),
                    "created_at": s.get("created_at"),
                }
            )
        url = d.get("next")
        if page % 10 == 0:
            print(f"    page {page}, {len(out)} sessions...", flush=True)
    CACHE.write_text(json.dumps(out))
    tagged = sum(1 for s in out if s.get("pid") and s.get("interview"))
    print(f"pulled {len(out)} OCS sessions ({tagged} tagged) -> {CACHE}", flush=True)
    return out


if __name__ == "__main__":
    pull()
