/* Shared helpers for the report (index.html) and the dashboard (dashboard.html).
   Requires d3 v7 (loaded from cdnjs before this file). */

// cache-busting version for data URLs; scripts/bump_version.py updates it together with the HTML
const SITE_VERSION = "202610011702";
const asset = (path) => `${path}?v=${SITE_VERSION}`;

const ZONES = ["Restricted area", "Paint (non-RA)", "Mid-range", "Corner 3", "Above-break 3"];
const ZONE_COLOR = {
  "Restricted area": "#c98500",
  "Paint (non-RA)": "#9085e9",
  "Mid-range": "#d95926",
  "Corner 3": "#199e70",
  "Above-break 3": "#3987e5",
};
// categorical order (validated) used for any other small set of series
const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];
const MUTED = "#8a91a0";
const ACCENT = "#ff7a1a";
const COLD = "#3987e5", MID_GRAY = "#4a5060", HOT = "#e66767";

/* ------------------------------------------------------------------ formatting */
const fmt = {
  int: d3.format(","),
  pct: (v, d = 1) => (v == null || isNaN(v) ? "–" : (v * 100).toFixed(d) + "%"),
  pps: (v) => (v == null || isNaN(v) ? "–" : v.toFixed(3)),
  num: (v, d = 1) => (v == null || isNaN(v) ? "–" : v.toFixed(d)),
  ft: (v) => (v == null || isNaN(v) ? "–" : v.toFixed(1) + " ft"),
  short: (v) => (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(2) + "M" : Math.abs(v) >= 1e4 ? (v / 1e3).toFixed(0) + "K" : d3.format(",")(Math.round(v))),
  signed: (v, d = 3) => (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.abs(v).toFixed(d),
  signedPct: (v, d = 1) => (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.abs(v * 100).toFixed(d) + " pts",
};
// "2015-16" -> "’16" for compact axes
const shortSeason = (s) => "’" + s.slice(5);

/* ------------------------------------------------------------------ tooltip */
const tip = (() => {
  const el = document.createElement("div");
  el.className = "tooltip";
  el.setAttribute("role", "status");
  document.addEventListener("DOMContentLoaded", () => document.body.appendChild(el));
  function place(evt) {
    const pad = 14, w = el.offsetWidth, h = el.offsetHeight;
    let x = evt.clientX + pad, y = evt.clientY + pad;
    if (x + w > window.innerWidth - 8) x = evt.clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = evt.clientY - h - pad;
    el.style.left = Math.max(8, x) + "px";
    el.style.top = Math.max(8, y) + "px";
  }
  return {
    show(evt, html) { el.innerHTML = html; el.classList.add("show"); place(evt); },
    move(evt) { place(evt); },
    hide() { el.classList.remove("show"); },
  };
})();

// build tooltip HTML: title, optional subtitle, rows [[label, value, color?]], optional note
function tipHTML(title, rows, { sub, note } = {}) {
  let h = `<div class="tt-title">${title}</div>`;
  if (sub) h += `<div class="tt-sub">${sub}</div>`;
  for (const [k, v, c] of rows) {
    const sw = c ? `<i class="swatch" style="background:${c}"></i>` : "";
    h += `<div class="tt-row"><span>${sw}${k}</span><span>${v}</span></div>`;
  }
  if (note) h += `<div class="tt-note">${note}</div>`;
  return h;
}

/* ------------------------------------------------------------------ layout helpers */
// render(fn) on load and whenever the container width changes
function responsive(container, fn) {
  let last = 0;
  const ro = new ResizeObserver((entries) => {
    const w = Math.floor(entries[0].contentRect.width);
    if (w && Math.abs(w - last) > 4) { last = w; fn(w); }
  });
  ro.observe(container);
}

function legendHTML(items, { line = false } = {}) {
  return items.map(([label, color]) =>
    `<span class="legend-item"><i class="swatch${line ? " line" : ""}" style="background:${color}"></i>${label}</span>`).join("");
}

// a <details> data table under a chart: columns [[header, accessor, formatter]]
function dataTable(host, rows, columns, { caption } = {}) {
  host.innerHTML = "";
  const det = document.createElement("details");
  det.className = "data-table";
  det.innerHTML = `<summary>${caption || "Show the numbers behind this chart"}</summary>`;
  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  const t = document.createElement("table");
  t.className = "tbl";
  t.innerHTML = "<thead><tr>" + columns.map((c) => `<th scope="col">${c[0]}</th>`).join("") + "</tr></thead>";
  const tb = document.createElement("tbody");
  tb.innerHTML = rows.map((r) => "<tr>" + columns.map((c) => `<td>${(c[2] || String)(c[1](r))}</td>`).join("") + "</tr>").join("");
  t.appendChild(tb);
  wrap.appendChild(t);
  det.appendChild(wrap);
  host.appendChild(det);
}

/* ------------------------------------------------------------------ court */
// Court in feet. Data x: -25..25 (sideline to sideline), y: feet from the baseline,
// basket centre at (0, 5.25). Drawn from half-court looking at the basket: basket at
// the bottom, so screen x is mirrored (the data's "left side" is positive x).
const COURT = { xMin: -25, xMax: 25, yMin: 0, yMax: 35, hoopY: 5.25 };

function courtScales(width) {
  const k = width / (COURT.xMax - COURT.xMin);
  const height = (COURT.yMax - COURT.yMin) * k;
  const sx = (x) => (COURT.xMax - x) * k;           // mirrored
  const sy = (y) => (COURT.yMax - y) * k;           // baseline at the bottom
  return { k, width, height, sx, sy };
}

function drawCourt(g, S, { stroke = "#3a4152", width = 1.4 } = {}) {
  const { sx, sy, k } = S;
  const c = g.append("g").attr("class", "court-lines").attr("fill", "none").attr("stroke", stroke)
    .attr("stroke-width", width).attr("pointer-events", "none");
  const arc = (cx, cy, r, a0, a1) => {               // angles in degrees, 0 = +x (data space)
    const p = d3.path(), n = 48;
    for (let i = 0; i <= n; i++) {
      const a = ((a0 + (a1 - a0) * i / n) * Math.PI) / 180;
      const X = sx(cx + r * Math.cos(a)), Y = sy(cy + r * Math.sin(a));
      i ? p.lineTo(X, Y) : p.moveTo(X, Y);
    }
    return p.toString();
  };
  // outline + baseline
  c.append("rect").attr("x", sx(25)).attr("y", sy(COURT.yMax)).attr("width", 50 * k).attr("height", COURT.yMax * k);
  // lane (16 ft wide, free-throw line 19 ft from baseline)
  c.append("rect").attr("x", sx(8)).attr("y", sy(19)).attr("width", 16 * k).attr("height", 19 * k);
  c.append("rect").attr("x", sx(6)).attr("y", sy(19)).attr("width", 12 * k).attr("height", 19 * k).attr("opacity", 0.6);
  // free-throw circle (top half)
  c.append("path").attr("d", arc(0, 19, 6, 0, 180));
  // backboard + rim
  c.append("line").attr("x1", sx(3)).attr("x2", sx(-3)).attr("y1", sy(4)).attr("y2", sy(4)).attr("stroke-width", width * 1.6);
  c.append("circle").attr("cx", sx(0)).attr("cy", sy(COURT.hoopY)).attr("r", 0.75 * k).attr("stroke", ACCENT).attr("stroke-width", width * 1.3);
  // restricted area (4 ft arc)
  c.append("path").attr("d", arc(0, COURT.hoopY, 4, 0, 180));
  c.append("line").attr("x1", sx(4)).attr("x2", sx(4)).attr("y1", sy(4)).attr("y2", sy(COURT.hoopY));
  c.append("line").attr("x1", sx(-4)).attr("x2", sx(-4)).attr("y1", sy(4)).attr("y2", sy(COURT.hoopY));
  // three-point line: corners at x = ±22 up to where the 23.75 ft arc starts
  const a0 = (Math.acos(22 / 23.75) * 180) / Math.PI;
  const yJoin = COURT.hoopY + Math.sqrt(23.75 ** 2 - 22 ** 2);
  c.append("line").attr("x1", sx(22)).attr("x2", sx(22)).attr("y1", sy(0)).attr("y2", sy(yJoin));
  c.append("line").attr("x1", sx(-22)).attr("x2", sx(-22)).attr("y1", sy(0)).attr("y2", sy(yJoin));
  c.append("path").attr("d", arc(0, COURT.hoopY, 23.75, a0, 180 - a0));
  return c;
}

// pointy-top hexagon path of radius r (screen px), centred at 0,0
function hexPath(r) {
  const pts = d3.range(6).map((i) => {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
  return "M" + pts.map((p) => p.join(",")).join("L") + "Z";
}

// points-per-shot -> diverging cold/hot color (gray at 1.00)
const ppsColor = d3.scaleDiverging()
  .domain([0.6, 1.0, 1.4])
  .interpolator(d3.piecewise(d3.interpolateRgb.gamma(2.2), [COLD, MID_GRAY, HOT]))
  .clamp(true);

function ppsLegend() {
  const stops = d3.range(0, 1.0001, 0.1).map((t) => ppsColor(0.6 + 0.8 * t));
  return `<span class="legend-gradient">Points per shot <span>0.6</span><i class="bar" style="background:linear-gradient(90deg,${stops.join(",")})"></i><span>1.4+</span></span>`;
}

// approximate court zone of a hex centre (used only for tooltips)
function zoneOf(x, y) {
  const r = Math.hypot(x, y - COURT.hoopY);
  if (Math.abs(x) >= 22 && y <= 14.2) return "Corner 3";
  if (r >= 23.75) return "Above-break 3";
  if (r <= 4) return "Restricted area";
  if (Math.abs(x) <= 8 && y <= 19) return "Paint (non-RA)";
  return "Mid-range";
}

/* ------------------------------------------------------------------ nav ball */
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".brand-ball").forEach((el) => {
    el.innerHTML = `<svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
      <circle cx="16" cy="16" r="14" fill="${ACCENT}"/>
      <g fill="none" stroke="#1a0d02" stroke-width="1.6">
        <path d="M2 16h28M16 2v28"/><path d="M6 6.5c4 4 4 15 0 19"/><path d="M26 6.5c-4 4-4 15 0 19"/>
      </g></svg>`;
  });
});
