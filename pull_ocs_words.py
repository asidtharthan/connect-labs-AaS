"""Fetch OCS message content for TAGGED sessions and count FLW (human) words per session.

Writes incremental cache `_ocs_words_cache.json` = {sid: {human_words, human_msgs}}.
FLW message = message with role == "user"; word = whitespace token in `content`.
(The AI is role == "assistant".) Mirrors the historical Chat-Export logic in build_dropoff_v7f.py,
adapted to the OCS session-detail API (GET /api/sessions/{id}/ -> messages[]).

Reads the session list from `_ocs_state_cache.json` (produced by pull_ocs_state.py) and only fetches
tagged sessions (interview != null) not already cached. OCS key from env OCS_API_KEY or .ocs_creds.json.
"""
import concurrent.futures
import json
import os
import threading
from pathlib import Path

import httpx

BASE = os.environ.get("OCS_BASE_URL", "https://www.openchatstudio.com")
STATE_CACHE = Path("_ocs_state_cache.json")
WORDS_CACHE = Path("_ocs_words_cache.json")
MAX_WORKERS = 16


def ocs_key():
    k = os.environ.get("OCS_API_KEY")
    if k:
        return k
    p = Path(".ocs_creds.json")
    if p.exists():
        return json.loads(p.read_text()).get("ocs_api_key")
    raise SystemExit('No OCS key: set env OCS_API_KEY or add .ocs_creds.json {"ocs_api_key": "..."}')


_local = threading.local()


def _client(key):
    if not getattr(_local, "client", None):
        _local.client = httpx.Client(headers={"Authorization": f"Bearer {key}"}, timeout=60.0)
    return _local.client


def fetch_words(key, sid):
    cl = _client(key)
    for attempt in range(3):
        try:
            r = cl.get(f"{BASE}/api/sessions/{sid}/")
            r.raise_for_status()
            msgs = r.json().get("messages") or []
            hw = hm = 0
            for m in msgs:
                if isinstance(m, dict) and str(m.get("role") or "").lower() == "user":
                    hm += 1
                    hw += len(str(m.get("content") or "").split())
            return sid, {"human_words": hw, "human_msgs": hm}
        except Exception:
            if attempt == 2:
                return sid, None
    return sid, None


def main():
    key = ocs_key()
    sessions = json.loads(STATE_CACHE.read_text())
    tagged = [s["sid"] for s in sessions if s.get("sid") and s.get("interview") and str(s["interview"]).strip()]
    cache = json.loads(WORDS_CACHE.read_text()) if WORDS_CACHE.exists() else {}
    todo = [sid for sid in dict.fromkeys(tagged) if sid not in cache]
    print(f"tagged sessions={len(set(tagged))}  cached={len(cache)}  to_fetch={len(todo)}", flush=True)
    done = fail = 0
    if todo:
        with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
            for sid, rec in ex.map(lambda s: fetch_words(key, s), todo):
                done += 1
                if rec is None:
                    fail += 1
                else:
                    cache[sid] = rec
                if done % 500 == 0:
                    print(f"  {done}/{len(todo)} (fail={fail})", flush=True)
        WORDS_CACHE.write_text(json.dumps(cache))
    tot_w = sum(v["human_words"] for v in cache.values())
    tot_m = sum(v["human_msgs"] for v in cache.values())
    print(f"words cache: {len(cache)} sessions, {tot_w} words / {tot_m} msgs "
          f"(avg {tot_w / tot_m:.2f}/msg) -> {WORDS_CACHE}  [fetch failures this run: {fail}]", flush=True)


if __name__ == "__main__":
    main()
