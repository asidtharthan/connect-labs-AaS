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
  var dimp = React.useState(false);
  var deImpact = dimp[0], setDeImpact = dimp[1];   // item 8: raw vs de-impacted (penult/last artifact)
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
    "10": "Malaria 2", "11": "Water & Diarrhea 2", "12": "Community & FLW Profile 2", "13": "Medicine Quality & Counterfeiting 2" };
  var SG_ORDER = ["TRS", "TRE", "ABT1-A", "ABT1-B", "ABT2-A", "ABT2-B", "PANEL", "ABT3-A", "ABT3-B"];
  // 6 states in the spec order (Notes doc): not-applicable -> completed
  var STATES = ["not-applicable", "not-available-yet", "available-not-started", "available-missed-overdue", "started-not-completed", "completed"];
  var STATES5 = ["not-available-yet", "available-not-started", "available-missed-overdue", "started-not-completed", "completed"];
  var STATE_LABEL = { "not-applicable": "Not applicable", "not-available-yet": "Not available yet",
    "available-not-started": "Available, not started", "available-missed-overdue": "Available, missed/overdue",
    "started-not-completed": "Started, not completed", "completed": "Completed" };
  var STATE_COLOR = { "not-applicable": "#e5e7eb", "not-available-yet": "#6366f1",
    "available-not-started": "#f59e0b", "available-missed-overdue": "#ef4444",
    "started-not-completed": "#84cc16", "completed": "#16a34a" };
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
  var SG_COLOR = { "TRS": "#6366f1", "TRE": "#0ea5e9", "ABT1-A": "#f59e0b", "ABT1-B": "#ef4444", "ABT2-A": "#10b981", "ABT2-B": "#8b5cf6", "PANEL": "#14b8a6", "ABT3-A": "#ec4899", "ABT3-B": "#f43f5e" };
  // FLW × Topic matrix cell glyphs, indexed by STATES order (0 not-applicable … 5 completed)
  var CELL_GLYPH = ["", "·", "○", "!", "◐", "✓"];
  var MATRIX_TOPIC_ORDER = ["A", "B", "C", "D", "E", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13"];

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
        return { label: s.sg + " (n=" + s.base + ")", data: pts, borderColor: col,
          backgroundColor: col, fill: false, tension: 0.2, spanGaps: false,
          // in-progress interviews (offered but still accumulating) → dotted segment
          segment: { borderDash: function (ctx) {
            return (st[ctx.p0DataIndex] === "in-progress" || st[ctx.p1DataIndex] === "in-progress") ? [6, 5] : undefined;
          } } }; }) },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { title: { display: true, text: "% FLWs who started each interview round (denominator = # FLWs initiated, constant per subgroup) — solid = settled, dotted = in-progress, line ends where interviews aren't offered yet" }, legend: { position: "bottom" } },
        scales: { y: { beginAtZero: true, max: 100, title: { display: true, text: "% Started" } }, x: { title: { display: true, text: "Interview #" } } } }
    });
    return function () { if (lineInst.current) { lineInst.current.destroy(); lineInst.current = null; } };
  }, [activeTab, deImpact]);

  // ---- stacked bar chart (Table View > Topic completion) ----
  React.useEffect(function () {
    if (activeTab !== "table" || tableSub !== "topiccomplete" || topicChart !== "stacked") return;
    if (!barRef.current || !window.Chart) return;
    if (barInst.current) barInst.current.destroy();
    var isCount = tcMode === "count";
    barInst.current = new window.Chart(barRef.current.getContext("2d"), {
      type: "bar",
      data: { labels: DATA.topicStatus.map(function (t) { return t.code + " · " + (TOPIC_NAMES[t.code] || t.code); }),
        datasets: STATES.map(function (st) {
          return { label: STATE_LABEL[st],
            data: DATA.topicStatus.map(function (t) { return isCount ? (t[st] || 0) : (t.total ? Math.round(1000 * t[st] / t.total) / 10 : 0); }),
            backgroundColor: STATE_COLOR[st] }; }) },
      options: { responsive: true, maintainAspectRatio: false, indexAxis: "y",
        plugins: { title: { display: true, text: isCount ? "FLW status distribution by topic — # of claimed FLWs" : "FLW status distribution by topic — % of claimed FLWs (stacks to 100%)" }, legend: { position: "bottom" },
          tooltip: { callbacks: { label: function (ctx) { return ctx.dataset.label + ": " + ctx.parsed.x + (isCount ? "" : "%"); } } } },
        scales: { x: { stacked: true, max: isCount ? undefined : 100, title: { display: true, text: isCount ? "# of claimed FLWs" : "% of claimed FLWs" } }, y: { stacked: true } } }
    });
    return function () { if (barInst.current) { barInst.current.destroy(); barInst.current = null; } };
  }, [activeTab, tableSub, topicChart, tcMode]);

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

  // ---- Granular: ALL live OCS sessions (from the pipeline prop, not embedded) + client-side search/paging ----
  function liveRows(alias) { var p = props.pipelines; return (p && p[alias] && p[alias].rows) || []; }
  var ocsLive = liveRows("sessions");
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
  var anyFilter = !!(fSg || fCo || fSt || fTr || gq);
  function clearFilters() { setGSearch(""); setFSg(""); setFCo(""); setFSt(""); setFTr(""); setGPage(0); }
  // Sessions table: filter live OCS rows via the FLW lookup (cohort filter is by the FLW's cohort,
  // since a session isn't bound to one cohort) + status from the row itself.
  var sessFiltered = sessSource.filter(function (r) {
    if (gq && (r.connect_id + " " + r.session_id + " " + r.interview + " " + (r.completed ? "completed" : r.started ? "started" : "")).toLowerCase().indexOf(gq) < 0) return false;
    var fi = flwInfo[r.connect_id];
    if (fSg && (!fi || fi.g !== fSg)) return false;
    if (fCo && (!fi || !fi.cohorts[fCo])) return false;
    if (fTr && (!fi || (fTr === "untrained" ? !fi.u : fi.u))) return false;
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
    if (fStIdx >= 0 && r.s.indexOf(fStIdx) < 0) return false;
    return true;
  });
  var GPAGE = 100;
  var activeLen = gView === "matrix" ? matFiltered.length : sessFiltered.length;
  var gPages = Math.max(1, Math.ceil(activeLen / GPAGE));
  var gPageC = Math.min(gPage, gPages - 1);
  var sessPageRows = sessFiltered.slice(gPageC * GPAGE, gPageC * GPAGE + GPAGE);
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
          <span><b>{c.flws}</b> FLWs</span>
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
            {[["overview", "Overview"], ["table", "Table View"], ["funnels", "Interview Completion Funnels"], ["breakdowns", "Breakdowns"]].map(function (t) {
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
              {[["Cohorts", c.cohorts], ["FLWs", c.flws], ["Interviews started", c.started],
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
                    <th className={th + " text-right"}>Started ≥1</th>
                    <th className={th + " text-right"}>Completed ≥1</th>
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
            <div className="flex gap-2">
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
                          {["connect_id", "interview", "status", "created", "session"].map(function (h) {
                            return <th key={h} className={th + " text-left"}>{h}</th>;
                          })}
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
                                  return <td key={t} className="px-2 py-1 text-center text-xs" title={(TOPIC_NAMES[t] || t) + " — " + STATE_LABEL[STATES[code]]}
                                    style={{ backgroundColor: rgbaOf(STATE_COLOR[STATES[code]], 0.85), color: "#fff" }}>{CELL_GLYPH[code]}</td>;
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
                <Legend title="Status definitions (in chart order)">
                  {STATES.map(function (s) {
                    return (
                      <div key={s} className="flex items-start gap-2">
                        <span style={{ display: "inline-block", width: 11, height: 11, background: STATE_COLOR[s], borderRadius: 2, marginTop: 3, flexShrink: 0 }}></span>
                        <span><b>{STATE_LABEL[s]}:</b> {STATE_DEF[s]}</span>
                      </div>
                    );
                  })}
                </Legend>
                <div className="flex flex-wrap items-center gap-2 px-1">
                  {subBtn(topicChart, "stacked", setTopicChart, "Stacked bar")}
                  {subBtn(topicChart, "scoreboard", setTopicChart, "Completion scoreboard")}
                  {subBtn(topicChart, "heatmap", setTopicChart, "Heatmap")}
                  <span className="mx-1 text-gray-300">|</span>
                  <span className="text-xs text-gray-400">Show:</span>
                  {subBtn(tcMode, "pct", setTcMode, "%")}
                  {subBtn(tcMode, "count", setTcMode, "Raw counts")}
                </div>
                {topicChart === "stacked" && (
                  <div style={{ height: "420px" }}><canvas ref={barRef}></canvas></div>
                )}
                {topicChart === "scoreboard" && (
                  <div className="px-1">
                    <p className="text-xs text-gray-400 mb-2">% completed of the FLWs each topic applies to (excludes the not-applicable group), sorted high → low.</p>
                    {DATA.topicStatus.slice().sort(function (a, b) {
                      var pa = a.applicable ? a.completed / a.applicable : -1;
                      var pb = b.applicable ? b.completed / b.applicable : -1;
                      return pb - pa;
                    }).map(function (t) {
                      var pct = t.applicable ? Math.round(1000 * t.completed / t.applicable) / 10 : null;
                      return (
                        <div key={t.code} className="flex items-center gap-2 py-1">
                          <div className="text-xs text-gray-600 truncate" style={{ width: "13rem", flexShrink: 0 }}>{t.code} · {TOPIC_NAMES[t.code] || t.code}</div>
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
                    <p className="text-xs text-gray-400 mb-2">Each cell = % of applicable FLWs in that stage (darker = higher). Rows = topics, columns = the 5 applicable stages.</p>
                    <table className="min-w-full border border-gray-200">
                      <thead className="bg-gray-50"><tr>
                        <th className={th + " text-left"}>Topic</th>
                        <th className={th + " text-right"}>Applies</th>
                        {STATES5.map(function (s) { return <th key={s} className={th + " text-right"}>{STATE_LABEL[s]}</th>; })}
                      </tr></thead>
                      <tbody>
                        {DATA.topicStatus.map(function (t) {
                          return (
                            <tr key={t.code}>
                              <td className={td + " font-medium text-gray-700"}>{t.code} · {TOPIC_NAMES[t.code] || t.code}</td>
                              <td className={td + " text-right text-gray-400"}>{t.applicable}</td>
                              {STATES5.map(function (s) {
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
                      {STATES.map(function (s) { return <th key={s} className={th + " text-right"}>{STATE_LABEL[s]}</th>; })}
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
                            {STATES.map(function (s) {
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
                                      {STATES5.map(function (s) { return <th key={s} className={th + " text-right"}>{STATE_LABEL[s]}</th>; })}
                                    </tr></thead>
                                    <tbody className="divide-y divide-gray-100">
                                      {cohRows.map(function (rc) {
                                        return (
                                          <tr key={rc.cohort} className="bg-white hover:bg-gray-50">
                                            <td className={td + " text-gray-700"}>{rc.cohort} <span className="text-gray-400">(n={rc.total})</span></td>
                                            <td className={td}>
                                              <div style={{ display: "flex", width: 120, height: 10, borderRadius: 2, overflow: "hidden", border: "1px solid #e5e7eb" }}>
                                                {STATES5.map(function (s) {
                                                  var w = rc.total ? (100 * rc[s] / rc.total) : 0;
                                                  return w > 0 ? <div key={s} title={STATE_LABEL[s] + ": " + (Math.round(10 * w) / 10) + "%"} style={{ width: w + "%", backgroundColor: STATE_COLOR[s] }}></div> : null;
                                                })}
                                              </div>
                                            </td>
                                            {STATES5.map(function (s) {
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
                <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  Removes FLWs who started only the LAST interview (skipped the penultimate — the two were triggered back-to-back) from the last interview's Started, revealing the true decline. Affects the line chart &amp; drop-off %Started below.
                </span>
              ) : null}
            </div>
            <div style={{ height: "380px" }}><canvas ref={lineRef}></canvas></div>

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

            <div className="overflow-x-auto">
              <h3 className="text-sm font-semibold text-gray-700 px-1 py-1">Full retention table — Connect funnel → every interview (one row per subgroup)</h3>
              <p className="text-xs text-gray-400 px-1">GW "Retention Drop-off" layout. Eligible = # Initiated (constant retention base). % Triggered / % Started = ÷ Eligible; % Compl = ÷ Started; <b>%init</b> = Completed ÷ Eligible (completion as a share of everyone who initiated).</p>
              <table className="min-w-full border border-gray-200 text-xs">
                <thead className="bg-gray-50">
                  <tr>
                    <th className={th + " text-left"} rowSpan={2}>Subgroup</th>
                    <th className={th + " text-right"} rowSpan={2}>Cohorts</th>
                    <th className={th + " text-right"} rowSpan={2}>Invited</th>
                    <th className={th + " text-right"} rowSpan={2}>Accepted</th>
                    <th className={th + " text-right"} rowSpan={2}>Started Learn</th>
                    <th className={th + " text-right"} rowSpan={2}>Compl. Learn</th>
                    <th className={th + " text-right"} rowSpan={2}>Claimed</th>
                    <th className={th + " text-right"} rowSpan={2}>FLW Reg</th>
                    <th className={th + " text-right border-r border-gray-300"} rowSpan={2}># Initiated</th>
                    {Array.apply(null, { length: maxIv }).map(function (_, i) {
                      return <th key={i} className={th + " text-center border-l border-gray-200"} colSpan={6}>Interview {i + 1}</th>;
                    })}
                  </tr>
                  <tr>
                    {Array.apply(null, { length: maxIv }).map(function (_, i) {
                      return [
                        <th key={i + "t"} className={th + " text-left border-l border-gray-200"}>Topic</th>,
                        <th key={i + "e"} className={th + " text-right"}>Elig</th>,
                        <th key={i + "tr"} className={th + " text-right"}>Trig/%</th>,
                        <th key={i + "s"} className={th + " text-right"}>Start/%</th>,
                        <th key={i + "c"} className={th + " text-right"}>Compl/%</th>,
                        <th key={i + "ci"} className={th + " text-right"}>%init</th>,
                      ];
                    })}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {DATA.dropoff.subgroups.map(function (s) {
                    var cn = s.connect, byN = {};
                    s.interviews.forEach(function (iv) { byN[iv.n] = iv; });
                    return (
                      <tr key={s.sg} className="hover:bg-gray-50">
                        <td className={td + " font-medium"}>{s.sg}</td>
                        <td className={td + " text-right text-gray-500"}>{s.cohorts_n}</td>
                        <td className={td + " text-right"}>{cn.invited}</td>
                        <td className={td + " text-right"}>{cn.accepted}</td>
                        <td className={td + " text-right"}>{cn.learn_started}</td>
                        <td className={td + " text-right"}>{cn.learn_completed}</td>
                        <td className={td + " text-right"}>{cn.claimed}</td>
                        <td className={td + " text-right"}>{cn.flw_reg}</td>
                        <td className={td + " text-right font-medium border-r border-gray-300"}>{cn.initiated}</td>
                        {Array.apply(null, { length: maxIv }).map(function (_, i) {
                          var iv = byN[i + 1];
                          if (!iv) return [
                            <td key={i + "t"} className={td + " text-gray-200 border-l border-gray-200"}>—</td>,
                            <td key={i + "e"} className={td}></td>, <td key={i + "tr"} className={td}></td>,
                            <td key={i + "s"} className={td}></td>, <td key={i + "c"} className={td}></td>,
                            <td key={i + "ci"} className={td}></td>,
                          ];
                          return [
                            <td key={i + "t"} className={td + " border-l border-gray-200"} title={iv.name}>{iv.topic}</td>,
                            <td key={i + "e"} className={td + " text-right text-gray-500"}>{iv.eligible}</td>,
                            <td key={i + "tr"} className={td + " text-right"}>{iv.triggered} <span className="text-gray-400">{iv.pct_trig}%</span></td>,
                            <td key={i + "s"} className={td + " text-right"}>{iv.started} <span className="text-gray-400">{iv.pct_started}%</span></td>,
                            <td key={i + "c"} className={td + " text-right text-green-700"}>{iv.completed} <span className="text-gray-400">{iv.pct_completed == null ? "—" : iv.pct_completed + "%"}</span></td>,
                            <td key={i + "ci"} className={td + " text-right text-gray-500"}>{iv.pct_completed_base == null ? "—" : iv.pct_completed_base + "%"}</td>,
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
            <Legend title="Metric definitions">
              <div><b>FLWs Started:</b> unique FLWs who started ≥1 interview in the group.</div>
              <div><b>Interviews Started / Completed:</b> count of started / completed interviews (an FLW can have several).</div>
              <div><b>% Completed:</b> Interviews Completed ÷ Interviews Started.</div>
              <div><b>Avg words / FLW msg:</b> total FLW-message words ÷ total FLW messages, over started sessions (whitespace word count).</div>
            </Legend>
            <div className="flex gap-2">
              {subBtn(bdSub, "subgroup", setBdSub, "By Subgroup")}
              {subBtn(bdSub, "topic", setBdSub, "By Topic")}
              {subBtn(bdSub, "ab", setBdSub, "A/B Arms")}
            </div>

            {bdSub === "subgroup" && (
              <div className="overflow-x-auto">
                <p className="text-xs text-gray-400 px-1 py-1">Unique FLWs &amp; interview counts per study arm. % Completed = completed ÷ started.</p>
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50"><tr>
                    <th className={th + " text-left"}>Subgroup</th><th className={th + " text-right"}>FLWs Started</th>
                    <th className={th + " text-right"}>Interviews Started</th><th className={th + " text-right"}>Completed</th>
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
                    <th className={th + " text-right"}>FLWs Started</th><th className={th + " text-right"}>Interviews Started</th>
                    <th className={th + " text-right"}>Completed</th><th className={th + " text-right"}>% Completed</th>
                    <th className={th + " text-right"}>Avg words / FLW msg</th>
                  </tr></thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {DATA.table2.map(function (r) {
                      return (
                        <tr key={r.code} className="hover:bg-gray-50">
                          <td className={td + " font-medium"}>{r.code}</td><td className={td}>{r.name}</td>
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

            {bdSub === "ab" && (
              <div className="overflow-x-auto">
                <p className="text-xs text-gray-400 px-1 py-1">A/B experimental arms (ABT1 &amp; ABT2 only). % Completed = completed ÷ started.</p>
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50"><tr>
                    <th className={th + " text-left"}>Arm</th><th className={th + " text-right"}>FLWs Started</th>
                    <th className={th + " text-right"}>Interviews Started</th><th className={th + " text-right"}>Completed</th>
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
