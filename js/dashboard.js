/* Dashboard (dashboard.html). Loads the aggregated shot cube and does every
   calculation in the browser: filters -> one pass over the cube -> sums by
   season x breakdown group x zone -> tiles, charts and table. */

const SURFACE = "#161a23";
const MIN_SHOTS = 25;   // rates on fewer shots than this are hidden (too noisy)

const ACTIONS = ["Dunk", "Layup", "Tip-in", "Hook", "Floater", "Pull-up jumper", "Step-back jumper", "Fadeaway / turnaround", "Other jumper"];
const PERIODS = ["Q1", "Q2", "Q3", "Q4", "OT"];
const PERIOD_NAME = { Q1: "1st quarter", Q2: "2nd quarter", Q3: "3rd quarter", Q4: "4th quarter", OT: "Overtime" };
const LOCS = ["Home", "Away"];
const ACTION_COLOR = Object.fromEntries(ACTIONS.map((a, i) => [a, i < 8 ? SERIES[i] : "#7a8190"]));
const PERIOD_COLOR = Object.fromEntries(PERIODS.map((p, i) => [p, SERIES[i]]));
const LOC_COLOR = { Home: SERIES[0], Away: SERIES[1] };
const TEAM_GRAY = "#5b6272";

const MEASURES = [
  { key: "fga", label: "Shots", long: "Shots", f: fmt.int, ax: fmt.short, rate: false },
  { key: "pg", label: "Per game", long: "Shots per team-game", f: (v) => fmt.num(v), ax: (v) => v.toFixed(v < 10 ? 1 : 0), rate: false },
  { key: "fg", label: "FG%", long: "Field-goal %", f: fmt.pct, ax: (v) => Math.round(v * 100) + "%", rate: true },
  { key: "fg3", label: "3P%", long: "3-point %", f: fmt.pct, ax: (v) => Math.round(v * 100) + "%", rate: true },
  { key: "efg", label: "eFG%", long: "Effective FG%", f: fmt.pct, ax: (v) => Math.round(v * 100) + "%", rate: true },
  { key: "pps", label: "Pts / shot", long: "Points per shot", f: fmt.pps, ax: (v) => v.toFixed(2), rate: true },
  { key: "share3", label: "3PA share", long: "3-point share of shots", f: fmt.pct, ax: (v) => Math.round(v * 100) + "%", rate: true },
  { key: "dist", label: "Avg distance", long: "Average shot distance", f: fmt.ft, ax: (v) => v.toFixed(0) + " ft", rate: true },
];
const M = Object.fromEntries(MEASURES.map((m) => [m.key, m]));

// a = {fga, fgm, fg3a, fg3m, pts, dist, games}
function measure(key, a) {
  if (!a || !a.fga) return NaN;
  switch (key) {
    case "fga": return a.fga;
    case "pg": return a.games ? a.fga / a.games : NaN;
    case "fg": return a.fgm / a.fga;
    case "fg3": return a.fg3a ? a.fg3m / a.fg3a : NaN;
    case "efg": return (a.fgm + 0.5 * a.fg3m) / a.fga;
    case "pps": return a.pts / a.fga;
    case "share3": return a.fg3a / a.fga;
    case "dist": return a.dist / a.fga;
  }
}
const shown = (key, a) => (M[key].rate && (!a || a.fga < MIN_SHOTS) ? NaN : measure(key, a));

let D;            // loaded data
let state;        // filters + switches
let teamSlots = new Map();   // team code -> categorical slot (only when <= 8 teams selected)

const DEFAULTS = () => ({
  from: 0, to: D.seasons.length - 1,
  teams: new Set(D.teams), zones: new Set(ZONES), actions: new Set(ACTIONS),
  periods: new Set(PERIODS), locs: new Set(LOCS),
  measure: "pg", by: "zone",
});

/* ================================================================== load */
Promise.all([
  d3.csv("data/processed/cube.csv"),
  d3.csv("data/processed/games.csv"),
  d3.csv("data/processed/teams.csv"),
  d3.csv("data/processed/bins.csv"),
]).then(([cube, games, teams, bins]) => {
  const seasons = Array.from(new Set(cube.map((d) => d.season))).sort();
  const teamName = new Map(teams.map((d) => [d.team, d.name]));
  const teamCodes = teams.map((d) => d.team).sort((a, b) => d3.ascending(teamName.get(a), teamName.get(b)));
  const si = new Map(seasons.map((s, i) => [s, i])), ti = new Map(teamCodes.map((t, i) => [t, i]));
  const zi = new Map(ZONES.map((z, i) => [z, i])), pi = new Map(PERIODS.map((p, i) => [p, i]));
  const li = new Map(LOCS.map((l, i) => [l, i])), ai = new Map(ACTIONS.map((a, i) => [a, i]));

  const n = cube.length;
  const C = { s: new Uint8Array(n), t: new Uint8Array(n), z: new Uint8Array(n), p: new Uint8Array(n), l: new Uint8Array(n), a: new Uint8Array(n),
    fga: new Float64Array(n), fgm: new Float64Array(n), fg3a: new Float64Array(n), fg3m: new Float64Array(n), pts: new Float64Array(n), dist: new Float64Array(n) };
  cube.forEach((r, i) => {
    C.s[i] = si.get(r.season); C.t[i] = ti.get(r.team); C.z[i] = zi.get(r.zone); C.p[i] = pi.get(r.period); C.l[i] = li.get(r.loc); C.a[i] = ai.get(r.action);
    C.fga[i] = +r.fga; C.fgm[i] = +r.fgm; C.fg3a[i] = +r.fg3a; C.fg3m[i] = +r.fg3m; C.pts[i] = +r.pts; C.dist[i] = +r.dist_sum;
  });
  // games[s][t][l]
  const G = seasons.map(() => teamCodes.map(() => [0, 0]));
  games.forEach((g) => { G[si.get(g.season)][ti.get(g.team)][li.get(g.loc)] = +g.games; });

  const nb = bins.length;
  const B = { s: new Uint8Array(nb), t: new Uint8Array(nb), z: new Uint8Array(nb), x: new Float64Array(nb), y: new Float64Array(nb), n: new Float64Array(nb), m: new Float64Array(nb), p: new Float64Array(nb) };
  bins.forEach((r, i) => {
    B.s[i] = si.get(r.season); B.t[i] = ti.get(r.team); B.z[i] = zi.get(r.zone);
    B.x[i] = +r.hx; B.y[i] = +r.hy; B.n[i] = +r.n; B.m[i] = +r.fgm; B.p[i] = +r.pts;
  });

  D = { seasons, teams: teamCodes, teamName, C, n, G, B, nb };
  D.dims = {
    zone: { label: "Court zone", values: ZONES, name: (v) => v, color: (v) => ZONE_COLOR[v], ordered: true, code: C.z },
    action: { label: "Shot type", values: ACTIONS, name: (v) => v, color: (v) => ACTION_COLOR[v], ordered: false, code: C.a },
    period: { label: "Quarter", values: PERIODS, name: (v) => PERIOD_NAME[v], color: (v) => PERIOD_COLOR[v], ordered: true, code: C.p },
    loc: { label: "Home / away", values: LOCS, name: (v) => v, color: (v) => LOC_COLOR[v], ordered: true, code: C.l },
    team: { label: "Team", values: teamCodes, name: (v) => teamName.get(v), color: teamColor, ordered: false, code: C.t },
  };
  state = DEFAULTS();
  D.baseline = compute(DEFAULTS()).total;
  buildControls();
  document.getElementById("loading").hidden = true;
  document.getElementById("app").hidden = false;
  setupCharts();
  update();
}).catch((err) => {
  console.error(err);
  document.getElementById("loading").innerHTML =
    `<p class="callout">Could not load the data files. If you opened this page straight from disk, run a local server (for example <code>python -m http.server</code>) and open it through that.</p>`;
});

function teamColor(code) {
  return teamSlots.has(code) ? SERIES[teamSlots.get(code)] : TEAM_GRAY;
}
function syncTeamSlots() {
  if (state.teams.size > 8) { teamSlots.clear(); return; }
  for (const t of Array.from(teamSlots.keys())) if (!state.teams.has(t)) teamSlots.delete(t);
  const used = new Set(teamSlots.values());
  for (const t of D.teams) {
    if (state.teams.has(t) && !teamSlots.has(t)) {
      let k = 0; while (used.has(k)) k++;
      teamSlots.set(t, k); used.add(k);
    }
  }
}

/* ================================================================== compute */
// one pass over the cube: sums by season x group x zone for the current filters
function compute(st) {
  const { C, n, seasons } = D;
  const dim = D.dims[st.by], nC = dim.values.length, nS = seasons.length, nZ = ZONES.length;
  const F = 6, acc = new Float64Array(nS * nC * nZ * F);
  const okT = D.teams.map((t) => st.teams.has(t)), okZ = ZONES.map((z) => st.zones.has(z)), okA = ACTIONS.map((a) => st.actions.has(a));
  const okP = PERIODS.map((p) => st.periods.has(p)), okL = LOCS.map((l) => st.locs.has(l));
  const code = dim.code;
  for (let i = 0; i < n; i++) {
    const s = C.s[i];
    if (s < st.from || s > st.to || !okT[C.t[i]] || !okZ[C.z[i]] || !okA[C.a[i]] || !okP[C.p[i]] || !okL[C.l[i]]) continue;
    const k = ((s * nC + code[i]) * nZ + C.z[i]) * F;
    acc[k] += C.fga[i]; acc[k + 1] += C.fgm[i]; acc[k + 2] += C.fg3a[i]; acc[k + 3] += C.fg3m[i]; acc[k + 4] += C.pts[i]; acc[k + 5] += C.dist[i];
  }
  const blank = () => ({ fga: 0, fgm: 0, fg3a: 0, fg3m: 0, pts: 0, dist: 0, games: 0 });
  const add = (o, k) => { o.fga += acc[k]; o.fgm += acc[k + 1]; o.fg3a += acc[k + 2]; o.fg3m += acc[k + 3]; o.pts += acc[k + 4]; o.dist += acc[k + 5]; };
  const total = blank(), byC = d3.range(nC).map(blank), bySC = d3.range(nS).map(() => d3.range(nC).map(blank));
  const byCZ = d3.range(nC).map(() => d3.range(nZ).map(blank)), bySZ = d3.range(nS).map(() => d3.range(nZ).map(blank));
  for (let s = st.from; s <= st.to; s++) for (let c = 0; c < nC; c++) for (let z = 0; z < nZ; z++) {
    const k = ((s * nC + c) * nZ + z) * F;
    if (!acc[k]) continue;
    add(total, k); add(byC[c], k); add(bySC[s][c], k); add(byCZ[c][z], k); add(bySZ[s][z], k);
  }
  // games played (team-games) for per-game measures; depends only on season, team, home/away
  const G = D.G, tSel = D.teams.map((t, i) => (st.teams.has(t) ? i : -1)).filter((i) => i >= 0), lSel = LOCS.map((l, i) => (st.locs.has(l) ? i : -1)).filter((i) => i >= 0);
  const games = (sList, tList, lList) => { let g = 0; for (const s of sList) for (const t of tList) for (const l of lList) g += G[s][t][l]; return g; };
  const sAll = d3.range(st.from, st.to + 1);
  total.games = games(sAll, tSel, lSel);
  const gFor = (sList, c) => (st.by === "team" ? games(sList, [c], lSel) : st.by === "loc" ? games(sList, tSel, [c]) : games(sList, tSel, lSel));
  byC.forEach((o, c) => (o.games = gFor(sAll, c)));
  bySC.forEach((row, s) => row.forEach((o, c) => (o.games = gFor([s], c))));
  return { total, byC, bySC, byCZ, bySZ, dim, sAll };
}

/* ================================================================== controls */
function buildControls() {
  const opts = D.seasons.map((s, i) => `<option value="${i}">${s}</option>`).join("");
  const from = document.getElementById("f-from"), to = document.getElementById("f-to");
  from.innerHTML = opts; to.innerHTML = opts;
  const onSeason = () => {
    let a = +from.value, b = +to.value;
    if (a > b) [a, b] = [b, a];
    state.from = a; state.to = b; update();
  };
  from.addEventListener("change", onSeason); to.addEventListener("change", onSeason);

  D.ctl = {
    team: dropdown("f-team", D.teams.map((t) => [t, D.teamName.get(t)]), "teams", () => state.teams, (s) => { state.teams = s; syncTeamSlots(); update(); }, true),
    zone: dropdown("f-zone", ZONES.map((z) => [z, z]), "zones", () => state.zones, (s) => { state.zones = s; update(); }),
    action: dropdown("f-action", ACTIONS.map((a) => [a, a]), "shot types", () => state.actions, (s) => { state.actions = s; update(); }),
    period: toggles("f-period", PERIODS.map((p) => [p, p]), () => state.periods, (s) => { state.periods = s; update(); }),
    loc: toggles("f-loc", LOCS.map((l) => [l, l]), () => state.locs, (s) => { state.locs = s; update(); }),
    measure: segmented("sw-measure", MEASURES.map((m) => [m.key, m.label]), () => state.measure, (v) => { state.measure = v; update(); }),
    by: segmented("sw-by", Object.entries({ zone: "Zone", action: "Shot type", period: "Quarter", loc: "Home / away", team: "Team" }), () => state.by, (v) => { state.by = v; update(); }),
  };

  document.getElementById("reset").addEventListener("click", () => {
    state = DEFAULTS();
    teamSlots.clear();
    update();
  });
  document.getElementById("download").addEventListener("click", downloadCSV);
}

function syncControls() {
  document.getElementById("f-from").value = state.from;
  document.getElementById("f-to").value = state.to;
  Object.values(D.ctl).forEach((c) => c.sync());
}

// multi-select dropdown with checkboxes
function dropdown(id, options, noun, get, set, search = false) {
  const host = document.getElementById(id);
  host.innerHTML = `<button type="button" class="dd-btn" aria-haspopup="true" aria-expanded="false"></button>
    <div class="dd-panel" hidden>
      ${search ? `<input class="dd-search" type="search" placeholder="Search…" aria-label="Search ${noun}">` : ""}
      <div class="dd-actions"><button type="button" data-act="all">Select all</button><button type="button" data-act="none">Clear</button></div>
      <div class="dd-list">${options.map(([v, l]) => `<label class="dd-opt" data-label="${l.toLowerCase()}"><input type="checkbox" value="${v}"> ${l}</label>`).join("")}</div>
    </div>`;
  const btn = host.querySelector(".dd-btn"), panel = host.querySelector(".dd-panel");
  const boxes = Array.from(host.querySelectorAll("input[type=checkbox]"));
  const open = (o) => { panel.hidden = !o; btn.setAttribute("aria-expanded", o); if (o && search) host.querySelector(".dd-search").focus(); };
  btn.addEventListener("click", () => open(panel.hidden));
  document.addEventListener("pointerdown", (e) => { if (!host.contains(e.target)) open(false); });
  host.addEventListener("keydown", (e) => { if (e.key === "Escape") { open(false); btn.focus(); } });
  boxes.forEach((b) => b.addEventListener("change", () => set(new Set(boxes.filter((x) => x.checked).map((x) => x.value)))));
  host.querySelector("[data-act=all]").addEventListener("click", () => set(new Set(options.map((o) => o[0]))));
  host.querySelector("[data-act=none]").addEventListener("click", () => set(new Set()));
  if (search) host.querySelector(".dd-search").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    host.querySelectorAll(".dd-opt").forEach((o) => (o.hidden = q && !o.dataset.label.includes(q)));
  });
  const sync = () => {
    const sel = get();
    boxes.forEach((b) => (b.checked = sel.has(b.value)));
    const all = sel.size === options.length;
    btn.textContent = all ? `All ${noun}` : sel.size === 0 ? `No ${noun}` : sel.size === 1 ? options.find((o) => sel.has(o[0]))[1] : `${sel.size} ${noun}`;
    btn.classList.toggle("active", !all);
  };
  return { sync };
}

// multi-select toggle chips (at least visually; an empty selection shows no data)
function toggles(id, options, get, set) {
  const host = document.getElementById(id);
  host.innerHTML = options.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="true">${l}</button>`).join("");
  const btns = Array.from(host.querySelectorAll("button"));
  btns.forEach((b) => b.addEventListener("click", () => {
    const s = new Set(get());
    s.has(b.dataset.v) ? s.delete(b.dataset.v) : s.add(b.dataset.v);
    set(s);
  }));
  return { sync: () => btns.forEach((b) => b.setAttribute("aria-pressed", get().has(b.dataset.v))) };
}

// single-select segmented control
function segmented(id, options, get, set) {
  const host = document.getElementById(id);
  host.innerHTML = options.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="false">${l}</button>`).join("");
  const btns = Array.from(host.querySelectorAll("button"));
  btns.forEach((b) => b.addEventListener("click", () => set(b.dataset.v)));
  return { sync: () => btns.forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === get())) };
}

/* ================================================================== update */
let R = null;           // latest compute() result
const charts = [];      // {el, draw(width)}

function setupCharts() {
  [["ch-trend", drawTrend], ["ch-bars", drawBars], ["ch-heat", drawHeat], ["ch-mix", drawMix], ["ch-map", drawMap]].forEach(([id, fn]) => {
    const c = { el: document.getElementById(id), w: 0, fn };
    charts.push(c);
    responsive(c.el, (w) => { c.w = w; if (R) fn(c.el, w); });
  });
}

function update() {
  syncControls();
  R = compute(state);
  const m = M[state.measure], dim = R.dim;
  document.getElementById("t1").textContent = `${m.long} by season, by ${dim.label.toLowerCase()}`;
  document.getElementById("t2").textContent = `${m.long} by ${dim.label.toLowerCase()}`;
  document.getElementById("t3").textContent = `${m.long}: season × ${dim.label.toLowerCase()}`;
  document.getElementById("t4").textContent = state.by === "zone" ? "Shot mix by court zone, by season" : `Shot mix by court zone, by ${dim.label.toLowerCase()}`;
  document.getElementById("t5").textContent = `The numbers: every measure by ${dim.label.toLowerCase()}`;
  renderKPIs();
  renderStatus();
  charts.forEach((c) => c.w && c.fn(c.el, c.w));
  renderTable();
}

function renderStatus() {
  const s = state, parts = [];
  parts.push(s.from === s.to ? D.seasons[s.from] : `${D.seasons[s.from]} to ${D.seasons[s.to]}`);
  if (s.teams.size !== D.teams.length) parts.push(`${s.teams.size} of 30 teams`);
  if (s.zones.size !== ZONES.length) parts.push(`${s.zones.size} of 5 zones`);
  if (s.actions.size !== ACTIONS.length) parts.push(`${s.actions.size} of 9 shot types`);
  if (s.periods.size !== PERIODS.length) parts.push(Array.from(s.periods).join(", ") || "no quarters");
  if (s.locs.size !== LOCS.length) parts.push(Array.from(s.locs).join(", ") || "neither home nor away");
  document.getElementById("status").innerHTML = `Showing <strong style="color:var(--text)">${fmt.int(R.total.fga)}</strong> shots · ${parts.join(" · ")}`;
}

function renderKPIs() {
  const t = R.total, b = D.baseline;
  const tiles = [
    ["Shots", fmt.int(t.fga), t.fga ? `${fmt.pct(t.fga / b.fga)} of all shots` : "No shots match"],
    ["Shots per team-game", "pg"], ["Field-goal %", "fg"], ["3-point %", "fg3"], ["Points per shot", "pps"], ["3-point share", "share3"], ["Average distance", "dist"],
  ].map(([label, key, note]) => {
    if (note) return { label, value: key, note };
    const v = measure(key, t), v0 = measure(key, b);
    const d = v - v0, m = M[key];
    const dtxt = isNaN(v) ? "–" : key === "pg" ? fmt.signed(d, 1) : key === "pps" ? fmt.signed(d) : key === "dist" ? fmt.signed(d, 1) + " ft" : fmt.signedPct(d);
    return { label, value: m.f(v), note: isNaN(v) ? "" : `${dtxt} vs all shots (${m.f(v0)})` };
  });
  document.getElementById("kpis").innerHTML = tiles.map((d) => `<div class="tile"><div class="tile-label">${d.label}</div><div class="tile-value">${d.value}</div><div class="tile-delta">${d.note}</div></div>`).join("");
}

function emptyNote(el, msg = "No shots match these filters. Widen a filter or press Reset.") {
  d3.select(el).selectAll("*").remove();
  d3.select(el).append("p").attr("class", "empty-note").text(msg);
}
function svgIn(el, w, h) {
  d3.select(el).selectAll("*").remove();
  return d3.select(el).append("svg").attr("width", w).attr("height", h).attr("viewBox", `0 0 ${w} ${h}`);
}
function barRight(x, y, w, h, r = 4) {
  if (w <= 0) return "";
  r = Math.min(r, h / 2, w);
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
}
// groups that have any shots under the current filters, in display order
function activeGroups() {
  const dim = R.dim, m = state.measure;
  let idx = d3.range(dim.values.length).filter((c) => R.byC[c].fga > 0);
  if (!dim.ordered) idx.sort((a, b) => d3.descending(shown(m, R.byC[a]) || -1, shown(m, R.byC[b]) || -1));
  return idx;
}
function groupTip(c, a, title) {
  const rows = [["Shots", fmt.int(a.fga)], ["Per team-game", fmt.num(measure("pg", a))], ["FG%", fmt.pct(measure("fg", a))], ["3P%", fmt.pct(measure("fg3", a))],
    ["eFG%", fmt.pct(measure("efg", a))], ["Points per shot", fmt.pps(measure("pps", a))], ["3-point share", fmt.pct(measure("share3", a))], ["Avg distance", fmt.ft(measure("dist", a))]];
  const key = state.measure, label = { fga: "Shots", pg: "Per team-game", fg: "FG%", fg3: "3P%", efg: "eFG%", pps: "Points per shot", share3: "3-point share", dist: "Avg distance" }[key];
  return tipHTML(title, rows.map((r) => (r[0] === label ? [`<b style="color:var(--accent)">${r[0]}</b>`, r[1]] : r)),
    { note: a.fga < MIN_SHOTS ? `Only ${a.fga} shots: rates are unreliable` : undefined });
}

/* ================================================================== chart 1: trend */
function drawTrend(el, W) {
  if (!R.total.fga) return emptyNote(el);
  const m = state.measure, dim = R.dim, groups = activeGroups();
  const seasons = R.sAll.map((s) => D.seasons[s]);
  const many = state.by === "team" && groups.filter((c) => teamSlots.has(dim.values[c])).length === 0;
  const series = groups.map((c) => ({ c, v: dim.values[c], name: dim.name(dim.values[c]), color: dim.color(dim.values[c]),
    pts: R.sAll.map((s) => ({ s, season: D.seasons[s], a: R.bySC[s][c], y: shown(m, R.bySC[s][c]) })) }));
  document.getElementById("lg1").innerHTML = many
    ? `<span class="legend-item"><i class="swatch line" style="background:${TEAM_GRAY}"></i>Each line is one team · hover to pick one out · choose up to 8 teams in the Team filter to color them</span>`
    : legendHTML(series.map((d) => [d.name, d.color]), { line: true });
  const narrow = W < 620;
  const m_ = { t: 12, r: narrow ? 14 : 130, b: 30, l: 56 }, w = W - m_.l - m_.r, h = 320;
  const svg = svgIn(el, W, h + m_.t + m_.b), g = svg.append("g").attr("transform", `translate(${m_.l},${m_.t})`);
  const x = d3.scalePoint().domain(seasons).range([0, w]).padding(seasons.length === 1 ? 0.5 : 0);
  const vals = series.flatMap((d) => d.pts.map((p) => p.y)).filter((v) => !isNaN(v));
  if (!vals.length) return emptyNote(el, "Too few shots for this measure under these filters.");
  const lo = d3.min(vals), hi = d3.max(vals), pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.05 || 1;
  const y = d3.scaleLinear().domain(M[m].rate ? [lo - pad, hi + pad] : [0, hi + pad]).nice().range([h, 0]);
  g.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(6).tickSize(-w).tickFormat(""));
  g.append("g").attr("class", "axis no-line").call(d3.axisLeft(y).ticks(6).tickSize(0).tickPadding(8).tickFormat(M[m].ax));
  const every = Math.ceil(seasons.length / Math.max(2, Math.floor(w / 46)));
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).tickSize(0).tickPadding(8).tickFormat((s, i) => ((seasons.length - 1 - i) % every === 0 ? shortSeason(s) : "")));
  const line = d3.line().defined((p) => !isNaN(p.y)).x((p) => x(p.season)).y((p) => y(p.y)).curve(d3.curveMonotoneX);
  const paths = g.append("g").selectAll("path").data(series).join("path")
    .attr("d", (d) => line(d.pts)).attr("fill", "none").attr("stroke", (d) => d.color)
    .attr("stroke-width", many ? 1.4 : 2.2).attr("opacity", many ? 0.6 : 1);
  if (seasons.length <= 3) g.append("g").selectAll("circle").data(series.flatMap((d) => d.pts.filter((p) => !isNaN(p.y)).map((p) => ({ ...p, color: d.color }))))
    .join("circle").attr("cx", (p) => x(p.season)).attr("cy", (p) => y(p.y)).attr("r", 4.5).attr("fill", (p) => p.color);
  if (!narrow && !many) {
    const labs = series.map((d) => { const last = d.pts.filter((p) => !isNaN(p.y)).at(-1); return last ? { name: d.name, y: y(last.y) + 4 } : null; }).filter(Boolean);
    labs.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 14) labs[i].y = labs[i - 1].y + 14;
    g.selectAll("text.lbl").data(labs).join("text").attr("class", "direct-label").attr("x", w + 8).attr("y", (d) => d.y)
      .text((d) => (d.name.length > 18 ? d.name.slice(0, 17) + "…" : d.name));
  }
  const cross = g.append("line").attr("class", "crosshair").attr("y1", 0).attr("y2", h).attr("opacity", 0);
  g.append("rect").attr("width", w).attr("height", h).attr("fill", "transparent")
    .on("pointermove", (e) => {
      const [px, py] = d3.pointer(e);
      const i = d3.minIndex(seasons, (s) => Math.abs(x(s) - px)), X = x(seasons[i]);
      cross.attr("x1", X).attr("x2", X).attr("opacity", 1);
      const at = series.map((d) => ({ d, p: d.pts[i] })).filter((o) => !isNaN(o.p.y)).sort((a, b) => b.p.y - a.p.y);
      if (!at.length) return tip.hide();
      if (many) {
        const near = d3.least(at, (o) => Math.abs(y(o.p.y) - py));
        paths.attr("stroke", (d) => (d === near.d ? ACCENT : TEAM_GRAY)).attr("opacity", (d) => (d === near.d ? 1 : 0.35)).attr("stroke-width", (d) => (d === near.d ? 2.5 : 1.4));
        paths.filter((d) => d === near.d).raise();
        const rank = at.indexOf(near) + 1;
        tip.show(e, tipHTML(near.d.name, [[M[m].long, M[m].f(near.p.y)], ["Rank this season", `${rank} of ${at.length}`], ["Shots", fmt.int(near.p.a.fga)]], { sub: seasons[i] }));
      } else {
        tip.show(e, tipHTML(seasons[i], at.slice(0, 10).map((o) => [o.d.name, M[m].f(o.p.y), o.d.color]), { sub: M[m].long }));
      }
    })
    .on("pointerleave", () => {
      cross.attr("opacity", 0); tip.hide();
      paths.attr("stroke", (d) => d.color).attr("opacity", many ? 0.6 : 1).attr("stroke-width", many ? 1.4 : 2.2);
    });
}

/* ================================================================== chart 2: bars */
function drawBars(el, W) {
  if (!R.total.fga) return emptyNote(el);
  const m = state.measure, dim = R.dim;
  const groups = activeGroups().filter((c) => !isNaN(shown(m, R.byC[c])));
  if (!groups.length) return emptyNote(el, "Too few shots for this measure under these filters.");
  const rows = groups.map((c) => ({ c, name: dim.name(dim.values[c]), a: R.byC[c], v: shown(m, R.byC[c]),
    color: state.by === "team" ? (teamSlots.has(dim.values[c]) ? dim.color(dim.values[c]) : SERIES[0]) : dim.color(dim.values[c]) }));
  const labelW = Math.min(170, Math.max(100, W * 0.32));
  const rowH = rows.length > 12 ? 20 : 30, m_ = { t: 6, r: 62, b: 26, l: labelW }, w = W - m_.l - m_.r, h = rowH * rows.length;
  const svg = svgIn(el, W, h + m_.t + m_.b), g = svg.append("g").attr("transform", `translate(${m_.l},${m_.t})`);
  const yb = d3.scaleBand().domain(rows.map((r) => r.c)).range([0, h]).paddingInner(0.28);
  const vmin = d3.min(rows, (r) => r.v), vmax = d3.max(rows, (r) => r.v);
  // counts start at zero; rates zoom in (the axis says where it starts)
  const x0 = M[m].rate && m !== "share3" ? Math.max(0, vmin - (vmax - vmin) * 0.6 - 0.02 * vmax) : 0;
  const x = d3.scaleLinear().domain([x0, vmax]).nice().range([0, w]);
  g.append("g").attr("class", "grid").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).ticks(4).tickSize(-h).tickFormat(""));
  g.append("g").attr("class", "axis no-line").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).ticks(4).tickSize(0).tickPadding(8).tickFormat(M[m].ax));
  g.selectAll("text.name").data(rows).join("text").attr("class", "axis-label").attr("x", -10).attr("y", (r) => yb(r.c) + yb.bandwidth() / 2 + 4)
    .attr("text-anchor", "end").style("font-size", "12px").style("fill", "#c3c8d4").text((r) => (r.name.length > 24 ? r.name.slice(0, 23) + "…" : r.name));
  const bars = g.append("g").selectAll("path").data(rows).join("path")
    .attr("d", (r) => barRight(0, yb(r.c), Math.max(1, x(r.v)), yb.bandwidth())).attr("fill", (r) => r.color);
  g.selectAll("text.val").data(rows).join("text").attr("class", "direct-label").attr("x", (r) => x(r.v) + 6).attr("y", (r) => yb(r.c) + yb.bandwidth() / 2 + 4).text((r) => M[m].f(r.v));
  g.append("g").selectAll("rect").data(rows).join("rect").attr("x", -labelW).attr("width", W).attr("y", (r) => yb(r.c) - 3).attr("height", yb.step()).attr("fill", "transparent")
    .on("pointerenter", (e, r) => bars.attr("opacity", (b) => (b === r ? 1 : 0.5)))
    .on("pointermove", (e, r) => tip.show(e, groupTip(r.c, r.a, r.name)))
    .on("pointerleave", () => { bars.attr("opacity", 1); tip.hide(); });
  if (x0 > 0) g.append("text").attr("class", "annot").attr("x", w).attr("y", h + 22).attr("text-anchor", "end").style("fill", "#8a91a0").text(`Axis starts at ${M[m].ax(x.domain()[0])}`);
}

/* ================================================================== chart 3: heatmap */
function drawHeat(el, Wc) {
  if (!R.total.fga) return emptyNote(el);
  const m = state.measure, dim = R.dim, groups = activeGroups();
  const seasons = R.sAll;
  const cells = [];
  groups.forEach((c) => seasons.forEach((s) => {
    const a = R.bySC[s][c], v = M[m].rate ? shown(m, a) : a.fga ? measure(m, a) : NaN;
    cells.push({ c, s, a, v });
  }));
  const vals = cells.map((d) => d.v).filter((v) => !isNaN(v));
  if (!vals.length) return emptyNote(el, "Too few shots for this measure under these filters.");
  const ext = d3.extent(vals);
  const color = d3.scaleSequential().domain(ext[0] === ext[1] ? [ext[0] - 1e-9, ext[1]] : ext)
    .interpolator(d3.piecewise(d3.interpolateRgb.gamma(2.2), ["#0d2a52", "#1c5cab", "#3987e5", "#86b6ef", "#e3efff"]));
  const stops = d3.range(0, 1.001, 0.1).map((t) => color(ext[0] + (ext[1] - ext[0]) * t));
  document.getElementById("lg3").innerHTML = `<span class="legend-gradient">${M[m].long} <span>${M[m].f(ext[0])}</span><i class="bar" style="background:linear-gradient(90deg,${stops.join(",")})"></i><span>${M[m].f(ext[1])}</span></span>`;
  const W = Math.max(Wc, 120 + seasons.length * 16);
  const labelW = Math.min(150, Math.max(90, W * 0.24)), m_ = { t: 4, r: 4, b: 26, l: labelW }, w = W - m_.l - m_.r;
  const rowH = groups.length > 12 ? 16 : 26, h = rowH * groups.length;
  const svg = svgIn(el, W, h + m_.t + m_.b), g = svg.append("g").attr("transform", `translate(${m_.l},${m_.t})`);
  const x = d3.scaleBand().domain(seasons).range([0, w]), yb = d3.scaleBand().domain(groups).range([0, h]);
  g.selectAll("text.name").data(groups).join("text").attr("class", "axis-label").attr("x", -8).attr("y", (c) => yb(c) + rowH / 2 + 4).attr("text-anchor", "end")
    .style("font-size", "11.5px").text((c) => { const nm = dim.name(dim.values[c]); return nm.length > 20 ? nm.slice(0, 19) + "…" : nm; });
  g.append("g").selectAll("rect").data(cells.filter((d) => !isNaN(d.v))).join("rect")
    .attr("x", (d) => x(d.s) + 1).attr("y", (d) => yb(d.c) + 1).attr("width", Math.max(1, x.bandwidth() - 2)).attr("height", rowH - 2).attr("rx", 2.5)
    .attr("fill", (d) => color(d.v))
    .on("pointermove", (e, d) => { d3.select(e.currentTarget).attr("stroke", "#fff").attr("stroke-width", 1.5); tip.show(e, groupTip(d.c, d.a, `${dim.name(dim.values[d.c])} · ${D.seasons[d.s]}`)); })
    .on("pointerleave", (e) => { d3.select(e.currentTarget).attr("stroke", null); tip.hide(); });
  const every = Math.ceil(seasons.length / Math.max(2, Math.floor(w / 34)));
  g.append("g").attr("class", "axis no-line").attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).tickSize(0).tickPadding(8).tickFormat((s, i) => ((seasons.length - 1 - i) % every === 0 ? shortSeason(D.seasons[s]) : "")));
}

/* ================================================================== chart 4: zone mix */
function drawMix(el, W) {
  if (!R.total.fga) return emptyNote(el);
  const dim = R.dim, zonesOn = ZONES.map((z, i) => i).filter((i) => state.zones.has(ZONES[i]));
  document.getElementById("lg4").innerHTML = legendHTML(zonesOn.map((i) => [ZONES[i], ZONE_COLOR[ZONES[i]]]));
  let rows;
  if (state.by === "zone") {
    rows = R.sAll.filter((s) => R.bySZ[s].some((a) => a.fga)).map((s) => ({ key: s, name: D.seasons[s], parts: R.bySZ[s] }));
  } else {
    rows = activeGroups().map((c) => ({ key: c, name: dim.name(dim.values[c]), parts: R.byCZ[c] }));
  }
  if (!rows.length) return emptyNote(el);
  const labelW = Math.min(150, Math.max(70, W * 0.26)), rowH = rows.length > 12 ? 18 : 28;
  const m_ = { t: 4, r: 10, b: 26, l: labelW }, w = W - m_.l - m_.r, h = rowH * rows.length;
  const svg = svgIn(el, W, h + m_.t + m_.b), g = svg.append("g").attr("transform", `translate(${m_.l},${m_.t})`);
  const yb = d3.scaleBand().domain(rows.map((r) => r.key)).range([0, h]).paddingInner(0.22);
  const x = d3.scaleLinear().domain([0, 1]).range([0, w]);
  g.append("g").attr("class", "axis no-line").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).ticks(5).tickSize(0).tickPadding(8).tickFormat((v) => v * 100 + "%"));
  g.selectAll("text.name").data(rows).join("text").attr("class", "axis-label").attr("x", -8).attr("y", (r) => yb(r.key) + yb.bandwidth() / 2 + 4).attr("text-anchor", "end")
    .style("font-size", "11.5px").text((r) => (r.name.length > 20 ? r.name.slice(0, 19) + "…" : r.name));
  const segs = [];
  rows.forEach((r) => {
    const tot = d3.sum(r.parts, (a) => a.fga); let x0 = 0;
    zonesOn.forEach((zi) => { const a = r.parts[zi], sh = tot ? a.fga / tot : 0; if (sh > 0) segs.push({ r, zi, a, sh, x0 }); x0 += sh; });
  });
  g.append("g").selectAll("rect").data(segs).join("rect")
    .attr("x", (d) => x(d.x0)).attr("y", (d) => yb(d.r.key)).attr("width", (d) => Math.max(0, x(d.x0 + d.sh) - x(d.x0) - 2)).attr("height", yb.bandwidth())
    .attr("fill", (d) => ZONE_COLOR[ZONES[d.zi]])
    .on("pointermove", (e, d) => {
      d3.select(e.currentTarget).attr("stroke", "#fff").attr("stroke-width", 1.5);
      tip.show(e, tipHTML(ZONES[d.zi], [["Share of shots", fmt.pct(d.sh)], ["Shots", fmt.int(d.a.fga)], ["FG%", fmt.pct(measure("fg", d.a))], ["Points per shot", fmt.pps(measure("pps", d.a))]], { sub: d.r.name }));
    })
    .on("pointerleave", (e) => { d3.select(e.currentTarget).attr("stroke", null); tip.hide(); });
  // label wide segments
  g.append("g").selectAll("text").data(segs.filter((d) => x(d.sh) > 34 && yb.bandwidth() >= 14)).join("text")
    .attr("x", (d) => x(d.x0) + 5).attr("y", (d) => yb(d.r.key) + yb.bandwidth() / 2 + 4).style("font-size", "11px").style("font-weight", 600)
    .style("fill", "#0b0e14").style("pointer-events", "none").text((d) => Math.round(d.sh * 100) + "%");
}

/* ================================================================== chart 5: shot map */
function drawMap(el, Wc) {
  const st = state, B = D.B;
  const okT = D.teams.map((t) => st.teams.has(t)), okZ = ZONES.map((z) => st.zones.has(z));
  const agg = new Map();
  let total = 0;
  for (let i = 0; i < D.nb; i++) {
    if (B.s[i] < st.from || B.s[i] > st.to || !okT[B.t[i]] || !okZ[B.z[i]]) continue;
    const k = B.x[i] + "," + B.y[i];
    let o = agg.get(k);
    if (!o) { o = { x: B.x[i], y: B.y[i], n: 0, m: 0, p: 0 }; agg.set(k, o); }
    o.n += B.n[i]; o.m += B.m[i]; o.p += B.p[i]; total += B.n[i];
  }
  document.getElementById("lg-map").innerHTML = `${ppsLegend()}<span class="legend-item">Bigger = more shots</span>`;
  document.getElementById("map-sub").textContent = total ? `${fmt.int(total)} shots mapped` : "";
  if (!total) return emptyNote(el);
  const minN = Math.max(3, total * 0.00004);
  const hexes = Array.from(agg.values()).filter((o) => o.n >= minN);
  hexes.forEach((o) => (o.share = o.n / total));
  const cap = d3.quantile(hexes.map((o) => o.share).sort(d3.ascending), 0.9) || 1;
  const W = Math.min(Wc, 620), S = courtScales(W);
  const svg = svgIn(el, W, S.height);
  svg.append("rect").attr("width", W).attr("height", S.height).attr("fill", "#121620").attr("rx", 10);
  const size = d3.scaleSqrt().domain([0, cap]).range([0, 1.6 * S.k]).clamp(true);
  svg.append("g").selectAll("path").data(hexes).join("path")
    .attr("transform", (o) => `translate(${S.sx(o.x)},${S.sy(o.y)})`).attr("d", (o) => hexPath(size(o.share)))
    .attr("fill", (o) => ppsColor(o.p / o.n)).attr("stroke", "#121620").attr("stroke-width", 0.5)
    .on("pointermove", (e, o) => {
      d3.select(e.currentTarget).attr("stroke", "#fff").attr("stroke-width", 1.5).raise();
      tip.show(e, tipHTML(zoneOf(o.x, o.y), [["Share of shots shown", fmt.pct(o.share, 2)], ["Shots", fmt.int(o.n)], ["FG%", fmt.pct(o.m / o.n)], ["Points per shot", fmt.pps(o.p / o.n), ppsColor(o.p / o.n)]],
        { sub: `about ${Math.hypot(o.x, o.y - COURT.hoopY).toFixed(0)} ft from the rim`, note: o.n < MIN_SHOTS ? "Few shots here: color is unreliable" : undefined }));
    })
    .on("pointerleave", (e) => { d3.select(e.currentTarget).attr("stroke", "#121620").attr("stroke-width", 0.5); tip.hide(); });
  drawCourt(svg, S);
}

/* ================================================================== table */
let sortKey = null, sortDir = -1;
const COLS = [
  ["name", "Group", null], ["fga", "Shots", fmt.int], ["fgm", "Makes", fmt.int], ["pg", "Per team-game", (v) => fmt.num(v)], ["fg", "FG%", fmt.pct], ["fg3", "3P%", fmt.pct],
  ["efg", "eFG%", fmt.pct], ["pps", "Pts / shot", fmt.pps], ["share3", "3PA share", fmt.pct], ["dist", "Avg distance", fmt.ft],
];
function tableRows() {
  const dim = R.dim;
  return d3.range(dim.values.length).filter((c) => R.byC[c].fga > 0).map((c) => {
    const a = R.byC[c], r = { name: dim.name(dim.values[c]), color: dim.color(dim.values[c]), order: c, fgm: a.fgm };
    MEASURES.forEach((m) => (r[m.key] = measure(m.key, a)));
    return r;
  });
}
function renderTable() {
  const t = document.getElementById("tbl");
  if (!R.total.fga) { t.innerHTML = `<tbody><tr><td class="empty-note">No shots match these filters.</td></tr></tbody>`; return; }
  const rows = tableRows();
  if (sortKey && sortKey !== "name") rows.sort((a, b) => sortDir * ((a[sortKey] ?? -Infinity) - (b[sortKey] ?? -Infinity) || 0));
  else if (sortKey === "name") rows.sort((a, b) => sortDir * d3.ascending(a.name, b.name));
  const tot = { name: "All matching shots", fgm: R.total.fgm };
  MEASURES.forEach((m) => (tot[m.key] = measure(m.key, R.total)));
  const cell = (r, [k, , f]) => (k === "name" ? `<td><i class="cell-swatch" style="background:${r.color || "transparent"}"></i>${r.name}</td>` : `<td>${isNaN(r[k]) ? "–" : f(r[k])}</td>`);
  t.innerHTML = `<thead><tr>${COLS.map(([k, l]) => `<th scope="col" data-k="${k}" aria-sort="${sortKey === k ? (sortDir > 0 ? "ascending" : "descending") : "none"}"
      style="${k === state.measure ? "color:var(--accent)" : ""}">${k === "name" ? R.dim.label : l}${sortKey === k ? `<span class="arrow">${sortDir > 0 ? "▲" : "▼"}</span>` : ""}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${COLS.map((c) => cell(r, c)).join("")}</tr>`).join("")}</tbody>
    <tfoot><tr>${COLS.map((c) => cell(tot, c)).join("")}</tr></tfoot>`;
  t.querySelectorAll("th").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.k;
    if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = k === "name" ? 1 : -1; }
    renderTable();
  }));
}

function downloadCSV() {
  if (!R || !R.total.fga) return;
  const rows = tableRows();
  const head = [R.dim.label, "Shots", "Makes", "Shots per team-game", "FG%", "3P%", "eFG%", "Points per shot", "3PA share", "Avg distance (ft)"];
  const line = (r) => [`"${r.name}"`, r.fga, r.fgm, r.pg, r.fg, r.fg3, r.efg, r.pps, r.share3, r.dist].map((v) => (typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(4)) : v)).join(",");
  const tot = { name: "All matching shots", fgm: R.total.fgm };
  MEASURES.forEach((m) => (tot[m.key] = measure(m.key, R.total)));
  const csv = [head.join(","), ...rows.map(line), line(tot)].join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = `nba-shots_${D.seasons[state.from]}_${D.seasons[state.to]}_by-${state.by}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
}
