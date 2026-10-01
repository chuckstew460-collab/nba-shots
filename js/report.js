/* Report page (index.html): every chart reads data/processed/report.json,
   which scripts/process_data.py builds from the raw shot files. */

const SURFACE = "#161a23";

/* ------------------------------------------------------------------ small helpers */
function svgIn(el, w, h) {
  const host = d3.select(el);
  host.selectAll("svg").remove();
  return host.append("svg").attr("width", w).attr("height", h).attr("viewBox", `0 0 ${w} ${h}`);
}
// bar with rounded data-end (top), square at the baseline
function barUp(x, y, w, h, r = 4) {
  if (h <= 0) return "";
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
// horizontal bar rounded at the right end
function barRight(x, y, w, h, r = 4) {
  if (w <= 0) return "";
  r = Math.min(r, h / 2, w);
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
}
function gridY(g, y, w, ticks, f) {
  g.append("g").attr("class", "grid").call(d3.axisLeft(y).ticks(ticks).tickSize(-w).tickFormat(""));
  g.append("g").attr("class", "axis no-line").call(d3.axisLeft(y).ticks(ticks).tickSize(0).tickPadding(8).tickFormat(f));
}
function seasonAxis(g, x, h, w) {
  const every = w < 520 ? 4 : w < 860 ? 2 : 1;
  const ax = d3.axisBottom(x).tickSize(0).tickPadding(8)
    .tickFormat((s, i) => ((x.domain().length - 1 - i) % every === 0 ? shortSeason(s) : ""));
  g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`).call(ax);
}
// avoid overlapping direct labels on the right edge
function spreadLabels(items, minGap, lo, hi) {
  items.sort((a, b) => a.y - b.y);
  for (let i = 1; i < items.length; i++) if (items[i].y - items[i - 1].y < minGap) items[i].y = items[i - 1].y + minGap;
  const over = items.length ? items[items.length - 1].y - hi : 0;
  if (over > 0) items.forEach((d) => (d.y -= over));
  for (let i = items.length - 2; i >= 0; i--) if (items[i + 1].y - items[i].y < minGap) items[i].y = items[i + 1].y - minGap;
  items.forEach((d) => (d.y = Math.max(lo, d.y)));
  return items;
}

d3.json("data/processed/report.json").then((R) => {
  const seasons = R.seasons;
  const L = R.league;
  const byS = new Map(L.map((d) => [d.season, d]));
  const zoneRows = R.zones;
  const zoneBy = d3.group(zoneRows, (d) => d.season);
  const zget = (s, z) => zoneBy.get(s).find((r) => r.zone === z);

  tiles(R, L, seasons, zget);
  volume(L);
  timeline(R, L, seasons, zget);
  zonesArea(seasons, zget);
  distanceCurve(R.distance);
  distHist(R.dist_hist, seasons, byS);
  zonePPS(seasons, zget);
  teamHeat(R.teams, seasons);
  scatter(R.teams, seasons);
  volumeShooters(R.volume_shooters, R.three_leaders);
  topSeasons(R.top_3pm_seasons);
  actions(R.actions, L);
  clutch(R.periods, R.clutch);
  homeCourt(R.home_away, seasons);
}).catch((err) => {
  console.error(err);
  document.querySelector("main").insertAdjacentHTML("afterbegin",
    `<div class="wrap"><p class="callout">Could not load the data file (data/processed/report.json). If you opened this page straight from disk, run a local server instead, e.g. <code>python -m http.server</code>.</p></div>`);
});

/* ================================================================== headline tiles */
function tiles(R, L, seasons, zget) {
  const H = R.headline, first = L[0], last = L[L.length - 1];
  const mid = seasons.map((s) => zget(s, "Mid-range").share);
  const defs = [
    { label: "Shots analyzed", value: fmt.short(H.total_shots), note: `${seasons.length} seasons · ${fmt.int(H.games)} games · ${fmt.int(H.players)} players` },
    { label: "3-point attempts per team-game, 2024-25", value: fmt.num(last.fg3a_pg), note: `up from ${fmt.num(first.fg3a_pg)} in 2003-04`, series: L.map((d) => d.fg3a_pg), f: (v) => fmt.num(v) },
    { label: "Share of shots from mid-range, 2024-25", value: fmt.pct(H.mid_share_last), note: `down from ${fmt.pct(H.mid_share_first)} in 2003-04`, series: mid, f: (v) => fmt.pct(v) },
    { label: "Share of shots that were threes, 2024-25", value: fmt.pct(last.three_share), note: `up from ${fmt.pct(first.three_share)} in 2003-04`, series: L.map((d) => d.three_share), f: (v) => fmt.pct(v) },
    { label: "Points per shot, 2024-25", value: fmt.pps(last.pps), note: `up from ${fmt.pps(first.pps)} in 2003-04`, series: L.map((d) => d.pps), f: fmt.pps },
    { label: "Average shot distance, 2024-25", value: `${fmt.num(last.avg_dist)}<small>ft</small>`, note: `up from ${fmt.num(first.avg_dist)} ft in 2003-04`, series: L.map((d) => d.avg_dist), f: fmt.ft },
  ];
  const host = document.getElementById("tiles");
  host.innerHTML = defs.map((d, i) => `<div class="tile"><div class="tile-label">${d.label}</div><div class="tile-value">${d.value}</div><div class="tile-note">${d.note}</div>${d.series ? `<div class="spark" data-i="${i}"></div>` : ""}</div>`).join("");
  host.querySelectorAll(".spark").forEach((el) => {
    const d = defs[+el.dataset.i];
    responsive(el, (w) => sparkline(el, w, d.series, seasons, d.f, d.label));
  });
}

function sparkline(el, w, series, seasons, f, label) {
  const h = 36, svg = svgIn(el, w, h).attr("class", "tile-spark");
  const x = d3.scaleLinear().domain([0, series.length - 1]).range([3, w - 3]);
  const y = d3.scaleLinear().domain(d3.extent(series)).range([h - 4, 4]);
  const line = d3.line().x((_, i) => x(i)).y((v) => y(v)).curve(d3.curveMonotoneX);
  svg.append("path").attr("d", line(series)).attr("fill", "none").attr("stroke", ACCENT).attr("stroke-width", 2);
  svg.append("circle").attr("cx", x(series.length - 1)).attr("cy", y(series[series.length - 1])).attr("r", 3).attr("fill", ACCENT);
  const dot = svg.append("circle").attr("r", 4).attr("fill", ACCENT).attr("stroke", SURFACE).attr("stroke-width", 2).attr("opacity", 0);
  svg.append("rect").attr("width", w).attr("height", h).attr("fill", "transparent")
    .on("pointermove", (e) => {
      const i = Math.max(0, Math.min(series.length - 1, Math.round(x.invert(d3.pointer(e)[0]))));
      dot.attr("cx", x(i)).attr("cy", y(series[i])).attr("opacity", 1);
      tip.show(e, tipHTML(seasons[i], [[label.replace(/, 2024-25$/, ""), f(series[i])]]));
    })
    .on("pointerleave", () => { dot.attr("opacity", 0); tip.hide(); });
}

/* ================================================================== 1. volume */
function volume(L) {
  const el = document.getElementById("c-volume");
  responsive(el, (W) => {
    const m = { t: 24, r: 12, b: 30, l: 40 }, w = W - m.l - m.r, h = 300;
    const svg = svgIn(el, W, h + m.t + m.b), g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
    const x = d3.scaleBand().domain(L.map((d) => d.season)).range([0, w]).paddingInner(0.22);
    const y = d3.scaleLinear().domain([0, 40]).range([h, 0]);
    gridY(g, y, w, 4, (v) => v);
    seasonAxis(g, x, h, w);
    const bars = g.append("g").selectAll("path").data(L).join("path")
      .attr("d", (d) => barUp(x(d.season), y(d.fg3a_pg), x.bandwidth(), h - y(d.fg3a_pg)))
      .attr("fill", ZONE_COLOR["Above-break 3"]);
    // direct labels: first and last
    [L[0], L[L.length - 1]].forEach((d) => g.append("text").attr("class", "direct-label").attr("text-anchor", "middle")
      .attr("x", x(d.season) + x.bandwidth() / 2).attr("y", y(d.fg3a_pg) - 7).text(fmt.num(d.fg3a_pg)));
    g.append("g").selectAll("rect").data(L).join("rect")
      .attr("x", (d) => x(d.season) - (x.step() - x.bandwidth()) / 2).attr("width", x.step()).attr("y", 0).attr("height", h)
      .attr("fill", "transparent")
      .on("pointerenter", (e, d) => bars.attr("opacity", (b) => (b === d ? 1 : 0.45)))
      .on("pointermove", (e, d) => tip.show(e, tipHTML(d.season, [
        ["3PA per team-game", fmt.num(d.fg3a_pg)],
        ["3PM per team-game", fmt.num(d.fg3m / d.team_games)],
        ["3-point %", fmt.pct(d.fg3_pct)],
        ["Share of all shots", fmt.pct(d.three_share)],
        ["Games", fmt.int(d.games)],
      ])))
      .on("pointerleave", () => { bars.attr("opacity", 1); tip.hide(); });
  });
  dataTable(document.getElementById("t-volume"), L, [
    ["Season", (d) => d.season], ["Games", (d) => d.games, fmt.int], ["3PA / team-game", (d) => d.fg3a_pg, (v) => fmt.num(v)],
    ["3PM / team-game", (d) => d.fg3m / d.team_games, (v) => fmt.num(v)], ["3P%", (d) => d.fg3_pct, fmt.pct],
    ["3PA share", (d) => d.three_share, fmt.pct], ["Total 3PA", (d) => d.fg3a, fmt.int],
  ]);
}

/* ================================================================== 2. timeline */
const MILESTONES = {
  "2003-04": { tag: "The starting point", title: "A mid-range league",
    text: "More than a third of all shots (35.7%) are mid-range twos and only 18.6% are threes. The Seattle SuperSonics lead the league with 29.2% of their shots from deep, and Peja Stojakovic leads all players with 240 made threes." },
  "2004-05": { tag: "Seven Seconds or Less", title: "Phoenix speeds up",
    text: "Mike D’Antoni’s Suns push the pace and spread the floor with shooters. They lead the league in 3-point share (28.6%), and Steve Nash wins the first of back-to-back MVP awards." },
  "2005-06": { tag: "Record", title: "Ray Allen hits 269",
    text: "Ray Allen makes 269 threes for Seattle, the single-season record at the time. League-wide, threes are still only 20.1% of shots." },
  "2008-09": { tag: "Four out, one in", title: "Orlando surrounds Dwight Howard with shooters",
    text: "Stan Van Gundy’s Magic put four shooters around Howard, lead the league in 3-point share (33.4%) and reach the NBA Finals. Orlando leads the league in 3-point share five straight seasons, from 2007-08 to 2011-12." },
  "2011-12": { tag: "Lockout", title: "A 66-game season",
    text: "The lockout cuts the season to 66 games, so totals dip. Only 11 players attempt 300 threes. Shares keep climbing: threes reach 22.4% of shots." },
  "2012-13": { tag: "Two arrivals", title: "Harden to Houston, Curry breaks the record",
    text: "Houston trades for James Harden in October 2012. Stephen Curry makes 272 threes, breaking Ray Allen’s record, and the league’s 3-point share jumps to 24.2%." },
  "2014-15": { tag: "The crossover", title: "Threes overtake the mid-range",
    text: "For the first time, teams take more threes (26.7% of shots) than mid-range twos (26.2%). Golden State wins the title, Curry wins MVP with 286 threes, and Houston leads the league at 39.1% from deep." },
  "2015-16": { tag: "Unanimous", title: "Curry’s 402",
    text: "Curry makes 402 threes (401 in this data) on 45.4% shooting and becomes the first unanimous MVP as the Warriors go 73–9. His mark is still the single-season record." },
  "2016-17": { tag: "Moreyball", title: "D’Antoni comes to Houston",
    text: "D’Antoni takes over in Houston and moves Harden to point guard. The Rockets take 46.2% of their shots from three, and the league’s 3-point attempts per game jump by 2.9." },
  "2017-18": { tag: "Half and half", title: "The first 50% team",
    text: "Houston becomes the first team in this data to take half of its shots from three (50.1%). Mid-range shots fall below 20% of the league’s attempts (19.1%)." },
  "2018-19": { tag: "Step-back era", title: "Harden attempts 1,028 threes",
    text: "Harden attempts 1,028 threes, the most in a season, many of them step-backs. The mid-range falls to 15.2% of shots, and league 3PA per game jumps by 3.0, the biggest one-year rise in the data." },
  "2019-20": { tag: "The bubble", title: "COVID-19 stops the season",
    text: "The season is suspended in March 2020 and finished in a bubble near Orlando. Threes reach 38.3% of all shots." },
  "2020-21": { tag: "Empty arenas", title: "A 72-game season without crowds",
    text: "Most games are played in empty or limited-capacity arenas. The home-court edge in points per shot falls to its smallest in the data (0.011)." },
  "2023-24": { tag: "Champions from deep", title: "Boston wins it all",
    text: "The Celtics lead the league with 47.0% of their shots from three and win the title. Curry, at 35, makes 357 threes." },
  "2024-25": { tag: "Today", title: "A record 53.5%",
    text: "Boston takes 53.5% of its shots from three, a record. League-wide, threes are 42.0% of shots and the mid-range is down to 9.8%. Anthony Edwards leads all players with 320 made threes." },
};

function timeline(R, L, seasons, zget) {
  const byS = new Map(L.map((d) => [d.season, d]));
  const teamsBy = d3.group(R.teams, (d) => d.season);
  const leaderBy = new Map(R.three_leaders.map((d) => [d.season, d]));
  const hex = R.hex;   // season -> [[hx, hy, share, n, fgm, pts], ...]
  let idx = 0, playing = null;

  const courtEl = document.getElementById("tl-court");
  const trackEl = document.getElementById("tl-track");
  const miniEl = document.getElementById("tl-mini");
  document.getElementById("tl-legend").innerHTML =
    `${ppsLegend()}<span class="legend-item">Bigger hexagon = more shots from that spot</span>`;
  document.getElementById("tl-mini-legend").innerHTML =
    legendHTML([["3-pointers", ZONE_COLOR["Above-break 3"]], ["Mid-range", ZONE_COLOR["Mid-range"]]], { line: true });

  // size scale shared by all seasons so growth/shrink is comparable
  const allShares = Object.values(hex).flat().map((d) => d[2]);
  const shareCap = d3.quantile(allShares.sort(d3.ascending), 0.9);

  let court = null, mini = null, track = null;

  responsive(courtEl, (W) => {
    const S = courtScales(W);
    const svg = svgIn(courtEl, W, S.height);
    svg.append("rect").attr("width", W).attr("height", S.height).attr("fill", "#121620").attr("rx", 10);
    const hexG = svg.append("g");
    drawCourt(svg, S);
    const rMax = 1.1 * S.k;
    court = { S, hexG, size: d3.scaleSqrt().domain([0, shareCap]).range([0, rMax]).clamp(true) };
    drawHexes(false);
  });

  function drawHexes(animate) {
    if (!court) return;
    const { S, hexG, size } = court;
    const data = hex[seasons[idx]];
    const sel = hexG.selectAll("path").data(data, (d) => d[0] + "," + d[1]);
    const t = animate ? d3.transition().duration(550).ease(d3.easeCubicOut) : null;
    sel.exit().call((s) => (t ? s.transition(t).attr("d", hexPath(0)).remove() : s.remove()));
    const enter = sel.enter().append("path")
      .attr("transform", (d) => `translate(${S.sx(d[0])},${S.sy(d[1])})`)
      .attr("d", hexPath(0))
      .attr("stroke", "#121620").attr("stroke-width", 0.5)
      .on("pointermove", (e, d) => {
        const dist = Math.hypot(d[0], d[1] - COURT.hoopY);
        tip.show(e, tipHTML(zoneOf(d[0], d[1]), [
          ["Share of league shots", fmt.pct(d[2], 2)],
          ["Attempts", fmt.int(d[3])],
          ["Make rate", fmt.pct(d[4] / d[3])],
          ["Points per shot", fmt.pps(d[5] / d[3]), ppsColor(d[5] / d[3])],
        ], { sub: `${seasons[idx]} · about ${dist.toFixed(0)} ft from the rim` }));
        d3.select(e.currentTarget).attr("stroke", "#fff").attr("stroke-width", 1.5).raise();
      })
      .on("pointerleave", (e) => { tip.hide(); d3.select(e.currentTarget).attr("stroke", "#121620").attr("stroke-width", 0.5); });
    const all = enter.merge(sel);
    (t ? all.transition(t) : all)
      .attr("d", (d) => hexPath(size(d[2])))
      .attr("fill", (d) => ppsColor(d[5] / d[3]));
  }

  responsive(miniEl, (W) => {
    const m = { t: 10, r: 46, b: 26, l: 36 }, w = W - m.l - m.r, h = 120;
    const svg = svgIn(miniEl, W, h + m.t + m.b), g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
    const x = d3.scalePoint().domain(seasons).range([0, w]);
    const y = d3.scaleLinear().domain([0, 0.45]).range([h, 0]);
    gridY(g, y, w, 3, (v) => Math.round(v * 100) + "%");
    const ax = d3.axisBottom(x).tickSize(0).tickPadding(8).tickFormat((s, i) => (i % 7 === 0 || i === seasons.length - 1 ? s : ""));
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`).call(ax);
    const three = seasons.map((s) => byS.get(s).three_share), mid = seasons.map((s) => zget(s, "Mid-range").share);
    const line = d3.line().x((_, i) => x(seasons[i])).y((v) => y(v)).curve(d3.curveMonotoneX);
    g.append("path").attr("d", line(three)).attr("fill", "none").attr("stroke", ZONE_COLOR["Above-break 3"]).attr("stroke-width", 2);
    g.append("path").attr("d", line(mid)).attr("fill", "none").attr("stroke", ZONE_COLOR["Mid-range"]).attr("stroke-width", 2);
    g.append("text").attr("class", "direct-label").attr("x", w + 6).attr("y", y(three.at(-1)) + 4).text(fmt.pct(three.at(-1), 0));
    g.append("text").attr("class", "direct-label").attr("x", w + 6).attr("y", y(mid.at(-1)) + 4).text(fmt.pct(mid.at(-1), 0));
    const cursor = g.append("line").attr("class", "crosshair").attr("y1", 0).attr("y2", h);
    const d1 = g.append("circle").attr("r", 4.5).attr("fill", ZONE_COLOR["Above-break 3"]).attr("stroke", SURFACE).attr("stroke-width", 2);
    const d2 = g.append("circle").attr("r", 4.5).attr("fill", ZONE_COLOR["Mid-range"]).attr("stroke", SURFACE).attr("stroke-width", 2);
    g.append("rect").attr("width", w).attr("height", h).attr("fill", "transparent").style("cursor", "pointer")
      .on("pointermove", (e) => {
        const i = nearestIndex(x, seasons, d3.pointer(e)[0]);
        tip.show(e, tipHTML(seasons[i], [["3-pointers", fmt.pct(three[i]), ZONE_COLOR["Above-break 3"]], ["Mid-range", fmt.pct(mid[i]), ZONE_COLOR["Mid-range"]]], { note: "Click to jump to this season" }));
      })
      .on("pointerleave", () => tip.hide())
      .on("click", (e) => setSeason(nearestIndex(x, seasons, d3.pointer(e)[0]), true));
    mini = { update() { const X = x(seasons[idx]); cursor.attr("x1", X).attr("x2", X); d1.attr("cx", X).attr("cy", y(three[idx])); d2.attr("cx", X).attr("cy", y(mid[idx])); } };
    mini.update();
  });

  responsive(trackEl, (W) => {
    const m = { l: 14, r: 14 }, w = W - m.l - m.r, h = 64;
    const svg = svgIn(trackEl, W, h);
    const g = svg.append("g").attr("transform", `translate(${m.l},0)`);
    const x = d3.scalePoint().domain(seasons).range([0, w]);
    const yLine = 22;
    g.append("line").attr("x1", 0).attr("x2", w).attr("y1", yLine).attr("y2", yLine).attr("stroke", "#3a4152").attr("stroke-width", 4).attr("stroke-linecap", "round");
    const progress = g.append("line").attr("x1", 0).attr("y1", yLine).attr("y2", yLine).attr("stroke", ACCENT).attr("stroke-width", 4).attr("stroke-linecap", "round");
    const every = w < 480 ? 4 : w < 760 ? 2 : 1;
    g.selectAll("text.tick").data(seasons).join("text").attr("class", "axis-label")
      .attr("x", (s) => x(s)).attr("y", 52).attr("text-anchor", "middle")
      .text((s, i) => (i % every === 0 || i === seasons.length - 1 ? shortSeason(s) : ""));
    g.selectAll("circle.tick").data(seasons).join("circle")
      .attr("cx", (s) => x(s)).attr("cy", yLine).attr("r", (s) => (MILESTONES[s] ? 5 : 2.5))
      .attr("fill", (s) => (MILESTONES[s] ? ACCENT : "#8a91a0")).attr("stroke", SURFACE).attr("stroke-width", (s) => (MILESTONES[s] ? 2 : 0));
    const handle = g.append("g").attr("class", "tl-handle");
    handle.append("circle").attr("r", 13).attr("fill", ACCENT).attr("opacity", 0.25);
    handle.append("circle").attr("r", 8).attr("fill", ACCENT).attr("stroke", "#fff").attr("stroke-width", 2);
    // whole track is the drag/click target (bigger than the handle)
    const hit = svg.append("rect").attr("width", W).attr("height", h).attr("fill", "transparent");
    const pick = (e) => nearestIndex(x, seasons, d3.pointer(e, g.node())[0]);
    hit.call(d3.drag()
      .on("start", (e) => { stop(); setSeason(pick(e.sourceEvent), true); })
      .on("drag", (e) => { const i = pick(e.sourceEvent); if (i !== idx) setSeason(i, true); }))
      .on("pointermove", (e) => {
        const s = seasons[pick(e)], ms = MILESTONES[s];
        tip.show(e, tipHTML(s, [], { sub: ms ? `${ms.tag}: ${ms.title}` : "Drag or click to jump here" }));
      })
      .on("pointerleave", () => tip.hide());
    track = { update() { const X = x(seasons[idx]); handle.attr("transform", `translate(${X},${yLine})`); progress.attr("x2", X); } };
    track.update();
  });

  function nearestIndex(x, domain, px) {
    let best = 0, bd = Infinity;
    domain.forEach((s, i) => { const dd = Math.abs(x(s) - px); if (dd < bd) { bd = dd; best = i; } });
    return best;
  }

  function story() {
    const s = seasons[idx], d = byS.get(s), ms = MILESTONES[s];
    const lead = leaderBy.get(s);
    const top = teamsBy.get(s).slice().sort((a, b) => b.three_share - a.three_share)[0];
    const card = document.getElementById("tl-card");
    card.innerHTML = ms
      ? `<div class="tl-tag">${ms.tag}</div><h3>${ms.title}</h3><p>${ms.text}</p>`
      : `<div class="tl-tag">${s}</div><h3>The arc keeps pulling shots outward</h3><p>Threes are ${fmt.pct(d.three_share)} of all shots and the mid-range ${fmt.pct(zget(s, "Mid-range").share)}. ${top.name_then} take the biggest share of threes (${fmt.pct(top.three_share)}); ${lead.PLAYER_NAME} leads all players with ${lead.fg3m} made threes.</p>`;
    const f = byS.get(seasons[0]);
    const delta = (v, v0, isPct) => (idx === 0 ? "2003-04 baseline" : `${isPct ? fmt.signedPct(v - v0) : fmt.signed(v - v0, 1)} vs 2003-04`);
    document.getElementById("tl-stats").innerHTML = [
      ["3PA per team-game", fmt.num(d.fg3a_pg), delta(d.fg3a_pg, f.fg3a_pg)],
      ["3-point share", fmt.pct(d.three_share), delta(d.three_share, f.three_share, true)],
      ["Mid-range share", fmt.pct(zget(s, "Mid-range").share), delta(zget(s, "Mid-range").share, zget(seasons[0], "Mid-range").share, true)],
    ].map(([k, v, n]) => `<div class="tl-stat"><div class="k">${k}</div><div class="v">${v}</div><div class="tile-delta">${n}</div></div>`).join("");
    document.getElementById("tl-season").innerHTML = `${s}<small>${fmt.int(d.fga)} shots · ${fmt.int(d.games)} games</small>`;
    trackEl.setAttribute("aria-valuenow", idx);
    trackEl.setAttribute("aria-valuetext", s);
  }

  function setSeason(i, animate) {
    idx = Math.max(0, Math.min(seasons.length - 1, i));
    drawHexes(animate);
    story();
    mini && mini.update();
    track && track.update();
  }

  const playBtn = document.getElementById("tl-play"), icon = document.getElementById("tl-play-icon");
  function stop() {
    if (playing) clearInterval(playing);
    playing = null;
    icon.setAttribute("d", "M4 2l12 7-12 7z");
    playBtn.setAttribute("aria-label", "Play timeline");
  }
  function play() {
    if (idx >= seasons.length - 1) setSeason(0, true);
    icon.setAttribute("d", "M3 2h4v14H3zM11 2h4v14h-4z");
    playBtn.setAttribute("aria-label", "Pause timeline");
    playing = setInterval(() => {
      if (idx >= seasons.length - 1) return stop();
      setSeason(idx + 1, true);
    }, 1300);
  }
  playBtn.addEventListener("click", () => (playing ? stop() : play()));
  trackEl.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowUp") { stop(); setSeason(idx + 1, true); e.preventDefault(); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") { stop(); setSeason(idx - 1, true); e.preventDefault(); }
    else if (e.key === "Home") { stop(); setSeason(0, true); e.preventDefault(); }
    else if (e.key === "End") { stop(); setSeason(seasons.length - 1, true); e.preventDefault(); }
    else if (e.key === " ") { playing ? stop() : play(); e.preventDefault(); }
  });

  // autoplay once when the timeline first scrolls into view (skipped for reduced motion)
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduce && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) { io.disconnect(); if (idx === 0 && !playing) play(); }
    }, { threshold: 0.55 });
    io.observe(document.getElementById("timeline"));
  }

  setSeason(0, false);

  dataTable(document.getElementById("t-timeline"), L, [
    ["Season", (d) => d.season], ["Shots", (d) => d.fga, fmt.int], ["3PA / team-game", (d) => d.fg3a_pg, (v) => fmt.num(v)],
    ["3-point share", (d) => d.three_share, fmt.pct], ["Mid-range share", (d) => zget(d.season, "Mid-range").share, fmt.pct],
    ["Points per shot", (d) => d.pps, fmt.pps], ["eFG%", (d) => d.efg, fmt.pct],
  ], { caption: "Show the league numbers for every season" });
}

/* ================================================================== 3. zone shares */
function zonesArea(seasons, zget) {
  const el = document.getElementById("c-zones");
  document.getElementById("l-zones").innerHTML = legendHTML(ZONES.map((z) => [z, ZONE_COLOR[z]]));
  const rows = seasons.map((s) => Object.fromEntries([["season", s], ...ZONES.map((z) => [z, zget(s, z).share])]));
  const stack = d3.stack().keys(ZONES)(rows);
  responsive(el, (W) => {
    const m = { t: 10, r: W < 560 ? 12 : 118, b: 30, l: 40 }, w = W - m.l - m.r, h = 340;
    const svg = svgIn(el, W, h + m.t + m.b), g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
    const x = d3.scalePoint().domain(seasons).range([0, w]);
    const y = d3.scaleLinear().domain([0, 1]).range([h, 0]);
    const area = d3.area().x((d) => x(d.data.season)).y0((d) => y(d[0])).y1((d) => y(d[1])).curve(d3.curveMonotoneX);
    g.append("g").selectAll("path").data(stack).join("path")
      .attr("d", area).attr("fill", (d) => ZONE_COLOR[d.key]).attr("stroke", SURFACE).attr("stroke-width", 2);
    g.append("g").attr("class", "axis no-line").call(d3.axisLeft(y).ticks(5).tickSize(0).tickPadding(8).tickFormat((v) => v * 100 + "%"));
    seasonAxis(g, x, h, w);
    if (W >= 560) {
      stack.forEach((layer) => {
        const last = layer[layer.length - 1], mid = (y(last[0]) + y(last[1])) / 2;
        g.append("text").attr("class", "direct-label").attr("x", w + 8).attr("y", mid + 4)
          .text(`${layer.key} ${fmt.pct(last[1] - last[0], 0)}`);
      });
    }
    // labels for the two story bands, placed inside the area at 2003-04
    const midL = stack[2][0];
    g.append("text").attr("class", "direct-label").attr("x", 8).attr("y", (y(midL[0]) + y(midL[1])) / 2 + 4)
      .attr("fill", "#fff").style("fill", "#fff").text(`Mid-range ${fmt.pct(midL[1] - midL[0], 1)}`);
    const cross = g.append("line").attr("class", "crosshair").attr("y1", 0).attr("y2", h).attr("opacity", 0);
    g.append("rect").attr("width", w).attr("height", h).attr("fill", "transparent")
      .on("pointermove", (e) => {
        const px = d3.pointer(e)[0];
        const i = d3.minIndex(seasons, (s) => Math.abs(x(s) - px));
        cross.attr("x1", x(seasons[i])).attr("x2", x(seasons[i])).attr("opacity", 1);
        const r = rows[i];
        tip.show(e, tipHTML(seasons[i], ZONES.slice().reverse().map((z) => [z, fmt.pct(r[z]), ZONE_COLOR[z]]),
          { note: `3-pointers: ${fmt.pct(r["Corner 3"] + r["Above-break 3"])}` }));
      })
      .on("pointerleave", () => { cross.attr("opacity", 0); tip.hide(); });
  });
  dataTable(document.getElementById("t-zones"), rows, [["Season", (d) => d.season], ...ZONES.map((z) => [z, (d) => d[z], fmt.pct])]);
}

/* ================================================================== 4. value by distance */
function distanceCurve(D) {
  const el = document.getElementById("c-dist");
  const TWO = ZONE_COLOR["Mid-range"], THREE = ZONE_COLOR["Above-break 3"];
  document.getElementById("l-dist").innerHTML = legendHTML([["Mostly 2-pointers", TWO], ["Mostly 3-pointers", THREE]]);
  responsive(el, (W) => {
    const m = { t: 20, r: 16, b: 40, l: 44 }, w = W - m.l - m.r, h = 330;
    const svg = svgIn(el, W, h + m.t + m.b), g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
    const x = d3.scaleLinear().domain([0, 35]).range([0, w]);
    const y = d3.scaleLinear().domain([0.3, 1.4]).range([h, 0]);
    // shade the 3-point range
    g.append("rect").attr("x", x(21.5)).attr("width", x(35) - x(21.5)).attr("y", 0).attr("height", h).attr("fill", THREE).attr("opacity", 0.07);
    gridY(g, y, w, 6, (v) => v.toFixed(1));
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).ticks(W < 500 ? 7 : 12).tickSize(0).tickPadding(8));
    g.append("text").attr("class", "axis-label").attr("x", w).attr("y", h + 34).attr("text-anchor", "end").text("Distance from the basket (ft)");
    g.append("text").attr("class", "axis-label").attr("x", 0).attr("y", -8).text("Points per shot");
    // the 4–20 ft plateau
    const plateau = D.filter((d) => d.dist >= 4 && d.dist <= 20);
    const pm = d3.mean(plateau, (d) => d.pps);
    g.append("line").attr("class", "annot-line").attr("x1", x(4)).attr("x2", x(20)).attr("y1", y(pm) + 22).attr("y2", y(pm) + 22);
    g.append("text").attr("class", "annot").attr("x", x(12)).attr("y", y(pm) + 38).attr("text-anchor", "middle").text("4–20 ft: every shot worth ≈ 0.80");
    const peak = D.find((d) => d.dist === 23);
    g.append("text").attr("class", "annot").attr("x", x(23) + 8).attr("y", y(peak.pps) - 12).text(`23 ft: ${fmt.pps(peak.pps)}`);
    g.append("text").attr("class", "annot").attr("x", x(21.5) + 6).attr("y", h - 8).attr("fill", "#8a91a0").style("fill", "#8a91a0").text("3-point range");
    // line colored by which kind of shot dominates at that distance
    const seg = d3.pairs(D);
    g.append("g").selectAll("line").data(seg).join("line")
      .attr("x1", (p) => x(p[0].dist)).attr("x2", (p) => x(p[1].dist)).attr("y1", (p) => y(p[0].pps)).attr("y2", (p) => y(p[1].pps))
      .attr("stroke", (p) => (p[1].three_share > 0.5 ? THREE : TWO)).attr("stroke-width", 2.2).attr("stroke-linecap", "round");
    g.append("g").selectAll("circle").data(D).join("circle")
      .attr("cx", (d) => x(d.dist)).attr("cy", (d) => y(d.pps)).attr("r", 3)
      .attr("fill", (d) => (d.three_share > 0.5 ? THREE : TWO));
    const cross = g.append("line").attr("class", "crosshair").attr("y1", 0).attr("y2", h).attr("opacity", 0);
    const dot = g.append("circle").attr("r", 6).attr("stroke", SURFACE).attr("stroke-width", 2).attr("opacity", 0);
    g.append("rect").attr("width", w).attr("height", h).attr("fill", "transparent")
      .on("pointermove", (e) => {
        const ft = Math.max(0, Math.min(35, Math.round(x.invert(d3.pointer(e)[0]))));
        const d = D.find((r) => r.dist === ft);
        cross.attr("x1", x(ft)).attr("x2", x(ft)).attr("opacity", 1);
        dot.attr("cx", x(ft)).attr("cy", y(d.pps)).attr("fill", d.three_share > 0.5 ? THREE : TWO).attr("opacity", 1);
        tip.show(e, tipHTML(`${ft} ft from the basket`, [
          ["Points per shot", fmt.pps(d.pps)], ["Make rate", fmt.pct(d.fg_pct)],
          ["Share that were 3s", fmt.pct(d.three_share, 0)], ["Attempts", fmt.int(d.fga)],
        ]));
      })
      .on("pointerleave", () => { cross.attr("opacity", 0); dot.attr("opacity", 0); tip.hide(); });
  });
  dataTable(document.getElementById("t-dist"), D, [
    ["Distance (ft)", (d) => d.dist], ["Attempts", (d) => d.fga, fmt.int], ["Make rate", (d) => d.fg_pct, fmt.pct],
    ["Points per shot", (d) => d.pps, fmt.pps], ["Share 3PA", (d) => d.three_share, (v) => fmt.pct(v, 0)],
  ]);
}

/* ================================================================== 5. distance histogram */
function distHist(H, seasons, byS) {
  const el = document.getElementById("c-hist");
  const bySeason = d3.group(H, (d) => d.season);
  const A = document.getElementById("h-a"), B = document.getElementById("h-b");
  const opts = seasons.map((s) => `<option value="${s}">${s}</option>`).join("");
  A.innerHTML = opts; B.innerHTML = opts;
  A.value = seasons[0]; B.value = seasons[seasons.length - 1];
  const COL_A = "#9aa1af", COL_B = ZONE_COLOR["Above-break 3"];
  let width = 0;
  const get = (s) => { const m = new Map(bySeason.get(s).map((d) => [d.dist, d.share])); return d3.range(0, 36).map((ft) => ({ ft, share: m.get(ft) || 0 })); };

  function draw() {
    if (!width) return;
    const sa = A.value, sb = B.value, da = get(sa), db = get(sb);
    document.getElementById("l-hist").innerHTML =
      `<span class="legend-item"><i class="swatch" style="background:${COL_B}"></i>${sb} (bars)</span>` +
      `<span class="legend-item"><i class="swatch line" style="background:${COL_A}"></i>${sa} (outline)</span>`;
    const W = width, m = { t: 14, r: 12, b: 40, l: 44 }, w = W - m.l - m.r, h = 300;
    const svg = svgIn(el, W, h + m.t + m.b), g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
    const x = d3.scaleBand().domain(d3.range(0, 36)).range([0, w]).paddingInner(0.12);
    const ymax = Math.min(0.28, d3.max([...da, ...db], (d) => d.share) * 1.08);
    const y = d3.scaleLinear().domain([0, ymax]).range([h, 0]).clamp(true);
    gridY(g, y, w, 5, (v) => Math.round(v * 100) + "%");
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x).tickValues(d3.range(0, 36, W < 520 ? 5 : 2)).tickSize(0).tickPadding(8));
    g.append("text").attr("class", "axis-label").attr("x", w).attr("y", h + 34).attr("text-anchor", "end").text("Distance from the basket (ft)");
    g.append("line").attr("x1", x(22) - 1).attr("x2", x(22) - 1).attr("y1", 0).attr("y2", h).attr("stroke", "#3a4152");
    g.append("text").attr("class", "annot").attr("x", x(22) + 4).attr("y", 12).text("22 ft: corner 3 line");
    const bars = g.append("g").selectAll("path").data(db).join("path")
      .attr("d", (d) => barUp(x(d.ft), y(d.share), x.bandwidth(), h - y(d.share), 3)).attr("fill", COL_B);
    const step = d3.line().x((d) => d.x).y((d) => d.y);
    const pts = [];
    da.forEach((d) => { pts.push({ x: x(d.ft) - x.step() * 0.06, y: y(d.share) }); pts.push({ x: x(d.ft) + x.bandwidth() + x.step() * 0.06, y: y(d.share) }); });
    g.append("path").attr("d", step(pts)).attr("fill", "none").attr("stroke", COL_A).attr("stroke-width", 2);
    if (ymax < d3.max(da, (d) => d.share)) {
      g.append("text").attr("class", "annot").attr("x", x(0) + x.bandwidth() + 6).attr("y", 12)
        .text(`${sa} at 0 ft: ${fmt.pct(da[0].share)} (off the scale)`);
    }
    g.append("g").selectAll("rect").data(db).join("rect")
      .attr("x", (d) => x(d.ft) - (x.step() - x.bandwidth()) / 2).attr("width", x.step()).attr("y", 0).attr("height", h).attr("fill", "transparent")
      .on("pointerenter", (e, d) => bars.attr("opacity", (b) => (b.ft === d.ft ? 1 : 0.5)))
      .on("pointermove", (e, d) => tip.show(e, tipHTML(`${d.ft} ft`, [[sb, fmt.pct(d.share), COL_B], [sa, fmt.pct(da[d.ft].share), COL_A]])))
      .on("pointerleave", () => { bars.attr("opacity", 1); tip.hide(); });
    const avgA = byS.get(sa).avg_dist, avgB = byS.get(sb).avg_dist;
    dataTable(document.getElementById("t-hist"), d3.range(0, 36).map((ft) => ({ ft, a: da[ft].share, b: db[ft].share })), [
      ["Distance (ft)", (d) => d.ft], [`${sa} share`, (d) => d.a, fmt.pct], [`${sb} share`, (d) => d.b, fmt.pct],
    ], { caption: `Show the numbers behind this chart · average distance ${fmt.num(avgA)} ft (${sa}) vs ${fmt.num(avgB)} ft (${sb})` });
  }
  A.addEventListener("change", draw); B.addEventListener("change", draw);
  responsive(el, (W) => { width = W; draw(); });
}

/* ================================================================== 6. zone value lines */
function zonePPS(seasons, zget) {
  const el = document.getElementById("c-zpps");
  document.getElementById("l-zpps").innerHTML = legendHTML(ZONES.map((z) => [z, ZONE_COLOR[z]]), { line: true });
  responsive(el, (W) => {
    const narrow = W < 560;
    const m = { t: 14, r: narrow ? 14 : 118, b: 30, l: 44 }, w = W - m.l - m.r, h = 330;
    const svg = svgIn(el, W, h + m.t + m.b), g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
    const x = d3.scalePoint().domain(seasons).range([0, w]);
    const y = d3.scaleLinear().domain([0.7, 1.4]).range([h, 0]);
    gridY(g, y, w, 7, (v) => v.toFixed(1));
    seasonAxis(g, x, h, w);
    const line = d3.line().x((d) => x(d.season)).y((d) => y(d.pps)).curve(d3.curveMonotoneX);
    const series = ZONES.map((z) => ({ z, vals: seasons.map((s) => zget(s, z)) }));
    const paths = g.append("g").selectAll("path").data(series).join("path")
      .attr("d", (d) => line(d.vals)).attr("fill", "none").attr("stroke", (d) => ZONE_COLOR[d.z]).attr("stroke-width", 2.2);
    if (!narrow) {
      const labels = spreadLabels(series.map((s) => ({ z: s.z, y: y(s.vals.at(-1).pps) + 4 })), 15, 8, h);
      g.selectAll("text.lbl").data(labels).join("text").attr("class", "direct-label").attr("x", w + 8).attr("y", (d) => d.y).text((d) => d.z);
    }
    const cross = g.append("line").attr("class", "crosshair").attr("y1", 0).attr("y2", h).attr("opacity", 0);
    const dots = g.append("g").selectAll("circle").data(series).join("circle").attr("r", 4.5)
      .attr("fill", (d) => ZONE_COLOR[d.z]).attr("stroke", SURFACE).attr("stroke-width", 2).attr("opacity", 0);
    g.append("rect").attr("width", w).attr("height", h).attr("fill", "transparent")
      .on("pointermove", (e) => {
        const px = d3.pointer(e)[0], i = d3.minIndex(seasons, (s) => Math.abs(x(s) - px)), X = x(seasons[i]);
        cross.attr("x1", X).attr("x2", X).attr("opacity", 1);
        dots.attr("cx", X).attr("cy", (d) => y(d.vals[i].pps)).attr("opacity", 1);
        const rows = series.slice().sort((a, b) => b.vals[i].pps - a.vals[i].pps)
          .map((d) => [d.z, `${fmt.pps(d.vals[i].pps)} <span style="color:#8a91a0;font-weight:400">(${fmt.pct(d.vals[i].fg_pct, 0)} FG)</span>`, ZONE_COLOR[d.z]]);
        tip.show(e, tipHTML(seasons[i], rows, { sub: "Points per shot" }));
      })
      .on("pointerleave", () => { cross.attr("opacity", 0); dots.attr("opacity", 0); tip.hide(); });
  });
  dataTable(document.getElementById("t-zpps"), seasons, [["Season", (s) => s], ...ZONES.map((z) => [`${z} PPS`, (s) => zget(s, z).pps, fmt.pps])]);
}

/* ================================================================== 7. team heatmap */
function teamHeat(T, seasons) {
  const el = document.getElementById("c-heat");
  const teams = Array.from(d3.group(T, (d) => d.team), ([team, rows]) => ({ team, rows: new Map(rows.map((r) => [r.season, r])) }));
  const last = seasons[seasons.length - 1];
  teams.sort((a, b) => b.rows.get(last).three_share - a.rows.get(last).three_share);
  const leader = new Map(Array.from(d3.group(T, (d) => d.season), ([s, rows]) => [s, d3.greatest(rows, (r) => r.three_share)]));
  const rank = new Map();
  d3.group(T, (d) => d.season).forEach((rows, s) => rows.slice().sort((a, b) => b.three_share - a.three_share).forEach((r, i) => rank.set(s + r.team, [i + 1, rows.length])));
  const color = d3.scaleSequential().domain([0.1, 0.54]).interpolator(d3.piecewise(d3.interpolateRgb.gamma(2.2), ["#0d2a52", "#1c5cab", "#3987e5", "#86b6ef", "#e3efff"])).clamp(true);
  const stops = d3.range(0, 1.001, 0.1).map((t) => color(0.1 + 0.44 * t));
  document.getElementById("l-heat").innerHTML =
    `<span class="legend-gradient">Share of shots that were 3s <span>10%</span><i class="bar" style="background:linear-gradient(90deg,${stops.join(",")})"></i><span>54%</span></span>` +
    `<span class="legend-item"><i class="swatch" style="background:transparent;box-shadow:inset 0 0 0 2px ${ACCENT}"></i>League leader</span>`;

  el.style.overflowX = "auto";
  responsive(el.parentElement, (Wp) => {
    const W = Math.max(Wp, 720);
    const labelW = W < 860 ? 120 : 170;
    const m = { t: 6, r: 4, b: 28, l: labelW }, w = W - m.l - m.r;
    const cell = w / seasons.length, rowH = 19, h = rowH * teams.length;
    const svg = svgIn(el, W, h + m.t + m.b), g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
    const x = d3.scaleBand().domain(seasons).range([0, w]);
    const yb = d3.scaleBand().domain(teams.map((t) => t.team)).range([0, h]);
    const rowsG = g.selectAll("g.row").data(teams).join("g").attr("transform", (t) => `translate(0,${yb(t.team)})`);
    rowsG.append("text").attr("class", "axis-label").attr("x", -8).attr("y", rowH / 2 + 4).attr("text-anchor", "end")
      .style("font-size", "12px").text((t) => (W < 860 ? t.team.split(" ").slice(-1)[0] : t.team));
    rowsG.selectAll("rect").data((t) => seasons.map((s) => t.rows.get(s)).filter(Boolean)).join("rect")
      .attr("x", (r) => x(r.season) + 1).attr("y", 1).attr("width", cell - 2).attr("height", rowH - 2).attr("rx", 3)
      .attr("fill", (r) => color(r.three_share))
      .attr("stroke", (r) => (leader.get(r.season) === r ? ACCENT : "none")).attr("stroke-width", 2)
      .on("pointermove", (e, r) => {
        const [k, n] = rank.get(r.season + r.team);
        d3.select(e.currentTarget).attr("stroke", "#fff");
        tip.show(e, tipHTML(r.name_then, [
          ["3-point share", fmt.pct(r.three_share)], ["Rank that season", `${k} of ${n}`],
          ["Points per shot", fmt.pps(r.pps)], ["FG%", fmt.pct(r.fg_pct)], ["Shots", fmt.int(r.fga)],
        ], { sub: r.season + (r.name_then !== r.team ? ` · now the ${r.team}` : "") }));
      })
      .on("pointerleave", (e, r) => { d3.select(e.currentTarget).attr("stroke", leader.get(r.season) === r ? ACCENT : "none"); tip.hide(); });
    const every = W < 900 ? 2 : 1;
    g.append("g").attr("class", "axis no-line").attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x).tickSize(0).tickPadding(8).tickFormat((s, i) => (i % every === 0 ? shortSeason(s) : "")));
  });
  const rows = teams.map((t) => ({ team: t.team, vals: seasons.map((s) => t.rows.get(s)) }));
  dataTable(document.getElementById("t-heat"), rows,
    [["Team", (d) => d.team], ...seasons.map((s, i) => [shortSeason(s), (d) => (d.vals[i] ? d.vals[i].three_share : null), (v) => (v == null ? "–" : fmt.pct(v, 0))])]);
}

/* ================================================================== 8. scatter */
function scatter(T, seasons) {
  const el = document.getElementById("c-scatter");
  const mean3 = d3.rollup(T, (v) => d3.mean(v, (d) => d.three_share), (d) => d.season);
  const meanP = d3.rollup(T, (v) => d3.mean(v, (d) => d.pps), (d) => d.season);
  const P = T.map((d) => ({ ...d, dx: d.three_share - mean3.get(d.season), dy: d.pps - meanP.get(d.season), si: seasons.indexOf(d.season) }));
  // least squares + pearson r
  const mx = d3.mean(P, (d) => d.dx), my = d3.mean(P, (d) => d.dy);
  const sxy = d3.sum(P, (d) => (d.dx - mx) * (d.dy - my)), sxx = d3.sum(P, (d) => (d.dx - mx) ** 2), syy = d3.sum(P, (d) => (d.dy - my) ** 2);
  const slope = sxy / sxx, icpt = my - slope * mx, r = sxy / Math.sqrt(sxx * syy);
  const color = d3.scaleSequential().domain([0, seasons.length - 1]).interpolator(d3.interpolateRgb.gamma(2.2)("#3a6fc0", "#d6e7ff"));
  const stops = d3.range(0, 1.001, 0.1).map((t) => color(t * (seasons.length - 1)));
  document.getElementById("l-scatter").innerHTML =
    `<span class="legend-gradient">Season <span>2003-04</span><i class="bar" style="background:linear-gradient(90deg,${stops.join(",")})"></i><span>2024-25</span></span>` +
    `<span class="legend-item"><i class="swatch line" style="background:${ACCENT}"></i>Best-fit line (r = ${r.toFixed(2)})</span>`;
  const top = P.slice().sort((a, b) => b.dx - a.dx).slice(0, 2);
  responsive(el, (W) => {
    const m = { t: 16, r: 18, b: 44, l: 54 }, w = W - m.l - m.r, h = Math.min(420, Math.max(300, w * 0.55));
    const svg = svgIn(el, W, h + m.t + m.b), g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
    const x = d3.scaleLinear().domain(d3.extent(P, (d) => d.dx)).nice().range([0, w]);
    const y = d3.scaleLinear().domain(d3.extent(P, (d) => d.dy)).nice().range([h, 0]);
    gridY(g, y, w, 6, (v) => (v > 0 ? "+" : "") + v.toFixed(2));
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x).ticks(W < 520 ? 5 : 9).tickSize(0).tickPadding(8).tickFormat((v) => (v > 0 ? "+" : "") + Math.round(v * 100)));
    g.append("line").attr("x1", x(0)).attr("x2", x(0)).attr("y1", 0).attr("y2", h).attr("stroke", "#3a4152");
    g.append("line").attr("x1", 0).attr("x2", w).attr("y1", y(0)).attr("y2", y(0)).attr("stroke", "#3a4152");
    g.append("text").attr("class", "axis-label").attr("x", w).attr("y", h + 36).attr("text-anchor", "end").text("3-point share vs. that season’s league average (percentage points)");
    g.append("text").attr("class", "axis-label").attr("x", 0).attr("y", -4).text("Points per shot vs. league average");
    const dots = g.append("g").selectAll("circle").data(P).join("circle")
      .attr("cx", (d) => x(d.dx)).attr("cy", (d) => y(d.dy)).attr("r", 4.5)
      .attr("fill", (d) => color(d.si)).attr("fill-opacity", 0.85).attr("stroke", SURFACE).attr("stroke-width", 1.5);
    const [x0, x1] = x.domain();
    g.append("line").attr("x1", x(x0)).attr("x2", x(x1)).attr("y1", y(icpt + slope * x0)).attr("y2", y(icpt + slope * x1))
      .attr("stroke", ACCENT).attr("stroke-width", 2);
    top.forEach((d) => g.append("text").attr("class", "direct-label").attr("x", x(d.dx) - 8).attr("y", y(d.dy) - 9).attr("text-anchor", "end")
      .text(`${d.season} ${d.team.split(" ").slice(-1)[0]}`));
    const ring = g.append("circle").attr("r", 8).attr("fill", "none").attr("stroke", "#fff").attr("stroke-width", 2).attr("opacity", 0);
    const delaunay = d3.Delaunay.from(P, (d) => x(d.dx), (d) => y(d.dy));
    g.append("rect").attr("width", w).attr("height", h).attr("fill", "transparent")
      .on("pointermove", (e) => {
        const [px, py] = d3.pointer(e), i = delaunay.find(px, py), d = P[i];
        if (Math.hypot(x(d.dx) - px, y(d.dy) - py) > 30) { ring.attr("opacity", 0); tip.hide(); return; }
        ring.attr("cx", x(d.dx)).attr("cy", y(d.dy)).attr("opacity", 1);
        tip.show(e, tipHTML(d.name_then, [
          ["3-point share", `${fmt.pct(d.three_share)} (${d.dx >= 0 ? "+" : "−"}${Math.abs(d.dx * 100).toFixed(1)})`],
          ["Points per shot", `${fmt.pps(d.pps)} (${fmt.signed(d.dy)})`], ["FG%", fmt.pct(d.fg_pct)],
        ], { sub: d.season, note: "Numbers in brackets: difference from that season’s league average" }));
      })
      .on("pointerleave", () => { ring.attr("opacity", 0); tip.hide(); });
  });
  dataTable(document.getElementById("t-scatter"), P.slice().sort((a, b) => b.dx - a.dx), [
    ["Team (name that season)", (d) => d.name_then], ["Season", (d) => d.season], ["3P share", (d) => d.three_share, fmt.pct],
    ["vs league (pts)", (d) => d.dx * 100, (v) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1)], ["Pts / shot", (d) => d.pps, fmt.pps],
    ["vs league", (d) => d.dy, (v) => fmt.signed(v)],
  ], { caption: `Show all 659 team-seasons · r = ${r.toFixed(3)}, slope = ${slope.toFixed(3)} points per shot per 100% of share` });
}

/* ================================================================== 9. shooters */
function volumeShooters(V, leaders) {
  const el = document.getElementById("c-vol");
  const lead = new Map(leaders.map((d) => [d.season, d]));
  const C300 = ZONE_COLOR["Above-break 3"], C500 = ZONE_COLOR["Corner 3"];
  document.getElementById("l-vol").innerHTML = legendHTML([["300+ attempts", C300], ["500+ attempts", C500]]);
  responsive(el, (W) => {
    const m = { t: 20, r: 10, b: 30, l: 36 }, w = W - m.l - m.r, h = 280;
    const svg = svgIn(el, W, h + m.t + m.b), g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
    const x = d3.scaleBand().domain(V.map((d) => d.season)).range([0, w]).paddingInner(0.2);
    const y = d3.scaleLinear().domain([0, 130]).range([h, 0]);
    gridY(g, y, w, 5, (v) => v);
    seasonAxis(g, x, h, W < 700 ? 300 : w);
    const b1 = g.append("g").selectAll("path").data(V).join("path").attr("d", (d) => barUp(x(d.season), y(d.p300), x.bandwidth(), h - y(d.p300))).attr("fill", C300);
    const inset = x.bandwidth() * 0.22;
    const b2 = g.append("g").selectAll("path").data(V).join("path")
      .attr("d", (d) => barUp(x(d.season) + inset, y(d.p500), x.bandwidth() - 2 * inset, h - y(d.p500), 3)).attr("fill", C500)
      .attr("stroke", C300).attr("stroke-width", 0);
    [V[0], V[V.length - 1]].forEach((d) => g.append("text").attr("class", "direct-label").attr("text-anchor", "middle")
      .attr("x", x(d.season) + x.bandwidth() / 2).attr("y", y(d.p300) - 6).text(d.p300));
    g.append("g").selectAll("rect").data(V).join("rect")
      .attr("x", (d) => x(d.season) - (x.step() - x.bandwidth()) / 2).attr("width", x.step()).attr("height", h).attr("fill", "transparent")
      .on("pointerenter", (e, d) => { b1.attr("opacity", (b) => (b === d ? 1 : 0.45)); b2.attr("opacity", (b) => (b === d ? 1 : 0.45)); })
      .on("pointermove", (e, d) => {
        const l = lead.get(d.season);
        tip.show(e, tipHTML(d.season, [["300+ attempts", d.p300, C300], ["500+ attempts", d.p500, C500]],
          { note: `Most made threes: <b>${l.PLAYER_NAME}</b>, ${l.fg3m} of ${fmt.int(l.fg3a)} (${fmt.pct(l.fg3_pct)})` }));
      })
      .on("pointerleave", () => { b1.attr("opacity", 1); b2.attr("opacity", 1); tip.hide(); });
  });
  dataTable(document.getElementById("t-vol"), V, [
    ["Season", (d) => d.season], ["300+ 3PA", (d) => d.p300], ["500+ 3PA", (d) => d.p500],
    ["3PM leader", (d) => lead.get(d.season).PLAYER_NAME], ["3PM", (d) => lead.get(d.season).fg3m], ["3P%", (d) => lead.get(d.season).fg3_pct, fmt.pct],
  ]);
}

function topSeasons(S) {
  const el = document.getElementById("c-top");
  const CURRY = ZONE_COLOR["Above-break 3"], OTHER = "#5b6272";
  responsive(el, (W) => {
    const labelW = W < 420 ? 128 : 170;
    const m = { t: 4, r: 40, b: 8, l: labelW }, w = W - m.l - m.r, rowH = 21, h = rowH * S.length;
    const svg = svgIn(el, W, h + m.t + m.b + 26), g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
    const y = d3.scaleBand().domain(S.map((_, i) => i)).range([0, h]).paddingInner(0.25);
    const x = d3.scaleLinear().domain([0, 420]).range([0, w]);
    const isC = (d) => d.PLAYER_NAME === "Stephen Curry";
    g.selectAll("text.name").data(S).join("text").attr("class", "axis-label").attr("x", -8).attr("y", (_, i) => y(i) + y.bandwidth() / 2 + 4)
      .attr("text-anchor", "end").style("fill", (d) => (isC(d) ? "#f3f4f6" : null)).style("font-size", "12px")
      .text((d) => `${W < 420 ? d.PLAYER_NAME.split(" ").slice(-1)[0] : d.PLAYER_NAME} · ${shortSeason(d.season)}`);
    const bars = g.append("g").selectAll("path").data(S).join("path").attr("d", (d, i) => barRight(0, y(i), x(d.fg3m), y.bandwidth())).attr("fill", (d) => (isC(d) ? CURRY : OTHER));
    g.selectAll("text.val").data(S).join("text").attr("class", "direct-label").attr("x", (d) => x(d.fg3m) + 6).attr("y", (_, i) => y(i) + y.bandwidth() / 2 + 4).text((d) => d.fg3m);
    g.append("g").attr("transform", `translate(0,${h + 22})`).append("text").attr("class", "axis-label")
      .html(`<tspan fill="${CURRY}" style="fill:${CURRY}">■</tspan> Stephen Curry   <tspan fill="${OTHER}" style="fill:${OTHER}">■</tspan> Everyone else`);
    g.append("g").selectAll("rect").data(S).join("rect").attr("x", -labelW).attr("width", w + labelW + m.r).attr("y", (_, i) => y(i) - 2).attr("height", y.step()).attr("fill", "transparent")
      .on("pointerenter", (e, d) => bars.attr("opacity", (b) => (b === d ? 1 : 0.5)))
      .on("pointermove", (e, d) => tip.show(e, tipHTML(d.PLAYER_NAME, [["Made threes", d.fg3m], ["Attempts", fmt.int(d.fg3a)], ["3-point %", fmt.pct(d.fg3_pct)]], { sub: d.season })))
      .on("pointerleave", () => { bars.attr("opacity", 1); tip.hide(); });
  });
  dataTable(document.getElementById("t-top"), S, [["Player", (d) => d.PLAYER_NAME], ["Season", (d) => d.season], ["3PM", (d) => d.fg3m], ["3PA", (d) => d.fg3a, fmt.int], ["3P%", (d) => d.fg3_pct, fmt.pct]]);
}

/* ================================================================== 10. shot types */
function actions(A, L) {
  const el = document.getElementById("c-action");
  const rows = Array.from(d3.group(A, (d) => d.action), ([action, v]) => {
    const fga = d3.sum(v, (d) => d.fga);
    return { action, fga, pps: d3.sum(v, (d) => d.fga * d.pps) / fga, fg: d3.sum(v, (d) => d.fga * d.fg_pct) / fga };
  }).sort((a, b) => b.pps - a.pps);
  const total = d3.sum(rows, (d) => d.fga), leaguePPS = d3.sum(L, (d) => d.pts) / d3.sum(L, (d) => d.fga);
  responsive(el, (W) => {
    const labelW = W < 460 ? 132 : 170;
    const m = { t: 22, r: 50, b: 26, l: labelW }, w = W - m.l - m.r, rowH = 30, h = rowH * rows.length;
    const svg = svgIn(el, W, h + m.t + m.b), g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
    const y = d3.scaleBand().domain(rows.map((d) => d.action)).range([0, h]).paddingInner(0.3);
    const x = d3.scaleLinear().domain([0, 2]).range([0, w]);
    g.append("g").attr("class", "grid").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).ticks(4).tickSize(-h).tickFormat(""));
    g.append("g").attr("class", "axis no-line").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).ticks(4).tickSize(0).tickPadding(8));
    g.selectAll("text.name").data(rows).join("text").attr("class", "axis-label").attr("x", -10).attr("y", (d) => y(d.action) + y.bandwidth() / 2 + 4)
      .attr("text-anchor", "end").style("font-size", "13px").style("fill", "#c3c8d4").text((d) => d.action);
    const bars = g.append("g").selectAll("path").data(rows).join("path").attr("d", (d) => barRight(0, y(d.action), x(d.pps), y.bandwidth())).attr("fill", ZONE_COLOR["Above-break 3"]);
    g.selectAll("text.val").data(rows).join("text").attr("class", "direct-label").attr("x", (d) => x(d.pps) + 6).attr("y", (d) => y(d.action) + y.bandwidth() / 2 + 4).text((d) => d.pps.toFixed(2));
    g.append("line").attr("x1", x(leaguePPS)).attr("x2", x(leaguePPS)).attr("y1", -10).attr("y2", h).attr("stroke", ACCENT).attr("stroke-width", 1.5);
    g.append("text").attr("class", "annot").attr("x", x(leaguePPS) + 5).attr("y", -10).text(`All shots: ${leaguePPS.toFixed(2)}`);
    g.append("g").selectAll("rect").data(rows).join("rect").attr("x", -labelW).attr("width", W).attr("y", (d) => y(d.action) - 4).attr("height", y.step()).attr("fill", "transparent")
      .on("pointerenter", (e, d) => bars.attr("opacity", (b) => (b === d ? 1 : 0.5)))
      .on("pointermove", (e, d) => tip.show(e, tipHTML(d.action, [["Points per shot", fmt.pps(d.pps)], ["Make rate", fmt.pct(d.fg)], ["Attempts", fmt.int(d.fga)], ["Share of all shots", fmt.pct(d.fga / total)]])))
      .on("pointerleave", () => { bars.attr("opacity", 1); tip.hide(); });
  });
  dataTable(document.getElementById("t-action"), rows, [["Shot type", (d) => d.action], ["Attempts", (d) => d.fga, fmt.int], ["Share", (d) => d.fga / total, fmt.pct], ["Make rate", (d) => d.fg, fmt.pct], ["Points per shot", (d) => d.pps, fmt.pps]]);
}

/* ================================================================== 11. clutch */
function clutch(P, C) {
  const el = document.getElementById("c-clutch");
  const order = ["Q1", "Q2", "Q3", "Q4", "OT"];
  const pn = { Q1: "1st quarter", Q2: "2nd quarter", Q3: "3rd quarter", Q4: "4th quarter", OT: "Overtime" };
  const rows = [
    ...order.map((p) => ({ group: "By period", label: pn[p], ...P.find((d) => d.period === p) })),
    ...["Rest of game", "2:00-5:00 left (Q4/OT)", "Final 2:00 (Q4/OT)"].map((c) => ({ group: "Late in the 4th quarter & overtime", label: c.replace("-", "–"), ...C.find((d) => d.clock === c) })),
  ];
  const BASE = ZONE_COLOR["Above-break 3"], HI = ZONE_COLOR["Mid-range"];
  const isHi = (d) => d.label === "Final 2:00 (Q4/OT)" || d.label === "Overtime";
  responsive(el, (W) => {
    const labelW = W < 460 ? 150 : 190;
    const m = { t: 8, r: 56, b: 26, l: labelW }, w = W - m.l - m.r, rowH = 30, gap = 34;
    const h = rowH * rows.length + gap * 2;
    const svg = svgIn(el, W, h + m.t + m.b), g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
    const x = d3.scaleLinear().domain([0.35, 0.5]).range([0, w]);
    const yOf = (i) => (i < 5 ? gap + i * rowH : gap * 2 + i * rowH);
    g.append("g").attr("class", "grid").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).ticks(4).tickSize(-h).tickFormat(""));
    g.append("g").attr("class", "axis no-line").attr("transform", `translate(0,${h})`).call(d3.axisBottom(x).ticks(4).tickSize(0).tickPadding(8).tickFormat((v) => Math.round(v * 100) + "%"));
    g.append("text").attr("class", "annot").attr("x", -labelW).attr("y", gap - 12).style("font-weight", 600).text("By period");
    g.append("text").attr("class", "annot").attr("x", -labelW).attr("y", yOf(5) - 12).style("font-weight", 600).text("4th quarter & overtime, by time left");
    g.selectAll("text.name").data(rows).join("text").attr("class", "axis-label").attr("x", -10).attr("y", (_, i) => yOf(i) + rowH * 0.35 + 4)
      .attr("text-anchor", "end").style("font-size", "13px").style("fill", "#c3c8d4").text((d) => d.label);
    const bars = g.append("g").selectAll("path").data(rows).join("path").attr("d", (d, i) => barRight(0, yOf(i), x(d.fg_pct), rowH * 0.7)).attr("fill", (d) => (isHi(d) ? HI : BASE));
    g.selectAll("text.val").data(rows).join("text").attr("class", "direct-label").attr("x", (d) => x(d.fg_pct) + 6).attr("y", (_, i) => yOf(i) + rowH * 0.35 + 4).text((d) => fmt.pct(d.fg_pct));
    g.append("g").selectAll("rect").data(rows).join("rect").attr("x", -labelW).attr("width", W).attr("y", (_, i) => yOf(i) - 4).attr("height", rowH).attr("fill", "transparent")
      .on("pointerenter", (e, d) => bars.attr("opacity", (b) => (b === d ? 1 : 0.5)))
      .on("pointermove", (e, d) => tip.show(e, tipHTML(d.label, [["Make rate", fmt.pct(d.fg_pct)], ["Points per shot", fmt.pps(d.pps)], ["Share that were 3s", fmt.pct(d.three_share)], ["Attempts", fmt.int(d.fga)]])))
      .on("pointerleave", () => { bars.attr("opacity", 1); tip.hide(); });
  });
  dataTable(document.getElementById("t-clutch"), rows, [["Situation", (d) => d.label], ["Attempts", (d) => d.fga, fmt.int], ["Make rate", (d) => d.fg_pct, fmt.pct], ["Points per shot", (d) => d.pps, fmt.pps], ["3PA share", (d) => d.three_share, fmt.pct]]);
}

/* ================================================================== 12. home court */
function homeCourt(HA, seasons) {
  const el = document.getElementById("c-home");
  const by = d3.group(HA, (d) => d.season);
  const rows = seasons.map((s) => {
    const h = by.get(s).find((d) => d.loc === "Home"), a = by.get(s).find((d) => d.loc === "Away");
    return { season: s, gap: h.pps - a.pps, fgGap: h.fg_pct - a.fg_pct, home: h, away: a };
  });
  const HI = ZONE_COLOR["Mid-range"], BASE = ZONE_COLOR["Above-break 3"];
  responsive(el, (W) => {
    const m = { t: 26, r: 12, b: 30, l: 50 }, w = W - m.l - m.r, h = 280;
    const svg = svgIn(el, W, h + m.t + m.b), g = svg.append("g").attr("transform", `translate(${m.l},${m.t})`);
    const x = d3.scaleBand().domain(seasons).range([0, w]).paddingInner(0.22);
    const y = d3.scaleLinear().domain([0, 0.035]).range([h, 0]);
    gridY(g, y, w, 7, (v) => "+" + v.toFixed(3));
    seasonAxis(g, x, h, w);
    const bars = g.append("g").selectAll("path").data(rows).join("path")
      .attr("d", (d) => barUp(x(d.season), y(d.gap), x.bandwidth(), h - y(d.gap))).attr("fill", (d) => (d.season === "2020-21" ? HI : BASE));
    const c = rows.find((d) => d.season === "2020-21");
    const cx = x(c.season) + x.bandwidth() / 2;
    g.append("text").attr("class", "direct-label").attr("x", cx).attr("y", y(c.gap) - 7).attr("text-anchor", "middle").text("+" + c.gap.toFixed(3));
    g.append("line").attr("class", "annot-line").attr("x1", cx).attr("x2", cx).attr("y1", y(0.0335) + 6).attr("y2", y(c.gap) - 22);
    g.append("text").attr("class", "annot").attr("x", cx).attr("y", y(0.0335)).attr("text-anchor", "end").attr("dx", 6).text("2020-21: arenas mostly empty");
    const avg = d3.mean(rows.filter((d) => d.season !== "2020-21"), (d) => d.gap);
    g.append("line").attr("x1", 0).attr("x2", w).attr("y1", y(avg)).attr("y2", y(avg)).attr("stroke", "#e3e6ec").attr("stroke-width", 1.5).attr("opacity", 0.8);
    document.getElementById("l-home").innerHTML = legendHTML([["Home edge, points per shot", BASE], ["2020-21", HI]]) +
      `<span class="legend-item"><i class="swatch line" style="background:#e3e6ec"></i>Average of the other 21 seasons (+${avg.toFixed(3)})</span>`;
    g.append("g").selectAll("rect").data(rows).join("rect")
      .attr("x", (d) => x(d.season) - (x.step() - x.bandwidth()) / 2).attr("width", x.step()).attr("height", h).attr("fill", "transparent")
      .on("pointerenter", (e, d) => bars.attr("opacity", (b) => (b === d ? 1 : 0.45)))
      .on("pointermove", (e, d) => tip.show(e, tipHTML(d.season, [
        ["Home points per shot", fmt.pps(d.home.pps)], ["Away points per shot", fmt.pps(d.away.pps)], ["Gap", fmt.signed(d.gap)],
        ["Home FG%", fmt.pct(d.home.fg_pct)], ["Away FG%", fmt.pct(d.away.fg_pct)],
      ])))
      .on("pointerleave", () => { bars.attr("opacity", 1); tip.hide(); });
  });
  dataTable(document.getElementById("t-home"), rows, [
    ["Season", (d) => d.season], ["Home PPS", (d) => d.home.pps, fmt.pps], ["Away PPS", (d) => d.away.pps, fmt.pps], ["Gap", (d) => d.gap, (v) => fmt.signed(v)],
    ["Home FG%", (d) => d.home.fg_pct, fmt.pct], ["Away FG%", (d) => d.away.fg_pct, fmt.pct], ["FG gap (pts)", (d) => d.fgGap * 100, (v) => (v >= 0 ? "+" : "") + v.toFixed(2)],
  ]);
}
