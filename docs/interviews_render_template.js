// Connect Interviews — MASTER dataset dashboard (v3). DISPLAY-ONLY build.
// Data is embedded (DATA below) from dashboard_data.json — the validated master (build_master_4src.py)
// aggregated by build_dashboard_data.py and reconciled 18/18 by build_dashboard_data_audit.py
// (which sits on top of audit_e2e 26/26). All 62 cohorts.
// WHY embedded, not live: a live multi-opp pipeline pull of 64 opportunities exceeds the platform's
// 600s SSE timeout (serial per-opp CCHQ/Connect fetches) and returns nothing. Embedding the audited
// snapshot gives a 100%-accurate all-cohort dashboard now. To refresh data: re-run the offline build
// (build_master_4src -> build_dashboard_data -> audit -> re-embed) — see docs.
// Charts via window.Chart (Chart.js, preloaded in the Labs render env, same as the KMC dashboards).
function WorkflowUI(props) {
  var DATA = /*__DATA__*/;

  var tab = React.useState("overview");
  var activeTab = tab[0], setTab = tab[1];
  var tsub = React.useState("granular");
  var tableSub = tsub[0], setTableSub = tsub[1];
  var bsub = React.useState("subgroup");
  var bdSub = bsub[0], setBdSub = bsub[1];
  var fex = React.useState({});
  var funExp = fex[0], setFunExp = fex[1];   // expanded subgroups in the drop-off matrix
  var tex = React.useState({});
  var topicExp = tex[0], setTopicExp = tex[1];   // expanded topics in topic-completion drilldown
  var tcc = React.useState("stacked");
  var topicChart = tcc[0], setTopicChart = tcc[1];   // topic-completion chart type: stacked | scoreboard | heatmap
  var tgm = React.useState("topic");
  var topicGroupMode = tgm[0], setTopicGroupMode = tgm[1];   // topic-completion grouping: topic | theme (GW consolidated bars)
  var tcm = React.useState("pct");
  var tcMode = tcm[0], setTcMode = tcm[1];   // topic-completion value mode: pct | count (raw interview counts)
  var gss = React.useState("");
  var gSearch = gss[0], setGSearch = gss[1];   // granular session search box
  var gpp = React.useState(0);
  var gPage = gpp[0], setGPage = gpp[1];   // granular page
  var gvw = React.useState("sessions");
  var gView = gvw[0], setGView = gvw[1];   // granular sub-view: sessions | matrix (FLW × Topic)
  var gf1 = React.useState(""); var fSg = gf1[0], setFSg = gf1[1];   // filter: subgroup
  var gf2 = React.useState(""); var fCo = gf2[0], setFCo = gf2[1];   // filter: cohort
  var gf3 = React.useState(""); var fSt = gf3[0], setFSt = gf3[1];   // filter: status (state)
  var gf4 = React.useState(""); var fTr = gf4[0], setFTr = gf4[1];   // filter: trained | untrained
  var gf5 = React.useState(""); var fTopic = gf5[0], setFTopic = gf5[1];   // filter: topic (interview code)
  var gso = React.useState({ key: "", dir: "asc" }); var gSort = gso[0], setGSort = gso[1];   // sessions table sort
  var dimp = React.useState(false);
  var deImpact = dimp[0], setDeImpact = dimp[1];   // item 8: raw vs de-impacted (penult/last artifact)
  var lsg = React.useState({}); var hidSg = lsg[0], setHidSg = lsg[1];   // funnels line chart: hidden subgroups (custom legend toggle)
  var lineRef = React.useRef(null), lineInst = React.useRef(null);
  var barRef = React.useRef(null), barInst = React.useRef(null);

  // Design + topic names come from the build (DATA.subgroupDesign / topicNames), derived from the
  // CommCare HQ interview_schedule lookup — single source of truth. Fallbacks for older data only.
  var SUBGROUP_DESIGN = {};
  if (DATA.subgroupDesign) {
    Object.keys(DATA.subgroupDesign).forEach(function (sg) { SUBGROUP_DESIGN[sg] = DATA.subgroupDesign[sg].topics; });
  } else {
    SUBGROUP_DESIGN = {
      "TRS": ["A", "B"], "TRE": ["A", "B", "C", "D", "E"],
      "ABT1-A": ["1", "2", "3", "4"], "ABT1-B": ["1", "2", "3", "4"],
      "ABT2-A": ["1", "2"], "ABT2-B": ["1", "2", "5", "6", "7", "8", "9", "3"],
      "PANEL": ["7", "1", "2", "12", "3", "4", "5", "6", "C", "10", "11", "8", "13"],
      "ABT3-A": ["8", "9", "10", "11"], "ABT3-B": ["8", "9", "10", "11"]
    };
  }
  var TOPIC_NAMES = DATA.topicNames || { A: "Community Demographics", B: "Malaria", C: "Nutrition Prevalance and Programs",
    D: "Water & Diarrhea", E: "Community & FLW Profile", "1": "Seasonal Malaria Chemoprevention",
    "2": "Seasonal Malaria Chemoprevention 2", "3": "Bed Net Usage", "4": "Health Worker Experience",
    "5": "Family Planning", "6": "Vitamin A Supplementation", "7": "Vaccines",
    "8": "Antibiotics and ACT Use", "9": "Medicine Quality & Counterfeiting",
    "10": "Malaria 2", "11": "Water & Diarrhea 2", "12": "Community & FLW Profile 2", "13": "Medicine Quality & Counterfeiting 2", "14": "Malaria 5",
    "8S": "Antibiotics and ACT Use 2", "8L": "Antibiotics and ACT Use 3", "10S": "Malaria 3", "10L": "Malaria 4", "11S": "Water & Diarrhea 3", "11L": "Water & Diarrhea 4", "13L": "Medicine Quality & Counterfeiting 3" };
  var SG_ORDER = ["TRS", "TRE", "ABT1-A", "ABT1-B", "ABT2-A", "ABT2-B", "PANEL", "ABT3-A", "ABT3-B", "2WT"];
  // 6 states in the spec order (Notes doc): not-applicable -> completed
  var STATES = ["not-applicable", "not-available-yet", "available-not-started", "available-missed-overdue", "started-not-completed", "completed"];
  var STATES5 = ["not-available-yet", "available-not-started", "available-missed-overdue", "started-not-completed", "completed"];
  // Topic-completion display order: completed (left/first) → not-available-yet; not-applicable parked last.
  // Used by the stacked bar, its legend, the detail table + drilldown, and the heatmap so they all read the same way.
  var BAR_ORDER = ["completed", "started-not-completed", "available-not-started", "available-missed-overdue", "not-available-yet", "not-applicable"];
  var BAR_ORDER5 = ["completed", "started-not-completed", "available-not-started", "available-missed-overdue", "not-available-yet"];
  var STATE_LABEL = { "not-applicable": "Not applicable", "not-available-yet": "Not available yet",
    "available-not-started": "Available, not started", "available-missed-overdue": "Available, missed/overdue",
    "started-not-completed": "Started, not completed", "completed": "Completed" };
  var STATE_COLOR = { "not-applicable": "#e5e7eb", "not-available-yet": "#6366f1",
    "available-not-started": "#f59e0b", "available-missed-overdue": "#b91c1c",
    "started-not-completed": "#06b6d4", "completed": "#16a34a" };
  var STATE_DEF = {
    "not-applicable": "topic isn't part of this cohort's design",
    "not-available-yet": "in the cohort, but not yet released per today's date, the topic's place in the schedule, and the cohort's training date",
    "available-not-started": "available for the FLW to trigger from the app, but not yet started",
    "available-missed-overdue": "the FLW missed this topic's window — the next topic is already available",
    "started-not-completed": "FLW responded with ≥1 message but did not complete the session",
    "completed": "FLW completed the interview",
  };
  function Legend(props2) {
    return (
      <details className="text-xs text-gray-600 bg-gray-50 rounded border border-gray-200 px-3 py-2">
        <summary className="cursor-pointer font-medium text-gray-700">{props2.title}</summary>
        <div className="mt-2 space-y-1">{props2.children}</div>
      </details>
    );
  }
  // Maximally-distinct categorical palette (D3 category10) so every subgroup line is unambiguous.
  var SG_COLOR = { "TRS": "#1f77b4", "TRE": "#17becf", "ABT1-A": "#2ca02c", "ABT1-B": "#d62728", "ABT2-A": "#9467bd", "ABT2-B": "#8c564b", "PANEL": "#e377c2", "ABT3-A": "#f58231", "ABT3-B": "#bcbd22", "2WT": "#334155" };
  // FLW × Topic matrix cell glyphs, indexed by STATES order (0 not-applicable … 5 completed)
  var CELL_GLYPH = ["", "·", "○", "!", "◐", "✓"];
  var MATRIX_TOPIC_ORDER = ["A", "B", "C", "D", "E", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "8S", "8L", "10S", "10L", "11S", "11L", "13L"];
  // GiveWell thematic grouping: pool related topics into one bar. Static + forward-looking
  // (already includes topics that get data later, e.g. ABT3 8S/8L/10S/10L/11S/11L/13L, 2WT 14).
  // A topic not listed here renders as its own bar. THEME_ORDER = display order of theme bars.
  var THEME_ORDER = ["Malaria", "Water & Diarrhea", "Community & FLW Profile", "Antibiotics and ACT Use", "Medicine Quality & Counterfeiting"];
  var TOPIC_GROUP = {
    "B": "Malaria", "1": "Malaria", "2": "Malaria", "10": "Malaria", "10S": "Malaria", "10L": "Malaria", "14": "Malaria",
    "D": "Water & Diarrhea", "11": "Water & Diarrhea", "11S": "Water & Diarrhea", "11L": "Water & Diarrhea",
    "E": "Community & FLW Profile", "12": "Community & FLW Profile",
    "8": "Antibiotics and ACT Use", "8S": "Antibiotics and ACT Use", "8L": "Antibiotics and ACT Use",
    "9": "Medicine Quality & Counterfeiting", "13": "Medicine Quality & Counterfeiting", "13L": "Medicine Quality & Counterfeiting"
  };
  // Pool DATA.topicStatus rows into theme bars (interview-level sum). Topics not in a theme stay
  // individual. Returns the SAME row shape (+ a `label`) so the charts reuse their existing code.
  function groupedTopicStatus(rows) {
    var STATE6 = ["not-applicable", "not-available-yet", "available-not-started", "available-missed-overdue", "started-not-completed", "completed"];
    var byKey = {}, order = [];
    rows.forEach(function (t) {
      var theme = TOPIC_GROUP[t.code];
      var key = theme || ("#" + t.code);   // "#code" keeps ungrouped topics distinct from theme labels
      if (!byKey[key]) {
        byKey[key] = { code: theme || t.code, name: theme || t.name, isTheme: !!theme,
          label: theme || (t.code + " · " + (TOPIC_NAMES[t.code] || t.code)), total: 0, applicable: 0 };
        STATE6.forEach(function (s) { byKey[key][s] = 0; });
        order.push(key);
      }
      var g = byKey[key];
      g.total += t.total || 0; g.applicable += t.applicable || 0;
      STATE6.forEach(function (s) { g[s] += t[s] || 0; });
    });
    return order.map(function (k) { return byKey[k]; }).sort(function (a, b) {
      var ai = a.isTheme ? THEME_ORDER.indexOf(a.name) : 100 + MATRIX_TOPIC_ORDER.indexOf(a.code);
      var bi = b.isTheme ? THEME_ORDER.indexOf(b.name) : 100 + MATRIX_TOPIC_ORDER.indexOf(b.code);
      return ai - bi;
    });
  }
  // The row set the topic-completion charts render: grouped-by-theme or raw per-topic.
  function topicRowsFor(rows, mode) { return mode === "theme" ? groupedTopicStatus(rows) : rows; }

  var th = "px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider";
  var td = "px-3 py-2 whitespace-nowrap text-sm text-gray-800";
  function pctTxt(v) { return v == null ? "—" : v + "%"; }
  function pctOf(a, b) { return b > 0 ? Math.round((a / b) * 100) + "%" : "—"; }

  // ---- line chart (Interview Completion Funnels) ----
  React.useEffect(function () {
    if (activeTab !== "funnels") return;
    if (!lineRef.current || !window.Chart) return;
    if (lineInst.current) lineInst.current.destroy();
    var maxLen = 0; DATA.lineSeries.forEach(function (s) { maxLen = Math.max(maxLen, s.pts.length); });
    var labels = []; for (var i = 1; i <= maxLen; i++) labels.push("Int " + i);
    lineInst.current = new window.Chart(lineRef.current.getContext("2d"), {
      type: "line",
      data: { labels: labels, datasets: DATA.lineSeries.map(function (s) {
        var raw = (deImpact && s.pts_di && s.pts_di.length) ? s.pts_di : s.pts;
        var st = s.status || [];
        // not-available interviews (not yet offered) → null so the line ends instead of a false 0%
        var pts = raw.map(function (v, i) { return st[i] === "not-available" ? null : v; });
        var col = SG_COLOR[s.sg] || "#9ca3af";
        // a subgroup still accumulating any interview (e.g. PANEL) → dot its ENTIRE line; fully settled → solid
        var inProgress = st.some(function (x) { return x === "in-progress"; });
        return { label: s.sg + " (n=" + s.base + ")", data: pts, borderColor: col,
          backgroundColor: col, fill: false, tension: 0.2, spanGaps: false, borderWidth: 3,
          hidden: !!hidSg[s.sg], borderDash: inProgress ? [8, 5] : undefined }; }) },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { title: { display: true, text: "% FLWs who started each interview round (denominator = # FLWs initiated, constant per subgroup) — solid = subgroup fully settled, dotted = subgroup still in progress, line ends where interviews aren't offered yet" }, legend: { display: false } },
        scales: { y: { beginAtZero: true, max: 100, title: { display: true, text: "% Started" } }, x: { title: { display: true, text: "Interview #" } } } }
    });
    return function () { if (lineInst.current) { lineInst.current.destroy(); lineInst.current = null; } };
  }, [activeTab, deImpact, hidSg]);

  // ---- stacked bar chart (Table View > Topic completion) ----
  React.useEffect(function () {
    if (activeTab !== "table" || tableSub !== "topiccomplete" || topicChart !== "stacked") return;
    if (!barRef.current || !window.Chart) return;
    if (barInst.current) barInst.current.destroy();
    var isCount = tcMode === "count";
    // counts mode: drop "not applicable" (it isn't an interview count) and fit the axis to the
    // largest applicable bar — removes the empty gap to the axis. % mode keeps all 6 (stacks to 100).
    var barStates = isCount ? BAR_ORDER5 : BAR_ORDER;
    var tsRows = topicRowsFor(DATA.topicStatus, topicGroupMode);
    var maxApp = Math.max.apply(null, tsRows.map(function (t) { return t.applicable || 0; })) || 1;
    barInst.current = new window.Chart(barRef.current.getContext("2d"), {
      type: "bar",
      data: { labels: tsRows.map(function (t) { return t.label || (t.code + " · " + (TOPIC_NAMES[t.code] || t.code)); }),
        datasets: barStates.map(function (st) {
          return { label: STATE_LABEL[st],
            data: tsRows.map(function (t) { return isCount ? (t[st] || 0) : (t.total ? Math.round(1000 * t[st] / t.total) / 10 : 0); }),
            backgroundColor: STATE_COLOR[st] }; }) },
      options: { responsive: true, maintainAspectRatio: false, indexAxis: "y",
        plugins: { title: { display: true, text: (topicGroupMode === "theme" ? "FLW status distribution by THEME (related topics pooled)" : "FLW status distribution by topic") + (isCount ? " — # of applicable FLWs" : " — % of claimed FLWs (stacks to 100%)") }, legend: { position: "bottom", title: { display: true, text: "⇄ Toggle: click any status in the legend below to show / hide it in the chart", color: "#4f46e5", font: { weight: "bold", size: 11 } } },
          tooltip: { callbacks: { label: function (ctx) { return ctx.dataset.label + ": " + ctx.parsed.x + (isCount ? "" : "%"); } } } },
        scales: { x: { stacked: true, max: isCount ? maxApp : 100, title: { display: true, text: isCount ? "# of FLWs the topic applies to" : "% of claimed FLWs" } }, y: { stacked: true, ticks: { autoSkip: false, font: { size: 10 } } } } }
    });
    return function () { if (barInst.current) { barInst.current.destroy(); barInst.current = null; } };
  }, [activeTab, tableSub, topicChart, tcMode, topicGroupMode]);

  function subBtn(cur, val, set, label) {
    var on = cur === val;
    return (
      <button onClick={function () { set(val); }}
        className={"px-3 py-1.5 text-sm rounded-md font-medium " + (on ? "bg-indigo-100 text-indigo-700" : "text-gray-500 hover:bg-gray-100")}>
        {label}
      </button>
    );
  }

  function rgbaOf(hex, a) {
    var h = String(hex).replace("#", "");
    var r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  }

  function ivRow(key, label, iv, indent) {
    var di = deImpact && iv.started_di != null;
    var stVal = di ? iv.started_di : iv.started;
    var pstVal = di ? iv.pct_started_di : iv.pct_started;
    var changed = di && iv.started_di !== iv.started;
    return (
      <tr key={key} className="hover:bg-gray-50">
        <td className={td + " " + indent + " text-gray-500"}>{label}</td>
        <td className={td}>{iv.name}</td>
        <td className={td + " text-right"}>{iv.eligible}</td>
        <td className={td + " text-right"}>{iv.triggered}</td>
        <td className={td + " text-right text-gray-500"}>{iv.pct_trig}%</td>
        <td className={td + " text-right" + (changed ? " text-amber-700 font-medium" : "")} title={changed ? "de-impacted (raw " + iv.started + ")" : ""}>{stVal}</td>
        <td className={td + " text-right text-gray-500"}>{pstVal}%</td>
        <td className={td + " text-right text-green-700 font-medium"}>{iv.completed}</td>
        <td className={td + " text-right text-gray-500"}>{iv.pct_completed == null ? "—" : iv.pct_completed + "%"}</td>
      </tr>
    );
  }

  var c = DATA.counts;
  var maxIv = Math.max.apply(null, (DATA.dropoff.subgroups || []).map(function (s) { return s.interviews.length; }));
  // ---- Full Retention Table: build a flat matrix (for copy/CSV export) ----
  function retentionMatrix() {
    var cols = ["Subgroup", "Cohorts", "Invited", "Accepted", "Started Learn", "Completed Learn", "Claimed", "FLW Reg", "# Initiated"];
    for (var k = 1; k <= maxIv; k++) {
      ["Topic", "Eligible", "Triggered", "% Trig", "Started", "% Started", "Completed", "% Compl", "Overall completed %"].forEach(function (h) { cols.push("I" + k + " " + h); });
    }
    var rows = [cols];
    DATA.dropoff.subgroups.forEach(function (s) {
      var cn = s.connect, byN = {};
      s.interviews.forEach(function (iv) { byN[iv.n] = iv; });
      var r = [s.sg, s.cohorts_n, cn.invited, cn.accepted, cn.learn_started, cn.learn_completed, cn.claimed, cn.flw_reg, cn.initiated];
      for (var k = 1; k <= maxIv; k++) {
        var iv = byN[k];
        if (!iv) { r.push("", "", "", "", "", "", "", "", ""); }
        else { r.push(iv.topic, iv.eligible, iv.triggered, iv.pct_trig, iv.started, iv.pct_started, iv.completed, iv.pct_completed == null ? "" : iv.pct_completed, iv.pct_completed_base == null ? "" : iv.pct_completed_base); }
      }
      rows.push(r);
    });
    return rows;
  }
  function copyRetention() {
    var t = retentionMatrix().map(function (r) { return r.join("\t"); }).join("\n");
    if (navigator.clipboard) navigator.clipboard.writeText(t);
  }
  function downloadRetention() {
    var csv = retentionMatrix().map(function (r) {
      return r.map(function (c) { var s = String(c); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(",");
    }).join("\n");
    var blob = new Blob([csv], { type: "text/csv" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "full_retention_table.csv"; a.click();
  }

  // ---- Granular: ALL live OCS sessions (from the pipeline prop, not embedded) + client-side search/paging ----
  function liveRows(alias) { var p = props.pipelines; return (p && p[alias] && p[alias].rows) || []; }
  var ocsLive = liveRows("sessions");
  // (FLW × Topic links, item D) map "connect_id|interview" -> OCS session id, from the live pipeline.
  // Lets each matrix cell link to its session with zero embed-size cost; empty if pipeline not loaded.
  var sessByKey = {};
  ocsLive.forEach(function (r) {
    var cid = r.connect_id || r.username || "";
    var iv = (r.interview == null || r.interview === "") ? "" : String(r.interview);
    var sid = r.id || r.matched_session_id || "";
    if (cid && iv && sid && !sessByKey[cid + "|" + iv]) sessByKey[cid + "|" + iv] = sid;
  });
  var sessSource = ocsLive.length
    ? ocsLive.map(function (r) {
        var iv = r.interview, stt = r.interview_status || "";
        return {
          connect_id: r.connect_id || r.username || "", interview: (iv == null || iv === "") ? "" : String(iv),
          started: !!(iv != null && iv !== ""), completed: stt === "interview_complete",
          created_at: (r.created_at || "").slice(0, 10), session_id: r.id || r.matched_session_id || "",
        };
      })
    : DATA.granular.map(function (r) {
        return { connect_id: r.connect_id, interview: r.topic_code, started: r.is_started,
          completed: r.is_completed, created_at: "", session_id: r.session_id };
      });
  var gq = gSearch.trim().toLowerCase();
  // ---- per-(FLW × cohort) × topic matrix + a connect_id lookup for filtering both tables ----
  var FM = DATA.flwMatrix || [];
  var flwInfo = {};   // connect_id -> { g: subgroup, cohorts: {cohort:1}, u: untrained }
  FM.forEach(function (r) {
    var fi = flwInfo[r.f] || (flwInfo[r.f] = { g: r.g, cohorts: {}, u: 0 });
    fi.cohorts[r.c] = 1; if (r.u) fi.u = 1;
  });
  var fSubgroups = SG_ORDER.filter(function (sg) { return FM.some(function (r) { return r.g === sg; }); });
  var fCohorts = Object.keys(FM.reduce(function (a, r) { a[r.c] = 1; return a; }, {})).sort();
  var MTOPICS = MATRIX_TOPIC_ORDER.filter(function (t) {
    return fSubgroups.some(function (sg) { return (SUBGROUP_DESIGN[sg] || []).indexOf(t) >= 0; });
  });
  var anyFilter = !!(fSg || fCo || fSt || fTr || fTopic || gq);
  function clearFilters() { setGSearch(""); setFSg(""); setFCo(""); setFSt(""); setFTr(""); setFTopic(""); setGPage(0); }
  // Sessions table: filter live OCS rows via the FLW lookup (cohort filter is by the FLW's cohort,
  // since a session isn't bound to one cohort) + status from the row itself.
  var sessFiltered = sessSource.filter(function (r) {
    if (gq && (r.connect_id + " " + r.session_id + " " + r.interview + " " + (r.completed ? "completed" : r.started ? "started" : "")).toLowerCase().indexOf(gq) < 0) return false;
    var fi = flwInfo[r.connect_id];
    if (fSg && (!fi || fi.g !== fSg)) return false;
    if (fCo && (!fi || !fi.cohorts[fCo])) return false;
    if (fTr && (!fi || (fTr === "untrained" ? !fi.u : fi.u))) return false;
    if (fTopic && String(r.interview) !== fTopic) return false;
    if (fSt) { var st = r.completed ? "completed" : (r.started ? "started-not-completed" : ""); if (st !== fSt) return false; }
    return true;
  });
  // FLW × Topic matrix rows: row-level filters; status filter = FLW has >=1 topic in that state.
  var fStIdx = fSt ? STATES.indexOf(fSt) : -1;
  var matFiltered = FM.filter(function (r) {
    if (gq && (r.f + " " + r.c).toLowerCase().indexOf(gq) < 0) return false;
    if (fSg && r.g !== fSg) return false;
    if (fCo && r.c !== fCo) return false;
    if (fTr && (fTr === "untrained" ? !r.u : r.u)) return false;
    if (fTopic) {
      var ti = (SUBGROUP_DESIGN[r.g] || []).indexOf(fTopic);
      if (ti < 0) return false;                              // FLW's subgroup doesn't run this topic
      if (fStIdx >= 0 && r.s[ti] !== fStIdx) return false;   // that topic must be in the chosen state
    } else if (fStIdx >= 0 && r.s.indexOf(fStIdx) < 0) return false;
    return true;
  });
  // ---- sessions sort (click a column header) ----
  function sortVal(r, key) {
    if (key === "interview") { var n = Number(r.interview); return isNaN(n) ? r.interview || "" : n; }
    if (key === "status") return r.completed ? 2 : r.started ? 1 : 0;   // ordinal: completed > started > none
    if (key === "created") return r.created_at || "";
    return r.connect_id || "";
  }
  var sessSorted = gSort.key
    ? sessFiltered.slice().sort(function (a, b) {
        var va = sortVal(a, gSort.key), vb = sortVal(b, gSort.key);
        var c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
        return gSort.dir === "asc" ? c : -c;
      })
    : sessFiltered;
  function sortTh(label, key) {
    var active = gSort.key === key;
    return (
      <th key={label} onClick={function () { setGSort(active ? { key: key, dir: gSort.dir === "asc" ? "desc" : "asc" } : { key: key, dir: key === "created" ? "desc" : "asc" }); setGPage(0); }}
        className={th + " text-left cursor-pointer select-none hover:text-indigo-600"} title="Click to sort">
        {label}<span className={"ml-1 " + (active ? "text-indigo-600" : "text-gray-300")}>{active ? (gSort.dir === "asc" ? "▲" : "▼") : "↕"}</span>
      </th>
    );
  }
  var GPAGE = 100;
  var activeLen = gView === "matrix" ? matFiltered.length : sessFiltered.length;
  var gPages = Math.max(1, Math.ceil(activeLen / GPAGE));
  var gPageC = Math.min(gPage, gPages - 1);
  var sessPageRows = sessSorted.slice(gPageC * GPAGE, gPageC * GPAGE + GPAGE);
  var matPageRows = matFiltered.slice(gPageC * GPAGE, gPageC * GPAGE + GPAGE);
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Connect Interviews Labs Dashboard</h1>
            <p className="text-xs text-gray-400 mt-1">Data as of {DATA.built_at || DATA.today || "—"} · auto-refreshes daily ~06:00 UTC</p>
          </div>
          <button onClick={function () { window.location.reload(); }}
            title="Data is rebuilt by the daily job; this just reloads the page — it does not pull new data on click."
            className="shrink-0 inline-flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700">
            ↻ Reload page
          </button>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3 text-sm">
          <span><b>{c.cohorts}</b> cohorts</span>
          <span><b>{c.master_rows}</b> master rows</span>
          <span><b>{c.flws}</b> unique FLWs</span>
          <span><b>{c.started}</b> interviews started</span>
          <span><b>{c.completed}</b> completed</span>
        </div>
        {(DATA.unmappedCohorts && DATA.unmappedCohorts.length) ? (
          <div className="mt-3 text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-md px-3 py-2">
            ⚠ {DATA.unmappedCohorts.length} cohort{DATA.unmappedCohorts.length === 1 ? "" : "s"} not yet mapped
            to a known program design (new program type?) — data is collected but hidden until a design is added:{" "}
            <span className="font-mono">{DATA.unmappedCohorts.join(", ")}</span>
          </div>
        ) : null}
      </div>

      <div className="bg-white rounded-lg shadow-sm">
        <div className="border-b border-gray-200 px-5">
          <nav className="-mb-px flex space-x-6">
            {[["overview", "Overview"], ["table", "Table View"], ["funnels", "Interview Completion Funnels"], ["fullretention", "Full Retention Table"], ["breakdowns", "Breakdowns"]].map(function (t) {
              var on = activeTab === t[0];
              return (
                <button key={t[0]} onClick={function () { setTab(t[0]); }}
                  className={"py-3 px-1 border-b-2 text-sm font-medium " + (on ? "border-indigo-500 text-indigo-600" : "border-transparent text-gray-500 hover:text-gray-700")}>
                  {t[1]}
                </button>
              );
            })}
          </nav>
        </div>

        {activeTab === "overview" && (
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[["Cohorts", c.cohorts], ["Unique FLWs", c.flws], ["Interviews started", c.started],
                ["Interviews completed", c.completed], ["% completed", pctOf(c.completed, c.started)]].map(function (kv) {
                return (
                  <div key={kv[0]} className="bg-gray-50 rounded-lg p-3">
                    <div className="text-2xl font-bold text-gray-900">{kv[1]}</div>
                    <div className="text-xs text-gray-500 mt-1">{kv[0]}</div>
                  </div>
                );
              })}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Connect funnel by subgroup</h3>
              <p className="text-xs text-gray-400 mb-2">Invited → Accepted → Completed Learn → Claimed from Connect (user_data); Initiated = any Welcome form; Started/Completed from OCS sessions.</p>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50"><tr>
                    <th className={th + " text-left"}>Subgroup</th>
                    <th className={th + " text-right"}>Invited</th>
                    <th className={th + " text-right"}>Accepted</th>
                    <th className={th + " text-right"}>Completed Learn</th>
                    <th className={th + " text-right"}>Claimed</th>
                    <th className={th + " text-right"}>Initiated</th>
                    <th className={th + " text-right"}>FLWs Started ≥1</th>
                    <th className={th + " text-right"}>FLWs Completed ≥1</th>
                  </tr></thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {DATA.connectFunnel.map(function (r) {
                      return (
                        <tr key={r.sg} className="hover:bg-gray-50">
                          <td className={td + " font-medium"}>{r.sg}</td>
                          <td className={td + " text-right"}>{r.invited}</td>
                          <td className={td + " text-right"}>{r.accepted}</td>
                          <td className={td + " text-right"}>{r.learn_completed}</td>
                          <td className={td + " text-right"}>{r.claimed}</td>
                          <td className={td + " text-right"}>{r.initiated}</td>
                          <td className={td + " text-right"}>{r.started}</td>
                          <td className={td + " text-right text-green-700 font-medium"}>{r.completed}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Completed interviews by round (unique FLWs per subgroup)</h3>
              <p className="text-xs text-gray-400 mb-2"># FLWs who completed each interview number — completion beyond the 1st interview, not just the first.</p>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50"><tr>
                    <th className={th + " text-left"}>Subgroup</th>
                    {Array.apply(null, { length: maxIv }).map(function (_, i) {
                      return <th key={i} className={th + " text-right"}>Int {i + 1}</th>;
                    })}
                  </tr></thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {DATA.dropoff.subgroups.map(function (s) {
                      var byN = {};
                      s.interviews.forEach(function (iv) { byN[iv.n] = iv; });
                      return (
                        <tr key={s.sg} className="hover:bg-gray-50">
                          <td className={td + " font-medium"}>{s.sg}</td>
                          {Array.apply(null, { length: maxIv }).map(function (_, i) {
                            var iv = byN[i + 1];
                            return (
                              <td key={i} className={td + " text-right" + (iv && iv.completed ? " text-green-700 font-medium" : " text-gray-300")}>
                                {iv ? iv.completed : "—"}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === "table" && (
          <div className="p-3 space-y-3">
            <div className="flex items-center gap-2">
              {subBtn(tableSub, "granular", setTableSub, "Granular view")}
              {subBtn(tableSub, "topiccomplete", setTableSub, "Topic completion view")}
            </div>

            {tableSub === "granular" && (
              <div>
                <div className="flex flex-wrap items-center gap-2 px-1 py-2">
                  {subBtn(gView, "sessions", function (v) { setGView(v); setGPage(0); }, "Sessions")}
                  {subBtn(gView, "matrix", function (v) { setGView(v); setGPage(0); }, "FLW × Topic")}
                  <span className="mx-1 text-gray-300">|</span>
                  <input type="text" value={gSearch} placeholder={gView === "matrix" ? "Search connect_id / cohort…" : "Search connect_id / session / interview / status…"}
                    onChange={function (e) { setGSearch(e.target.value); setGPage(0); }}
                    className="border border-gray-300 rounded-md px-3 py-1.5 text-sm" style={{ width: "18rem" }} />
                  <select value={fSg} onChange={function (e) { setFSg(e.target.value); setGPage(0); }} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm">
                    <option value="">All subgroups</option>
                    {fSubgroups.map(function (sg) { return <option key={sg} value={sg}>{sg}</option>; })}
                  </select>
                  <select value={fCo} onChange={function (e) { setFCo(e.target.value); setGPage(0); }} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm">
                    <option value="">All cohorts</option>
                    {fCohorts.map(function (co) { return <option key={co} value={co}>{co}</option>; })}
                  </select>
                  <select value={fTopic} onChange={function (e) { setFTopic(e.target.value); setGPage(0); }} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm" title="Filter by interview topic">
                    <option value="">All topics</option>
                    {MTOPICS.map(function (t) { return <option key={t} value={t}>{t} · {TOPIC_NAMES[t] || t}</option>; })}
                  </select>
                  <select value={fSt} onChange={function (e) { setFSt(e.target.value); setGPage(0); }} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm">
                    <option value="">All statuses</option>
                    {STATES5.map(function (s) { return <option key={s} value={s}>{STATE_LABEL[s]}</option>; })}
                  </select>
                  <select value={fTr} onChange={function (e) { setFTr(e.target.value); setGPage(0); }} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm">
                    <option value="">All FLWs</option>
                    <option value="trained">Trained</option>
                    <option value="untrained">Untrained</option>
                  </select>
                  {anyFilter ? <button onClick={clearFilters} className="px-2 py-1.5 text-xs text-indigo-600 hover:underline">Clear</button> : null}
                </div>

                {gView === "sessions" && (
                  <div>
                    <div className="px-1 pb-2 text-xs text-gray-500">
                      {sessFiltered.length} sessions{ocsLive.length ? " (live OCS)" : " (embedded sample — live pipeline not loaded)"}{anyFilter ? " matching" : ""}
                    </div>
                    <div className="overflow-x-auto" style={{ maxHeight: "65vh" }}>
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50 sticky top-0"><tr>
                          {sortTh("connect_id", "connect_id")}
                          {sortTh("interview", "interview")}
                          {sortTh("status", "status")}
                          {sortTh("created", "created")}
                          <th className={th + " text-left"}>session</th>
                        </tr></thead>
                        <tbody className="bg-white divide-y divide-gray-100">
                          {sessPageRows.map(function (r, idx) {
                            var label = r.completed ? "Completed" : (r.started ? "Started" : "—");
                            var cls = r.completed ? "text-green-700 font-medium" : (r.started ? "text-lime-700" : "text-gray-400");
                            return (
                              <tr key={idx} className="hover:bg-gray-50">
                                <td className={td + " font-mono text-xs"}>{r.connect_id}</td>
                                <td className={td}>{r.interview || "—"}</td>
                                <td className={td + " " + cls}>{label}</td>
                                <td className={td + " text-gray-500"}>{r.created_at || "—"}</td>
                                <td className={td + " font-mono text-xs"}>{r.session_id ? <a href={"https://www.openchatstudio.com/a/Vaccine_Coach/chatbots/e/cc01d032-5931-4bdd-a4b2-6f05f4f72f88/s/" + r.session_id + "/view/"} target="_blank" rel="noopener noreferrer" title={r.session_id} className="text-indigo-600 hover:underline">view ↗</a> : ""}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {gView === "matrix" && (
                  <div>
                    <div className="px-1 pb-1 text-xs text-gray-500">
                      {matFiltered.length} FLW×cohort rows{anyFilter ? " matching" : ""} · one row per claimed FLW, one column per topic — hover a cell for its status.
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 px-1 pb-2 text-xs text-gray-500">
                      {STATES5.map(function (s) {
                        return <span key={s} className="inline-flex items-center gap-1"><span style={{ display: "inline-block", width: 11, height: 11, background: STATE_COLOR[s], borderRadius: 2 }}></span>{CELL_GLYPH[STATES.indexOf(s)]} {STATE_LABEL[s]}</span>;
                      })}
                    </div>
                    <div className="overflow-x-auto" style={{ maxHeight: "65vh" }}>
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50 sticky top-0"><tr>
                          <th className={th + " text-left"}>connect_id</th>
                          <th className={th + " text-left"}>cohort</th>
                          <th className={th + " text-left"}>subgroup</th>
                          {MTOPICS.map(function (t) { return <th key={t} className={th + " text-center"} title={TOPIC_NAMES[t] || t}>{t}</th>; })}
                        </tr></thead>
                        <tbody className="bg-white divide-y divide-gray-100">
                          {matPageRows.map(function (r, idx) {
                            var topics = SUBGROUP_DESIGN[r.g] || [];
                            var cb = {}; topics.forEach(function (t, i) { cb[t] = r.s[i]; });
                            return (
                              <tr key={idx} className="hover:bg-gray-50">
                                <td className={td + " font-mono text-xs"}>{r.f}{r.u ? <span title="Untrained FLW" className="ml-1 text-amber-600">⚑</span> : null}</td>
                                <td className={td}>{r.c}</td>
                                <td className={td + " text-gray-500"}>{r.g}</td>
                                {MTOPICS.map(function (t) {
                                  if (!(t in cb)) return <td key={t} className="px-2 py-1 text-center text-gray-200">·</td>;
                                  var code = cb[t];
                                  var _sid = sessByKey[r.f + "|" + t];
                                  var _cell = _sid
                                    ? <a href={"https://www.openchatstudio.com/a/Vaccine_Coach/chatbots/e/cc01d032-5931-4bdd-a4b2-6f05f4f72f88/s/" + _sid + "/view/"} target="_blank" rel="noopener noreferrer" style={{ color: "#fff", fontWeight: 700, textDecoration: "none" }}>{CELL_GLYPH[code]}<span style={{ fontSize: "10px", verticalAlign: "super", color: "#38bdf8", fontWeight: 700 }}>↗</span></a>
                                    : CELL_GLYPH[code];
                                  return <td key={t} className={"px-2 py-1 text-center text-xs" + (_sid ? " cursor-pointer" : "")} title={(TOPIC_NAMES[t] || t) + " — " + STATE_LABEL[STATES[code]] + (_sid ? " · click ↗ to open the OCS session" : "")}
                                    style={{ backgroundColor: rgbaOf(STATE_COLOR[STATES[code]], 0.85), color: "#fff" }}>{_cell}</td>;
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3 px-1 py-2 text-sm">
                  <button onClick={function () { setGPage(Math.max(0, gPageC - 1)); }} disabled={gPageC <= 0}
                    className="px-2 py-1 rounded border border-gray-300 disabled:opacity-40">‹ Prev</button>
                  <span className="text-gray-500">Page {gPageC + 1} / {gPages}</span>
                  <button onClick={function () { setGPage(Math.min(gPages - 1, gPageC + 1)); }} disabled={gPageC >= gPages - 1}
                    className="px-2 py-1 rounded border border-gray-300 disabled:opacity-40">Next ›</button>
                </div>
              </div>
            )}

            {tableSub === "topiccomplete" && (
              <div className="space-y-4">
                <p className="text-xs text-gray-400 px-1">Per-FLW status by topic, across all claimed FLWs (each topic stacks to 100%). Click a topic to break it down by cohort.</p>
                <p className="text-xs text-gray-400 px-1">Each bar counts <span className="font-medium text-gray-500">enrollment slots</span> for that topic (claimed FLW × cohort — the completion-rate base), not unique FLWs. It includes people enrolled but not yet started, and counts anyone in two cohorts twice, so a bar can exceed the Overview unique-FLW total.</p>
                <div className="flex flex-wrap items-center gap-2 px-1">
                  {subBtn(topicChart, "stacked", setTopicChart, "Stacked bar")}
                  {subBtn(topicChart, "scoreboard", setTopicChart, "Completion scoreboard")}
                  {subBtn(topicChart, "heatmap", setTopicChart, "Heatmap")}
                  <span className="mx-1 text-gray-300">|</span>
                  <span className="text-xs text-gray-400">Group:</span>
                  {subBtn(topicGroupMode, "topic", setTopicGroupMode, "By topic")}
                  {subBtn(topicGroupMode, "theme", setTopicGroupMode, "By theme")}
                  <span className="mx-1 text-gray-300">|</span>
                  <span className="text-xs text-gray-400">Show:</span>
                  {subBtn(tcMode, "pct", setTcMode, "%")}
                  {subBtn(tcMode, "count", setTcMode, "Raw counts")}
                </div>
                {topicGroupMode === "theme" && (
                  <p className="text-xs text-gray-400 px-1">Related topics pooled into themes (interview-level sum): <span className="font-medium text-gray-500">Malaria</span> = B,1,2,10,10S,10L,14 · <span className="font-medium text-gray-500">Water &amp; Diarrhea</span> = D,11,11S,11L · <span className="font-medium text-gray-500">Community &amp; FLW Profile</span> = E,12 · <span className="font-medium text-gray-500">Antibiotics &amp; ACT Use</span> = 8,8S,8L · <span className="font-medium text-gray-500">Medicine Quality</span> = 9,13,13L. Topics not in a theme stay individual.</p>
                )}
                <Legend title="Status definitions (in chart order)">
                  {BAR_ORDER.map(function (s) {
                    return (
                      <div key={s} className="flex items-start gap-2">
                        <span style={{ display: "inline-block", width: 11, height: 11, background: STATE_COLOR[s], borderRadius: 2, marginTop: 3, flexShrink: 0 }}></span>
                        <span><b>{STATE_LABEL[s]}:</b> {STATE_DEF[s]}</span>
                      </div>
                    );
                  })}
                </Legend>
                {topicChart === "stacked" && (
                  <div style={{ height: Math.max(440, (topicRowsFor(DATA.topicStatus, topicGroupMode).length || 12) * 30) + "px" }}><canvas ref={barRef}></canvas></div>
                )}
                {topicChart === "scoreboard" && (
                  <div className="px-1">
                    <p className="text-xs text-gray-400 mb-2">% completed of the FLWs each {topicGroupMode === "theme" ? "theme" : "topic"} applies to (excludes the not-applicable group), sorted high → low.</p>
                    {topicRowsFor(DATA.topicStatus, topicGroupMode).slice().sort(function (a, b) {
                      var pa = a.applicable ? a.completed / a.applicable : -1;
                      var pb = b.applicable ? b.completed / b.applicable : -1;
                      return pb - pa;
                    }).map(function (t) {
                      var pct = t.applicable ? Math.round(1000 * t.completed / t.applicable) / 10 : null;
                      return (
                        <div key={t.code} className="flex items-center gap-2 py-1">
                          <div className="text-xs text-gray-600 truncate" style={{ width: "13rem", flexShrink: 0 }}>{t.label || (t.code + " · " + (TOPIC_NAMES[t.code] || t.code))}</div>
                          <div className="flex-1" style={{ background: "#f1f5f9", borderRadius: 4, height: 16, minWidth: 120 }}>
                            <div title={(pct == null ? "—" : pct + "%") + " completed"} style={{ width: (pct == null ? 0 : pct) + "%", background: STATE_COLOR["completed"], height: "100%", borderRadius: 4 }}></div>
                          </div>
                          <div className="text-xs font-medium text-gray-700 text-right" style={{ width: "3.5rem", flexShrink: 0 }}>{pct == null ? "—" : pct + "%"}</div>
                          <div className="text-xs text-gray-400 text-right" style={{ width: "5.5rem", flexShrink: 0 }}>applies {t.applicable}</div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {topicChart === "heatmap" && (
                  <div className="overflow-x-auto px-1">
                    <p className="text-xs text-gray-400 mb-2">Each cell = % of applicable FLWs in that stage (darker = higher). Rows = {topicGroupMode === "theme" ? "themes" : "topics"}, columns = the 5 applicable stages.</p>
                    <table className="min-w-full border border-gray-200">
                      <thead className="bg-gray-50"><tr>
                        <th className={th + " text-left"}>{topicGroupMode === "theme" ? "Theme" : "Topic"}</th>
                        <th className={th + " text-right"}>Applies</th>
                        {BAR_ORDER5.map(function (s) { return <th key={s} className={th + " text-right"}>{STATE_LABEL[s]}</th>; })}
                      </tr></thead>
                      <tbody>
                        {topicRowsFor(DATA.topicStatus, topicGroupMode).map(function (t) {
                          return (
                            <tr key={t.code}>
                              <td className={td + " font-medium text-gray-700"}>{t.label || (t.code + " · " + (TOPIC_NAMES[t.code] || t.code))}</td>
                              <td className={td + " text-right text-gray-400"}>{t.applicable}</td>
                              {BAR_ORDER5.map(function (s) {
                                var frac = t.applicable ? t[s] / t.applicable : 0;
                                var pct = t.applicable ? Math.round(1000 * t[s] / t.applicable) / 10 : null;
                                return (
                                  <td key={s} className={td + " text-right"} style={{ backgroundColor: rgbaOf(STATE_COLOR[s], t.applicable ? (0.08 + 0.92 * frac) : 0) }}>
                                    {pct == null ? "—" : pct + "%"}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50"><tr>
                      <th className={th + " text-left"}>Topic</th>
                      {BAR_ORDER.map(function (s) { return <th key={s} className={th + " text-right"}>{STATE_LABEL[s]}</th>; })}
                    </tr></thead>
                    <tbody className="bg-white divide-y divide-gray-100">
                      {DATA.topicStatus.map(function (t) {
                        var open = !!topicExp[t.code];
                        var has = (DATA.topicStatusCohort[t.code] || []).length > 0;
                        function p(s, tot) { return tcMode === "count" ? s : (tot ? Math.round(1000 * s / tot) / 10 + "%" : "—"); }
                        var rows = [];
                        rows.push(
                          <tr key={t.code} className={"hover:bg-gray-50 " + (has ? "cursor-pointer" : "")}
                            onClick={has ? function () { var n = Object.assign({}, topicExp); n[t.code] = !open; setTopicExp(n); } : null}>
                            <td className={td + " font-medium"}>{has ? (open ? "▾ " : "▸ ") : ""}{t.code} · {TOPIC_NAMES[t.code] || t.code}</td>
                            {BAR_ORDER.map(function (s) {
                              return <td key={s} className={td + " text-right" + (s === "completed" ? " text-green-700 font-medium" : " text-gray-600")}>{p(t[s], t.total)}</td>;
                            })}
                          </tr>
                        );
                        if (open) {
                          var cohRows = DATA.topicStatusCohort[t.code] || [];
                          rows.push(
                            <tr key={t.code + "-exp"} className="bg-gray-50">
                              <td className={td} colSpan={STATES.length + 1} style={{ padding: 0 }}>
                                <div className="my-2 ml-8 mr-3 border-l-2 border-gray-300 pl-3">
                                  <div className="text-xs font-medium text-gray-500 mb-1">
                                    By cohort — {t.code} · {TOPIC_NAMES[t.code] || t.code} ({cohRows.length} cohort{cohRows.length === 1 ? "" : "s"})
                                  </div>
                                  <table className="min-w-full border border-gray-200 rounded-md overflow-hidden">
                                    <thead className="bg-white"><tr>
                                      <th className={th + " text-left"}>Cohort</th>
                                      <th className={th + " text-left"}>Distribution</th>
                                      {BAR_ORDER5.map(function (s) { return <th key={s} className={th + " text-right"}>{STATE_LABEL[s]}</th>; })}
                                    </tr></thead>
                                    <tbody className="divide-y divide-gray-100">
                                      {cohRows.map(function (rc) {
                                        return (
                                          <tr key={rc.cohort} className="bg-white hover:bg-gray-50">
                                            <td className={td + " text-gray-700"}>{rc.cohort} <span className="text-gray-400">(n={rc.total})</span></td>
                                            <td className={td}>
                                              <div style={{ display: "flex", width: 120, height: 10, borderRadius: 2, overflow: "hidden", border: "1px solid #e5e7eb" }}>
                                                {BAR_ORDER5.map(function (s) {
                                                  var w = rc.total ? (100 * rc[s] / rc.total) : 0;
                                                  return w > 0 ? <div key={s} title={STATE_LABEL[s] + ": " + (Math.round(10 * w) / 10) + "%"} style={{ width: w + "%", backgroundColor: STATE_COLOR[s] }}></div> : null;
                                                })}
                                              </div>
                                            </td>
                                            {BAR_ORDER5.map(function (s) {
                                              return <td key={s} className={td + " text-right" + (s === "completed" ? " text-green-700" : " text-gray-500")}>{p(rc[s], rc.total)}</td>;
                                            })}
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          );
                        }
                        return rows;
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === "funnels" && (
          <div className="p-3 space-y-4">
            <div className="flex flex-wrap items-center gap-2 px-1">
              <span className="text-xs font-medium text-gray-600">Penult/last artifact:</span>
              {subBtn(deImpact ? "di" : "raw", "raw", function () { setDeImpact(false); }, "Raw")}
              {subBtn(deImpact ? "di" : "raw", "di", function () { setDeImpact(true); }, "De-impacted")}
              {deImpact ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  <span title={"FLWs removed from the last interview's Started (started last but not penultimate, triggered back-to-back):\n" + Object.keys(DATA.deimpact || {}).sort().map(function (sg) { return "  " + sg + ": " + DATA.deimpact[sg].count; }).join("\n") + "\n  Total: " + Object.keys(DATA.deimpact || {}).reduce(function (a, sg) { return a + DATA.deimpact[sg].count; }, 0)}
                    className="cursor-help font-bold border border-amber-400 rounded-full w-4 h-4 inline-flex items-center justify-center shrink-0">ℹ</span>
                  Removes FLWs who started only the LAST interview (skipped the penultimate — triggered back-to-back) from the last interview's Started, revealing the true decline. Hover ℹ for per-subgroup counts. Affects the line chart &amp; drop-off %Started below.
                </span>
              ) : null}
            </div>
            <div style={{ height: "380px" }}><canvas ref={lineRef}></canvas></div>
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 px-2">
              <span className="text-xs font-semibold text-indigo-600 mr-1">⇄ Toggle: click a subgroup to show / hide its line</span>
              {DATA.lineSeries.map(function (s) {
                var col = SG_COLOR[s.sg] || "#9ca3af";
                var dashed = (s.status || []).some(function (x) { return x === "in-progress"; });
                var off = !!hidSg[s.sg];
                return (
                  <button key={s.sg} type="button"
                    onClick={function () { var n = Object.assign({}, hidSg); n[s.sg] = !n[s.sg]; setHidSg(n); }}
                    title={off ? "Hidden — click to show" : "Click to hide" + (dashed ? " · dashed = still in progress" : "")}
                    className={"inline-flex items-center gap-1.5 text-xs " + (off ? "opacity-40 line-through" : "text-gray-700 hover:text-gray-900")}>
                    <svg width="32" height="12" style={{ flexShrink: 0 }}>
                      <line x1="1" y1="6" x2="31" y2="6" stroke={col} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={dashed ? "6,4" : "none"} />
                    </svg>
                    {s.sg} (n={s.base})
                  </button>
                );
              })}
            </div>

            <Legend title="What these columns mean">
              <div><b>Connect funnel:</b> Invited → Accepted → Started/Completed Learn → Claimed (downloaded the app) → FLW Reg (HQ) (registered in CommCare HQ) → # Initiated (clicked any Welcome/start form).</div>
              <div><b>Eligible</b> = # FLWs initiated (constant per group — the retention base). <b>Triggered</b> = the bot prompted that interview. <b>Started</b> = an OCS session exists. <b>Completed</b> = session reached interview_complete.</div>
              <div><b>% Started</b> = Started ÷ Eligible · <b>% Triggered</b> = Triggered ÷ Eligible · <b>% Completed</b> = Completed ÷ Started.</div>
            </Legend>

            <div className="overflow-x-auto">
              <h3 className="text-sm font-semibold text-gray-700 px-1 py-1">Connect funnel by subgroup</h3>
              <p className="text-xs text-gray-400 px-1">Invited → Accepted → Started/Completed Learn → Claimed → FLW registered (HQ) → # Initiated (any Welcome form). From Connect user_data (static snapshot) + HQ.</p>
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50"><tr>
                  {["Subgroup", "Invited", "Accepted", "Started Learn", "Completed Learn", "Claimed", "FLW Reg (HQ)", "# Initiated"].map(function (h, i) {
                    return <th key={h} className={th + (i === 0 ? " text-left" : " text-right")}>{h}</th>;
                  })}
                </tr></thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {DATA.dropoff.subgroups.map(function (s) {
                    var c = s.connect;
                    return (
                      <tr key={s.sg} className="hover:bg-gray-50">
                        <td className={td + " font-medium"}>{s.sg} <span className="text-gray-400">({s.cohorts_n})</span></td>
                        <td className={td + " text-right"}>{c.invited}</td>
                        <td className={td + " text-right"}>{c.accepted}</td>
                        <td className={td + " text-right"}>{c.learn_started}</td>
                        <td className={td + " text-right"}>{c.learn_completed}</td>
                        <td className={td + " text-right"}>{c.claimed}</td>
                        <td className={td + " text-right"}>{c.flw_reg}</td>
                        <td className={td + " text-right font-medium"}>{c.initiated}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="overflow-x-auto">
              <h3 className="text-sm font-semibold text-gray-700 px-1 py-1">Interview drop-off — by interview, all topics</h3>
              <p className="text-xs text-gray-400 px-1">Retention rates: Eligible = # FLWs initiated (constant per group); % Started = Started ÷ Eligible; % Completed = Completed ÷ Started. Click a subgroup to expand its cohorts.</p>
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50"><tr>
                  <th className={th + " text-left"}>Group / Int</th><th className={th + " text-left"}>Topic</th>
                  <th className={th + " text-right"}>Eligible</th><th className={th + " text-right"}>Triggered</th>
                  <th className={th + " text-right"}>% Trig</th><th className={th + " text-right"}>Started</th>
                  <th className={th + " text-right"}>% Started</th><th className={th + " text-right"}>Completed</th>
                  <th className={th + " text-right"}>% Completed</th>
                </tr></thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {DATA.dropoff.subgroups.map(function (s) {
                    var open = !!funExp[s.sg];
                    var rows = [];
                    rows.push(
                      <tr key={s.sg + "-h"} className="bg-indigo-50 cursor-pointer"
                        onClick={function () { var n = Object.assign({}, funExp); n[s.sg] = !open; setFunExp(n); }}>
                        <td className={td + " font-bold text-indigo-800"} colSpan={9}>{open ? "▾" : "▸"} {s.sg} — {(DATA.dropoff.cohorts[s.sg] || []).length} cohorts</td>
                      </tr>
                    );
                    s.interviews.forEach(function (iv) { rows.push(ivRow(s.sg + "-" + iv.n, "Int " + iv.n, iv, "")); });
                    if (open) {
                      var cos = DATA.dropoff.cohorts[s.sg] || [];
                      rows.push(
                        <tr key={s.sg + "-exp"} className="bg-gray-50">
                          <td className={td} colSpan={9} style={{ padding: 0 }}>
                            <div className="my-2 ml-6 mr-3 border-l-2 border-indigo-200 pl-3 space-y-3">
                              {cos.map(function (co) {
                                return (
                                  <div key={co.cohort}>
                                    <div className="text-xs font-medium text-gray-500 mb-1">{co.cohort} — {co.interviews.length} interview{co.interviews.length === 1 ? "" : "s"}</div>
                                    <table className="min-w-full border border-gray-200 rounded-md overflow-hidden">
                                      <thead className="bg-white"><tr>
                                        <th className={th + " text-left"}>Int</th><th className={th + " text-left"}>Topic</th>
                                        <th className={th + " text-right"}>Eligible</th><th className={th + " text-right"}>Triggered</th>
                                        <th className={th + " text-right"}>% Trig</th><th className={th + " text-right"}>Started</th>
                                        <th className={th + " text-right"}>% Started</th><th className={th + " text-right"}>Completed</th>
                                        <th className={th + " text-right"}>% Completed</th>
                                      </tr></thead>
                                      <tbody className="divide-y divide-gray-100">
                                        {co.interviews.map(function (iv) {
                                          return (
                                            <tr key={co.cohort + "-" + iv.n} className="bg-white hover:bg-gray-50">
                                              <td className={td + " text-gray-500"}>Int {iv.n}</td>
                                              <td className={td}>{iv.name}</td>
                                              <td className={td + " text-right"}>{iv.eligible}</td>
                                              <td className={td + " text-right"}>{iv.triggered}</td>
                                              <td className={td + " text-right text-gray-500"}>{iv.pct_trig}%</td>
                                              <td className={td + " text-right"}>{iv.started}</td>
                                              <td className={td + " text-right text-gray-500"}>{iv.pct_started}%</td>
                                              <td className={td + " text-right text-green-700 font-medium"}>{iv.completed}</td>
                                              <td className={td + " text-right text-gray-500"}>{iv.pct_completed == null ? "—" : iv.pct_completed + "%"}</td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      );
                    }
                    return rows;
                  })}
                </tbody>
              </table>
            </div>

          </div>
        )}

        {activeTab === "fullretention" && (
          <div className="p-3 space-y-4">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-700 mr-2">Full retention table — Connect funnel → every interview (one row per subgroup)</h3>
              <button onClick={copyRetention} className="px-3 py-1.5 text-sm rounded-md bg-indigo-600 text-white hover:bg-indigo-700">⧉ Copy</button>
              <button onClick={downloadRetention} className="px-3 py-1.5 text-sm rounded-md border border-gray-300 hover:bg-gray-100">↓ CSV</button>
              <span className="text-xs text-gray-400">Copy pastes tab-separated into Sheets/Excel.</span>
            </div>
            <Legend title="Column definitions">
              <div><b>Connect funnel</b> (unique FLWs per subgroup): <b>Invited</b> → <b>Accepted</b> → <b>Started Learn</b> → <b>Completed Learn</b> → <b>Claimed</b> (downloaded the opportunity) → <b>FLW Reg</b> (also registered in CommCare HQ) → <b># Initiated</b> (submitted any Welcome/start form — the retention base).</div>
              <div><b>Per interview:</b> <b>Eligible</b> = # Initiated (constant base). <b>Triggered</b> = bot prompted that interview. <b>Started</b> = an OCS session exists. <b>Completed</b> = session reached interview_complete.</div>
              <div><b>% Trig</b> = Triggered ÷ Eligible · <b>% Started</b> = Started ÷ Eligible · <b>% Compl</b> = Completed ÷ Started (conversion of those who started) · <b>Overall completed</b> = Completed ÷ # Initiated (completion as a share of everyone who initiated).</div>
            </Legend>
            <Legend title="Which interviews each subgroup runs (topic sequence)">
              {SG_ORDER.filter(function (sg) { return (SUBGROUP_DESIGN[sg] || []).length; }).map(function (sg) {
                return (
                  <div key={sg}><b>{sg}</b> <span className="text-gray-400">({(SUBGROUP_DESIGN[sg] || []).length} interviews, every {(DATA.subgroupDesign && DATA.subgroupDesign[sg] ? DATA.subgroupDesign[sg].cadence : "?")}d)</span>: {(SUBGROUP_DESIGN[sg] || []).map(function (t, i) { return "Int" + (i + 1) + "=" + t + " (" + (TOPIC_NAMES[t] || t) + ")"; }).join(" · ")}</div>
                );
              })}
            </Legend>
            <div className="overflow-x-auto border border-gray-200 rounded-lg" style={{ maxHeight: "70vh", fontVariantNumeric: "tabular-nums" }}>
              <table className="min-w-full text-xs border-collapse">
                <thead className="sticky top-0 z-20">
                  <tr className="bg-gray-100">
                    <th className={th + " text-left sticky left-0 z-30 bg-gray-100 border-b border-gray-300"} rowSpan={2} title="Study arm / program type">Subgroup</th>
                    <th className={th + " text-right border-b border-gray-300"} rowSpan={2} title="Number of cohorts in this subgroup">Cohorts</th>
                    <th className={th + " text-right border-b border-gray-300"} rowSpan={2} title="Unique FLWs with an invited_date in Connect">Invited</th>
                    <th className={th + " text-right border-b border-gray-300"} rowSpan={2} title="Unique FLWs with user_invite_status = accepted">Accepted</th>
                    <th className={th + " text-right border-b border-gray-300"} rowSpan={2} title="Unique FLWs with a date_learn_started">Started Learn</th>
                    <th className={th + " text-right border-b border-gray-300"} rowSpan={2} title="Unique FLWs with a completed_learn_date">Compl. Learn</th>
                    <th className={th + " text-right border-b border-gray-300"} rowSpan={2} title="Unique FLWs with a date_claimed (downloaded the opportunity)">Claimed</th>
                    <th className={th + " text-right border-b border-gray-300"} rowSpan={2} title="Claimed FLWs also registered in CommCare HQ (claimed ∩ HQ flw_registration)">FLW Reg</th>
                    <th className={th + " text-right border-r-2 border-gray-300 border-b"} rowSpan={2} title="Unique FLWs with any Welcome/start form — the retention base (denominator for the % columns)"># Initiated</th>
                    {Array.apply(null, { length: maxIv }).map(function (_, i) {
                      return <th key={i} className={th + " text-center border-l-2 border-gray-300 " + (i % 2 ? "bg-gray-100" : "bg-indigo-50")} colSpan={6}>Interview {i + 1}</th>;
                    })}
                  </tr>
                  <tr className="bg-gray-100">
                    {Array.apply(null, { length: maxIv }).map(function (_, i) {
                      var gb = (i % 2 ? "bg-gray-100" : "bg-indigo-50");
                      return [
                        <th key={i + "t"} className={th + " text-left border-l-2 border-gray-300 border-b border-gray-300 " + gb} title="Topic code for this interview position (hover a cell for the topic name)">Topic</th>,
                        <th key={i + "e"} className={th + " text-right border-b border-gray-300 " + gb} title="Eligible = # Initiated (constant retention base)">Elig</th>,
                        <th key={i + "tr"} className={th + " text-right border-b border-gray-300 " + gb} title="Bot-triggered FLWs · % = Triggered ÷ Eligible">Trig/%</th>,
                        <th key={i + "s"} className={th + " text-right border-b border-gray-300 " + gb} title="FLWs with an OCS session · % = Started ÷ Eligible">Start/%</th>,
                        <th key={i + "c"} className={th + " text-right border-b border-gray-300 " + gb} title="Completed (session reached interview_complete) · % = Completed ÷ Started">Compl/%</th>,
                        <th key={i + "ci"} className={th + " text-right border-b border-gray-300 " + gb} title="Overall completed = Completed ÷ # Initiated (share of everyone who initiated)">Overall Compl%</th>,
                      ];
                    })}
                  </tr>
                </thead>
                <tbody>
                  {DATA.dropoff.subgroups.map(function (s, ridx) {
                    var cn = s.connect, byN = {};
                    s.interviews.forEach(function (iv) { byN[iv.n] = iv; });
                    var rbg = ridx % 2 ? "bg-gray-50" : "bg-white";
                    return (
                      <tr key={s.sg} className={rbg + " hover:bg-indigo-50/60 border-b border-gray-100"}>
                        <td className={td + " font-semibold sticky left-0 z-10 " + rbg}>{s.sg}</td>
                        <td className={td + " text-right text-gray-500"}>{s.cohorts_n}</td>
                        <td className={td + " text-right"}>{cn.invited}</td>
                        <td className={td + " text-right"}>{cn.accepted}</td>
                        <td className={td + " text-right"}>{cn.learn_started}</td>
                        <td className={td + " text-right"}>{cn.learn_completed}</td>
                        <td className={td + " text-right"}>{cn.claimed}</td>
                        <td className={td + " text-right"}>{cn.flw_reg}</td>
                        <td className={td + " text-right font-semibold border-r-2 border-gray-300"}>{cn.initiated}</td>
                        {Array.apply(null, { length: maxIv }).map(function (_, i) {
                          var iv = byN[i + 1];
                          if (!iv) return [
                            <td key={i + "t"} className={td + " text-gray-200 border-l-2 border-gray-300"}>—</td>,
                            <td key={i + "e"} className={td}></td>, <td key={i + "tr"} className={td}></td>,
                            <td key={i + "s"} className={td}></td>, <td key={i + "c"} className={td}></td>,
                            <td key={i + "ci"} className={td}></td>,
                          ];
                          return [
                            <td key={i + "t"} className={td + " border-l-2 border-gray-300 font-medium text-gray-600"} title={iv.name}>{iv.topic}</td>,
                            <td key={i + "e"} className={td + " text-right text-gray-400"}>{iv.eligible}</td>,
                            <td key={i + "tr"} className={td + " text-right"}>{iv.triggered} <span className="text-gray-400">{iv.pct_trig}%</span></td>,
                            <td key={i + "s"} className={td + " text-right"}>{iv.started} <span className="text-gray-400">{iv.pct_started}%</span></td>,
                            <td key={i + "c"} className={td + " text-right text-green-700"}>{iv.completed} <span className="text-gray-400">{iv.pct_completed == null ? "—" : iv.pct_completed + "%"}</span></td>,
                            <td key={i + "ci"} className={td + " text-right font-semibold " + (iv.pct_completed_base == null ? "text-gray-400" : "text-green-800")}>{iv.pct_completed_base == null ? "—" : iv.pct_completed_base + "%"}</td>,
                          ];
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "breakdowns" && (
          <div className="p-3 space-y-3">
            <div className="flex items-center gap-2">
              {subBtn(bdSub, "subgroup", setBdSub, "By Subgroup")}
              {subBtn(bdSub, "topic", setBdSub, "By Topic")}
              {subBtn(bdSub, "ab", setBdSub, "A/B Arms")}
            </div>
            <Legend title="Metric definitions">
              <div><b>FLWs Started:</b> unique FLWs who started ≥1 interview in the group.</div>
              <div><b>Interviews Started / Completed:</b> count of started / completed interviews (an FLW can have several).</div>
              <div><b>% Completed:</b> Interviews Completed ÷ Interviews Started.</div>
              <div><b>Avg words / FLW msg:</b> total FLW-message words ÷ total FLW messages, over started sessions (whitespace word count).</div>
            </Legend>

            {bdSub === "subgroup" && (
              <div className="overflow-x-auto">
                <p className="text-xs text-gray-400 px-1 py-1">Unique FLWs &amp; interview counts per study arm. % Completed = completed ÷ started.</p>
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50"><tr>
                    <th className={th + " text-left"}>Subgroup</th><th className={th + " text-right"}>FLWs Started</th>
                    <th className={th + " text-right"}>Interviews Started</th><th className={th + " text-right"}>Interviews Completed</th>
                    <th className={th + " text-right"}>% Completed</th><th className={th + " text-right"}>Avg words / FLW msg</th>
                  </tr></thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {DATA.table1.map(function (r) {
                      var ov = r.key === "Overall";
                      return (
                        <tr key={r.key} className={ov ? "bg-gray-50" : "hover:bg-gray-50"}>
                          <td className={td + (ov ? " font-bold" : " font-medium")}>{r.key}</td>
                          <td className={td + " text-right"}>{r.flws}</td><td className={td + " text-right"}>{r.ist}</td>
                          <td className={td + " text-right text-green-700 font-medium"}>{r.icmp}</td>
                          <td className={td + " text-right text-gray-500"}>{pctTxt(r.pct)}</td>
                          <td className={td + " text-right text-gray-500"}>{r.avg_words == null ? "—" : r.avg_words}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {bdSub === "topic" && (
              <div className="overflow-x-auto">
                <p className="text-xs text-gray-400 px-1 py-1">Interview engagement by topic (pooled across subgroups). % Completed = completed ÷ started.</p>
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50"><tr>
                    <th className={th + " text-left"}>Topic</th><th className={th + " text-left"}>Name</th>
                    <th className={th + " text-right"} title="Number of questions in this topic's interview (per the design)"># Questions</th>
                    <th className={th + " text-right"}>FLWs Started</th><th className={th + " text-right"}>Interviews Started</th>
                    <th className={th + " text-right"}>Interviews Completed</th><th className={th + " text-right"}>% Completed</th>
                    <th className={th + " text-right"}>Avg words / FLW msg</th>
                  </tr></thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {DATA.table2.map(function (r) {
                      var _q = DATA.topicQuestions && DATA.topicQuestions[r.code] != null ? DATA.topicQuestions[r.code] : null;
                      var none = !r.ist;  // no started interviews yet (e.g. not-yet-reached PANEL topics)
                      return (
                        <tr key={r.code} className={none ? "text-gray-400" : "hover:bg-gray-50"}>
                          <td className={td + " font-medium"}>{r.code}</td><td className={td}>{r.name}</td>
                          <td className={td + " text-right text-gray-600"}>{_q == null ? "—" : _q}</td>
                          <td className={td + " text-right"}>{none ? "—" : r.flws}</td><td className={td + " text-right"}>{none ? "—" : r.ist}</td>
                          <td className={td + " text-right text-green-700 font-medium"}>{none ? "—" : r.icmp}</td>
                          <td className={td + " text-right text-gray-500"}>{pctTxt(r.pct)}</td>
                          <td className={td + " text-right text-gray-500"}>{r.avg_words == null ? "—" : r.avg_words}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {bdSub === "ab" && (
              <div className="overflow-x-auto">
                <p className="text-xs text-gray-400 px-1 py-1">A/B experimental arms (ABT1 &amp; ABT2 only). % Completed = completed ÷ started.</p>
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50"><tr>
                    <th className={th + " text-left"}>Arm</th><th className={th + " text-right"}>FLWs Started</th>
                    <th className={th + " text-right"}>Interviews Started</th><th className={th + " text-right"}>Interviews Completed</th>
                    <th className={th + " text-right"}>% Completed</th><th className={th + " text-right"}>Avg words / FLW msg</th>
                  </tr></thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {DATA.table3.map(function (r) {
                      var ov = r.key === "Overall";
                      return (
                        <tr key={r.key} className={ov ? "bg-gray-50" : "hover:bg-gray-50"}>
                          <td className={td + (ov ? " font-bold" : " font-medium")}>{r.key}</td>
                          <td className={td + " text-right"}>{r.flws}</td><td className={td + " text-right"}>{r.ist}</td>
                          <td className={td + " text-right text-green-700 font-medium"}>{r.icmp}</td>
                          <td className={td + " text-right text-gray-500"}>{pctTxt(r.pct)}</td>
                          <td className={td + " text-right text-gray-500"}>{r.avg_words == null ? "—" : r.avg_words}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
