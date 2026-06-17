"""Build the AGGREGATES payload (tiny, render-ready) from the validated master + status.
Funnel + Tables 1-3 + topic/subgroup status distributions + %Started line series.
No per-row data (those need the server-side phase). Emits payload_agg.json + size.
"""
import json
from collections import defaultdict
from datetime import date, timedelta

import build_master_4src as bm

TODAY = date(2026, 6, 16)
TOPICS = ["A", "B", "C", "D", "E", "1", "2", "3", "4", "5", "6", "7", "8", "9"]
SG_ORDER = ["TRS", "TRE", "ABT1-A", "ABT1-B", "ABT2-A", "ABT2-B"]
ROLL = {"TRS": "TRS", "TRE": "TRE", "ABT1-A": "ABT1", "ABT1-B": "ABT1", "ABT2-A": "ABT2", "ABT2-B": "ABT2"}

# ---- cells: unique (flw,cohort,interview_n) ----
cell = {}
for r in bm.rows:
    k = (r["connect_id"], r["cohort_id"], int(r["interview_n"]))
    c = cell.setdefault(
        k,
        {"sg": r["subgroup"], "n": int(r["interview_n"]), "flw": r["connect_id"], "t": False, "s": False, "c": False},
    )
    c["t"] = True
    if r["is_started"] == "Y":
        c["s"] = True
    if r["is_completed"] == "Y":
        c["c"] = True
cells = list(cell.values())

# ---- eligible per subgroup ----
elig_sg = defaultdict(set)
for (cohort, topic), flws in bm.welcome_flws_by_key.items():
    sg = bm.cohort_to_sg(cohort)
    if sg:
        elig_sg[sg] |= flws

# ---- funnel + line series ----
fset = defaultdict(lambda: {"t": set(), "s": set(), "c": set()})
for c in cells:
    f = fset[(c["sg"], c["n"])]
    if c["t"]:
        f["t"].add(c["flw"])
    if c["s"]:
        f["s"].add(c["flw"])
    if c["c"]:
        f["c"].add(c["flw"])
funnel = []
line = {}
for sg in SG_ORDER:
    elig = len(elig_sg[sg]) or 1
    series = []
    for i, tc in enumerate(bm.SUBGROUP_DESIGN[sg]["topics"]):
        n = i + 1
        f = fset[(sg, n)]
        t, s, cc = len(f["t"]), len(f["s"]), len(f["c"])
        funnel.append(
            {
                "sg": sg,
                "n": n,
                "topic": tc,
                "name": bm.TOPIC_NAMES[tc],
                "elig": elig,
                "trig": t,
                "started": s,
                "completed": cc,
                "pct_trig": round(100 * t / elig, 1),
                "pct_started": round(100 * s / elig, 1),
                "pct_completed": round(100 * cc / s, 1) if s else None,
            }
        )
        series.append(round(100 * s / elig, 1))
    line[sg] = series


# ---- Tables 1-3 ----
def agg(keyfn, keys):
    a = defaultdict(lambda: {"flw": set(), "ist": 0, "icmp": 0})
    for c in cells:
        for k in set(keyfn(c)):
            if c["s"]:
                a[k]["flw"].add(c["flw"])
                a[k]["ist"] += 1
            if c["c"]:
                a[k]["icmp"] += 1
    return [
        {
            "key": k,
            "flws": len(a[k]["flw"]),
            "ist": a[k]["ist"],
            "icmp": a[k]["icmp"],
            "pct": round(100 * a[k]["icmp"] / a[k]["ist"], 1) if a[k]["ist"] else None,
        }
        for k in keys
        if k in a
    ]


t1 = agg(lambda c: [ROLL[c["sg"]], "Overall"], ["TRS", "TRE", "ABT1", "ABT2", "Overall"])
t3 = agg(
    lambda c: ([c["sg"], "Overall"] if c["sg"] in ("ABT1-A", "ABT1-B", "ABT2-A", "ABT2-B") else []),
    ["ABT1-A", "ABT1-B", "ABT2-A", "ABT2-B", "Overall"],
)
# Table 2 by topic
t2a = defaultdict(lambda: {"flw": set(), "ist": 0, "icmp": 0})
for c in cells:
    tc = bm.SUBGROUP_DESIGN[c["sg"]]["topics"][c["n"] - 1]
    if c["s"]:
        t2a[tc]["flw"].add(c["flw"])
        t2a[tc]["ist"] += 1
    if c["c"]:
        t2a[tc]["icmp"] += 1
t2 = [
    {
        "code": tc,
        "name": bm.TOPIC_NAMES[tc],
        "flws": len(t2a[tc]["flw"]),
        "ist": t2a[tc]["ist"],
        "icmp": t2a[tc]["icmp"],
        "pct": round(100 * t2a[tc]["icmp"] / t2a[tc]["ist"], 1) if t2a[tc]["ist"] else None,
    }
    for tc in TOPICS
    if tc in t2a
]

# ---- topic-status distribution (per topic + per subgroup) for stacked bars ----
STATES = [
    "not-applicable",
    "not-available-yet",
    "available-not-started",
    "available-missed-overdue",
    "started-not-completed",
    "completed",
]
mlook = {}


def rank(r):
    return (1 if r["is_completed"] == "Y" else 0) * 2 + (1 if r["is_started"] == "Y" else 0)


for r in bm.rows:
    k = (r["connect_id"], r["cohort_id"], r["topic_code"])
    if k not in mlook or rank(r) > rank(mlook[k]):
        mlook[k] = r


def status_for(flw, cohort, topic):
    sg = bm.cohort_to_sg(cohort)
    topics = bm.SUBGROUP_DESIGN[sg]["topics"]
    if topic not in topics:
        return "not-applicable"
    n = topics.index(topic) + 1
    m = mlook.get((flw, cohort, topic))
    if m and m["is_completed"] == "Y":
        return "completed"
    if m and m["is_started"] == "Y":
        return "started-not-completed"
    td = bm.cohort_info.get(cohort, {}).get("training_date")
    if not td:
        return "available-not-started"
    cad = bm.SUBGROUP_DESIGN[sg]["cadence"]
    if TODAY < td + timedelta(days=(n - 1) * cad):
        return "not-available-yet"
    if n < len(topics) and TODAY >= td + timedelta(days=n * cad):
        return "available-missed-overdue"
    return "available-not-started"


topic_status = defaultdict(lambda: defaultdict(int))
sg_status = defaultdict(lambda: defaultdict(int))
for cohort, info in bm.cohort_info.items():
    sg = info["subgroup"]
    claimed = [f for f in bm.cohort_flws[cohort] if bm.cohort_flw_meta[(cohort, f)].get("date_claimed")]
    for flw in claimed:
        for topic in TOPICS:
            st = status_for(flw, cohort, topic)
            topic_status[topic][st] += 1
            if st != "not-applicable":
                sg_status[sg][st] += 1
topic_status_out = [
    {"code": tc, "name": bm.TOPIC_NAMES[tc], **{s: topic_status[tc][s] for s in STATES}} for tc in TOPICS
]

payload = {
    "built_at": "2026-06-16",  # stamped at build; render shows this
    "today": str(TODAY),
    "counts": {
        "cohorts": len(bm.cohort_info),
        "flws": len({c["flw"] for c in cells}),
        "master_rows": len(bm.rows),
        "claimed_pairs": sum(
            1
            for cohort in bm.cohort_info
            for f in bm.cohort_flws[cohort]
            if bm.cohort_flw_meta[(cohort, f)].get("date_claimed")
        ),
    },
    "funnel": funnel,
    "line_pct_started": line,
    "table1": t1,
    "table2": t2,
    "table3": t3,
    "topic_status": topic_status_out,
    "states": STATES,
    "topics": TOPICS,
    "sg_order": SG_ORDER,
}
out = json.dumps(payload, separators=(",", ":"))
open("payload_agg.json", "w", encoding="utf-8").write(out)
print(f"payload_agg.json: {len(out.encode())/1024:.1f} KB")
print(f"  counts: {payload['counts']}")
print(f"  funnel rows: {len(funnel)}, table2 rows: {len(t2)}, topic_status rows: {len(topic_status_out)}")
print(f"  sample funnel[0]: {funnel[0]}")
print(f"  sample topic_status[0]: {topic_status_out[0]}")
