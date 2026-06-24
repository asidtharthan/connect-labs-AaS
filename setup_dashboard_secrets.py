"""One-shot: set ALL GitHub Actions secrets for the daily Interviews dashboard refresh.

Reads credentials from your LOCAL files (never prints them) and sets them as repo secrets via the
`gh` CLI. No participant data touches git — the Connect snapshot is gzip+base64'd and stored as
3 secrets (CONNECT_SNAP_1/2/3) that the workflow reassembles at runtime.

Prereqs:
  - `gh` CLI installed and authenticated (`gh auth login`), with access to this repo.
  - Run from the repo root, on the machine that has: connect_user_data_snapshot.csv, .hq_creds.json,
    ~/.claude.json (connect_labs MCP token).

Usage:
  python setup_dashboard_secrets.py            # sets secrets on the current repo's origin
  python setup_dashboard_secrets.py --repo owner/name
"""
import argparse
import base64
import gzip
import json
import os
import subprocess
import sys

N_CHUNKS = 3


def gh_set(name, value, repo):
    cmd = ["gh", "secret", "set", name]
    if repo:
        cmd += ["--repo", repo]
    r = subprocess.run(cmd, input=value, text=True)
    if r.returncode != 0:
        sys.exit(f"FAILED to set secret {name} (is `gh` authenticated? `gh auth status`)")
    print(f"  set {name}  ({len(value)} chars)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", default=None, help="owner/name (default: current repo's origin)")
    args = ap.parse_args()

    # 1) Connect snapshot -> gzip+base64 -> 3 chunked secrets (GitHub secret limit ~48KB each)
    snap = "connect_user_data_snapshot.csv"
    if not os.path.exists(snap):
        sys.exit(f"Missing {snap} — generate it locally first (consolidate the *_audit/user_data.csv files).")
    b64 = base64.b64encode(gzip.compress(open(snap, "rb").read(), 9)).decode()
    size = -(-len(b64) // N_CHUNKS)
    print(f"Connect snapshot: {len(b64)} b64 chars -> {N_CHUNKS} secrets of ~{size}")
    for i in range(N_CHUNKS):
        gh_set(f"CONNECT_SNAP_{i+1}", b64[i * size : (i + 1) * size] or "", args.repo)

    # 2) CommCare HQ creds
    if os.path.exists(".hq_creds.json"):
        hq = json.load(open(".hq_creds.json"))
        gh_set("HQ_API_KEY", hq["hq_api_key"], args.repo)
        gh_set("HQ_USERNAME", hq["hq_username"], args.repo)
    else:
        print("  [skip] .hq_creds.json absent — set HQ_API_KEY / HQ_USERNAME manually")

    # 3) OCS bearer key (from env or untracked .ocs_creds.json; never hardcoded)
    ocs = os.environ.get("OCS_API_KEY")
    if not ocs and os.path.exists(".ocs_creds.json"):
        ocs = json.load(open(".ocs_creds.json")).get("ocs_api_key")
    if ocs:
        gh_set("OCS_API_KEY", ocs, args.repo)
    else:
        print('  [skip] OCS_API_KEY — set env OCS_API_KEY or add .ocs_creds.json {"ocs_api_key": "..."}')

    # 4) connect_labs MCP bearer (from ~/.claude.json)
    try:
        cfg = json.load(open(os.path.expanduser("~/.claude.json")))
        auth = cfg["mcpServers"]["connect_labs"]["headers"]["Authorization"]
        gh_set("MCP_BEARER", auth.split()[-1], args.repo)
    except Exception as e:
        print(f"  [skip] MCP_BEARER — could not read ~/.claude.json connect_labs ({e}); set it manually")

    # 5) Headless Connect pull creds (OAuth refresh-token grant) + GH PAT for token write-back.
    #    From env, else .connect_creds.json {refresh_token, client_id, client_secret, gh_pat}.
    cc = json.load(open(".connect_creds.json")) if os.path.exists(".connect_creds.json") else {}
    for secret_name, env_name, cc_key in [
        ("CONNECT_REFRESH_TOKEN", "CONNECT_REFRESH_TOKEN", "refresh_token"),
        ("CONNECT_OAUTH_CLIENT_ID", "CONNECT_OAUTH_CLIENT_ID", "client_id"),
        ("CONNECT_OAUTH_CLIENT_SECRET", "CONNECT_OAUTH_CLIENT_SECRET", "client_secret"),
        ("GH_PAT", "GH_PAT", "gh_pat"),
    ]:
        val = os.environ.get(env_name) or cc.get(cc_key)
        if val:
            gh_set(secret_name, val, args.repo)
        else:
            print(f"  [skip] {secret_name} — set env {env_name} or add to .connect_creds.json")

    print("\nDone. Verify with:  gh secret list" + (f" --repo {args.repo}" if args.repo else ""))


if __name__ == "__main__":
    main()
