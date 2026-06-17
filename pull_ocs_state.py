"""Pull LIVE OCS sessions (with Session State) -> _ocs_state_cache.json. ALWAYS re-pulls (overwrites).

Standalone (no Django) so the daily job can run it headless.
OCS bearer key from env OCS_API_KEY (CI secret) or untracked .ocs_creds.json locally — never hardcoded.
Output shape matches what build_master_4src.py reads: {sid, pid, interview, interview_status, created_at}.
"""
import json
import os
from pathlib import Path

import httpx

BASE = os.environ.get("OCS_BASE_URL", "https://www.openchatstudio.com")
EXP = os.environ.get("OCS_EXPERIMENT", "cc01d032-5931-4bdd-a4b2-6f05f4f72f88")


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
        r = c.get(url, params=params if page == 1 else None)
        r.raise_for_status()
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
