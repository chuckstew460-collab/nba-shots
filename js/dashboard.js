/* Dashboard (dashboard.html). Loads the shot data and does every calculation in the
   browser: 4 filters (seasons, teams, court zones, home/away) -> sums by season x group
   -> summary tiles, 4 charts and a table, each compared with the whole league.
   All chart axes start at zero so differences are never exaggerated. */

const SURFACE = THEME.surface;
const LOCS = ["Home", "Away"];
const LOC_COLOR = { Home: SERIES[0], Away: SERIES[1] };
const LEAGUE_COLOR = "#e3e6ec", TEAM_GRAY = "#5b6272";
const MAX_TEAM_LINES = 6;

const MEASURES = {
  pg: { label: "Shots per game", f: (v) => fmt.num(v), ax: (v) => d3.format(",.0f")(v),
    explain: "<b>Shots per game</b> = shots ÷ games played, per team. Counting per game keeps the short seasons (2011-12, 2019-20, 2020-21) comparable. Split by zone, it shows how many of a team’s shots per game came from each part of the floor." },
  fg: { label: "Make rate", f: (v) => fmt.pct(v), ax: (v) => Math.round(v * 100) + "%",
    explain: "<b>Make rate</b> (FG%) = shots made ÷ shots taken. It treats a three like a two, so a lower make rate can still score more; check points per shot too." },
  pps: { label: "Points per shot", f: (v) => fmt.pps(v), ax: (v) => v.toFixed(1),
    explain: "<b>Points per shot</b> = points from made shots ÷ shots taken (free throws are not in the data). 1.00 means one point every time a team shoots. It is the fairest single measure of how good a shot is." },
  share3: { label: "3-point share", f: (v) => fmt.pct(v), ax: (v) => Math.round(v * 100) + "%",
    explain: "<b>3-point share</b> = 3-point attempts ÷ all shots: how much of the offense came from behind the arc." },
};
const BY = {
  zone: { label: "Court zone", lower: "court zone", explain: "Each line, bar and row is one part of the floor." },
  team: { label: "Team", lower: "team", explain: `Each bar and row is one team. The trend chart colors up to ${MAX_TEAM_LINES} teams: choose them in the Teams filter above.` },
  loc: { label: "Home vs. away", lower: "home vs. away", explain: "Home games compared with road games." },
  leader: { label: "3-point leaders vs. rest", lower: "3-point leader vs. the rest",
    explain: "Each season’s 3-point leader is the team that took the biggest share of its shots from three that year: the Suns of the mid-2000s, the Magic, the Rockets, the Celtics and more. This view compares them with every other team that same season. The Teams filter doesn’t apply here." },
};
const LEAD_COLOR = SERIES[1], REST_COLOR = SERIES[0];
function measure(key, a) {
  if (!a || !a.fga) return NaN;
  if (key === "pg") return a.games ? a.fga / a.games : NaN;
  if (key === "fg") return a.fgm / a.fga;
  if (key === "pps") return a.pts / a.fga;
  if (key === "share3") return a.fg3a / a.fga;
}

let D, state, RT = null, teamSlots = new Map();
var R = null;   // latest compute() result (var so drawTrend can read window.R)
const DEFAULTS = () => ({ from: 0, to: D.seasons.length - 1, teams: new Set(D.teams), zones: new Set(ZONES), locs: new Set(LOCS), m: "pg", by: "zone", preset: null });

/* ------------------------------------------------------------------ undo history */
// Every quick view and every click-to-filter saves the previous state, so "Undo" can walk back.
const undoStack = [];
const snap = (st) => ({ ...st, teams: new Set(st.teams), zones: new Set(st.zones), locs: new Set(st.locs) });
function edit(fn) { stopPlay(); fn(); state.preset = null; update(); }                    // filter bar / switches
function drill(changes) {                                                                // a click on a chart
  stopPlay();
  undoStack.push(snap(state));
  Object.assign(state, changes, { preset: null });
  syncTeamSlots();
  update();
}
function undo() {
  if (!undoStack.length) return;
  stopPlay();
  state = undoStack.pop();
  teamSlots.clear(); syncTeamSlots();
  update();
}

/* ------------------------------------------------------------------ quick views */
// One click sets every filter to tell a story; all of them come straight from the report's findings.
const PRESETS = [
  { id: "mid", title: "The death of the mid-range", text: "Shots per game from each zone, 2003-04 to 2024-25", set: { by: "zone", m: "pg" } },
  { id: "suns", title: "Seven Seconds or Less", text: "The Suns, 2004-05 to 2005-06, vs. the league", set: { teams: ["PHX"], from: "2004-05", to: "2005-06", by: "team", m: "share3" } },
  { id: "magic", title: "Orlando’s four-out Magic", text: "2007-08 to 2011-12: five straight 3-point titles", set: { teams: ["ORL"], from: "2007-08", to: "2011-12", by: "team", m: "share3" } },
  { id: "rockets", title: "The Rockets’ revolution", text: "Houston, 2013-14 to 2019-20, vs. the league", set: { teams: ["HOU"], from: "2013-14", to: "2019-20", by: "team", m: "share3" } },
  { id: "celtics", title: "Boston’s record", text: "The Celtics climb to 53.5% threes, 2019-20 to 2024-25", set: { teams: ["BOS"], from: "2019-20", to: "2024-25", by: "team", m: "share3" } },
  { id: "leaders", title: "3-point leaders vs. everyone", text: "Every season’s leader against the rest of the league", set: { by: "leader", m: "share3" } },
  { id: "value", title: "Corner 3 vs. mid-range", text: "Points per shot: the best and worst jumpers", set: { zones: ["Corner 3", "Mid-range"], by: "zone", m: "pps" } },
  { id: "fans", title: "Home court without fans", text: "Home vs. away points per shot around 2020-21", set: { by: "loc", m: "pps", from: "2016-17", to: "2023-24" } },
];
function applyPreset(pr) {
  stopPlay();
  undoStack.push(snap(state));
  state = DEFAULTS();
  const v = pr.set, idx = (season) => D.seasons.indexOf(season);
  if (v.teams) state.teams = new Set(v.teams);
  if (v.zones) state.zones = new Set(v.zones);
  if (v.from) state.from = idx(v.from);
  if (v.to) state.to = idx(v.to);
  if (v.by) state.by = v.by;
  if (v.m) state.m = v.m;
  state.preset = pr.id;
  teamSlots.clear(); syncTeamSlots();
  update();
  const k = document.getElementById("kpis").getBoundingClientRect();
  if (k.top > window.innerHeight * 0.6) document.getElementById("kpis").scrollIntoView({ behavior: "smooth", block: "start" });
}
function buildPresets() {
  const host = document.getElementById("presets");
  host.innerHTML = PRESETS.map((pr) => `<button type="button" class="preset" data-id="${pr.id}" aria-pressed="false"><b>${pr.title}</b><span>${pr.text}</span></button>`).join("");
  host.querySelectorAll(".preset").forEach((b) => b.addEventListener("click", () => applyPreset(PRESETS.find((pr) => pr.id === b.dataset.id))));
}

/* ================================================================== load */
// convert only the numeric columns (d3.autoType would turn seasons like "2003-04" into dates)
const nums = (...cols) => (d) => { for (const c of cols) d[c] = +d[c]; return d; };
Promise.all([
  d3.csv(asset("data/processed/cube.csv"), nums("fga", "fgm", "fg3a", "fg3m", "pts")),
  d3.csv(asset("data/processed/games.csv"), nums("games")),
  d3.csv(asset("data/processed/teams.csv")),
  d3.csv(asset("data/processed/bins.csv"), nums("s", "t", "z", "l", "h", "n", "m", "p")),
  d3.json(asset("data/processed/bins_key.json")),
  d3.csv(asset("data/processed/leaders.csv")),
]).then(([cube, games, teams, bins, key, leaders]) => {
  // guard against a stale cached file from before an update
  if (!cube.columns.includes("loc") || !bins.columns.includes("h") || !key.hexes) throw new Error("stale data files");
  const seasons = Array.from(new Set(cube.map((d) => d.season))).sort();
  const teamName = new Map(teams.map((d) => [d.team, d.name]));
  const teamCodes = teams.map((d) => d.team).sort((a, b) => d3.ascending(teamName.get(a), teamName.get(b)));
  const si = new Map(seasons.map((s, i) => [s, i])), ti = new Map(teamCodes.map((t, i) => [t, i]));
  const zi = new Map(ZONES.map((z, i) => [z, i])), li = new Map(LOCS.map((l, i) => [l, i]));
  const rows = cube.map((r) => ({ s: si.get(r.season), t: ti.get(r.team), z: zi.get(r.zone), l: li.get(r.loc), fga: r.fga, fgm: r.fgm, fg3a: r.fg3a, pts: r.pts }));
  const G = seasons.map(() => teamCodes.map(() => [0, 0]));
  games.forEach((g) => { G[si.get(g.season)][ti.get(g.team)][li.get(g.loc)] = g.games; });
  // map bins arrive as codes; translate their season/team/zone/loc codes onto ours
  const bs = key.seasons.map((s) => si.get(s)), bt = key.teams.map((t) => ti.get(t)), bz = key.zones.map((z) => zi.get(z)), bl = key.locs.map((l) => li.get(l));
  const B = bins.map((b) => ({ s: bs[b.s], t: bt[b.t], z: bz[b.z], l: bl[b.l], h: b.h, n: b.n, m: b.m, p: b.p }));
  // each season's 3-point leader (team index) and the name it played under that year
  const leader = seasons.map(() => -1), leaderName = seasons.map(() => "");
  leaders.forEach((r) => { leader[si.get(r.season)] = ti.get(r.team); leaderName[si.get(r.season)] = r.name_then; });
  D = { seasons, teams: teamCodes, teamName, rows, G, B, hexes: key.hexes, leader, leaderName };
  state = DEFAULTS();
  buildControls();
  document.getElementById("loading").hidden = true;
  document.getElementById("app").hidden = false;
  setupCharts();
  update();
  const mini = document.getElementById("minibar"), filters = document.querySelector(".filters");
  // show the slim summary bar only once the filters have scrolled up past the top of the screen
  new IntersectionObserver((en) => { mini.hidden = en[0].isIntersecting || en[0].boundingClientRect.top > 0; }, { rootMargin: "-60px 0px 0px 0px" }).observe(filters);
  document.getElementById("mini-edit").addEventListener("click", () => filters.scrollIntoView({ behavior: "smooth", block: "start" }));
}).catch((err) => {
  console.error(err);
  document.getElementById("loading").innerHTML =
    `<p class="callout">The dashboard could not load its data. The site may have just been updated: please refresh the page
     (Ctrl+Shift+R, or Cmd+Shift+R on a Mac). If you opened this file straight from disk, run a local server instead
     (for example <code>python -m http.server</code>).</p>`;
});

/* ================================================================== compute */
const blank = () => ({ fga: 0, fgm: 0, fg3a: 0, pts: 0, games: 0 });
const add = (o, r) => { o.fga += r.fga; o.fgm += r.fgm; o.fg3a += r.fg3a; o.pts += r.pts; };

function groupsOf(st) {
  if (st.by === "leader") return [{ key: "lead", name: "3-point leader", color: LEAD_COLOR }, { key: "rest", name: "Rest of the league", color: REST_COLOR }];
  if (st.by === "zone") return ZONES.filter((z) => st.zones.has(z)).map((z) => ({ key: z, name: z, color: ZONE_COLOR[z], test: (r) => ZONES[r.z] === z }));
  if (st.by === "loc") return LOCS.filter((l) => st.locs.has(l)).map((l) => ({ key: l, name: l === "Home" ? "Home games" : "Away games", color: LOC_COLOR[l], test: (r) => LOCS[r.l] === l }));
  return D.teams.filter((t) => st.teams.has(t)).map((t) => ({ key: t, name: D.teamName.get(t), color: teamColor(t), test: (r) => D.teams[r.t] === t }));
}

function compute(st) {
  const sAll = d3.range(st.from, st.to + 1), groups = groupsOf(st), lead = st.by === "leader";
  const okZ = ZONES.map((z) => st.zones.has(z)), okL = LOCS.map((l) => st.locs.has(l)), okT = D.teams.map((t) => st.teams.has(t));
  const gIndex = lead ? (r) => (D.leader[r.s] === r.t ? 0 : 1)
    : st.by === "zone" ? (r) => groups.findIndex((g) => g.key === ZONES[r.z])
    : st.by === "loc" ? (r) => groups.findIndex((g) => g.key === LOCS[r.l]) : (r) => groups.findIndex((g) => g.key === D.teams[r.t]);
  const sel = blank(), league = blank(), bySel = sAll.map(blank), byLeague = sAll.map(blank);
  const byG = groups.map(blank), bySG = sAll.map(() => groups.map(blank)), byGZ = groups.map(() => ZONES.map(blank)), bySZ = sAll.map(() => ZONES.map(blank));
  const leagueZ = ZONES.map(blank), byTeam = D.teams.map(blank);
  for (const r of D.rows) {
    if (r.s < st.from || r.s > st.to || !okZ[r.z] || !okL[r.l]) continue;
    const si = r.s - st.from;
    add(league, r); add(byLeague[si], r); add(leagueZ[r.z], r);
    if (lead) {   // every team counts: the season's leader in group 0, everyone else in group 1
      const g = gIndex(r);
      add(byG[g], r); add(bySG[si][g], r); add(byGZ[g][r.z], r);
      if (g === 0) { add(sel, r); add(bySel[si], r); add(bySZ[si][r.z], r); }
      continue;
    }
    add(byTeam[r.t], r);
    if (!okT[r.t]) continue;
    add(sel, r); add(bySel[si], r); add(bySZ[si][r.z], r);
    const g = gIndex(r);
    if (g >= 0) { add(byG[g], r); add(bySG[si][g], r); add(byGZ[g][r.z], r); }
  }
  // team-games for "per game": depends on seasons, teams and home/away only
  const tSel = D.teams.map((t, i) => (st.teams.has(t) ? i : -1)).filter((i) => i >= 0), tAll = D.teams.map((_, i) => i);
  const lSel = LOCS.map((l, i) => (st.locs.has(l) ? i : -1)).filter((i) => i >= 0);
  const games = (ss, ts, ls) => { let n = 0; for (const s of ss) for (const t of ts) for (const l of ls) n += D.G[s][t][l]; return n; };
  if (lead) {
    const gl = (s) => games([s], [D.leader[s]], lSel), ga = (s) => games([s], tAll, lSel);
    sAll.forEach((s, i) => { bySG[i][0].games = bySel[i].games = gl(s); byLeague[i].games = ga(s); bySG[i][1].games = ga(s) - gl(s); });
    sel.games = byG[0].games = d3.sum(sAll, gl); league.games = d3.sum(sAll, ga); byG[1].games = league.games - sel.games;
    return { sAll, groups, sel, league, bySel, byLeague, byG, bySG, byGZ, bySZ, leagueZ, allTeams: false, lead };
  }
  const gFor = (ss, g) => (st.by === "team" ? games(ss, [D.teams.indexOf(groups[g].key)], lSel) : st.by === "loc" ? games(ss, tSel, [LOCS.indexOf(groups[g].key)]) : games(ss, tSel, lSel));
  sel.games = games(sAll, tSel, lSel); league.games = games(sAll, tAll, lSel);
  sAll.forEach((s, i) => { bySel[i].games = games([s], tSel, lSel); byLeague[i].games = games([s], tAll, lSel); });
  byG.forEach((o, g) => (o.games = gFor(sAll, g)));
  bySG.forEach((row, i) => row.forEach((o, g) => (o.games = gFor([sAll[i]], g))));
  byTeam.forEach((o, t) => (o.games = games(sAll, [t], lSel)));
  return { sAll, groups, sel, league, bySel, byLeague, byG, bySG, byGZ, bySZ, leagueZ, byTeam, allTeams: st.teams.size === D.teams.length };
}

function teamColor(t) { return teamSlots.has(t) ? SERIES[teamSlots.get(t)] : TEAM_GRAY; }
function syncTeamSlots() {
  if (state.teams.size > MAX_TEAM_LINES) { teamSlots.clear(); return; }
  for (const t of Array.from(teamSlots.keys())) if (!state.teams.has(t)) teamSlots.delete(t);
  const used = new Set(teamSlots.values());
  for (const t of D.teams) if (state.teams.has(t) && !teamSlots.has(t)) { let k = 0; while (used.has(k)) k++; teamSlots.set(t, k); used.add(k); }
}

/* ================================================================== controls */
function buildControls() {
  buildPresets();
  D.ctl = [
    seasonSlider(),
    dropdown("f-team", D.teams.map((t) => [t, D.teamName.get(t)]), () => state.teams, (s) => edit(() => { state.teams = s; syncTeamSlots(); })),
    toggles("f-zone", ZONES.map((z) => [z, z, ZONE_COLOR[z]]), () => state.zones, (s) => edit(() => { state.zones = s; })),
    toggles("f-loc", LOCS.map((l) => [l, l === "Home" ? "Home" : "Away"]), () => state.locs, (s) => edit(() => { state.locs = s; })),
    segmented("sw-measure", Object.entries(MEASURES).map(([k, m]) => [k, m.label]), () => state.m, (v) => { state.m = v; update(); }),
    segmented("sw-by", Object.entries(BY).map(([k, b]) => [k, b.label]), () => state.by, (v) => edit(() => { state.by = v; })),
  ];
  document.getElementById("reset").addEventListener("click", () => { stopPlay(); undoStack.length = 0; state = DEFAULTS(); teamSlots.clear(); update(); });
  document.getElementById("undo").addEventListener("click", undo);
  document.getElementById("season-play").addEventListener("click", togglePlay);
  document.getElementById("download").addEventListener("click", downloadCSV);
}

/* ------------------------------------------------------------------ season slider */
// Two handles (first and last season) on one track; drag either, click the track, or use the arrow keys.
function seasonSlider() {
  const host = document.getElementById("season-range"), n = D.seasons.length;
  let W = 0, x = null, parts = null, active = null;
  const setRange = (a, b) => edit(() => { state.from = Math.max(0, Math.min(a, b)); state.to = Math.min(n - 1, Math.max(a, b)); });
  function draw(width) {
    W = Math.max(220, width);
    x = d3.scalePoint().domain(d3.range(n)).range([12, W - 12]);
    const svg = d3.select(host).selectAll("svg").data([0]).join("svg").attr("width", W).attr("height", 46).attr("viewBox", `0 0 ${W} 46`);
    svg.selectAll("*").remove();
    svg.append("line").attr("x1", 12).attr("x2", W - 12).attr("y1", 16).attr("y2", 16).attr("stroke", "var(--axis)").attr("stroke-width", 5).attr("stroke-linecap", "round");
    const band = svg.append("line").attr("y1", 16).attr("y2", 16).attr("stroke", ACCENT).attr("stroke-width", 5).attr("stroke-linecap", "round");
    svg.append("g").selectAll("circle").data(d3.range(n)).join("circle").attr("cx", (i) => x(i)).attr("cy", 16).attr("r", 1.6).attr("fill", "#c9c3e6").attr("opacity", 0.6);
    const every = W < 300 ? 7 : W < 420 ? 4 : 3;
    svg.append("g").selectAll("text").data(d3.range(n).filter((i) => (n - 1 - i) % every === 0)).join("text")
      .attr("x", (i) => x(i)).attr("y", 40).attr("text-anchor", "middle").attr("class", "axis-label").style("font-size", "11px").text((i) => shortSeason(D.seasons[i]));
    const handle = (which) => {
      const g = svg.append("g").attr("class", "season-handle").attr("tabindex", 0).attr("role", "slider")
        .attr("aria-label", which === "from" ? "First season" : "Last season").attr("aria-valuemin", 0).attr("aria-valuemax", n - 1);
      g.append("circle").attr("r", 13).attr("fill", ACCENT).attr("opacity", 0.22);
      g.append("circle").attr("r", 8).attr("fill", ACCENT).attr("stroke", "#fff").attr("stroke-width", 2.5);
      g.on("keydown", (e) => {
        const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        if (which === "from") setRange(Math.min(state.from + d, state.to), state.to); else setRange(state.from, Math.max(state.to + d, state.from));
        host.querySelectorAll(".season-handle")[which === "from" ? 0 : 1].focus();
      });
      return g;
    };
    parts = { band, hFrom: handle("from"), hTo: handle("to") };
    const idxAt = (e) => { const px = d3.pointer(e, svg.node())[0]; return d3.minIndex(d3.range(n), (i) => Math.abs(x(i) - px)); };
    svg.style("touch-action", "none").style("cursor", "pointer")
      .on("pointerdown", (e) => {
        const i = idxAt(e);
        active = state.from === state.to ? (i < state.from ? "from" : "to") : Math.abs(i - state.from) <= Math.abs(i - state.to) ? "from" : "to";
        svg.node().setPointerCapture(e.pointerId);
        move(i);
      })
      .on("pointermove", (e) => { if (active) move(idxAt(e)); })
      .on("pointerup pointercancel", () => { active = null; });
    sync();
  }
  function move(i) {
    if (active === "from" && (i !== state.from || state.to < i)) setRange(Math.min(i, state.to), state.to);
    else if (active === "to" && (i !== state.to || i < state.from)) setRange(state.from, Math.max(i, state.from));
  }
  function sync() {
    const label = document.getElementById("season-label");
    label.textContent = playTimer ? `▶ ${D.seasons[state.from]}` : state.from === state.to ? D.seasons[state.from] : `${D.seasons[state.from]} to ${D.seasons[state.to]}`;
    if (!parts) return;
    const a = playTimer && playRange ? playRange[0] : state.from, b = playTimer && playRange ? playRange[1] : state.to;
    parts.band.attr("x1", x(a)).attr("x2", x(b));
    parts.hFrom.attr("transform", `translate(${x(playTimer ? state.from : state.from)},16)`).attr("aria-valuenow", state.from).attr("aria-valuetext", D.seasons[state.from]);
    parts.hTo.attr("transform", `translate(${x(state.to)},16)`).attr("aria-valuenow", state.to).attr("aria-valuetext", D.seasons[state.to]);
  }
  responsive(host, (w) => draw(w));
  return { sync };
}

// Play: step through the selected seasons one at a time (all 22 if only one is selected),
// then return to the full range. The trend chart keeps the whole span and marks the season.
let playTimer = 0, playRange = null;
function togglePlay() {
  if (playTimer) return stopPlay(false);
  playRange = state.from === state.to ? [0, D.seasons.length - 1] : [state.from, state.to];
  let i = playRange[0];
  const icon = document.getElementById("season-play-icon");
  icon.setAttribute("d", "M3 2h4v14H3zM11 2h4v14h-4z");
  document.getElementById("season-play").setAttribute("aria-label", "Pause");
  const step = () => {
    if (i > playRange[1]) return stopPlay(true);
    state.from = state.to = i++;
    update();
  };
  playTimer = setInterval(step, 1100);
  step();
}
function stopPlay(restore) {
  if (!playTimer) return;
  clearInterval(playTimer); playTimer = 0;
  const range = playRange; playRange = null;
  document.getElementById("season-play-icon").setAttribute("d", "M4 2l12 7-12 7z");
  document.getElementById("season-play").setAttribute("aria-label", "Play through the seasons one at a time");
  if (restore && range) { state.from = range[0]; state.to = range[1]; }
  update();
}

function dropdown(id, options, get, set) {
  const host = document.getElementById(id);
  host.innerHTML = `<button type="button" class="dd-btn" aria-haspopup="true" aria-expanded="false"></button>
    <div class="dd-panel" hidden>
      <input class="dd-search" type="search" placeholder="Search teams…" aria-label="Search teams">
      <div class="dd-actions"><button type="button" data-act="all">All teams</button><button type="button" data-act="none">Clear</button></div>
      <div class="dd-list">${options.map(([v, l]) => `<label class="dd-opt" data-label="${l.toLowerCase()}"><input type="checkbox" value="${v}"> ${l}</label>`).join("")}</div>
    </div>`;
  const btn = host.querySelector(".dd-btn"), panel = host.querySelector(".dd-panel"), boxes = Array.from(host.querySelectorAll("input[type=checkbox]"));
  const open = (o) => { panel.hidden = !o; btn.setAttribute("aria-expanded", o); if (o) host.querySelector(".dd-search").focus(); };
  btn.addEventListener("click", () => open(panel.hidden));
  document.addEventListener("pointerdown", (e) => { if (!host.contains(e.target)) open(false); });
  host.addEventListener("keydown", (e) => { if (e.key === "Escape") { open(false); btn.focus(); } });
  boxes.forEach((b) => b.addEventListener("change", () => set(new Set(boxes.filter((x) => x.checked).map((x) => x.value)))));
  host.querySelector("[data-act=all]").addEventListener("click", () => set(new Set(options.map((o) => o[0]))));
  host.querySelector("[data-act=none]").addEventListener("click", () => set(new Set()));
  host.querySelector(".dd-search").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    host.querySelectorAll(".dd-opt").forEach((o) => (o.hidden = q && !o.dataset.label.includes(q)));
  });
  return { sync() {
    const s = get(), all = s.size === options.length;
    boxes.forEach((b) => (b.checked = s.has(b.value)));
    btn.textContent = all ? "All 30 teams" : s.size === 0 ? "No teams" : s.size === 1 ? options.find((o) => s.has(o[0]))[1] : `${s.size} teams`;
    btn.classList.toggle("active", !all);
  } };
}
function toggles(id, options, get, set) {
  const host = document.getElementById(id);
  host.innerHTML = options.map(([v, l, c]) => `<button type="button" data-v="${v}" aria-pressed="true">${c ? `<i class="swatch" style="background:${c}"></i>` : ""}${l}</button>`).join("");
  const btns = Array.from(host.querySelectorAll("button"));
  btns.forEach((b) => b.addEventListener("click", () => { const s = new Set(get()); s.has(b.dataset.v) ? s.delete(b.dataset.v) : s.add(b.dataset.v); set(s); }));
  return { sync: () => btns.forEach((b) => b.setAttribute("aria-pressed", get().has(b.dataset.v))) };
}
function segmented(id, options, get, set) {
  const host = document.getElementById(id);
  host.innerHTML = options.map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="false">${l}</button>`).join("");
  const btns = Array.from(host.querySelectorAll("button"));
  btns.forEach((b) => b.addEventListener("click", () => set(b.dataset.v)));
  return { sync: () => btns.forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === get())) };
}

/* ================================================================== update */
const charts = [];
function setupCharts() {
  [["ch-trend", drawTrend], ["ch-bars", drawBars], ["ch-mix", drawMix], ["ch-map", drawMap]].forEach(([id, fn]) => {
    const c = { el: document.getElementById(id), w: 0, fn };
    charts.push(c);
    responsive(c.el, (w) => { c.w = w; if (R) fn(c.el, w); });
  });
}

function update() {
  D.ctl.forEach((c) => c.sync());
  R = compute(state);
  RT = playRange ? compute({ ...state, from: playRange[0], to: playRange[1] }) : R;   // trend keeps the full span while playing
  document.querySelectorAll(".preset").forEach((b) => { const on = b.dataset.id === state.preset; b.classList.toggle("on", on); b.setAttribute("aria-pressed", on); });
  document.getElementById("undo").hidden = !undoStack.length;
  const m = MEASURES[state.m], by = BY[state.by];
  document.getElementById("measure-explain").innerHTML = m.explain;
  document.getElementById("by-explain").textContent = by.explain;
  const lead = state.by === "leader";
  document.getElementById("f-team").closest(".filter").classList.toggle("muted", lead);
  document.getElementById("t1").textContent = lead ? `${m.label} by season: each year’s 3-point leader vs. the rest of the league` : `${m.label} by season, split by ${by.lower}`;
  document.getElementById("t2").textContent = lead ? `${m.label}: the gap between each season’s 3-point leader and everyone else` : `${m.label} by ${by.lower}, all selected seasons combined`;
  document.getElementById("t4").textContent = state.by === "zone" ? "Shot mix by season: what share of shots came from each zone" : `Shot mix by ${by.lower}: what share of shots came from each zone`;
  document.getElementById("t5").textContent = lead ? "The numbers: each season’s 3-point leader vs. the rest" : `The numbers, by ${by.lower}`;
  document.getElementById("h5").textContent = lead
    ? "One row per season: the team that led the league in 3-point share, its number, everyone else’s, and the gap. The bottom row combines all selected seasons."
    : "The exact numbers behind the charts. Click a column header to sort. The last two rows are your whole selection and the whole league for the same seasons, zones and games.";
  document.getElementById("h1").innerHTML = trendHowto();
  document.getElementById("h2").innerHTML = lead
    ? `<b style="color:${LEAD_COLOR}">●</b> the season’s 3-point leader, <b style="color:${REST_COLOR}">●</b> every other team that season combined; the number is the gap. The axis starts at zero. Hover a row for details.`
    : "Bars start at zero. " + (state.by === "team" ? "The white line is the league average for comparison. "
    : state.by === "zone" && state.m === "pg" ? "Together the bars add up to all the shots per game. " : "The white line is your whole selection for comparison. ") + "Hover a bar for every number.";
  document.getElementById("h4").textContent = lead ? "Where the 3-point leaders took their shots compared with everyone else. Each row adds up to 100%."
    : state.by === "zone"
    ? "Each row is one season and adds up to 100%. Watch the orange mid-range band shrink and the blue 3-point bands grow."
    : "Each row adds up to 100%, so you can compare where different groups take their shots" + (state.by === "team" ? ", with the league at the bottom." : ".");
  renderStatus(); renderKPIs(); renderInsights();
  charts.forEach((c) => c.w && c.fn(c.el, c.w));
  renderTable();
}
function trendHowto() {
  if (state.by === "leader") return `<b style="color:${LEAD_COLOR}">Orange</b> = each season’s 3-point leader (hover to see which team), <b style="color:${REST_COLOR}">blue</b> = every other team that season combined. ` +
    (state.m === "fg" || state.m === "pps" ? "<b>The y-axis is zoomed in</b> (it doesn’t start at zero)." : "The y-axis starts at zero.");
  const axis = state.m === "fg" || state.m === "pps"
    ? "<b>The y-axis is zoomed in</b> (it doesn’t start at zero) so small differences are visible; read the numbers, not just the gaps, and use the bar chart below for true-to-scale sizes."
    : "The y-axis starts at zero, so the gaps are true to scale.";
  if (state.by === "team") return (state.teams.size > MAX_TEAM_LINES
    ? `Each thin gray line is one team (hover to pick one out); the <b>white line is the league average</b>. To compare specific teams in color, choose up to ${MAX_TEAM_LINES} in the Teams filter. `
    : "Each colored line is one team; the <b>white line is the league average</b>. ") + axis;
  return `Each line is one ${state.by === "zone" ? "court zone" : "kind of game"}. ${axis} Hover for exact values.`;
}

function listNames(arr, max = 3) { return arr.length <= max ? arr.join(", ").replace(/, ([^,]*)$/, " and $1") : `${arr.slice(0, max).join(", ")} and ${arr.length - max} more`; }
function renderStatus() {
  const s = state, seasons = s.from === s.to ? D.seasons[s.from] : `${D.seasons[s.from]} to ${D.seasons[s.to]}`;
  const leadNames = Array.from(new Set(R.sAll.map((x) => D.leaderName[x])));
  const teams = R.lead ? `each season’s 3-point leader (${listNames(leadNames, 4)})` : R.allTeams ? "all 30 teams" : s.teams.size ? listNames(D.teams.filter((t) => s.teams.has(t)).map((t) => D.teamName.get(t))) : "no teams";
  const zones = s.zones.size === ZONES.length ? "every court zone" : s.zones.size ? listNames(ZONES.filter((z) => s.zones.has(z)), 4) : "no zones";
  const locs = s.locs.size === 2 ? "home and away games" : s.locs.size ? `${Array.from(s.locs)[0].toLowerCase()} games only` : "no games";
  const txt = `Showing <strong>${fmt.int(R.sel.fga)}</strong> shots by ${teams} · ${seasons} · ${zones} · ${locs}`;
  document.getElementById("status").innerHTML = txt;
  document.getElementById("mini-text").innerHTML = `${txt} · <b>${MEASURES[state.m].label}</b> by <b>${BY[state.by].lower}</b>`;
}

function renderKPIs() {
  const t = R.sel, L = R.league;
  document.getElementById("kpis").innerHTML = Object.entries(MEASURES).map(([k, m]) => {
    const v = measure(k, t), lv = measure(k, L);
    let note;
    if (isNaN(v)) note = "No shots match";
    else if (R.allTeams) note = "This is the whole league";
    else {
      const d = v - lv, txt = k === "pg" ? fmt.signed(d, 1) : k === "pps" ? fmt.signed(d) : fmt.signedPct(d);
      note = `League: ${m.f(lv)} <span class="${d >= 0 ? "up" : "down"}">(${txt})</span>`;
    }
    return `<div class="tile${k === state.m ? " on" : ""}"><div class="tile-label">${m.label}</div><div class="tile-value">${isNaN(v) ? "–" : m.f(v)}</div><div class="tile-delta">${note}</div></div>`;
  }).join("");
}

function emptyNote(el, msg = "No shots match these filters. Widen a filter or press Reset everything.") {
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
function allNumbersTip(title, a, sub, note) {
  return tipHTML(title, [["Shots", fmt.int(a.fga)], ...Object.entries(MEASURES).map(([k, m]) => [k === state.m ? `<b style="color:var(--accent)">${m.label}</b>` : m.label, m.f(measure(k, a))])], { sub, note });
}
// what a click on a group (bar, table row) filters to
function groupFilter(key) {
  if (state.by === "team") return { teams: new Set([key]) };
  if (state.by === "zone") return { zones: new Set([key]) };
  if (state.by === "loc") return { locs: new Set([key]) };
  return {};
}
const groupNoun = () => ({ team: "this team", zone: "this zone", loc: "these games" }[state.by] || "this");

/* ================================================================== chart 1: trend */
function drawTrend(el, W) {
  const R = RT || window.R;   // while playing, the trend shows the whole span
  if (!R.sel.fga) return emptyNote(el);
  const m = state.m, M = MEASURES[m], seasons = R.sAll.map((s) => D.seasons[s]);
  const spaghetti = state.by === "team" && state.teams.size > MAX_TEAM_LINES;
  const series = R.groups.map((g, gi) => ({ ...g, pts: R.sAll.map((s, i) => ({ season: D.seasons[s], a: R.bySG[i][gi], y: measure(m, R.bySG[i][gi]) })) }))
    .filter((s) => s.pts.some((p) => !isNaN(p.y)));
  const leagueLine = state.by === "team" ? R.sAll.map((s, i) => ({ season: D.seasons[s], a: R.byLeague[i], y: measure(m, R.byLeague[i]) })) : null;
  document.getElementById("lg1").innerHTML = (spaghetti ? `<span class="legend-item"><i class="swatch line" style="background:${TEAM_GRAY}"></i>One line per team</span>` : legendHTML(series.map((s) => [s.name, s.color]), { line: true }))
    + (leagueLine ? `<span class="legend-item"><i class="swatch line" style="background:${LEAGUE_COLOR}"></i>League average</span>` : "");
  const narrow = W < 640;
  const mg = { t: 12, r: narrow || spaghetti ? 14 : 140, b: 30, l: 50 }, w = W - mg.l - mg.r, h = 300;
  const svg = svgIn(el, W, h + mg.t + mg.b), g = svg.append("g").attr("transform", `translate(${mg.l},${mg.t})`);
  const x = d3.scalePoint().domain(seasons).range([0, w]).padding(seasons.length === 1 ? 0.5 : 0);
  const vals = [...series.flatMap((s) => s.pts.map((p) => p.y)), ...(leagueLine || []).map((p) => p.y)].filter((v) => !isNaN(v));
  // counts and shares start at zero; make rate and points per shot zoom to the data (the chart says so)
  const zoom = m === "fg" || m === "pps", lo = d3.min(vals), hi = d3.max(vals) || 1, pad = (hi - lo) * 0.15 || hi * 0.05;
  const y = d3.scaleLinear().domain(zoom ? [Math.max(0, lo - pad), hi + pad] : [0, hi * 1.08]).nice().range([h, 0]);
  g.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(5).tickSize(-w).tickFormat(""));
  g.append("g").attr("class", "axis no-line").call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(8).tickFormat(m === "pps" ? (v) => v.toFixed(2) : M.ax));
  if (zoom) g.append("text").attr("class", "annot").attr("x", 0).attr("y", h - 6).style("fill", "#ffb067").text(`Axis zoomed: starts at ${m === "pps" ? y.domain()[0].toFixed(2) : M.ax(y.domain()[0])}, not zero`);
  const every = Math.ceil(seasons.length / Math.max(2, Math.floor(w / 46)));
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`)
    .call(d3.axisBottom(x).tickSize(0).tickPadding(8).tickFormat((s, i) => ((seasons.length - 1 - i) % every === 0 ? shortSeason(s) : "")));
  const line = d3.line().defined((p) => !isNaN(p.y)).x((p) => x(p.season)).y((p) => y(p.y)).curve(d3.curveMonotoneX);
  const paths = g.append("g").selectAll("path").data(series).join("path").attr("d", (s) => line(s.pts)).attr("fill", "none")
    .attr("stroke", (s) => (spaghetti ? TEAM_GRAY : s.color)).attr("stroke-width", spaghetti ? 1.3 : 2.4).attr("opacity", spaghetti ? 0.55 : 1);
  if (leagueLine) g.append("path").attr("d", line(leagueLine)).attr("fill", "none").attr("stroke", LEAGUE_COLOR).attr("stroke-width", 2.6);
  if (seasons.length <= 3) g.append("g").selectAll("circle").data(series.flatMap((s) => s.pts.filter((p) => !isNaN(p.y)).map((p) => ({ ...p, c: s.color }))))
    .join("circle").attr("cx", (p) => x(p.season)).attr("cy", (p) => y(p.y)).attr("r", 5).attr("fill", (p) => p.c);
  if (!narrow && !spaghetti) {
    const labs = series.map((s) => { const last = s.pts.filter((p) => !isNaN(p.y)).at(-1); return last ? { name: s.name, y: y(last.y) + 4 } : null; }).filter(Boolean);
    if (leagueLine && !isNaN(leagueLine.at(-1).y)) labs.push({ name: "League average", y: y(leagueLine.at(-1).y) + 4 });
    labs.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labs.length; i++) if (labs[i].y - labs[i - 1].y < 14) labs[i].y = labs[i - 1].y + 14;
    g.selectAll("text.lbl").data(labs).join("text").attr("class", "direct-label").attr("x", w + 8).attr("y", (d) => d.y).text((d) => (d.name.length > 20 ? d.name.slice(0, 19) + "…" : d.name));
  }
  if (playTimer) {   // the season currently playing
    const X = x(D.seasons[state.from]);
    g.append("line").attr("x1", X).attr("x2", X).attr("y1", 0).attr("y2", h).attr("stroke", ACCENT).attr("stroke-width", 2);
    g.append("text").attr("class", "annot").attr("x", X).attr("y", -2).attr("text-anchor", "middle").style("fill", "#ffc15e").text(`▶ ${D.seasons[state.from]}`);
  }
  const cross = g.append("line").attr("class", "crosshair").attr("y1", 0).attr("y2", h).attr("opacity", 0);
  g.append("rect").attr("width", w).attr("height", h).attr("fill", "transparent")
    .on("pointermove", (e) => {
      const [px, py] = d3.pointer(e), i = d3.minIndex(seasons, (s) => Math.abs(x(s) - px)), X = x(seasons[i]);
      cross.attr("x1", X).attr("x2", X).attr("opacity", 1);
      const at = series.map((s) => ({ s, p: s.pts[i] })).filter((o) => !isNaN(o.p.y)).sort((a, b) => b.p.y - a.p.y);
      const lg = leagueLine ? [["League average", M.f(leagueLine[i].y), LEAGUE_COLOR]] : [];
      if (spaghetti && at.length) {
        const near = d3.least(at, (o) => Math.abs(y(o.p.y) - py));
        paths.attr("stroke", (s) => (s === near.s ? ACCENT : TEAM_GRAY)).attr("opacity", (s) => (s === near.s ? 1 : 0.3)).attr("stroke-width", (s) => (s === near.s ? 2.6 : 1.3));
        paths.filter((s) => s === near.s).raise();
        tip.show(e, tipHTML(near.s.name, [[M.label, M.f(near.p.y)], ["Rank that season", `${at.indexOf(near) + 1} of ${at.length}`], ...lg], { sub: seasons[i] }));
      } else {
        tip.show(e, tipHTML(seasons[i], [...at.map((o) => [o.s.name, M.f(o.p.y), o.s.color]), ...lg],
          { sub: R.lead ? `3-point leader: ${D.leaderName[R.sAll[i]]}` : M.label, note: R.sAll.length > 1 && !playTimer ? "Click to focus on this season" : undefined }));
      }
    })
    .style("cursor", R.sAll.length > 1 && !playTimer ? "pointer" : null)
    .on("click", (e) => {
      if (playTimer || R.sAll.length < 2) return;
      const i = d3.minIndex(seasons, (sn) => Math.abs(x(sn) - d3.pointer(e)[0]));
      tip.hide();
      drill({ from: R.sAll[i], to: R.sAll[i] });
    })
    .on("pointerleave", () => {
      cross.attr("opacity", 0); tip.hide();
      paths.attr("stroke", (s) => (spaghetti ? TEAM_GRAY : s.color)).attr("opacity", spaghetti ? 0.55 : 1).attr("stroke-width", spaghetti ? 1.3 : 2.4);
    });
}

/* ================================================================== the written summary */
const ordinal = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
function selectionName() {
  const names = D.teams.filter((t) => state.teams.has(t)).map((t) => D.teamName.get(t));
  return names.length <= 3 ? listNames(names) : `Your ${names.length} teams`;
}
function renderInsights() {
  const list = document.getElementById("insight-list"), b = (v) => `<b>${v}</b>`;
  if (!R.sel.fga) { list.innerHTML = "<li>No shots match these filters. Widen a filter, pick a quick view, or press Reset everything.</li>"; return; }
  const m = state.m, M = MEASURES[m], out = [];
  // say which shots the numbers cover when zones or games are filtered
  const scope = [state.zones.size < ZONES.length ? `${listNames(ZONES.filter((z) => state.zones.has(z)), 4)} shots` : "",
    state.locs.size === 1 ? `${Array.from(state.locs)[0].toLowerCase()} games` : ""].filter(Boolean);
  const lab = M.label.toLowerCase() + (scope.length && !R.lead && state.by !== "zone" ? ` (${scope.join(", ")} only)` : scope.length && state.by === "zone" && state.locs.size === 1 ? ` (${scope[scope.length - 1]} only)` : "");
  const sIdx = R.sAll, s0 = D.seasons[sIdx[0]], s1 = D.seasons[sIdx[sIdx.length - 1]], multi = sIdx.length > 1;
  const span = multi ? `${s0} to ${s1}` : s0;
  const ends = (arr) => {   // first and last seasons with a value
    const v = arr.map((a) => measure(m, a)), i0 = v.findIndex((q) => !isNaN(q)), i1 = v.length - 1 - [...v].reverse().findIndex((q) => !isNaN(q));
    return i0 < 0 ? null : { a: v[i0], b: v[i1], sa: D.seasons[sIdx[i0]], sb: D.seasons[sIdx[i1]] };
  };
  if (R.lead) {
    const gapAll = measure(m, R.byG[0]) - measure(m, R.byG[1]);
    out.push(`From ${span}, each season’s 3-point leader ${gapAll >= 0 ? "beat" : "trailed"} the rest of the league by ${b(gapText(m, gapAll))} in ${lab}: ${b(M.f(measure(m, R.byG[0])))} vs. ${M.f(measure(m, R.byG[1]))}.`);
    const rows = leaderRows().map((r) => ({ ...r, gap: measure(m, r.a) - measure(m, r.b) })).filter((r) => !isNaN(r.gap));
    if (rows.length > 1) {
      const hi = d3.greatest(rows, (r) => r.gap), lo = d3.least(rows, (r) => r.gap);
      out.push(`Biggest gap: the ${hi.season} ${hi.name} (${b(gapText(m, hi.gap))}). Smallest: the ${lo.season} ${lo.name} (${gapText(m, lo.gap)}).`);
      const counts = d3.rollups(sIdx.map((x) => D.leaderName[x]), (v) => v.length, (d) => d).sort((p, q) => q[1] - p[1]);
      if (counts[0][1] > 1) out.push(`The ${counts[0][0]} led the league in 3-point share ${b(counts[0][1] + " times")} in this range, more than any other team.`);
    }
  } else if (R.allTeams) {
    const e = ends(R.bySel);
    if (multi && e) out.push(`League-wide, ${state.by === "zone" && state.zones.size < ZONES.length ? `${lab} for ${listNames(ZONES.filter((z) => state.zones.has(z)), 4)} shots combined` : lab} went from ${b(M.f(e.a))} in ${e.sa} to ${b(M.f(e.b))} in ${e.sb} (${gapText(m, e.b - e.a)}).`);
    else out.push(`In ${span}, the league’s ${lab} was ${b(M.f(measure(m, R.sel)))}.`);
  } else {
    const v = measure(m, R.sel), lv = measure(m, R.league);
    out.push(`${selectionName()}: ${lab} of ${b(M.f(v))} over ${span}, ${v >= lv ? "above" : "below"} the league’s ${M.f(lv)} (${b(gapText(m, v - lv))}).`);
    const e = ends(R.bySel), el = ends(R.byLeague);
    if (multi && e && el && e.sa !== e.sb) out.push(`Over those seasons it went from ${M.f(e.a)} to ${b(M.f(e.b))} (${gapText(m, e.b - e.a)}), while the league went from ${M.f(el.a)} to ${M.f(el.b)}.`);
    const ranked = D.teams.map((t, i) => ({ t, v: measure(m, R.byTeam[i]) })).filter((o) => !isNaN(o.v)).sort((p, q) => q.v - p.v);
    const mine = ranked.filter((o) => state.teams.has(o.t));
    if (mine.length && mine.length <= 4) out.push(mine.map((o) => `The ${D.teamName.get(o.t)} ranked ${b(ordinal(ranked.indexOf(o) + 1))} of ${ranked.length}`).join("; ") + ` in ${lab} over ${span}.`);
  }
  // one more line that depends on the split
  if (state.by === "zone" && R.groups.length > 1) {
    const vals = R.groups.map((g, i) => ({ name: g.name, pps: measure("pps", R.byG[i]) })).filter((r) => !isNaN(r.pps));
    const best = d3.greatest(vals, (r) => r.pps), worst = d3.least(vals, (r) => r.pps);
    if (multi) {
      const share = (row) => { const tot = d3.sum(R.groups, (g) => row[ZONES.indexOf(g.key)].fga); return R.groups.map((g) => (tot ? row[ZONES.indexOf(g.key)].fga / tot : NaN)); };
      const f = share(R.bySZ[0]), l = share(R.bySZ[R.bySZ.length - 1]);
      const ch = R.groups.map((g, i) => ({ name: g.name, f: f[i], l: l[i], d: l[i] - f[i] })).filter((c) => !isNaN(c.d));
      const up = d3.greatest(ch, (c) => c.d), down = d3.least(ch, (c) => c.d);
      if (up && down && up !== down) out.push(`Biggest shift: ${down.name} ${down.d < 0 ? "fell" : "rose"} from ${fmt.pct(down.f)} to ${b(fmt.pct(down.l))} of these shots, while ${up.name} ${up.d >= 0 ? "rose" : "fell"} from ${fmt.pct(up.f)} to ${b(fmt.pct(up.l))}.`);
    }
    if (best && worst && best !== worst) out.push(`Best value: ${best.name} at ${b(fmt.pps(best.pps))} points per shot. Worst: ${worst.name} at ${fmt.pps(worst.pps)}.`);
  } else if (state.by === "loc" && R.groups.length === 2) {
    const gap = measure(m, R.byG[0]) - measure(m, R.byG[1]);
    let line = `Home games ${gap >= 0 ? "beat" : "trailed"} away games by ${b(gapText(m, gap))} in ${lab}`;
    if (multi) {
      const per = sIdx.map((x, i) => ({ s: D.seasons[x], g: measure(m, R.bySG[i][0]) - measure(m, R.bySG[i][1]) })).filter((r) => !isNaN(r.g));
      const lo = d3.least(per, (r) => r.g), hi = d3.greatest(per, (r) => r.g);
      line += `; the gap was smallest in ${b(lo.s)} (${gapText(m, lo.g)}) and largest in ${hi.s} (${gapText(m, hi.g)})`;
    }
    out.push(line + ".");
  } else if (state.by === "team" && state.teams.size > 4) {
    const rows = R.groups.map((g, i) => ({ name: g.name, v: measure(m, R.byG[i]) })).filter((r) => !isNaN(r.v));
    const hi = d3.greatest(rows, (r) => r.v), lo = d3.least(rows, (r) => r.v);
    if (hi && lo && hi !== lo) out.push(`Highest ${lab}: the ${hi.name} (${b(M.f(hi.v))}). Lowest: the ${lo.name} (${M.f(lo.v)}).`);
  }
  list.innerHTML = out.map((t) => `<li>${t}</li>`).join("");
}

/* ================================================================== chart 2: bars */
function gapText(m, d) { return m === "pg" ? fmt.signed(d, 1) : m === "pps" ? fmt.signed(d) : fmt.signedPct(d); }
function drawDumbbell(el, W) {
  const m = state.m, M = MEASURES[m];
  const rows = R.sAll.map((s, i) => ({ s, season: D.seasons[s], name: D.leaderName[s], a: R.bySG[i][0], b: R.bySG[i][1], va: measure(m, R.bySG[i][0]), vb: measure(m, R.bySG[i][1]) }))
    .filter((r) => !isNaN(r.va) && !isNaN(r.vb)).reverse();
  if (!rows.length) return emptyNote(el);
  const labelW = Math.min(205, Math.max(120, W * 0.4)), rowH = 22, mg = { t: 6, r: 64, b: 26, l: labelW }, w = W - mg.l - mg.r, h = rowH * rows.length;
  const svg = svgIn(el, W, h + mg.t + mg.b), g = svg.append("g").attr("transform", `translate(${mg.l},${mg.t})`);
  const yb = d3.scaleBand().domain(rows.map((r) => r.s)).range([0, h]);
  const x = d3.scaleLinear().domain([0, d3.max(rows, (r) => Math.max(r.va, r.vb)) * 1.05]).nice().range([0, w]);
  g.append("g").attr("class", "grid").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).ticks(4).tickSize(-h).tickFormat(""));
  g.append("g").attr("class", "axis no-line").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).ticks(4).tickSize(0).tickPadding(8).tickFormat(m === "pps" ? (v) => v.toFixed(1) : M.ax));
  const cy = (r) => yb(r.s) + yb.bandwidth() / 2;
  g.selectAll("text.name").data(rows).join("text").attr("class", "axis-label").attr("x", -10).attr("y", (r) => cy(r) + 4).attr("text-anchor", "end").style("font-size", "11.5px")
    .text((r) => `${shortSeason(r.season)} · ${W < 520 ? r.name.split(" ").slice(-1)[0] : r.name}`);
  const rowG = g.append("g").selectAll("g").data(rows).join("g");
  rowG.append("line").attr("x1", (r) => x(r.vb)).attr("x2", (r) => x(r.va)).attr("y1", cy).attr("y2", cy).attr("stroke", "#5b6272").attr("stroke-width", 3).attr("stroke-linecap", "round");
  rowG.append("circle").attr("cx", (r) => x(r.vb)).attr("cy", cy).attr("r", 5).attr("fill", REST_COLOR).attr("stroke", SURFACE).attr("stroke-width", 2);
  rowG.append("circle").attr("cx", (r) => x(r.va)).attr("cy", cy).attr("r", 6).attr("fill", LEAD_COLOR).attr("stroke", SURFACE).attr("stroke-width", 2);
  rowG.append("text").attr("class", "direct-label").attr("x", (r) => x(Math.max(r.va, r.vb)) + 10).attr("y", (r) => cy(r) + 4).text((r) => gapText(m, r.va - r.vb));
  g.append("g").selectAll("rect").data(rows).join("rect").attr("x", -labelW).attr("width", W).attr("y", (r) => yb(r.s)).attr("height", yb.step()).attr("fill", "transparent")
    .on("pointerenter", (e, r) => rowG.attr("opacity", (q) => (q === r ? 1 : 0.4)))
    .on("pointermove", (e, r) => tip.show(e, tipHTML(r.name, [[`3-point leader`, M.f(r.va), LEAD_COLOR], ["Rest of the league", M.f(r.vb), REST_COLOR], ["Gap", gapText(m, r.va - r.vb)],
      ["Leader’s 3-point share", fmt.pct(measure("share3", r.a))]], { sub: `${r.season} · ${M.label}`, note: "Click to compare this team with the league" })))
    .style("cursor", "pointer")
    .on("click", (e, r) => { tip.hide(); drill({ by: "team", teams: new Set([D.teams[D.leader[r.s]]]) }); })
    .on("pointerleave", () => { rowG.attr("opacity", 1); tip.hide(); });
}

function drawBars(el, W) {
  if (!R.sel.fga) return emptyNote(el);
  if (R.lead) return drawDumbbell(el, W);
  const m = state.m, M = MEASURES[m];
  let rows = R.groups.map((g, i) => ({ ...g, a: R.byG[i], v: measure(m, R.byG[i]) })).filter((r) => !isNaN(r.v));
  if (state.by === "team") rows.sort((a, b) => b.v - a.v);
  if (!rows.length) return emptyNote(el);
  // reference line: the league for teams; all selected shots otherwise (not for zone x per-game,
  // where the all-zone total is a sum, not a comparable average)
  const ref = state.by === "team" ? { name: "League average", v: measure(m, R.league) }
    : state.by === "zone" && m === "pg" ? { name: "", v: NaN } : { name: "All selected shots", v: measure(m, R.sel) };
  const labelW = Math.min(160, Math.max(96, W * 0.3)), rowH = rows.length > 10 ? 20 : 32;
  const mg = { t: 22, r: 58, b: 26, l: labelW }, w = W - mg.l - mg.r, h = rowH * rows.length;
  const svg = svgIn(el, W, h + mg.t + mg.b), g = svg.append("g").attr("transform", `translate(${mg.l},${mg.t})`);
  const yb = d3.scaleBand().domain(rows.map((r) => r.key)).range([0, h]).paddingInner(0.28);
  const x = d3.scaleLinear().domain([0, Math.max(d3.max(rows, (r) => r.v), ref.v || 0) * 1.05]).nice().range([0, w]);
  g.append("g").attr("class", "grid").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).ticks(4).tickSize(-h).tickFormat(""));
  g.append("g").attr("class", "axis no-line").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).ticks(4).tickSize(0).tickPadding(8).tickFormat(M.ax));
  g.selectAll("text.name").data(rows).join("text").attr("class", "axis-label").attr("x", -10).attr("y", (r) => yb(r.key) + yb.bandwidth() / 2 + 4)
    .attr("text-anchor", "end").style("font-size", "12px").style("fill", "#c3c8d4").text((r) => (r.name.length > 22 ? r.name.slice(0, 21) + "…" : r.name));
  const bars = g.append("g").selectAll("path").data(rows).join("path")
    .attr("d", (r) => barRight(0, yb(r.key), Math.max(1, x(r.v)), yb.bandwidth())).attr("fill", (r) => (state.by === "team" && !teamSlots.has(r.key) ? SERIES[0] : r.color));
  g.selectAll("text.val").data(rows).join("text").attr("class", "direct-label").attr("x", (r) => x(r.v) + 6).attr("y", (r) => yb(r.key) + yb.bandwidth() / 2 + 4).text((r) => M.f(r.v));
  if (!isNaN(ref.v)) {
    g.append("line").attr("x1", x(ref.v)).attr("x2", x(ref.v)).attr("y1", -8).attr("y2", h).attr("stroke", LEAGUE_COLOR).attr("stroke-width", 1.5);
    g.append("text").attr("class", "annot").attr("x", x(ref.v)).attr("y", -10).attr("text-anchor", x(ref.v) > w * 0.7 ? "end" : "start").text(`${ref.name}: ${M.f(ref.v)}`);
  }
  g.append("g").selectAll("rect").data(rows).join("rect").attr("x", -labelW).attr("width", W).attr("y", (r) => yb(r.key) - 3).attr("height", yb.step()).attr("fill", "transparent")
    .on("pointerenter", (e, r) => bars.attr("opacity", (b) => (b === r ? 1 : 0.5)))
    .style("cursor", "pointer")
    .on("pointermove", (e, r) => tip.show(e, allNumbersTip(r.name, r.a, `${fmt.int(r.a.games)} team-games`, rows.length > 1 ? `Click to filter to ${groupNoun()}` : undefined)))
    .on("click", (e, r) => { if (rows.length > 1) { tip.hide(); drill(groupFilter(r.key)); } })
    .on("pointerleave", () => { bars.attr("opacity", 1); tip.hide(); });
}

/* ================================================================== chart 3: zone mix */
function drawMix(el, W) {
  if (!R.sel.fga) return emptyNote(el);
  const zonesOn = ZONES.map((z, i) => i).filter((i) => state.zones.has(ZONES[i]));
  document.getElementById("lg4").innerHTML = legendHTML(zonesOn.map((i) => [ZONES[i], ZONE_COLOR[ZONES[i]]]));
  let rows = state.by === "zone"
    ? R.sAll.map((s, i) => ({ key: "s" + s, name: D.seasons[s], parts: R.bySZ[i] }))
    : R.groups.map((g, i) => ({ key: g.key, name: g.name, parts: R.byGZ[i] }));
  if (state.by === "team") rows.push({ key: "league", name: "League", parts: R.leagueZ, league: true });
  rows = rows.filter((r) => d3.sum(r.parts, (a) => a.fga) > 0);
  if (!rows.length) return emptyNote(el);
  const labelW = Math.min(160, Math.max(70, W * 0.18)), rowH = rows.length > 12 ? 18 : 28;
  const mg = { t: 4, r: 10, b: 26, l: labelW }, w = W - mg.l - mg.r, h = rowH * rows.length;
  const svg = svgIn(el, W, h + mg.t + mg.b), g = svg.append("g").attr("transform", `translate(${mg.l},${mg.t})`);
  const yb = d3.scaleBand().domain(rows.map((r) => r.key)).range([0, h]).paddingInner(0.22);
  const x = d3.scaleLinear().domain([0, 1]).range([0, w]);
  g.append("g").attr("class", "axis no-line").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).ticks(5).tickSize(0).tickPadding(8).tickFormat((v) => v * 100 + "%"));
  g.selectAll("text.name").data(rows).join("text").attr("class", "axis-label").attr("x", -8).attr("y", (r) => yb(r.key) + yb.bandwidth() / 2 + 4).attr("text-anchor", "end")
    .style("font-size", "11.5px").style("font-weight", (r) => (r.league ? 700 : 400)).style("fill", (r) => (r.league ? "#f3f4f6" : null))
    .text((r) => (r.name.length > 20 ? r.name.slice(0, 19) + "…" : r.name));
  const segs = [];
  rows.forEach((r) => {
    const tot = d3.sum(zonesOn, (zi) => r.parts[zi].fga); let x0 = 0;
    zonesOn.forEach((zi) => { const a = r.parts[zi], sh = tot ? a.fga / tot : 0; if (sh > 0) segs.push({ r, zi, a, sh, x0 }); x0 += sh; });
  });
  g.append("g").selectAll("rect").data(segs).join("rect")
    .attr("x", (d) => x(d.x0)).attr("y", (d) => yb(d.r.key)).attr("width", (d) => Math.max(0, x(d.x0 + d.sh) - x(d.x0) - 2)).attr("height", yb.bandwidth())
    .attr("fill", (d) => ZONE_COLOR[ZONES[d.zi]])
    .on("pointermove", (e, d) => {
      d3.select(e.currentTarget).attr("stroke", "#fff").attr("stroke-width", 1.5);
      tip.show(e, tipHTML(ZONES[d.zi], [["Share of shots", fmt.pct(d.sh)], ["Shots", fmt.int(d.a.fga)], ["Make rate", fmt.pct(measure("fg", d.a))], ["Points per shot", fmt.pps(measure("pps", d.a))]],
        { sub: d.r.name, note: `Click to filter to ${ZONES[d.zi]}${d.r.league ? "" : ` · ${d.r.name}`}` }));
    })
    .style("cursor", "pointer")
    .on("click", (e, d) => {
      tip.hide();
      const ch = { zones: new Set([ZONES[d.zi]]) };
      if (!d.r.league) {
        if (state.by === "zone") { const si = +d.r.key.slice(1); ch.from = si; ch.to = si; }
        else Object.assign(ch, groupFilter(d.r.key));
      }
      drill(ch);
    })
    .on("pointerleave", (e) => { d3.select(e.currentTarget).attr("stroke", null); tip.hide(); });
  g.append("g").selectAll("text").data(segs.filter((d) => x(d.sh) > 34 && yb.bandwidth() >= 14)).join("text")
    .attr("x", (d) => x(d.x0) + 5).attr("y", (d) => yb(d.r.key) + yb.bandwidth() / 2 + 4).style("font-size", "11px").style("font-weight", 600)
    .style("fill", THEME.ink).style("pointer-events", "none").text((d) => Math.round(d.sh * 100) + "%");
}

/* ================================================================== chart 4: shot map */
function drawMap(el, Wc) {
  const st = state, okT = D.teams.map((t) => st.teams.has(t)), okZ = ZONES.map((z) => st.zones.has(z)), okL = LOCS.map((l) => st.locs.has(l));
  const agg = new Map(); let total = 0;
  for (const b of D.B) {
    if (b.s < st.from || b.s > st.to || !okZ[b.z] || !okL[b.l] || !(st.by === "leader" ? D.leader[b.s] === b.t : okT[b.t])) continue;
    let o = agg.get(b.h);
    if (!o) { o = { x: D.hexes[b.h][0], y: D.hexes[b.h][1], n: 0, m: 0, p: 0 }; agg.set(b.h, o); }
    o.n += b.n; o.m += b.m; o.p += b.p; total += b.n;
  }
  document.getElementById("lg-map").innerHTML = `${ppsLegend()}<span class="legend-item">${fmt.int(total)} shots mapped${st.by === "leader" ? " · the 3-point leaders only" : ""}</span>`;
  if (!total) return emptyNote(el);
  const hexes = Array.from(agg.values()).filter((o) => o.n >= Math.max(3, total * 0.00004));
  hexes.forEach((o) => (o.share = o.n / total));
  const cap = d3.quantile(hexes.map((o) => o.share).sort(d3.ascending), 0.9) || 1;
  const W = Math.min(Wc, 620), S = courtScales(W);
  const svg = svgIn(el, W, S.height);
  svg.append("rect").attr("width", W).attr("height", S.height).attr("fill", THEME.court).attr("rx", 10);
  const size = d3.scaleSqrt().domain([0, cap]).range([0, 1.6 * S.k]).clamp(true);
  svg.append("g").selectAll("path").data(hexes).join("path")
    .attr("transform", (o) => `translate(${S.sx(o.x)},${S.sy(o.y)})`).attr("d", (o) => hexPath(size(o.share)))
    .attr("fill", (o) => ppsColor(o.p / o.n)).attr("stroke", THEME.court).attr("stroke-width", 0.5)
    .on("pointermove", (e, o) => {
      d3.select(e.currentTarget).attr("stroke", "#fff").attr("stroke-width", 1.5).raise();
      tip.show(e, tipHTML(zoneOf(o.x, o.y), [["Share of selected shots", fmt.pct(o.share, 2)], ["Shots", fmt.int(o.n)], ["Make rate", fmt.pct(o.m / o.n)], ["Points per shot", fmt.pps(o.p / o.n), ppsColor(o.p / o.n)]],
        { sub: `about ${Math.hypot(o.x, o.y - COURT.hoopY).toFixed(0)} ft from the rim`, note: (o.n < 25 ? "Few shots here: the color is unreliable · " : "") + `Click to filter to ${zoneOf(o.x, o.y)}` }));
    })
    .style("cursor", "pointer")
    .on("click", (e, o) => { tip.hide(); drill({ zones: new Set([zoneOf(o.x, o.y)]) }); })
    .on("pointerleave", (e) => { d3.select(e.currentTarget).attr("stroke", THEME.court).attr("stroke-width", 0.5); tip.hide(); });
  drawCourt(svg, S);
}

/* ================================================================== table */
let sortKey = null, sortDir = -1;
const COLS = [["name", "Group"], ["fga", "Shots"], ["fgm", "Made"], ...Object.entries(MEASURES).map(([k, m]) => [k, m.label])];
const rowOf = (name, a, extra = {}) => ({ name, fga: a.fga, fgm: a.fgm, ...Object.fromEntries(Object.keys(MEASURES).map((k) => [k, measure(k, a)])), ...extra });
function leaderRows() {
  return R.sAll.map((s, i) => ({ season: D.seasons[s], name: D.leaderName[s], a: R.bySG[i][0], b: R.bySG[i][1] })).filter((r) => r.a.fga && r.b.fga);
}
function renderLeaderTable(t) {
  const m = state.m, M = MEASURES[m], rows = leaderRows();
  const extra = m !== "share3";   // also show the 3-point shares unless they're already the measure
  const cells = (r, label, name) => `<td>${label}</td><td style="text-align:left">${name}</td><td>${M.f(measure(m, r.a))}</td><td>${M.f(measure(m, r.b))}</td><td>${gapText(m, measure(m, r.a) - measure(m, r.b))}</td>` +
    (extra ? `<td>${fmt.pct(measure("share3", r.a))}</td><td>${fmt.pct(measure("share3", r.b))}</td>` : "");
  t.innerHTML = `<thead><tr><th>Season</th><th style="text-align:left">3-point leader</th><th style="color:var(--accent)">Leader: ${M.label}</th><th>Rest: ${M.label}</th><th>Gap</th>${extra ? "<th>Leader 3PA share</th><th>Rest 3PA share</th>" : ""}</tr></thead>
    <tbody>${rows.map((r) => `<tr class="clicky" data-team="${D.teams[D.leader[D.seasons.indexOf(r.season)]]}" title="Click to compare ${r.name} with the league">${cells(r, r.season, r.name)}</tr>`).join("")}</tbody>
    <tfoot><tr>${cells({ a: R.byG[0], b: R.byG[1] }, "All selected seasons", "All leaders combined")}</tr></tfoot>`;
  t.querySelectorAll("tbody tr[data-team]").forEach((row) => row.addEventListener("click", () => drill({ by: "team", teams: new Set([row.dataset.team]) })));
}
function renderTable() {
  const t = document.getElementById("tbl");
  if (!R.sel.fga) { t.innerHTML = `<tbody><tr><td class="empty-note">No shots match these filters.</td></tr></tbody>`; return; }
  if (R.lead) return renderLeaderTable(t);
  const rows = R.groups.map((g, i) => rowOf(g.name, R.byG[i], { key: g.key, color: state.by === "team" && !teamSlots.has(g.key) ? null : g.color })).filter((r) => r.fga > 0);
  if (sortKey) rows.sort((a, b) => (sortKey === "name" ? sortDir * d3.ascending(a.name, b.name) : sortDir * ((a[sortKey] || 0) - (b[sortKey] || 0))));
  const fmtCol = (k, v) => (k === "fga" || k === "fgm" ? fmt.int(v) : isNaN(v) ? "–" : MEASURES[k].f(v));
  const tr = (r, cls = "") => `<tr class="${cls}"${r.key ? ` data-key="${r.key}" title="Click to filter to ${r.name}"` : ""}>${COLS.map(([k]) => (k === "name" ? `<td>${r.color ? `<i class="cell-swatch" style="background:${r.color}"></i>` : ""}${r.name}</td>` : `<td>${fmtCol(k, r[k])}</td>`)).join("")}</tr>`;
  t.innerHTML = `<thead><tr>${COLS.map(([k, l]) => `<th scope="col" data-k="${k}" aria-sort="${sortKey === k ? (sortDir > 0 ? "ascending" : "descending") : "none"}" style="${k === state.m ? "color:var(--accent)" : ""}">${k === "name" ? BY[state.by].label : l}${sortKey === k ? `<span class="arrow">${sortDir > 0 ? "▲" : "▼"}</span>` : ""}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => tr(r)).join("")}</tbody>
    <tfoot>${tr(rowOf("Your selection", R.sel))}${tr(rowOf("Whole league (same seasons, zones, games)", R.league), "league")}</tfoot>`;
  if (rows.length > 1) t.querySelectorAll("tbody tr[data-key]").forEach((row) => { row.classList.add("clicky"); row.addEventListener("click", () => drill(groupFilter(row.dataset.key))); });
  t.querySelectorAll("th").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.k;
    if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = k === "name" ? 1 : -1; }
    renderTable();
  }));
}
function downloadCSV() {
  if (!R || !R.sel.fga) return;
  if (R.lead) {
    const ks = Object.keys(MEASURES), head = ["Season", "3-point leader", ...ks.flatMap((k) => [`Leader ${MEASURES[k].label}`, `Rest ${MEASURES[k].label}`])];
    const lines = leaderRows().map((r) => [r.season, `"${r.name}"`, ...ks.flatMap((k) => [measure(k, r.a), measure(k, r.b)].map((v) => v.toFixed(4)))].join(","));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" }));
    a.download = `nba-shots_3pt-leaders_${D.seasons[state.from]}_${D.seasons[state.to]}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    return;
  }
  const rows = [...R.groups.map((g, i) => rowOf(g.name, R.byG[i])).filter((r) => r.fga > 0), rowOf("Your selection", R.sel), rowOf("Whole league", R.league)];
  const head = [BY[state.by].label, "Shots", "Made", "Shots per team-game", "Make rate", "Points per shot", "3-point share"];
  const line = (r) => [`"${r.name}"`, r.fga, r.fgm, r.pg, r.fg, r.pps, r.share3].map((v) => (typeof v === "number" ? (Number.isInteger(v) ? v : v.toFixed(4)) : v)).join(",");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([[head.join(","), ...rows.map(line)].join("\n")], { type: "text/csv" }));
  a.download = `nba-shots_${D.seasons[state.from]}_${D.seasons[state.to]}_by-${state.by}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
}
