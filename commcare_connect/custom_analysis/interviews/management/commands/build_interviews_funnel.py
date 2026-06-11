"""Local reconciliation oracle for the Connect Interviews funnel.

Ports the Trigger-Bot <-> OCS-session matching from ``build_dropoff_v7f.py`` (repo
root) and computes the per-cohort funnel (Triggered / Started / Completed per
interview) directly from the raw exports. Its only purpose is to *reconcile*: it
reproduces the ``master_v7e.csv`` numbers from source so we can trust the locked V7
methodology before the deployable workflow template is authored (separately, live,
via MCP). It is NOT a production data path and writes nothing to the database.

Methodology (locked V7 -- do not re-derive; see the thin-slice spec):
  * Triggered  -- a CommCare HQ "Trigger Bot" form per (FLW, interview/topic).
  * Started    -- matched OCS session has >= 1 human message.
  * Completed  -- matched OCS session ``interview_status == interview_complete``.
  * Match      -- Nth Trigger Bot -> Nth OCS session per (FLW, topic), chronological,
                  tiebreak prefers ``interview_complete`` then earliest session at or
                  after the trigger time (``pick_best``, ported verbatim from v7f).
  * NO synthetic-FLW exclusion is applied -- v7f applies none, and ``^[a-f0-9]{20}$``
    would wrongly drop real Connect IDs (e.g. ``5ej4jqjha0x1f3tbc08y``).

Matching is computed GLOBALLY across all four interview domains (a FLW's sessions
are matched by ``(connect_id, topic)`` regardless of cohort) and only then filtered
to the requested cohort for display -- this is what makes the output identical to
``master_v7e.csv``.

Example:
    python manage.py build_interviews_funnel --cohort 01TRS
"""

import json
from collections import Counter, defaultdict
from pathlib import Path

import pandas as pd
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

# --- Locked V7 design constants (ported from build_dropoff_v7f.py) --------------

ALL_DOMAINS = [
    "connect-interview-cowacdi",
    "connect-interview-eha",
    "connect-interview-cowac-2",
    "connect-interview-eha-2",
]

SUBGROUP_DESIGN = {
    "TRS": {"topics": ["A", "B"], "cadence": 7},
    "TRE": {"topics": ["A", "B", "C", "D", "E"], "cadence": 3},
    "ABT1-A": {"topics": ["1", "2", "3", "4"], "cadence": 7},
    "ABT1-B": {"topics": ["1", "2", "3", "4"], "cadence": 7},
    "ABT2-A": {"topics": ["1", "2"], "cadence": 14},
    "ABT2-B": {"topics": ["1", "2", "5", "6", "7", "8", "9", "3"], "cadence": 3},
}

TOPIC_NAMES = {
    "A": "Community Demographics",
    "B": "Malaria",
    "C": "Nutrition Prevalence and Programs",
    "D": "Water & Diarrhea",
    "E": "Community & FLW Profile",
    "1": "Seasonal Malaria Chemoprevention",
    "2": "Seasonal Malaria Chemoprevention 2",
    "3": "Bed Net Usage",
    "4": "Health Worker Experience",
    "5": "Family Planning",
    "6": "Vitamin A Supplementation",
    "7": "Topic 7",
    "8": "Topic 8",
    "9": "Topic 9",
}

# Known reconciliation targets (from master_v7e.csv). Used only for the pass/fail
# self-check; add cohorts here as they are validated.
EXPECTED = {
    "01TRS": {1: (29, 27, 25), 2: (26, 26, 24)},
}


def cohort_to_sg(c):
    """Map a cohort_id to its design subgroup (ported verbatim from v7f)."""
    if not c or c == "1A":
        return None
    c = str(c)
    if "TRS" in c:
        return "TRS"
    if "TRE" in c:
        return "TRE"
    if "ABT1" in c:
        return "ABT1-A" if "A" in c[5:] else "ABT1-B"
    if "ABT2" in c:
        return "ABT2-A" if "A" in c[5:] else "ABT2-B"
    return None


def parse_dt(s):
    """Parse a timestamp to a tz-aware UTC datetime (ported verbatim from v7f)."""
    if s is None or s == "" or (isinstance(s, float) and pd.isna(s)):
        return None
    try:
        ts = pd.Timestamp(s)
        return ts.tz_localize("UTC").to_pydatetime() if ts.tz is None else ts.tz_convert("UTC").to_pydatetime()
    except Exception:
        return None


def pick_best(sessions, after_dt, claimed):
    """Pick the best unclaimed session for a trigger (ported verbatim from v7f).

    Prefer ``interview_complete``, then the earliest session at or after the trigger
    time; if none are after the trigger, take the closest in time.
    """
    avail = [s for s in sessions if s["sid"] not in claimed]
    if not avail:
        return None
    after = [s for s in avail if s["first"] >= after_dt]
    if after:
        return min(after, key=lambda s: (0 if s["status"] == "interview_complete" else 1, s["first"]))
    return min(avail, key=lambda s: abs((s["first"] - after_dt).total_seconds()))


class Command(BaseCommand):
    help = "Reconciliation oracle: compute the Connect Interviews funnel for one cohort from raw exports."

    def add_arguments(self, parser):
        root = Path(getattr(settings, "BASE_DIR", Path.cwd()))
        parser.add_argument("--cohort", default="01TRS", help="cohort_id to display (default: 01TRS)")
        parser.add_argument(
            "--all",
            action="store_true",
            help="reconcile EVERY cohort in master_v7e.csv (single OCS pass) and print a pass/fail summary",
        )
        parser.add_argument(
            "--master-csv",
            default=str(root / "master_v7e.csv"),
            help="master_v7e.csv to diff against in --all mode",
        )
        parser.add_argument(
            "--hq-dir",
            default=str(root / "hq_pull_full"),
            help="directory of {domain}__trigger_bot.jsonl files",
        )
        parser.add_argument(
            "--ocs-export",
            default="",
            help="OCS 'Chat Export' CSV (default: newest matching file in the repo root)",
        )
        parser.add_argument(
            "--root",
            default=str(root),
            help="repo root used to auto-discover the OCS export (default: settings.BASE_DIR)",
        )

    # -- loaders -----------------------------------------------------------------

    def _resolve_ocs(self, root, explicit):
        if explicit:
            p = Path(explicit)
            if not p.exists():
                raise CommandError(f"--ocs-export not found: {p}")
            return p
        candidates = sorted(
            (p for p in Path(root).iterdir() if "Chat Export" in p.name and p.suffix == ".csv"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if not candidates:
            raise CommandError(f"No 'Chat Export' CSV found in {root}; pass --ocs-export explicitly.")
        return candidates[0]

    def _load_triggers(self, hq_dir):
        """Load Trigger Bot forms across all domains -> trigger entries.

        Returns ``triggers_by_flw_iv`` keyed by (connect_id, next_interview), each a
        chronologically sorted list of entries carrying the originating cohort_id.
        """
        hq_dir = Path(hq_dir)
        triggers_by_flw_iv = defaultdict(list)
        total = 0
        for domain in ALL_DOMAINS:
            path = hq_dir / f"{domain}__trigger_bot.jsonl"
            if not path.exists():
                self.stderr.write(f"  (missing) {path}")
                continue
            n = 0
            for line in path.open(encoding="utf-8"):
                try:
                    sub = json.loads(line)
                except Exception:
                    continue
                form = sub.get("form", {})
                meta = form.get("meta", {}) if isinstance(form.get("meta"), dict) else {}
                connect_id = (form.get("connect_id") or meta.get("username") or sub.get("username") or "").strip()
                received_on = parse_dt(sub.get("received_on"))
                if not connect_id or not received_on:
                    continue
                cohort_id = (form.get("cohort_id") or "").strip()
                next_iv = (form.get("next_interview") or "").strip()
                if not cohort_id:
                    continue
                triggers_by_flw_iv[(connect_id, next_iv)].append(
                    {
                        "connect_id": connect_id,
                        "cohort_id": cohort_id,
                        "next_interview": next_iv,
                        "received_on": received_on,
                        "form_id": sub.get("id"),
                    }
                )
                n += 1
            total += n
            self.stdout.write(f"  {domain}/trigger_bot: {n:,}")
        for k in triggers_by_flw_iv:
            triggers_by_flw_iv[k].sort(key=lambda tb: tb["received_on"])
        self.stdout.write(f"  total trigger forms: {total:,}")
        return triggers_by_flw_iv

    def _load_ocs(self, ocs_path):
        """Stream the OCS export -> ocs_by_key keyed by (participant_id, interview).

        Mirrors v7f: human-message + word counts per session, ``interview_status``
        sticks once it reaches ``interview_complete``, first/last message timestamps
        compared as raw strings then parsed at the end.
        """
        sess = defaultdict(
            lambda: {
                "pid": None,
                "first": None,
                "last": None,
                "h": 0,
                "a": 0,
                "status": None,
                "interview": None,
                "human_words": 0,
                "human_msgs": 0,
            }
        )
        cols = [
            "Session ID",
            "Participant Identifier",
            "Message Date",
            "Message Type",
            "Session State",
            "Message Content",
        ]
        for chunk in pd.read_csv(ocs_path, chunksize=300_000, usecols=cols, low_memory=False):
            for sid, pid, d, mt, ss, mc in zip(
                chunk["Session ID"],
                chunk["Participant Identifier"],
                chunk["Message Date"],
                chunk["Message Type"],
                chunk["Session State"],
                chunk["Message Content"],
            ):
                if pd.isna(sid):
                    continue
                s = sess[sid]
                if s["pid"] is None and pd.notna(pid):
                    s["pid"] = str(pid)
                m = str(mt).lower() if pd.notna(mt) else ""
                if "human" in m:
                    s["h"] += 1
                    s["human_msgs"] += 1
                    if pd.notna(mc):
                        s["human_words"] += len([w for w in str(mc).split() if w])
                elif "ai" in m:
                    s["a"] += 1
                if pd.notna(d):
                    ds = str(d)
                    if s["first"] is None or ds < s["first"]:
                        s["first"] = ds
                    if s["last"] is None or ds > s["last"]:
                        s["last"] = ds
                if pd.notna(ss) and ss not in ("", "{}"):
                    try:
                        j = json.loads(ss)
                        st = j.get("interview_status")
                        tp = j.get("interview")
                        if st and s["status"] != "interview_complete":
                            s["status"] = st
                        if tp and not s["interview"]:
                            s["interview"] = str(tp)
                    except Exception:
                        pass

        ocs_by_key = defaultdict(list)
        for sid, info in sess.items():
            pid = info["pid"]
            iv = info["interview"]
            if not pid or not iv:
                continue
            first = parse_dt(info["first"])
            if not first:
                continue
            ocs_by_key[(pid, iv)].append(
                {
                    "sid": sid,
                    "first": first,
                    "h": info["h"],
                    "status": info["status"] or "",
                    "human_words": info["human_words"],
                    "human_msgs": info["human_msgs"],
                }
            )
        for k in ocs_by_key:
            ocs_by_key[k].sort(key=lambda s: s["first"])
        self.stdout.write(
            f"  {len(sess):,} sessions; {sum(len(v) for v in ocs_by_key.values()):,} with (FLW, interview) key"
        )
        return ocs_by_key

    # -- main --------------------------------------------------------------------

    def handle(self, *args, **opts):
        run_all = opts["all"]
        cohort = opts["cohort"]
        if not run_all:
            sg = cohort_to_sg(cohort)
            if not sg:
                raise CommandError(f"cohort_id {cohort!r} does not map to a known subgroup")

        ocs_path = self._resolve_ocs(opts["root"], opts["ocs_export"])
        scope = "ALL cohorts" if run_all else f"cohort {cohort}"
        self.stdout.write(self.style.MIGRATE_HEADING(f"Interviews funnel reconciliation -- {scope}"))
        self.stdout.write(f"  OCS export: {ocs_path.name}")

        self.stdout.write(self.style.MIGRATE_HEADING("[1/4] Loading Trigger Bot forms..."))
        triggers_by_flw_iv = self._load_triggers(opts["hq_dir"])

        self.stdout.write(self.style.MIGRATE_HEADING("[2/4] Streaming OCS export (single pass, ~1GB; be patient)..."))
        ocs_by_key = self._load_ocs(ocs_path)

        self.stdout.write(self.style.MIGRATE_HEADING("[3/4] Matching Nth trigger -> Nth session (global)..."))
        matched = {}
        stats = Counter()
        for (flw, iv), trs in triggers_by_flw_iv.items():
            sessions = ocs_by_key.get((flw, iv), [])
            claimed = set()
            for tb in trs:
                best = pick_best(sessions, tb["received_on"], claimed)
                matched[tb["form_id"]] = best
                if best:
                    claimed.add(best["sid"])
                    stats["matched"] += 1
                else:
                    stats["orphan"] += 1
        self.stdout.write(f"  matched: {stats['matched']:,}  orphan: {stats['orphan']:,}")

        # One funnel build covers every cohort (computed from the single match above).
        funnel = self._build_funnel(triggers_by_flw_iv, matched)

        if run_all:
            self.stdout.write(self.style.MIGRATE_HEADING("[4/4] Reconciling every cohort against master_v7e.csv..."))
            self._reconcile_all(funnel, opts["master_csv"])
        else:
            self.stdout.write(self.style.MIGRATE_HEADING(f"[4/4] Funnel for cohort {cohort}..."))
            topics = SUBGROUP_DESIGN[sg]["topics"]
            triggered = {n: funnel.get((cohort, n), (set(), set(), set()))[0] for n in range(1, len(topics) + 1)}
            started = {n: funnel.get((cohort, n), (set(), set(), set()))[1] for n in range(1, len(topics) + 1)}
            completed = {n: funnel.get((cohort, n), (set(), set(), set()))[2] for n in range(1, len(topics) + 1)}
            self._render(cohort, sg, topics, triggered, started, completed)

    def _build_funnel(self, triggers_by_flw_iv, matched):
        """Compute per-(cohort, interview_n) unique-FLW funnel sets for ALL cohorts.

        Mirrors v7f's per-trigger master-row logic, aggregated to unique FLWs:
        Triggered = any trigger; Started = any matched session with h>=1;
        Completed = any matched session interview_complete.
        """
        funnel = defaultdict(lambda: (set(), set(), set()))
        for (flw, iv), trs in triggers_by_flw_iv.items():
            for tb in trs:
                sg = cohort_to_sg(tb["cohort_id"])
                if not sg or iv not in SUBGROUP_DESIGN[sg]["topics"]:
                    continue
                interview_n = SUBGROUP_DESIGN[sg]["topics"].index(iv) + 1
                tset, sset, cset = funnel[(tb["cohort_id"], interview_n)]
                tset.add(flw)
                m = matched.get(tb["form_id"])
                if m and m["h"] >= 1:
                    sset.add(flw)
                if m and m["status"] == "interview_complete":
                    cset.add(flw)
        return funnel

    def _load_expected(self, master_csv):
        """Aggregate master_v7e.csv to per-(cohort, interview_n) unique-FLW counts."""
        import csv

        path = Path(master_csv)
        if not path.exists():
            raise CommandError(f"--master-csv not found: {path}")
        csv.field_size_limit(2**24)
        exp = defaultdict(lambda: (set(), set(), set()))
        with path.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                cohort = (row.get("cohort_id") or "").strip()
                try:
                    n = int(row.get("interview_n") or 0)
                except ValueError:
                    continue
                if not cohort or not n:
                    continue
                flw = (row.get("connect_id") or "").strip()
                tset, sset, cset = exp[(cohort, n)]
                if row.get("is_triggered") == "Y":
                    tset.add(flw)
                if row.get("is_started") == "Y":
                    sset.add(flw)
                if row.get("is_completed") == "Y":
                    cset.add(flw)
        return exp

    def _reconcile_all(self, funnel, master_csv):
        expected = self._load_expected(master_csv)
        cohorts = sorted({c for (c, _n) in expected})

        # Group cohorts by subgroup so TRE / ABT1 / ABT2-B coverage is explicit.
        by_sg = defaultdict(list)
        for c in cohorts:
            by_sg[cohort_to_sg(c) or "?"].append(c)

        n_pass = 0
        mismatches = []
        self.stdout.write("")
        self.stdout.write(
            "  {:<10} {:<8} {}".format("Cohort", "Subgroup", "Result (triggered/started/completed per interview)")
        )
        self.stdout.write("  " + "-" * 92)
        for sg in ["TRS", "TRE", "ABT1-A", "ABT1-B", "ABT2-A", "ABT2-B", "?"]:
            for cohort in sorted(by_sg.get(sg, [])):
                ns = sorted({n for (c, n) in expected if c == cohort})
                cohort_ok = True
                detail = []
                for n in ns:
                    egot = tuple(len(s) for s in expected[(cohort, n)])
                    mgot = tuple(len(s) for s in funnel.get((cohort, n), (set(), set(), set())))
                    ok = egot == mgot
                    cohort_ok = cohort_ok and ok
                    if ok:
                        detail.append("i{}={}/{}/{}".format(n, *mgot))
                    else:
                        detail.append("i{} MINE {}/{}/{} vs MASTER {}/{}/{}".format(n, *mgot, *egot))
                if cohort_ok:
                    n_pass += 1
                    tag = self.style.SUCCESS("PASS")
                else:
                    mismatches.append((cohort, sg, detail))
                    tag = self.style.ERROR("FAIL")
                self.stdout.write("  {:<10} {:<8} {}  {}".format(cohort, sg, tag, "  ".join(detail)))

        total = len(cohorts)
        self.stdout.write("  " + "-" * 92)
        # Per-subgroup tally (confirms TRE / ABT1 / ABT2-B are covered).
        self.stdout.write("  Coverage by subgroup:")
        for sg in ["TRS", "TRE", "ABT1-A", "ABT1-B", "ABT2-A", "ABT2-B", "?"]:
            cs = by_sg.get(sg)
            if cs:
                self.stdout.write(f"    {sg:<8} {len(cs)} cohort(s)")
        self.stdout.write("")
        summary = f"  SUMMARY: {n_pass}/{total} cohorts match master_v7e.csv exactly."
        self.stdout.write(self.style.SUCCESS(summary) if n_pass == total else self.style.ERROR(summary))
        if mismatches:
            self.stdout.write(self.style.ERROR(f"  {len(mismatches)} cohort(s) did NOT match:"))
            for cohort, sg, detail in mismatches:
                self.stdout.write(
                    self.style.ERROR(f"    {cohort} ({sg}): " + "  ".join(d for d in detail if "vs MASTER" in d))
                )

    def _render(self, cohort, sg, topics, triggered, started, completed):
        all_flws = set().union(*triggered.values()) if triggered else set()
        self.stdout.write("")
        self.stdout.write(f"  Cohort {cohort}  |  subgroup {sg}  |  {len(all_flws)} unique FLWs triggered")
        self.stdout.write("  " + "-" * 70)
        self.stdout.write(
            "  {:<7} {:<28} {:>9} {:>8} {:>10}".format("Int", "Topic", "Triggered", "Started", "Completed")
        )
        self.stdout.write("  " + "-" * 70)
        expected = EXPECTED.get(cohort, {})
        all_ok = True
        for n in range(1, len(topics) + 1):
            tc = topics[n - 1]
            tg, st, co = len(triggered[n]), len(started[n]), len(completed[n])
            line = f"  Int#{n:<3} {TOPIC_NAMES.get(tc, tc):<28} {tg:>9} {st:>8} {co:>10}"
            if n in expected:
                etg, est, eco = expected[n]
                ok = (tg, st, co) == (etg, est, eco)
                all_ok = all_ok and ok
                mark = self.style.SUCCESS("  OK") if ok else self.style.ERROR(f"  EXPECTED {etg}/{est}/{eco}")
                line += mark
            self.stdout.write(line)
        self.stdout.write("  " + "-" * 70)
        if expected:
            if all_ok:
                self.stdout.write(self.style.SUCCESS(f"  RECONCILED: {cohort} matches master_v7e.csv exactly."))
            else:
                self.stdout.write(
                    self.style.ERROR(f"  MISMATCH: {cohort} does not match the expected master_v7e numbers.")
                )
