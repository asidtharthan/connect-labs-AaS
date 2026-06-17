"""Audit dashboard_data.json (the data the render embeds) — independent recompute vs the
master (build_master_4src) and vs the audit_e2e-validated payload_agg.json. All PASS required.
Run after build_dashboard_data.py.  UTF-8: run with PYTHONUTF8=1.
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

dd = json.loads(open("dashboard_data.json", encoding="utf-8").read())
pay = json.loads(open("payload_agg.json", encoding="utf-8").read())

results = []


def chk(name, ok, detail=""):
    results.append(ok)
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}  {detail}")


print("=" * 80)
print("A. AGGREGATES in dashboard_data == validated payload_agg.json")
print("=" * 80)
chk("funnel identical to payload", dd["funnel"] == pay["funnel"], f"{len(dd['funnel'])} rows")
chk("table1 identical", dd["table1"] == pay["table1"])
chk("table2 identical", dd["table2"] == pay["table2"])
chk("table3 identical", dd["table3"] == pay["table3"])
ts_ok = True
ts_bad = 0
pay_ts = {t["code"]: t for t in pay["topic_status"]}
for t in dd["topicStatus"]:
    p = pay_ts[t["code"]]
    for s in STATES_NA:
        if t[s] != p[s]:
            ts_ok = False
            ts_bad += 1
    if t["applicable"] != sum(t[s] for s in STATES_NA):
        ts_ok = False
        ts_bad += 1
chk("topicStatus states == payload + applicable==sum(states)", ts_ok, f"{ts_bad} bad cells")

print("=" * 80)
print("B. CONNECT FUNNEL — independent recompute from master + bm.sg_unique")
print("=" * 80)
elig_sg = defaultdict(set)
for (cohort, topic), flws in bm.welcome_flws_by_key.items():
    sg = bm.cohort_to_sg(cohort)
    if sg:
        elig_sg[sg] |= flws
sg_started, sg_completed = defaultdict(set), defaultdict(set)
for r in bm.rows:
    if r["is_started"] == "Y":
        sg_started[r["subgroup"]].add(r["connect_id"])
    if r["is_completed"] == "Y":
        sg_completed[r["subgroup"]].add(r["connect_id"])
cf = {r["sg"]: r for r in dd["connectFunnel"]}
bad = 0
for sg in SG_ORDER:
    u = bm.sg_unique[sg]
    exp = {
        "invited": len(u["invited"]),
        "accepted": len(u["accepted"]),
        "learn_completed": len(u["learn_completed"]),
        "claimed": len(u["claimed"]),
        "initiated": len(elig_sg[sg]),
        "started": len(sg_started[sg]),
        "completed": len(sg_completed[sg]),
    }
    for k, v in exp.items():
        if cf[sg][k] != v:
            bad += 1
            print(f"    MISMATCH {sg}.{k}: dash={cf[sg][k]} exp={v}")
chk("connectFunnel every cell == independent recompute", bad == 0, f"{bad} mismatches / {len(SG_ORDER)*7}")
mono = all(
    cf[sg]["invited"] >= cf[sg]["accepted"] >= cf[sg]["learn_completed"] >= cf[sg]["claimed"] for sg in SG_ORDER
)
chk("connect funnel monotonic invited>=accepted>=learnC>=claimed", mono)
mono2 = all(cf[sg]["started"] >= cf[sg]["completed"] for sg in SG_ORDER)
chk("started >= completed (all subgroups)", mono2)

print("=" * 80)
print("C. COUNTS")
print("=" * 80)
chk(
    "counts.master_rows == len(rows)",
    dd["counts"]["master_rows"] == len(bm.rows),
    f"{dd['counts']['master_rows']} == {len(bm.rows)}",
)
uflw = len({r["connect_id"] for r in bm.rows})
chk("counts.flws == unique connect_ids", dd["counts"]["flws"] == uflw, f"{dd['counts']['flws']} == {uflw}")
ucoh = len({r["cohort_id"] for r in bm.rows})
chk("counts.cohorts == unique cohort_ids", dd["counts"]["cohorts"] == ucoh, f"{dd['counts']['cohorts']} == {ucoh}")
ts2 = sum(1 for r in bm.rows if r["is_started"] == "Y")
tc2 = sum(1 for r in bm.rows if r["is_completed"] == "Y")
chk("counts.started == master started rows", dd["counts"]["started"] == ts2, f"{dd['counts']['started']} == {ts2}")
chk(
    "counts.completed == master completed rows",
    dd["counts"]["completed"] == tc2,
    f"{dd['counts']['completed']} == {tc2}",
)

print("=" * 80)
print("D. LINE SERIES")
print("=" * 80)
ls = {s["sg"]: s for s in dd["lineSeries"]}
lbad = 0
for sg in SG_ORDER:
    if ls[sg]["base"] != len(elig_sg[sg]):
        lbad += 1
    if ls[sg]["pts"] != pay["line_pct_started"].get(sg, []):
        lbad += 1
chk("lineSeries base==initiated & pts==payload line_pct_started", lbad == 0, f"{lbad} bad")
# cross-check: pts == round(100*funnel.started/base)
fmap = defaultdict(dict)
for f in dd["funnel"]:
    fmap[f["sg"]][f["n"]] = f
xbad = 0
for sg in SG_ORDER:
    base = ls[sg]["base"] or 1
    for i, p in enumerate(ls[sg]["pts"]):
        st = fmap[sg][i + 1]["started"]
        if round(1000 * st / base) / 10 != p:
            xbad += 1
chk("lineSeries pts == 100*funnel.started/base (recompute)", xbad == 0, f"{xbad} mismatched points")

print("=" * 80)
print("E. GRANULAR SAMPLE integrity")
print("=" * 80)
chk("granular_total == len(rows)", dd["granular_total"] == len(bm.rows), f"{dd['granular_total']} == {len(bm.rows)}")
chk("granular sample size in (0,500]", 0 < len(dd["granular"]) <= 500, f"{len(dd['granular'])}")
# every granular row exists in master with matching flags
mindex = {}
for r in bm.rows:
    mindex[(r["connect_id"], r["cohort_id"], int(r["interview_n"]))] = r
gbad = 0
for g in dd["granular"]:
    key = (g["connect_id"], g["cohort_id"], g["interview_n"])
    r = mindex.get(key)
    if not r:
        gbad += 1
        continue
    if (
        (r["is_started"] == "Y") != g["is_started"]
        or (r["is_completed"] == "Y") != g["is_completed"]
        or r["topic_code"] != g["topic_code"]
    ):
        gbad += 1
chk("every granular row matches a real master row (flags+topic)", gbad == 0, f"{gbad} bad / 500")

print("=" * 80)
n_pass = sum(results)
n_tot = len(results)
print(f"  TOTAL: {n_pass}/{n_tot} checks passed")
print(f"  RESULT: {'ALL PASS' if n_pass == n_tot else 'FAILURES PRESENT'}")
print("=" * 80)
