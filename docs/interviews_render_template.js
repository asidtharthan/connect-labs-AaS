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
  var lineRef = React.useRef(null), lineInst = React.useRef(null);
  var barRef = React.useRef(null), barInst = React.useRef(null);

  var SUBGROUP_DESIGN = {
    "TRS": ["A", "B"], "TRE": ["A", "B", "C", "D", "E"],
    "ABT1-A": ["1", "2", "3", "4"], "ABT1-B": ["1", "2", "3", "4"],
    "ABT2-A": ["1", "2"], "ABT2-B": ["1", "2", "5", "6", "7", "8", "9", "3"]
  };
  var TOPIC_NAMES = { A: "Community Demographics", B: "Malaria", C: "Nutrition Prevalance and Programs",
    D: "Water & Diarrhea", E: "Community & FLW Profile", "1": "Seasonal Malaria Chemoprevention",
    "2": "Seasonal Malaria Chemoprevention 2", "3": "Bed Net Usage", "4": "Health Worker Experience",
    "5": "Family Planning", "6": "Vitamin A Supplementation", "7": "Vaccines",
    "8": "Antibiotics and ACT Use", "9": "Medicine Quality & Counterfeiting" };
  var SG_ORDER = ["TRS", "TRE", "ABT1-A", "ABT1-B", "ABT2-A", "ABT2-B"];
  var STATES = ["completed", "started-not-completed", "available-missed-overdue", "available-not-started", "not-available-yet"];
  var STATE_LABEL = { "completed": "Completed", "started-not-completed": "Started, not completed",
    "available-missed-overdue": "Overdue / missed", "available-not-started": "Available, not started",
    "not-available-yet": "Not available yet" };
  var STATE_COLOR = { "completed": "#16a34a", "started-not-completed": "#84cc16",
    "available-missed-overdue": "#ef4444", "available-not-started": "#f59e0b", "not-available-yet": "#cbd5e1" };
  var SG_COLOR = { "TRS": "#6366f1", "TRE": "#0ea5e9", "ABT1-A": "#f59e0b", "ABT1-B": "#ef4444", "ABT2-A": "#10b981", "ABT2-B": "#8b5cf6" };

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
        return { label: s.sg + " (n=" + s.base + ")", data: s.pts, borderColor: SG_COLOR[s.sg],
          backgroundColor: SG_COLOR[s.sg], fill: false, tension: 0.2, spanGaps: true }; }) },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { title: { display: true, text: "% FLWs who started each interview round (denominator = # FLWs initiated, constant per subgroup)" }, legend: { position: "bottom" } },
        scales: { y: { beginAtZero: true, max: 100, title: { display: true, text: "% Started" } }, x: { title: { display: true, text: "Interview #" } } } }
    });
    return function () { if (lineInst.current) { lineInst.current.destroy(); lineInst.current = null; } };
  }, [activeTab]);

  // ---- stacked bar chart (Table View > Topic completion) ----
  React.useEffect(function () {
    if (activeTab !== "table" || tableSub !== "topiccomplete") return;
    if (!barRef.current || !window.Chart) return;
    if (barInst.current) barInst.current.destroy();
    barInst.current = new window.Chart(barRef.current.getContext("2d"), {
      type: "bar",
      data: { labels: DATA.topicStatus.map(function (t) { return t.code + " · " + (TOPIC_NAMES[t.code] || t.code); }),
        datasets: STATES.map(function (st) {
          return { label: STATE_LABEL[st], data: DATA.topicStatus.map(function (t) { return t[st]; }), backgroundColor: STATE_COLOR[st] }; }) },
      options: { responsive: true, maintainAspectRatio: false, indexAxis: "y",
        plugins: { title: { display: true, text: "FLW status distribution by topic (claimed FLWs, time-gated)" }, legend: { position: "bottom" } },
        scales: { x: { stacked: true, title: { display: true, text: "FLWs" } }, y: { stacked: true } } }
    });
    return function () { if (barInst.current) { barInst.current.destroy(); barInst.current = null; } };
  }, [activeTab, tableSub]);

  function subBtn(cur, val, set, label) {
    var on = cur === val;
    return (
      <button onClick={function () { set(val); }}
        className={"px-3 py-1.5 text-sm rounded-md font-medium " + (on ? "bg-indigo-100 text-indigo-700" : "text-gray-500 hover:bg-gray-100")}>
        {label}
      </button>
    );
  }

  var c = DATA.counts;
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow-sm p-5">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Connect Interviews — Master Dataset</h1>
            <p className="text-gray-600 mt-1">One row per FLW × interview, interlocking Connect · CCHQ Trigger · CCHQ Welcome · OCS session. All {c.cohorts} cohorts.</p>
            <p className="text-xs text-gray-400 mt-1">Validated snapshot (audit_e2e 26/26 + dashboard audit 18/18){DATA.today ? " · data as of " + DATA.today : ""}.</p>
          </div>
          <button onClick={function () { window.location.reload(); }} title="Reload the dashboard"
            className="shrink-0 inline-flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700">
            ↻ Reload
          </button>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 mt-3 text-sm">
          <span><b>{c.cohorts}</b> cohorts</span>
          <span><b>{c.master_rows}</b> master rows</span>
          <span><b>{c.flws}</b> FLWs</span>
          <span><b>{c.started}</b> interviews started</span>
          <span><b>{c.completed}</b> completed</span>
        </div>
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
          </div>
        )}

        {activeTab === "table" && (
          <div className="p-3 space-y-3">
            <div className="flex gap-2">
              {subBtn(tableSub, "granular", setTableSub, "Granular view")}
              {subBtn(tableSub, "topiccomplete", setTableSub, "Topic completion view")}
            </div>

            {tableSub === "granular" && (
              <div className="overflow-x-auto" style={{ maxHeight: "70vh" }}>
                <p className="text-xs text-gray-400 px-1 py-1">Showing {DATA.granular.length} of {DATA.granular_total} master rows (validated sample, sorted by cohort).</p>
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50 sticky top-0"><tr>
                    {["connect_id", "cohort", "sg", "int", "topic", "trig", "init", "started", "completed", "session"].map(function (h) {
                      return <th key={h} className={th + " text-left"}>{h}</th>;
                    })}
                  </tr></thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {DATA.granular.map(function (r, idx) {
                      function yn(v) { return <span className={v ? "text-green-600 font-bold" : "text-gray-300"}>{v ? "Y" : "N"}</span>; }
                      return (
                        <tr key={idx} className="hover:bg-gray-50">
                          <td className={td + " font-mono text-xs"}>{r.connect_id}</td>
                          <td className={td}>{r.cohort_id}</td><td className={td}>{r.subgroup}</td>
                          <td className={td}>{r.interview_n}</td><td className={td}>{r.topic_code}</td>
                          <td className={td + " text-center"}>{yn(r.is_triggered)}</td>
                          <td className={td + " text-center"}>{yn(r.is_initiated)}</td>
                          <td className={td + " text-center"}>{yn(r.is_started)}</td>
                          <td className={td + " text-center"}>{yn(r.is_completed)}</td>
                          <td className={td + " font-mono text-xs"}>{r.session_id ? <a href={"https://www.openchatstudio.com/a/Vaccine_Coach/chatbots/e/cc01d032-5931-4bdd-a4b2-6f05f4f72f88/s/" + r.session_id + "/view/"} target="_blank" rel="noopener noreferrer" title={r.session_id} className="text-indigo-600 hover:underline">{String(r.session_id).slice(0, 8)}↗</a> : ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {tableSub === "topiccomplete" && (
              <div className="space-y-4">
                <p className="text-xs text-gray-400 px-1">FLW status per topic across claimed FLWs. Time-gating uses cohort training date + subgroup cadence.</p>
                <div style={{ height: "420px" }}><canvas ref={barRef}></canvas></div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50"><tr>
                      <th className={th + " text-left"}>Topic</th>
                      <th className={th + " text-right"}>Applicable</th>
                      {STATES.map(function (s) { return <th key={s} className={th + " text-right"}>{STATE_LABEL[s]}</th>; })}
                      <th className={th + " text-right"}>% Completed</th>
                    </tr></thead>
                    <tbody className="bg-white divide-y divide-gray-100">
                      {DATA.topicStatus.map(function (t) {
                        return (
                          <tr key={t.code} className="hover:bg-gray-50">
                            <td className={td + " font-medium"}>{t.code} · {TOPIC_NAMES[t.code] || t.code}</td>
                            <td className={td + " text-right"}>{t.applicable}</td>
                            {STATES.map(function (s) { return <td key={s} className={td + " text-right"}>{t[s]}</td>; })}
                            <td className={td + " text-right text-gray-500"}>{t.applicable ? Math.round(100 * t.completed / t.applicable) + "%" : "—"}</td>
                          </tr>
                        );
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
            <div style={{ height: "380px" }}><canvas ref={lineRef}></canvas></div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50"><tr>
                  <th className={th + " text-left"}>Subgroup</th><th className={th + " text-left"}>Int</th>
                  <th className={th + " text-left"}>Topic</th><th className={th + " text-right"}>Eligible</th>
                  <th className={th + " text-right"}>Triggered</th><th className={th + " text-right"}>Started</th>
                  <th className={th + " text-right"}>Completed</th><th className={th + " text-right"}>% Started</th>
                  <th className={th + " text-right"}>% Completed</th>
                </tr></thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {DATA.funnel.map(function (f) {
                    return (
                      <tr key={f.sg + f.n} className="hover:bg-gray-50">
                        <td className={td + " font-medium"}>{f.sg}</td><td className={td}>{f.n}</td>
                        <td className={td}>{f.name}</td>
                        <td className={td + " text-right"}>{f.elig}</td>
                        <td className={td + " text-right"}>{f.trig}</td>
                        <td className={td + " text-right"}>{f.started}</td>
                        <td className={td + " text-right text-green-700 font-medium"}>{f.completed}</td>
                        <td className={td + " text-right text-gray-500"}>{f.pct_started == null ? "—" : f.pct_started + "%"}</td>
                        <td className={td + " text-right text-gray-500"}>{f.pct_completed == null ? "—" : f.pct_completed + "%"}</td>
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
                    <th className={th + " text-right"}>% Completed</th>
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
                  </tr></thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {DATA.table2.map(function (r) {
                      return (
                        <tr key={r.code} className="hover:bg-gray-50">
                          <td className={td + " font-medium"}>{r.code}</td><td className={td}>{r.name}</td>
                          <td className={td + " text-right"}>{r.flws}</td><td className={td + " text-right"}>{r.ist}</td>
                          <td className={td + " text-right text-green-700 font-medium"}>{r.icmp}</td>
                          <td className={td + " text-right text-gray-500"}>{pctTxt(r.pct)}</td>
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
                    <th className={th + " text-right"}>% Completed</th>
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
