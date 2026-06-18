"""Build dashboard_data.json — the exact data the Labs render embeds (display-only).
Aggregates come straight from payload_agg.json (already validated by audit_e2e 26/26).
Adds: counts, connectFunnel (per subgroup), lineSeries bases, topicStatus reshaped, granular sample.
Run build_payload_agg.py first. Then audit with build_dashboard_data_audit.py.
"""
import json
from collections import defaultdict

import build_master_4src as bm

SG_ORDER = ["TRS", "TRE", "ABT1-A", "ABT1-B", "ABT2-A", "ABT2-B"]
STATES_NA = [
    "completed",
    "started-not-completed",
    "available-missed-overdue",
    "available-not-started",
    "not-available-yet",
]

payload = json.loads(open("payload_agg.json", encoding="utf-8").read())
cohort_meta = json.loads(open("cohort_meta.json", encoding="utf-8").read())

# ---- initiated per subgroup (welcome union) ----
elig_sg = defaultdict(set)
for (cohort, topic), flws in bm.welcome_flws_by_key.items():
    sg = bm.cohort_to_sg(cohort)
    if sg:
        elig_sg[sg] |= flws

# ---- started/completed unique FLWs per subgroup (from master) ----
sg_started, sg_completed = defaultdict(set), defaultdict(set)
for r in bm.rows:
    sg = r["subgroup"]
    if r["is_started"] == "Y":
        sg_started[sg].add(r["connect_id"])
    if r["is_completed"] == "Y":
        sg_completed[sg].add(r["connect_id"])

# ---- connect funnel per subgroup (REAL Connect funnel from user_data.csv via bm.sg_unique) ----
# invited -> accepted -> completed-learn -> claimed -> initiated (welcome) -> started -> completed
connect_funnel = []
for sg in SG_ORDER:
    u = bm.sg_unique[sg]
    connect_funnel.append(
        {
            "sg": sg,
            "invited": len(u["invited"]),
            "accepted": len(u["accepted"]),
            "learn_completed": len(u["learn_completed"]),
            "claimed": len(u["claimed"]),
            "initiated": len(elig_sg.get(sg, set())),
            "started": len(sg_started.get(sg, set())),
            "completed": len(sg_completed.get(sg, set())),
        }
    )

# ---- line series bases ----
line_series = []
for sg in SG_ORDER:
    line_series.append({"sg": sg, "base": len(elig_sg.get(sg, set())), "pts": payload["line_pct_started"].get(sg, [])})

# ---- topicStatus reshaped: all 6 states (incl not-applicable) + total (for %-stack to 100) ----
ORDER6 = [
    "not-applicable",
    "not-available-yet",
    "available-not-started",
    "available-missed-overdue",
    "started-not-completed",
    "completed",
]
topic_status = []
for t in payload["topic_status"]:
    total = sum(t[s] for s in ORDER6)
    row = {"code": t["code"], "name": t["name"], "total": total, "applicable": total - t["not-applicable"]}
    for s in ORDER6:
        row[s] = t[s]
    topic_status.append(row)

# ---- counts ----
tot_started = sum(1 for r in bm.rows if r["is_started"] == "Y")
tot_completed = sum(1 for r in bm.rows if r["is_completed"] == "Y")
counts = {
    "cohorts": payload["counts"]["cohorts"],
    "flws": payload["counts"]["flws"],
    "master_rows": payload["counts"]["master_rows"],
    "started": tot_started,
    "completed": tot_completed,
}

# ---- granular sample (first 500 rows, stable sort) ----
gcols = [
    "connect_id",
    "cohort_id",
    "subgroup",
    "interview_n",
    "topic_code",
    "is_triggered",
    "is_started",
    "is_completed",
    "matched_session_id",
]
rows_sorted = sorted(bm.rows, key=lambda r: (r["cohort_id"], r["connect_id"], int(r["interview_n"])))
GRANULAR_N = 30
granular = []
for r in rows_sorted[:GRANULAR_N]:
    granular.append(
        {
            "connect_id": r["connect_id"],
            "cohort_id": r["cohort_id"],
            "subgroup": r["subgroup"],
            "interview_n": int(r["interview_n"]),
            "topic_code": r["topic_code"],
            "is_triggered": r.get("is_triggered", "Y") == "Y",
            "is_initiated": r.get("is_initiated", "") == "Y",
            "is_started": r["is_started"] == "Y",
            "is_completed": r["is_completed"] == "Y",
            "session_id": r.get("matched_session_id", "") or "",
        }
    )

out = {
    "built_at": payload.get("built_at", ""),
    "today": payload.get("today", ""),
    "counts": counts,
    "connectFunnel": connect_funnel,
    "funnel": payload["funnel"],
    "lineSeries": line_series,
    "table1": payload["table1"],
    "table2": payload["table2"],
    "table3": payload["table3"],
    "topicStatus": topic_status,
    "topicStatusCohort": payload["topic_status_cohort"],
    "dropoff": payload["dropoff"],
    "granular": granular,
    "granular_total": len(bm.rows),
}
s = json.dumps(out, separators=(",", ":"))
open("dashboard_data.json", "w", encoding="utf-8").write(s)
print(f"dashboard_data.json: {len(s.encode()) / 1024:.1f} KB")
print(f"  counts: {counts}")
print(
    f"  connectFunnel rows: {len(connect_funnel)}; funnel rows: {len(out['funnel'])}; topicStatus: {len(topic_status)}; granular: {len(granular)}/{len(bm.rows)}"
)
print(f"  connectFunnel[0]: {connect_funnel[0]}")
