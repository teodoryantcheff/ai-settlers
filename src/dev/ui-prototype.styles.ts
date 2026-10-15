/** Throwaway UI study styles, bundled only by src/dev/main.ts. */
export const prototypeStyles = `
body.ui-study { margin:0; overflow:hidden; background:#f5f6f3; color:#24332f; user-select:text; }
body.ui-study > :not(#ui-study):not(#study-map):not(style):not(script) { display:none!important; }
#ui-study { --bg:#f5f6f3; --surface:#fff; --soft:#f1f4f0; --line:#dfe5df; --text:#24332f; --muted:#728078; --accent:#2c6958; --tint:#e6efea; --amber:#a66a25; --amber-bg:#fbf2e3; --red:#a65343; --shadow:0 12px 60px #172c2222; position:fixed; inset:0; z-index:101; font:13px/1.5 'Inter','Segoe UI',Arial,sans-serif; color:var(--text); font-variant-numeric:tabular-nums; letter-spacing:0; }
#ui-study *, #ui-study *:before, #ui-study *:after { box-sizing:border-box; }
#ui-study button,#ui-study input,#ui-study select,#ui-study textarea { font:inherit; letter-spacing:inherit; }
#ui-study button { appearance:none; border:1px solid var(--line); border-radius:5px; color:var(--text); background:var(--surface); padding:7px 11px; cursor:pointer; font-weight:500; display:inline-flex; align-items:center; justify-content:center; gap:7px; white-space:nowrap; box-shadow:none; text-shadow:none; }
#ui-study button:hover { border-color:var(--accent); background:var(--soft); }
#ui-study button:focus-visible, #ui-study input:focus-visible,#ui-study select:focus-visible,#ui-study summary:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
#ui-study button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
#ui-study button.primary:hover { filter:brightness(1.08); }
#ui-study button.quiet { border-color:transparent; background:transparent; color:var(--muted); }
#ui-study button.text-link { padding:0; border:0; color:var(--accent); background:transparent; }
#ui-study button.active { background:var(--tint); border-color:var(--tint); color:var(--accent); }
#ui-study button:disabled { opacity:.45; cursor:default; }
#ui-study input,#ui-study select,#ui-study textarea { color:var(--text); background:var(--surface); border:1px solid var(--line); border-radius:4px; padding:9px 11px; min-width:0; }
#ui-study input[type=checkbox] { accent-color:var(--accent); }
#ui-study .ico { width:17px; height:17px; flex:none; stroke:currentColor; stroke-width:1.6; fill:none; stroke-linecap:round; stroke-linejoin:round; }
#ui-study h1,#ui-study h2,#ui-study h3,#ui-study h4,#ui-study p { margin:0; font-family:inherit; letter-spacing:normal; color:inherit; text-shadow:none; }
#ui-study h1 { font-size:28px; line-height:1.2; font-weight:550; letter-spacing:-.9px; }
#ui-study h2 { font-size:19px; line-height:1.3; font-weight:550; letter-spacing:-.4px; }
#ui-study h3 { font-size:14px; font-weight:600; line-height:1.4; }
#ui-study h4 { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:1.3px; color:var(--muted); }
#ui-study small,#ui-study .muted { color:var(--muted); }
#ui-study small { font-size:11px; }
#ui-study .num { font-variant-numeric:tabular-nums; }
#ui-study .mono { font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace; }
#ui-study .up { color:var(--accent); }
#ui-study .down { color:var(--red); }
#ui-study .warning { color:var(--amber); }
#ui-study .eyebrow { font-size:10px; text-transform:uppercase; letter-spacing:1.7px; color:var(--muted); font-weight:600; }
#ui-study .label { font-size:11px; color:var(--muted); }
#ui-study .dot { width:6px; height:6px; display:inline-block; border-radius:50%; background:var(--accent); margin-right:6px; vertical-align:middle; }
#ui-study .dot.amber { background:var(--amber); }
#ui-study .badge { display:inline-flex; gap:5px; align-items:center; padding:3px 7px; border-radius:4px; background:var(--soft); font-size:10px; font-weight:550; color:var(--muted); white-space:nowrap; }
#ui-study .badge.warn { background:var(--amber-bg); color:var(--amber); }
#ui-study .badge.good { background:var(--tint); color:var(--accent); }
#ui-study .row { display:flex; gap:12px; align-items:center; }
#ui-study .between { display:flex; justify-content:space-between; gap:12px; align-items:center; }
#ui-study .grow { flex:1; }
#ui-study .divider { height:1px; background:var(--line); margin:20px 0; }
#ui-study .brand { font-size:15px; font-weight:650; letter-spacing:-.4px; display:flex; gap:9px; align-items:center; }
#ui-study .brandmark { height:27px; width:27px; display:grid; place-items:center; background:var(--accent); color:#fff; border-radius:5px; }
#ui-study .brandmark svg { width:19px; height:19px; }
#ui-study .study-header { height:62px; border-bottom:1px solid var(--line); background:var(--surface); display:flex; padding:0 24px; align-items:center; gap:27px; }
#ui-study .study-header .session-name { border-left:1px solid var(--line); padding-left:25px; display:flex; gap:10px; align-items:center; }
#ui-study .study-header .seed { font-size:10px; color:var(--muted); }
#ui-study .time-controls { display:flex; align-items:center; gap:5px; }
#ui-study .time-controls button { padding:5px 8px; font-size:11px; }
#ui-study .clock { padding-right:14px; margin-right:7px; border-right:1px solid var(--line); }
#ui-study .clock b { font-size:13px; font-weight:550; }
#ui-study .shell { position:absolute; inset:62px 0 38px; display:grid; grid-template-columns:188px 1fr; }
#ui-study .sidebar { display:flex; flex-direction:column; padding:23px 12px 20px; background:var(--surface); border-right:1px solid var(--line); min-height:0; }
#ui-study .nav-label { padding:0 14px; margin-bottom:11px; }
#ui-study .sidebar button { justify-content:flex-start; width:100%; padding:10px 12px; border:0; margin:2px 0; font-size:12px; background:transparent; color:var(--muted); }
#ui-study .sidebar button.active { background:var(--tint); color:var(--accent); }
#ui-study .sidebar button .nav-count { margin-left:auto; font-size:10px; padding:0 5px; border-radius:3px; background:var(--amber-bg); color:var(--amber); }
#ui-study .sidebar .nav-bottom { margin-top:auto; padding-top:25px; }
#ui-study .sidebar .model-note { margin:18px 12px 0; padding-top:17px; border-top:1px solid var(--line); font-size:10px; color:var(--muted); line-height:1.8; }
#ui-study .main-content { min-width:0; min-height:0; display:flex; flex-direction:column; }
#ui-study .page-heading { height:90px; flex:none; padding:21px 27px; background:var(--bg); display:flex; align-items:center; justify-content:space-between; gap:12px; }
#ui-study .page-heading h1 { font-size:24px; margin-bottom:3px; }
#ui-study .page-heading p { color:var(--muted); font-size:11px; }
#ui-study .view-tools { display:flex; align-items:center; gap:9px; }
#ui-study .segmented { display:inline-flex; border:1px solid var(--line); border-radius:5px; background:var(--surface); padding:2px; }
#ui-study .segmented button { font-size:10px; padding:4px 8px; border:0; background:transparent; }
#ui-study .segmented button.active { background:var(--tint); }
#ui-study .kpi-strip { display:grid; grid-template-columns:repeat(4,1fr); background:var(--surface); border-top:1px solid var(--line); border-bottom:1px solid var(--line); flex:none; }
#ui-study .kpi { padding:15px 25px; border-right:1px solid var(--line); }
#ui-study .kpi:last-child { border:0; }
#ui-study .kpi .value { font-size:25px; font-weight:500; letter-spacing:-1px; line-height:1.2; margin:7px 0 4px; }
#ui-study .kpi .value span { font-size:12px; color:var(--muted); letter-spacing:0; margin-left:4px; }
#ui-study .kpi p { font-size:10px; color:var(--muted); }
#ui-study .workspace-grid { flex:1; min-height:0; display:grid; grid-template-columns:minmax(350px,1fr) 322px; grid-template-rows:minmax(250px,1fr) 190px; gap:1px; background:transparent; }
#ui-study .map-cell { min-height:0; position:relative; background:transparent; overflow:hidden; }
#ui-study .map-slot { position:absolute; inset:0; overflow:hidden; }
#study-map { position:fixed; z-index:100; border:0; background:#7f9461; visibility:hidden; pointer-events:none; }
#ui-study .map-top { position:absolute; z-index:2; top:15px; left:17px; right:17px; display:flex; justify-content:space-between; align-items:center; pointer-events:none; }
#ui-study .map-top > * { pointer-events:auto; }
#ui-study .map-caption { background:#fffffff0; border:1px solid #ffffff80; border-radius:5px; box-shadow:0 2px 10px #233d2320; padding:7px 10px; color:#324439; font-size:10px; }
#ui-study .map-caption b { font-weight:600; margin-right:7px; }
#ui-study .map-actions { display:flex; gap:4px; padding:3px; border-radius:6px; background:#fffffff0; }
#ui-study .map-actions button { color:#385546; border-color:transparent; background:transparent; padding:5px; }
#ui-study .map-bottom { position:absolute; bottom:17px; left:17px; right:17px; display:flex; justify-content:space-between; align-items:flex-end; pointer-events:none; }
#ui-study .map-bottom > * { pointer-events:auto; }
#ui-study .map-scale { border-bottom:2px solid #fff; border-left:2px solid #fff; border-right:2px solid #fff; width:90px; padding-bottom:4px; text-align:center; color:#fff; font-size:10px; text-shadow:0 1px 5px #000; }
#ui-study .map-pin { position:absolute; transform:translate(-50%,-100%); border-radius:4px; background:#fff; border:1px solid #cfa766; box-shadow:0 3px 14px #192b2738; color:#493c28; font-size:10px; padding:5px 9px; z-index:3; }
#ui-study .map-pin:after { content:''; position:absolute; width:7px; height:7px; background:#fff; border-bottom:1px solid #cfa766; border-right:1px solid #cfa766; bottom:-4px; left:50%; transform:rotate(45deg); }
#ui-study .map-notice[hidden] { display:none; }
#ui-study .map-notice { position:absolute; inset:0; display:grid; place-items:center; color:#4f5d49; background:#dce4d4; font-size:12px; }
#ui-study .inspector { grid-column:2; grid-row:1/3; background:var(--surface); padding:22px; min-height:0; overflow:auto; }
#ui-study .inspector .object-type { font-size:10px; color:var(--muted); text-transform:uppercase; letter-spacing:1px; }
#ui-study .inspector h2 { margin:7px 0 10px; }
#ui-study .inspector .intro { margin:11px 0 18px; font-size:11px; color:var(--muted); line-height:1.7; }
#ui-study .inspector .metric-pair { display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:16px 0; border-top:1px solid var(--line); border-bottom:1px solid var(--line); }
#ui-study .metric-pair strong { display:block; font-size:24px; font-weight:500; letter-spacing:-.5px; }
#ui-study .metric-pair strong small { font-size:11px; font-weight:400; }
#ui-study .metric-pair .label { font-size:10px; }
#ui-study .meter { background:var(--soft); height:5px; border-radius:3px; overflow:hidden; margin:7px 0; }
#ui-study .meter i { display:block; height:100%; background:var(--accent); }
#ui-study .diagnosis { padding:13px; background:var(--amber-bg); border-left:2px solid #d0a15f; margin:17px 0; }
#ui-study .diagnosis strong { font-size:11px; font-weight:600; color:var(--amber); }
#ui-study .diagnosis p { font-size:11px; margin:6px 0 10px; line-height:1.7; color:var(--text); }
#ui-study .definition-list { margin:15px 0; }
#ui-study .definition-list > div { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:6px 0; font-size:11px; }
#ui-study .definition-list span { color:var(--muted); }
#ui-study .definition-list b { font-weight:550; }
#ui-study .chain-mini { display:flex; gap:6px; align-items:center; margin:12px 0; }
#ui-study .chain-mini button { font-size:10px; padding:6px; flex:1; }
#ui-study .chain-mini > span { color:var(--muted); }
#ui-study .inspector .action-stack { display:flex; gap:7px; margin-top:20px; }
#ui-study .inspector .action-stack button { flex:1; font-size:11px; }
#ui-study .bottom-economy { background:var(--surface); padding:16px 22px; overflow:auto; }
#ui-study .mini-resource-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:18px; margin-top:15px; }
#ui-study .mini-resource { cursor:pointer; }
#ui-study .mini-resource .resource-name { display:flex; gap:6px; align-items:center; font-size:11px; }
#ui-study .resource-icon { width:20px; height:20px; vertical-align:middle; flex:none; }
#ui-study .mini-resource .big { font-size:21px; margin:3px 0; font-weight:500; }
#ui-study .spark { width:100%; height:28px; overflow:visible; }
#ui-study .spark path { fill:none; stroke:var(--accent); stroke-width:1.5; vector-effect:non-scaling-stroke; }
#ui-study .spark.negative path { stroke:var(--red); }
#ui-study .status-footer { position:absolute; height:38px; bottom:0; left:0; right:0; background:var(--surface); border-top:1px solid var(--line); display:flex; align-items:center; justify-content:space-between; gap:12px; padding:0 23px; font-size:10px; color:var(--muted); }
#ui-study .content-scroll { background:var(--bg); padding:25px 28px 90px; overflow:auto; min-height:0; flex:1; }
#ui-study .table-panel { border:1px solid var(--line); background:var(--surface); border-radius:6px; overflow:hidden; }
#ui-study .table-tools { display:flex; padding:14px 17px; border-bottom:1px solid var(--line); gap:12px; align-items:center; }
#ui-study .table-tools input { padding:6px 9px; width:210px; font-size:11px; }
#ui-study table { width:100%; border-collapse:collapse; font-size:12px; }
#ui-study th { font-size:10px; font-weight:500; color:var(--muted); text-align:right; padding:11px 15px; border-bottom:1px solid var(--line); background:var(--soft); white-space:nowrap; }
#ui-study td { text-align:right; padding:12px 15px; border-bottom:1px solid var(--line); white-space:nowrap; }
#ui-study tr:last-child td { border-bottom:0; }
#ui-study th:first-child,#ui-study td:first-child { text-align:left; }
#ui-study td:first-child { font-weight:500; }
#ui-study td .resource-icon { margin-right:8px; }
#ui-study tbody tr { cursor:pointer; }
#ui-study tbody tr:hover,#ui-study tbody tr.selected { background:var(--tint); }
#ui-study th button { padding:0; border:0; color:inherit; background:transparent; font-size:inherit; }
#ui-study td .spark { width:75px; height:22px; }
#ui-study .table-note { padding:12px 16px; color:var(--muted); font-size:10px; background:var(--surface); border-top:1px solid var(--line); }
#ui-study .analytics-grid { display:grid; grid-template-columns:1.5fr 1fr; gap:20px; margin-bottom:22px; }
#ui-study .chart-panel { background:var(--surface); border:1px solid var(--line); padding:20px; border-radius:5px; }
#ui-study .chart { width:100%; height:160px; display:block; overflow:visible; margin-top:17px; }
#ui-study .chart text { fill:var(--muted); font-size:10px; font-family:inherit; }
#ui-study .chart .gridline { stroke:var(--line); stroke-dasharray:3 3; }
#ui-study .chart .trend { fill:none; stroke:var(--accent); stroke-width:2.3; }
#ui-study .chart .second { stroke:var(--amber); }
#ui-study .legend { display:flex; gap:17px; font-size:10px; color:var(--muted); margin-top:9px; }
#ui-study .legend i { display:inline-block; width:13px; height:2px; background:var(--accent); margin-right:5px; vertical-align:middle; }
#ui-study .legend i.amber { background:var(--amber); }
#ui-study .event-list { margin-top:16px; }
#ui-study .event { display:grid; grid-template-columns:44px 1fr; gap:10px; padding:10px 0; border-top:1px solid var(--line); font-size:11px; }
#ui-study .event time { color:var(--muted); font-size:10px; }
#ui-study .event p { margin:3px 0 0; font-size:10px; color:var(--muted); }
#ui-study .network { display:grid; grid-template-columns:1fr 35px 1fr 35px 1fr 35px 1fr; align-items:center; margin:27px 0; }
#ui-study .network-node { border:1px solid var(--line); background:var(--surface); border-radius:5px; padding:17px 13px; text-align:center; }
#ui-study .network-node.warn { border-color:#d4ad75; background:var(--amber-bg); }
#ui-study .network-node strong { display:block; margin:7px 0; }
#ui-study .network-arrow { color:var(--muted); text-align:center; }
#ui-study .logistics-bottom { display:grid; grid-template-columns:1fr 1fr; gap:20px; }
#ui-study .pane { border:1px solid var(--line); border-radius:5px; padding:21px; background:var(--surface); }
#ui-study .doc-layout { display:grid; grid-template-columns:190px minmax(0,700px); gap:50px; max-width:1050px; margin:15px auto; }
#ui-study .doc-toc { display:flex; flex-direction:column; gap:6px; }
#ui-study .doc-toc button { justify-content:flex-start; border:0; font-size:12px; background:transparent; }
#ui-study .prose { font-size:13px; line-height:1.85; }
#ui-study .prose p { margin:15px 0; color:var(--muted); }
#ui-study .prose h2 { margin-top:25px; }
#ui-study .prose h3 { margin-top:22px; }
#ui-study .prose .lead { color:var(--text); font-size:18px; line-height:1.65; margin:20px 0; }
#ui-study .prose ul { color:var(--muted); padding-left:18px; }
#ui-study .prose .note { padding:15px 18px; border-left:2px solid var(--accent); background:var(--tint); color:var(--text); }
#ui-study .about-layout { max-width:920px; margin:15px auto; display:grid; grid-template-columns:1fr 230px; gap:70px; }
#ui-study .about-aside { padding-top:28px; font-size:11px; }
#ui-study .about-aside h4 { margin:22px 0 8px; }
#ui-study .about-aside p { color:var(--muted); }
#ui-study .welcome { height:100%; background:transparent; display:grid; grid-template-columns:1fr 1fr; }
#ui-study .welcome-copy { padding:8vh 5vw 80px; overflow:auto; }
#ui-study .welcome h1 { font-size:47px; font-weight:450; letter-spacing:-2px; line-height:1.1; margin:21px 0; }
#ui-study .welcome .lead { color:var(--muted); font-size:15px; line-height:1.8; max-width:440px; }
#ui-study .welcome-session { background:var(--surface); border:1px solid var(--line); padding:22px; border-radius:7px; max-width:450px; margin:33px 0 17px; }
#ui-study .welcome-session .resume-stats { display:flex; gap:30px; margin:20px 0; }
#ui-study .resume-stats b { display:block; font-size:19px; font-weight:500; }
#ui-study .resume-stats small { display:block; margin-top:3px; }
#ui-study .welcome .welcome-visual { position:relative; min-height:400px; }
#ui-study .welcome .visual-note { position:absolute; z-index:5; left:30px; right:30px; bottom:35px; padding:21px; background:#ffffffee; color:#24332f; border-radius:6px; }
#ui-study .welcome .visual-note p { font-size:12px; margin-top:6px; color:#65776b; }
#ui-study .welcome-links { display:flex; gap:23px; margin-top:40px; }
#ui-study .dialog-scrim { position:fixed; inset:0; background:#17282366; z-index:200; display:flex; align-items:center; justify-content:center; backdrop-filter:blur(3px); padding:35px 20px 100px; }
#ui-study .study-dialog { width:680px; max-height:100%; overflow:auto; border-radius:9px; background:var(--surface); box-shadow:var(--shadow); border:1px solid var(--line); }
#ui-study .dialog-header { padding:23px 26px; display:flex; justify-content:space-between; border-bottom:1px solid var(--line); align-items:center; }
#ui-study .dialog-body { padding:24px 27px; }
#ui-study .dialog-footer { padding:15px 26px; display:flex; justify-content:flex-end; gap:9px; background:var(--soft); border-top:1px solid var(--line); }
#ui-study .setting-row { display:flex; justify-content:space-between; align-items:center; gap:25px; padding:17px 0; border-bottom:1px solid var(--line); }
#ui-study .setting-row:last-child { border:0; }
#ui-study .setting-row small { display:block; margin-top:4px; }
#ui-study .setting-row select { min-width:150px; font-size:12px; }
#ui-study .setting-row input[type=range] { width:150px; accent-color:var(--accent); padding:0; }
#ui-study .save-card { padding:17px; border:1px solid var(--line); border-radius:5px; margin-bottom:11px; }
#ui-study .save-card p { font-size:11px; color:var(--muted); margin-top:4px; }
#ui-study .build-grid { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-top:18px; }
#ui-study .build-card { display:flex; flex-direction:column; align-items:flex-start; padding:15px!important; text-align:left; white-space:normal!important; gap:10px!important; min-height:140px; }
#ui-study .build-card small { font-size:10px; font-weight:400; }
#ui-study .build-card .capacity { color:var(--accent); font-size:11px; }
#ui-study .field { display:flex; flex-direction:column; gap:7px; margin:15px 0; font-size:12px; }
#ui-study .ledger-breakdown { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin:20px 0; }
#ui-study .ledger-breakdown > div { padding:13px; background:var(--soft); border-radius:4px; }
#ui-study .ledger-breakdown strong { font-size:25px; display:block; font-weight:500; margin:4px 0; }
#ui-study .notice-toast { position:fixed; z-index:250; right:25px; bottom:68px; padding:15px 20px; background:var(--surface); border:1px solid var(--line); border-left:3px solid var(--accent); border-radius:5px; box-shadow:var(--shadow); max-width:380px; font-size:12px; }
#ui-study .prototype-switcher { position:fixed; bottom:17px; left:50%; transform:translateX(-50%); z-index:300; display:flex; gap:8px; align-items:center; border-radius:13px; padding:8px 11px; background:#1d2829; color:#f1f5f4; box-shadow:0 7px 30px #0004; border:1px solid #40504d; }
#ui-study .prototype-switcher button { background:transparent; border:0; color:#d5dfdc; padding:6px 9px; border-radius:5px; }
#ui-study .prototype-switcher button:hover,#ui-study .prototype-switcher button.active { color:#fff; background:#3b4b47; }
#ui-study .prototype-switcher .switcher-label { width:153px; text-align:center; line-height:1.4; }
#ui-study .prototype-switcher small { display:block; color:#8ca19a; font-size:9px; letter-spacing:1.4px; text-transform:uppercase; }
#ui-study .prototype-switcher strong { font-size:11px; font-weight:500; }
#ui-study .prototype-switcher .v-choice { font-size:11px; padding:5px 9px; }
#ui-study .prototype-switcher .state-toggle { border-left:1px solid #44524d; margin-left:4px; border-radius:0; font-size:10px; }
#ui-study .prototype-state { position:fixed; z-index:301; bottom:86px; left:50%; transform:translateX(-50%); padding:18px; width:440px; max-height:50vh; overflow:auto; background:#1d2829; color:#dbe5e0; border:1px solid #44524d; border-radius:8px; font-size:11px; box-shadow:var(--shadow); }
#ui-study .prototype-state pre { white-space:pre-wrap; margin:10px 0 0; font:10px/1.7 monospace; }
/* B changes the hierarchy: perimeter controls, four simultaneous analytical panes. */
#ui-study[data-variant=B] { --bg:#151c20; --surface:#1b2429; --soft:#232e34; --line:#334046; --text:#dce5e7; --muted:#8a9ca4; --accent:#71c7b0; --tint:#263e3b; --amber:#dfb16e; --amber-bg:#3b3327; --red:#df9687; --shadow:0 15px 70px #0007; }
#ui-study[data-variant=B] button.primary { color:#142b25; }
#ui-study[data-variant=B] .study-header { height:54px; padding:0 19px; }
#ui-study[data-variant=B] .brand { font-family:Consolas,'Liberation Mono',monospace; font-size:14px; letter-spacing:.5px; }
#ui-study[data-variant=B] .brandmark { color:#162d26; }
#ui-study .console-shell { position:absolute; inset:54px 0 38px; display:flex; flex-direction:column; }
#ui-study .console-nav { display:flex; gap:22px; align-items:center; height:49px; padding:0 21px; border-bottom:1px solid var(--line); background:var(--surface); flex:none; }
#ui-study .console-nav button { border:0; background:none; color:var(--muted); height:49px; border-radius:0; font-size:11px; padding:0 3px; }
#ui-study .console-nav button.active { color:var(--accent); border-bottom:2px solid var(--accent); }
#ui-study .console-grid { flex:1; min-height:0; display:grid; grid-template-columns:270px minmax(350px,1fr) 330px; grid-template-rows:88px minmax(220px,1fr) 215px; background:transparent; gap:1px; }
#ui-study .console-grid .kpi-strip { grid-column:1/4; border:0; }
#ui-study .console-grid .kpi { padding:10px 20px; }
#ui-study .console-grid .kpi .value { font:23px/1.2 Consolas,'Liberation Mono',monospace; }
#ui-study .console-resources { grid-row:2/4; background:var(--surface); padding:19px 16px; overflow:auto; }
#ui-study .console-resources h4 { margin-bottom:14px; }
#ui-study .console-resource { display:flex; justify-content:space-between; align-items:center; width:100%; padding:9px 2px!important; border:0!important; border-bottom:1px solid var(--line)!important; border-radius:0!important; background:transparent!important; font-size:11px!important; }
#ui-study .console-resource span { display:flex; align-items:center; gap:6px; }
#ui-study .console-resource .resource-icon { width:16px; height:16px; }
#ui-study .console-resource small { font-family:Consolas,monospace; font-size:10px; width:47px; text-align:right; }
#ui-study .console-grid .map-cell { grid-column:2; grid-row:2; }
#ui-study .console-grid .inspector { grid-column:3; grid-row:2/4; border-left:1px solid var(--line); }
#ui-study .console-timeline { grid-column:2; grid-row:3; background:var(--surface); padding:17px 20px; overflow:auto; }
#ui-study[data-variant=B] .map-caption,#ui-study[data-variant=B] .map-actions { background:#1b2429ed; color:#dce5e7; border-color:#354a44; }
#ui-study[data-variant=B] .map-actions button { color:#a9cec1; }
/* C puts the economic ledger first; the map becomes a compact contextual panel. */
#ui-study[data-variant=C] { --bg:#f4f3ee; --surface:#fcfbf7; --soft:#eeeee7; --line:#dadbd0; --text:#333a30; --muted:#7a8072; --accent:#596e42; --tint:#e8eddf; --amber:#a37532; }
#ui-study[data-variant=C] .study-header { height:72px; border-top:4px solid var(--accent); padding:0 34px; }
#ui-study[data-variant=C] .brand { font-family:Georgia,serif; font-weight:500; font-size:23px; }
#ui-study[data-variant=C] .brandmark { display:none; }
#ui-study .ledger-shell { position:absolute; inset:72px 0 38px; display:flex; flex-direction:column; }
#ui-study .ledger-nav { background:var(--surface); border-bottom:1px solid var(--line); height:46px; flex:none; display:flex; padding:0 32px; align-items:center; gap:30px; }
#ui-study .ledger-nav button { border:0; background:none; border-radius:0; padding:0; height:46px; color:var(--muted); font-size:12px; }
#ui-study .ledger-nav button.active { border-bottom:2px solid var(--accent); color:var(--text); }
#ui-study .ledger-grid { flex:1; min-height:0; display:grid; grid-template-columns:minmax(580px,1fr) 350px; gap:25px; padding:23px 32px 80px; background:transparent; overflow:auto; }
#ui-study .ledger-main { min-width:0; }
#ui-study .ledger-title { display:flex; justify-content:space-between; align-items:flex-end; margin:0 0 23px; }
#ui-study .ledger-title h1 { font:33px/1.2 Georgia,serif; letter-spacing:-1px; margin:6px 0; }
#ui-study .ledger-title p { color:var(--muted); font-size:11px; }
#ui-study .ledger-stats { display:grid; grid-template-columns:repeat(3,1fr); padding:18px 0; margin-bottom:22px; border-top:1px solid var(--line); border-bottom:1px solid var(--line); }
#ui-study .ledger-stats .kpi { padding:0 22px; }
#ui-study .ledger-stats .kpi:first-child { padding-left:0; }
#ui-study .ledger-stats .value { font:31px/1.25 Georgia,serif; }
#ui-study .ledger-aside { display:flex; flex-direction:column; gap:18px; min-height:0; }
#ui-study .ledger-map { height:255px; position:relative; border:1px solid var(--line); border-radius:6px; overflow:hidden; flex:none; background:transparent; }
#ui-study .ledger-grid .inspector { grid-column:auto; grid-row:auto; padding:19px; border:1px solid var(--line); border-radius:5px; min-height:350px; }
#ui-study .ledger-grid th,#ui-study .ledger-grid td { padding:10px 12px; }
#ui-study .ledger-grid .table-tools { padding:12px; }
#ui-study .ledger-grid .table-tools input { width:170px; }
#ui-study[data-density=comfortable] td { padding-top:17px; padding-bottom:17px; }
#ui-study[data-density=comfortable] .console-resource { padding-top:13px!important; padding-bottom:13px!important; }
@media(min-width:1800px) { #ui-study .shell { grid-template-columns:210px 1fr; } #ui-study .workspace-grid { grid-template-columns:minmax(400px,1fr) 370px; grid-template-rows:minmax(300px,1fr) 215px; } #ui-study .inspector { padding:28px; } #ui-study .console-grid { grid-template-columns:300px 1fr 370px; } #ui-study .ledger-grid { grid-template-columns:minmax(700px,1fr) 410px; } #ui-study .ledger-map { height:300px; } }
@media(max-width:1200px) { #ui-study .shell { grid-template-columns:150px 1fr; } #ui-study .study-header { gap:15px; padding:0 15px; } #ui-study .study-header .session-name { padding-left:15px; } #ui-study .seed { display:none; } #ui-study .workspace-grid { grid-template-columns:minmax(280px,1fr) 280px; } #ui-study .inspector { padding:17px; } #ui-study .console-grid { grid-template-columns:215px minmax(300px,1fr) 285px; } #ui-study .ledger-grid { grid-template-columns:minmax(500px,1fr) 290px; padding:20px; gap:18px; } #ui-study .ledger-grid th,#ui-study .ledger-grid td { padding:9px 8px; } #ui-study .ledger-grid td .spark { width:45px; } #ui-study .kpi { padding:14px 16px; } }
@media(max-width:950px) { #ui-study { overflow:auto; } #ui-study .shell { grid-template-columns:60px 1fr; } #ui-study .sidebar { padding:15px 5px; } #ui-study .sidebar button { justify-content:center; } #ui-study .sidebar button > span,#ui-study .sidebar .nav-label,#ui-study .model-note { display:none; } #ui-study .study-header .session-name,#ui-study .header-extra { display:none; } #ui-study .workspace-grid { grid-template-columns:minmax(290px,1fr) 260px; } #ui-study .console-grid { grid-template-columns:190px 1fr; overflow:auto; } #ui-study .console-grid .kpi-strip { grid-column:1/3; } #ui-study .console-grid .inspector { display:none; } #ui-study .ledger-grid { display:block; } #ui-study .ledger-aside { margin-top:22px; } #ui-study .welcome { grid-template-columns:1fr; overflow:auto; } #ui-study .welcome-visual { display:none; } #ui-study .welcome h1 { font-size:38px; } #ui-study .doc-layout { grid-template-columns:130px 1fr; gap:24px; } #ui-study .about-layout { grid-template-columns:1fr; gap:20px; } #ui-study .prototype-switcher { bottom:10px; } #ui-study .prototype-switcher .state-toggle { display:none; } }
@media(max-width:700px) {
#ui-study .study-header,#ui-study[data-variant=B] .study-header,#ui-study[data-variant=C] .study-header { height:104px; padding:12px; gap:9px; flex-wrap:wrap; align-content:center; }
#ui-study .study-header .brand { flex:1; } #ui-study .study-header .grow { display:none; }
#ui-study .time-controls { order:3; width:100%; justify-content:space-between; } #ui-study .clock { white-space:nowrap; }
#ui-study .shell,#ui-study .console-shell,#ui-study .ledger-shell { top:104px; }
#ui-study .page-heading { height:auto; padding:18px 14px; flex-wrap:wrap; } #ui-study .page-heading h1 { font-size:21px; }
#ui-study .kpi-strip { grid-template-columns:1fr 1fr; } #ui-study .kpi { padding:12px 14px; } #ui-study .kpi .value { font-size:22px; }
#ui-study .workspace-grid { display:flex; flex-direction:column; overflow:auto; } #ui-study .workspace-grid .map-cell { min-height:330px; flex:none; }
#ui-study .workspace-grid .inspector { overflow:visible; flex:none; order:3; padding-bottom:85px; }
#ui-study .bottom-economy { overflow:visible; flex:none; } #ui-study .mini-resource-grid { grid-template-columns:1fr 1fr; gap:18px; }
#ui-study .map-top { left:10px; right:10px; } #ui-study .map-caption { max-width:165px; } #ui-study .map-caption span { display:none; }
#ui-study .map-scale { display:none; } #ui-study .status-footer > span:last-child { display:none; }
#ui-study .console-nav,#ui-study .ledger-nav { padding:0 15px; gap:20px; overflow:auto; } #ui-study .console-nav .grow,#ui-study .ledger-nav .grow { display:none; }
#ui-study .console-grid { display:flex; flex-direction:column; overflow:auto; } #ui-study .console-grid .map-cell { min-height:360px; flex:none; }
#ui-study .console-resources { display:none; } #ui-study .console-grid .inspector { display:block; flex:none; order:4; padding-bottom:85px; overflow:visible; }
#ui-study .console-timeline { min-height:230px; flex:none; }
#ui-study .ledger-grid { padding:18px 14px 80px; } #ui-study .ledger-title { flex-wrap:wrap; gap:14px; } #ui-study .ledger-title h1 { font-size:29px; }
#ui-study .ledger-stats { gap:8px; } #ui-study .ledger-stats .kpi { padding:0 8px; } #ui-study .ledger-stats .value { font-size:24px; }
#ui-study .table-tools { flex-wrap:wrap; } #ui-study .table-tools input { width:160px; } #ui-study .table-tools .grow { display:none; }
#ui-study .analytics-grid,#ui-study .logistics-bottom { grid-template-columns:1fr; } #ui-study .content-scroll { padding:20px 14px 100px; }
#ui-study .network { grid-template-columns:1fr; gap:8px; } #ui-study .network-arrow { transform:rotate(90deg); }
#ui-study .doc-layout { grid-template-columns:1fr; gap:20px; } #ui-study .doc-toc { flex-direction:row; overflow:auto; }
#ui-study .doc-toc h4 { display:none; } #ui-study .about-layout { margin:0; }
#ui-study .welcome-copy { padding:35px 22px 100px; } #ui-study .welcome-links { flex-wrap:wrap; gap:15px; }
#ui-study .study-dialog { width:100%; } #ui-study .dialog-scrim { padding:14px 12px 85px; } #ui-study .dialog-header,#ui-study .dialog-body { padding:19px; }
#ui-study .ledger-breakdown,#ui-study .build-grid { grid-template-columns:1fr 1fr; } #ui-study .setting-row { gap:10px; }
#ui-study .prototype-switcher { padding:7px; gap:3px; } #ui-study .prototype-switcher .switcher-label { width:140px; }
}
@media(prefers-reduced-motion:reduce) { #ui-study * { scroll-behavior:auto!important; transition:none!important; animation:none!important; } }
`;
