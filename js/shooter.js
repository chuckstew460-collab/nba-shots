/* Side-view basketball scene used on the report page: a jointed player figure
   that moves, shoots and dunks, a hoop with a net, and balls that fly on a real
   gravity arc and swish through. Everything is measured in feet and converted to
   pixels with k (px per ft): the rim is 10 ft high, the 3-point line 23 ft 9 in out.

   Hoops.scene(host, options) -> {
     layout(width), shoot(style), dunk(), move(dir), setPlayer(opts), distance
   }
   styles: "standard" (rise-and-shoot), "pullup" (dribble, then rise),
           "stepback" (drive, step back, fade)

   A player profile sets the look and the motion:
     { heightIn, build, jersey, trim, numColor, number, hair: "short" | "tall", beard, lefty,
       motion: { tempo, jump, dip, early, setHigh, fade, step, hold, turnAway } }
   The motions are stylized cartoons, not motion capture. */

const Hoops = (() => {
  const G = 32;                                   // gravity, ft/s²
  const RIM_H = 10, RIM_R = 0.75, BALL_R = 0.42, THREE = 23.75;
  const BASE_IN = 78;                             // limb lengths below are for a 6'6" player
  const LB = { thigh: 1.75, shin: 1.75, torso: 2.05, neck: 0.3, head: 0.42, ua: 1.15, fa: 1.1 };
  const NS = "http://www.w3.org/2000/svg";
  const SKIN = "#d5dae3", SKIN_BACK = "#8d95a5", HAIR = "#23262e";
  const MIN_FT = 1.1, MAX_FT = 29.5, RUN = 11;   // movement limits (ft from rim) and speed (ft/s)

  // ---------------------------------------------------------------- poses
  // arm angles: 0 = pointing down, 90 = pointing at the hoop, 180 = straight up
  const READY = { x: 0, lift: 0, crouch: 0.12, lean: 6, sa: 28, sf: 105, ga: 34, gf: 100, stride: 0, face: 1 };
  const KEYS = Object.keys(READY);
  const DRIB = { crouch: 0.32, lean: 16, sa: 52, sf: 72, ga: 30, gf: 84, stride: 0 };
  const MOTION = { tempo: 1, jump: 1, dip: 1, early: 0, setHigh: 0, fade: 0, step: 1.6, hold: 1, turnAway: 0 };

  // the jump shot itself, starting with the dip at time s; x drifts back by `fade` while airborne
  function jumper(s, M, x, fade, leanAir) {
    const pk = 1.15 * M.jump, rel = (M.early ? 0.72 : 1.05) * M.jump, tRel = s + (M.early ? 0.36 : 0.42);
    const tFt = s + 0.54, tDesc = tFt + 0.24 * M.hold, tLand = tDesc + 0.14;
    const frames = [
      [s, { x, crouch: Math.min(0.75, 0.55 * M.dip), lean: 12 - fade * 10, sa: 22, sf: 95, ga: 28, gf: 92, stride: 0 }],
      [s + 0.18, { x, crouch: 0.25, lean: 6 - fade * 10, sa: 115, sf: 168, ga: 105, gf: 165 }],
      [s + 0.28, { x: x - 0.1 * fade, crouch: 0, lift: 0.35 * M.jump, lean: leanAir + 1, sa: 140 + M.setHigh * 0.5, sf: 178, ga: 128, gf: 172 }],
      [tRel, { x: x - 0.3 * fade, lift: rel, lean: leanAir, sa: 158 + M.setHigh, sf: 184, ga: 140 + M.setHigh * 0.5, gf: 178 }],
      [tFt, { x: x - 0.45 * fade, lift: pk, sa: 166 + M.setHigh * 0.5, sf: 126, ga: 150, gf: 166 }],
      [tDesc, { x: x - 0.6 * fade, lift: 0.45 * M.jump, sa: 162, sf: 130, face: M.turnAway ? -1 : 1 }],
      [tLand, { x: x - 0.65 * fade, lift: 0, crouch: 0.42, lean: 0, sa: 150, sf: 135, ga: 120, gf: 140 }],
      [tLand + 0.38, { ...READY, x: x - 0.65 * fade, face: M.turnAway ? -1 : 1 }],
    ];
    return { frames, release: tRel };
  }

  function build(type, M, distFt) {
    let frames, release, dribble = null, kind = "shot";
    if (type === "dunk") {
      // offsets are "distance covered toward the rim"; every dunk lands about 1 ft in front of it
      const off = (d) => distFt - d, run = Math.max(0, off(3.6)), tr = Math.max(0.12, run / 14);
      kind = "dunk";
      frames = [
        [0, { x: 0, crouch: 0.25, lean: 14, sa: 40, sf: 80, ga: 35, gf: 85, stride: run > 0 ? 1 : 0 }],
        [tr, { x: run, crouch: 0.3, lean: 14 }],
        [tr + 0.12, { x: Math.max(run, off(3.1)), crouch: 0.55, lean: 10, stride: 0, sa: 60, sf: 120, ga: 55, gf: 120 }],
        [tr + 0.3, { x: off(2.5), crouch: 0, lift: 0.9, lean: 4, sa: 150, sf: 170, ga: 150, gf: 170 }],
        [tr + 0.48, { x: off(1.7), lift: 3.0, lean: 6, sa: 168, sf: 176, ga: 166, gf: 176 }],
        [tr + 0.56, { x: off(1.4), lift: 2.75, lean: 14, sa: 125, sf: 118, ga: 130, gf: 125 }],
        [tr + 0.64, { x: off(1.3), lift: 2.5, lean: 0, sa: 176, sf: 179, ga: 176, gf: 179 }],
        [tr + 0.98, { x: off(1.25), lift: 2.45, lean: 2, sa: 177, sf: 180, ga: 177, gf: 180 }],
        [tr + 1.18, { x: off(1.1), lift: 0, crouch: 0.5, lean: 4, sa: 60, sf: 70, ga: 55, gf: 75 }],
        [tr + 1.55, { ...READY, x: off(1.1) }],
      ];
      release = tr + 0.55;
    } else if (type === "pullup") {
      dribble = [0, 0.62, 0.31];
      const j = jumper(0.74, M, 0, M.fade, 2 - 10 * M.fade);
      frames = [[0, { ...DRIB, x: -1.2 }], [0.62, { ...DRIB, x: -0.1 }], ...j.frames];
      release = j.release;
    } else if (type === "stepback") {
      dribble = [0, 0.3, 0.3];
      const fade = Math.max(0.3, M.fade), j = jumper(0.54, M, 0.1, fade, -4 - 10 * fade);
      frames = [[0, { ...DRIB, x: M.step * 0.8 }], [0.3, { ...DRIB, x: M.step, lean: 12 }], ...j.frames];
      release = j.release;
    } else {
      const j = jumper(0.2, M, 0, M.fade, 2 - 10 * M.fade);
      frames = [[0, { ...READY }], ...j.frames];
      release = j.release;
    }
    // tempo: quicker shooters run the whole clip faster (the dunk keeps real time)
    const sc = type === "dunk" ? 1 : 1 / M.tempo;
    let prev = { ...READY };
    frames = frames.map(([t, p]) => { prev = { ...prev, ...p }; return [t * sc, prev]; });
    return { frames, release: release * sc, end: frames[frames.length - 1][0], kind,
      dribble: dribble && dribble.map((v) => v * sc) };
  }

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const lerpPose = (a, b, u) => Object.fromEntries(KEYS.map((key) => [key, a[key] + (b[key] - a[key]) * u]));
  function poseAt(frames, t) {
    if (t <= frames[0][0]) return frames[0][1];
    for (let i = 1; i < frames.length; i++) {
      if (t <= frames[i][0]) {
        const [t0, p0] = frames[i - 1], [t1, p1] = frames[i];
        return lerpPose(p0, p1, t1 > t0 ? ease((t - t0) / (t1 - t0)) : 1);
      }
    }
    return frames[frames.length - 1][1];
  }
  const dir = (deg) => { const r = (deg * Math.PI) / 180; return [Math.sin(r), Math.cos(r)]; };

  // ---------------------------------------------------------------- scene
  function scene(host, opts = {}) {
    const o = { distFt: 25, kMax: 20, spanFt: 39, label: "", onScore: null, onShot: null, onMove: null, ...opts };
    let P = profile(opts.player);
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "hoops-svg");
    svg.style.display = "block";
    host.appendChild(svg);
    const el = (tag, attrs = {}, parent = svg) => {
      const e = document.createElementNS(NS, tag);
      for (const [a, v] of Object.entries(attrs)) e.setAttribute(a, v);
      parent.appendChild(e);
      return e;
    };
    const uid = "h" + Math.random().toString(36).slice(2, 8);

    let W = 0, H = 0, k = 20, floorY = 0, rimX = 0, posFt = o.distFt;
    let layer = {}, fig = {}, net = null, shake = null;
    let pose = { ...READY }, shot = null, queue = [], balls = [], held = null, raf = 0, last = 0;
    let moveDir = 0, runPhase = 0, lastX = 0;

    function profile(p = {}) {
      return { heightIn: 78, build: 1, jersey: "#ff7a1a", trim: "#1a0d02", number: "", hair: "short", beard: false, lefty: false,
        ...p, motion: { ...MOTION, ...(p.motion || {}) } };
    }
    const x0 = () => rimX - posFt * k;
    const yOf = (ftUp) => floorY - ftUp * k;

    function layout(width) {
      W = Math.max(280, Math.floor(width));
      k = Math.min(o.kMax, W / o.spanFt);
      floorY = Math.round(15.6 * k);
      H = floorY + Math.round(2 * k) + 6;
      rimX = W - 9 * k;
      svg.setAttribute("width", W); svg.setAttribute("height", H);
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      svg.innerHTML = "";
      balls = []; held = null; shot = null; queue = []; pose = { ...READY };
      drawStatic();
      newHeldBall(false);
      render();
    }

    function drawStatic() {
      const defs = el("defs");
      defs.innerHTML = `
        <radialGradient id="${uid}-ball" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stop-color="#ffb26b"/><stop offset="55%" stop-color="#f26d1d"/><stop offset="100%" stop-color="#a8420a"/>
        </radialGradient>
        <linearGradient id="${uid}-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#3a2a1c"/><stop offset="100%" stop-color="#1c140e"/>
        </linearGradient>
        <radialGradient id="${uid}-glow" cx="80%" cy="0%" r="90%">
          <stop offset="0%" stop-color="rgba(255,122,26,0.16)"/><stop offset="100%" stop-color="rgba(255,122,26,0)"/>
        </radialGradient>`;
      el("rect", { x: 0, y: 0, width: W, height: H, fill: `url(#${uid}-glow)` });
      el("rect", { x: 0, y: floorY, width: W, height: H - floorY, fill: `url(#${uid}-floor)` });
      for (let x = (rimX % (2.2 * k)) - 2.2 * k; x < W; x += 2.2 * k) el("line", { x1: x, x2: x - 0.8 * k, y1: floorY, y2: H, stroke: "rgba(255,255,255,0.05)" });
      el("line", { x1: 0, x2: W, y1: floorY, y2: floorY, stroke: "rgba(255,255,255,0.18)", "stroke-width": 1.5 });
      const xb = rimX + 5.25 * k, x3 = rimX - THREE * k;
      el("path", { d: `M${xb - 2},${floorY} L${xb + 2},${floorY} L${xb + 2 - 0.6 * k},${H} L${xb - 2 - 0.6 * k},${H} Z`, fill: "rgba(255,255,255,0.55)" });
      el("path", { d: `M${x3 - 2.5},${floorY} L${x3 + 2.5},${floorY} L${x3 + 2.5 - 0.6 * k},${H} L${x3 - 2.5 - 0.6 * k},${H} Z`, fill: "#ff7a1a" });
      const lab = el("text", { x: x3 + 8, y: floorY + 1.25 * k, fill: "#ffb067", "font-size": Math.max(10, 0.62 * k), "font-family": "Oswald, sans-serif", "letter-spacing": "0.08em" });
      lab.textContent = "3-POINT LINE · 23′9″";
      const xs = rimX + 8 * k, xbb = rimX + 1.25 * k;
      el("rect", { x: xs - 1.1 * k, y: yOf(2.6), width: 2.2 * k, height: 2.6 * k, rx: 0.3 * k, fill: "#2a3040" });
      el("rect", { x: xs - 0.22 * k, y: yOf(11.6), width: 0.44 * k, height: 9.2 * k, fill: "#3a4152" });
      el("path", { d: `M${xs},${yOf(11.4)} L${xbb + 0.2 * k},${yOf(11.4)} M${xs},${yOf(10.4)} L${xbb + 0.2 * k},${yOf(11.2)}`, stroke: "#3a4152", "stroke-width": 0.28 * k, fill: "none", "stroke-linecap": "round" });
      el("rect", { x: xbb, y: yOf(13), width: 0.2 * k, height: 3.5 * k, fill: "rgba(235,240,250,0.85)", rx: 1 });
      el("line", { x1: xbb - 0.05 * k, x2: rimX + RIM_R * k, y1: yOf(RIM_H) + 1, y2: yOf(RIM_H) + 1, stroke: "#6b7280", "stroke-width": 0.18 * k });

      layer.fig = el("g");
      layer.balls = el("g");
      layer.fx = el("g");
      // rim + net on top so the ball passes "through" them
      net = el("g", { transform: `translate(${rimX},${yOf(RIM_H)})` });
      shake = el("g", {}, net);
      const ni = el("g", {}, shake);
      const r = RIM_R * k, nb = 1.6 * k, bw = 0.42 * k;
      [[-r, -bw], [-r * 0.45, -bw * 0.4], [0, 0], [r * 0.45, bw * 0.4], [r, bw]].forEach(([a, b]) =>
        el("line", { x1: a, y1: 0, x2: b, y2: nb, stroke: "rgba(240,244,250,0.75)", "stroke-width": 1.1 }, ni));
      [0.33, 0.66].forEach((f) => {
        const y = nb * f, w = r - (r - bw) * f;
        el("path", { d: `M${-w},${y} L${-w * 0.5},${y + 0.18 * k} L0,${y} L${w * 0.5},${y + 0.18 * k} L${w},${y}`, stroke: "rgba(240,244,250,0.6)", "stroke-width": 1, fill: "none" }, ni);
      });
      el("line", { x1: -r, x2: r, y1: 0, y2: 0, stroke: "#ff7a1a", "stroke-width": Math.max(2.5, 0.17 * k), "stroke-linecap": "round" }, shake);
      net.inner = ni;
      drawFigure();
    }

    function drawFigure() {
      layer.fig.innerHTML = "";
      const s = P.heightIn / BASE_IN, b = P.build;
      const st = (w, c) => ({ fill: "none", stroke: c, "stroke-width": w, "stroke-linecap": "round", "stroke-linejoin": "round" });
      const g = el("g", {}, layer.fig);
      fig = { g };
      fig.legB = el("polyline", st(0.36 * k * s * b, SKIN_BACK), g);
      fig.armFar = el("polyline", st(0.27 * k * s * b, SKIN_BACK), g);
      fig.shortB = el("line", st(0.56 * k * s * b, P.jersey), g);
      fig.jersey = el("path", { fill: P.jersey, stroke: P.trim, "stroke-width": Math.max(1.5, 0.08 * k), "stroke-linejoin": "round" }, g);
      fig.num = el("text", { "text-anchor": "middle", "dominant-baseline": "central", fill: P.trim, "font-family": "Oswald, sans-serif", "font-weight": 600, "font-size": Math.max(7, 0.62 * k * s) }, g);
      fig.num.setAttribute("fill", P.numColor || P.trim);
      fig.num.textContent = P.number;
      fig.legF = el("polyline", st(0.38 * k * s * b, SKIN), g);
      fig.shortF = el("line", st(0.6 * k * s * b, P.jersey), g);
      fig.shoeB = el("line", st(0.26 * k * s, P.trim), g);
      fig.shoeF = el("line", st(0.28 * k * s, P.trim), g);
      fig.head = el("circle", { r: LB.head * k * s, fill: SKIN }, g);
      fig.hair = el("path", { fill: HAIR }, g);
      fig.beard = P.beard ? el("path", { fill: HAIR }, g) : null;
      fig.armNear = el("polyline", st(0.28 * k * s * b, SKIN), g);
      if (o.label) fig.label = el("text", { "text-anchor": "end", fill: "#c3c8d4", "font-size": Math.max(10, 0.6 * k), "font-family": "Inter, sans-serif" }, layer.fig);
    }

    // forward kinematics: pose -> joint positions in px
    function joints(p) {
      const s = P.heightIn / BASE_IN, L = Object.fromEntries(Object.entries(LB).map(([n, v]) => [n, v * s]));
      const STAND = L.thigh + L.shin;
      const hipH = STAND * (1 - 0.32 * p.crouch) + p.lift;
      const hip = [x0() + p.x * k, floorY - hipH * k];
      const air = p.lift > 0.03;
      const footY = air ? Math.min(floorY, hip[1] + STAND * 0.985 * k) : floorY;
      // running: the feet swing through a stride cycle
      const sw = p.stride * Math.sin(runPhase), lf = p.stride * 0.45 * k;
      const fF = [hip[0] + (air ? 0.15 : 0.45 * (1 - p.stride)) * k + sw * k, footY - (air ? 0.15 * k : Math.max(0, Math.cos(runPhase)) * lf)];
      const fB = [hip[0] - (air ? 0.4 : 0.55 * (1 - p.stride)) * k - sw * k,
        Math.min(floorY, footY + (air ? -0.25 * k : 0)) - (air ? 0 : Math.max(0, -Math.cos(runPhase)) * lf)];
      const knee = (H0, F) => {
        const a = L.thigh * k, c = L.shin * k;
        let d = Math.hypot(F[0] - H0[0], F[1] - H0[1]);
        d = Math.max(Math.abs(a - c) + 0.01, Math.min(a + c - 0.01, d));
        const th = Math.atan2(F[1] - H0[1], F[0] - H0[0]), A = Math.acos((a * a + d * d - c * c) / (2 * a * d));
        return [H0[0] + a * Math.cos(th - A), H0[1] + a * Math.sin(th - A)];
      };
      const tdir = [Math.sin((p.lean * Math.PI) / 180), -Math.cos((p.lean * Math.PI) / 180)];
      const sh = [hip[0] + tdir[0] * L.torso * k, hip[1] + tdir[1] * L.torso * k];
      const neck = [sh[0] + tdir[0] * L.neck * k, sh[1] + tdir[1] * L.neck * k];
      const head = [neck[0] + tdir[0] * L.head * k, neck[1] + tdir[1] * L.head * k];
      const arm = (ua, fa) => {
        const u = dir(ua), f = dir(fa);
        const e = [sh[0] + u[0] * L.ua * k, sh[1] + u[1] * L.ua * k];
        return [e, [e[0] + f[0] * L.fa * k, e[1] + f[1] * L.fa * k], f];
      };
      const [eS, hS, fS] = arm(p.sa, p.sf), [eG, hG] = arm(p.ga, p.gf);
      const ball = [hS[0] + fS[0] * BALL_R * k * 1.05, hS[1] + fS[1] * BALL_R * k * 1.05];
      return { hip, kF: knee(hip, fF), kB: knee(hip, fB), fF, fB, sh, head, eS, hS, eG, hG, ball, tdir, s };
    }

    const pts = (...p) => p.map((q) => q[0].toFixed(1) + "," + q[1].toFixed(1)).join(" ");
    const flipX = (J, x) => J.hip[0] + pose.face * (x - J.hip[0]);   // mirror around the hip when turned away

    function render() {
      if (!fig.jersey) return;
      const J = joints(pose), s = J.s;
      const along = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      const set = (e, a, b) => { e.setAttribute("x1", a[0]); e.setAttribute("y1", a[1]); e.setAttribute("x2", b[0]); e.setAttribute("y2", b[1]); };
      fig.g.setAttribute("transform", `translate(${J.hip[0]},0) scale(${pose.face.toFixed(3)},1) translate(${-J.hip[0]},0)`);
      fig.legB.setAttribute("points", pts(J.hip, J.kB, J.fB));
      fig.legF.setAttribute("points", pts(J.hip, J.kF, J.fF));
      set(fig.shortB, J.hip, along(J.hip, J.kB, 0.55));
      set(fig.shortF, J.hip, along(J.hip, J.kF, 0.55));
      // jersey: a tapered panel from hip to shoulder, number on it
      const n = [-J.tdir[1], J.tdir[0]], wH = 0.42 * k * s * P.build, wS = 0.5 * k * s * P.build;
      const top = [J.sh[0] - J.tdir[0] * 0.1 * k, J.sh[1] - J.tdir[1] * 0.1 * k];
      fig.jersey.setAttribute("d", `M${J.hip[0] + n[0] * wH},${J.hip[1] + n[1] * wH} L${top[0] + n[0] * wS},${top[1] + n[1] * wS} ` +
        `L${top[0] - n[0] * wS},${top[1] - n[1] * wS} L${J.hip[0] - n[0] * wH},${J.hip[1] - n[1] * wH} Z`);
      const mid = along(J.hip, J.sh, 0.55), sg = pose.face < 0 ? -1 : 1;
      fig.num.setAttribute("transform", `translate(${mid[0]},${mid[1]}) scale(${sg},1) rotate(${(pose.lean * sg).toFixed(1)})`);
      set(fig.shoeB, J.fB, [J.fB[0] + 0.45 * k * s, J.fB[1]]);
      set(fig.shoeF, J.fF, [J.fF[0] + 0.5 * k * s, J.fF[1]]);
      const hr = LB.head * k * s, [cx, cy] = J.head;
      fig.head.setAttribute("cx", cx); fig.head.setAttribute("cy", cy);
      fig.hair.setAttribute("d", P.hair === "tall"
        ? `M${cx - hr * 1.05},${cy - hr * 0.05} C${cx - hr * 1.2},${cy - hr * 1.9} ${cx + hr * 1.1},${cy - hr * 1.9} ${cx + hr * 0.95},${cy - hr * 0.35} Q${cx},${cy - hr * 0.75} ${cx - hr * 1.05},${cy - hr * 0.05} Z`
        : `M${cx - hr * 1.0},${cy - hr * 0.1} A${hr} ${hr} 0 0 1 ${cx + hr * 0.92},${cy - hr * 0.4} Q${cx},${cy - hr * 0.62} ${cx - hr * 1.0},${cy - hr * 0.1} Z`);
      if (fig.beard) fig.beard.setAttribute("d", `M${cx - hr * 0.55},${cy - hr * 0.05} Q${cx + hr * 1.3},${cy - hr * 0.1} ${cx + hr * 1.05},${cy + hr * 0.85} Q${cx + hr * 0.45},${cy + hr * 1.85} ${cx - hr * 0.55},${cy + hr * 1.0} Z`);
      // right-handers shoot with the far arm (we see their left side); lefties with the near arm
      const shootArm = pts(J.sh, J.eS, J.hS), guideArm = pts(J.sh, J.eG, J.hG);
      fig.armNear.setAttribute("points", P.lefty ? shootArm : guideArm);
      fig.armFar.setAttribute("points", P.lefty ? guideArm : shootArm);
      if (fig.label) { fig.label.setAttribute("x", rimX - THREE * k - 0.5 * k); fig.label.setAttribute("y", floorY + 1.25 * k); fig.label.textContent = o.label; }
      if (held) {
        let b = J.ball;
        if (shot && shot.dribble) {
          const [d0, d1, per] = shot.dribble, t = shot.t;
          if (t >= d0 && t <= d1) {
            const down = Math.sin(Math.PI * (((t - d0) % per) / per));
            b = [J.hS[0] + 0.35 * k, J.hS[1] + (floorY - BALL_R * k - J.hS[1]) * down];
          }
        }
        if (pose.stride > 0.3 && (!shot || shot.kind === "dunk")) {   // dribble while running
          const down = Math.abs(Math.sin(runPhase));
          b = [J.hS[0] + 0.45 * k, J.hS[1] + (floorY - BALL_R * k - J.hS[1]) * down];
        }
        placeBall(held, flipX(J, b[0]), b[1], held.rot);
      }
    }

    function makeBall() {
      const g = el("g", {}, layer.balls);
      const r = BALL_R * k;
      el("circle", { r, fill: `url(#${uid}-ball)`, stroke: "#6b2a06", "stroke-width": 0.8 }, g);
      el("path", { d: `M0,${-r} L0,${r} M${-r},0 L${r},0 M${-r * 0.7},${-r * 0.7} Q0,0 ${-r * 0.7},${r * 0.7} M${r * 0.7},${-r * 0.7} Q0,0 ${r * 0.7},${r * 0.7}`, stroke: "#5a2305", "stroke-width": 0.8, fill: "none", opacity: 0.8 }, g);
      return { g, rot: 0 };
    }
    function placeBall(b, x, y, rot) { b.g.setAttribute("transform", `translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${rot.toFixed(0)})`); }
    function newHeldBall(fade) {
      held = makeBall();
      if (fade) { held.g.style.opacity = 0; held.g.style.transition = "opacity 0.2s"; requestAnimationFrame(() => (held.g.style.opacity = 1)); }
    }

    // jump shot: a gravity arc from the release point to the centre of the rim
    function launch(ballObj, fromPx, points) {
      const X0 = (fromPx[0] - rimX) / k, Y0 = (floorY - fromPx[1]) / k;
      const T = 0.95 + 0.009 * Math.abs(X0);
      balls.push({ b: ballObj, X0, Y0, vx: -X0 / T, vy: (RIM_H - Y0 + 0.5 * G * T * T) / T, T, t: 0, phase: 0, points, dunk: false });
    }
    // dunk: hammered straight down through the rim
    function launchDunk(ballObj, fromPx) {
      const X0 = (fromPx[0] - rimX) / k, Y0 = (floorY - fromPx[1]) / k;
      balls.push({ b: ballObj, X0, Y0, T: 0.09, t: 0, phase: 0, points: 2, dunk: true, vx: 0 });
    }

    function stepBall(B, dt) {
      B.t += dt;
      let X, Y;
      if (B.t <= B.T) {
        if (B.dunk) { const u = B.t / B.T; X = B.X0 * (1 - u); Y = B.Y0 + (RIM_H - B.Y0) * u; }
        else { X = B.X0 + B.vx * B.t; Y = B.Y0 + B.vy * B.t - 0.5 * G * B.t * B.t; B.b.rot -= 540 * dt; }
      } else {
        if (B.phase === 0) { B.phase = 1; swish(B); }
        const tn = B.t - B.T, NET = B.dunk ? 0.12 : 0.2;
        if (tn <= NET) { X = B.vx * 0.12 * tn; Y = RIM_H - 1.7 * (tn / NET); }
        else {
          if (!B.fall) B.fall = { x: B.vx * 0.12 * NET, y: RIM_H - 1.7, vx: -0.6 - Math.random() * 1.2, vy: B.dunk ? -14 : -7, t: 0, bounces: 0 };
          const f = B.fall;
          f.t += dt; f.vy -= G * dt; f.x += f.vx * dt; f.y += f.vy * dt;
          if (f.y <= BALL_R) { f.y = BALL_R; f.vy = -f.vy * 0.55; f.vx *= 0.8; f.bounces++; }
          X = f.x; Y = f.y;
          B.b.rot += f.vx * 60 * dt;
          if (f.bounces >= 2) B.b.g.style.opacity = Math.max(0, 1 - (f.t - 0.9) / 0.5);
          if (f.t > 1.6) { B.b.g.remove(); return false; }
        }
      }
      placeBall(B.b, rimX + X * k, floorY - Y * k, B.b.rot);
      return true;
    }

    function swish(B) {
      net.inner.animate([
        { transform: "scale(1,1) skewX(0deg)" }, { transform: `scale(0.82,${B.dunk ? 1.55 : 1.35}) skewX(-6deg)`, offset: 0.25 },
        { transform: "scale(1.06,0.92) skewX(4deg)", offset: 0.55 }, { transform: "scale(1,1) skewX(0deg)" },
      ], { duration: 650, easing: "ease-out" });
      if (B.dunk) shake.animate([{ transform: "translateY(0) rotate(0deg)" }, { transform: `translateY(${0.25 * k}px) rotate(4deg)`, offset: 0.2 },
        { transform: "translateY(-2px) rotate(-2deg)", offset: 0.5 }, { transform: "translateY(0) rotate(0deg)" }], { duration: 700, easing: "ease-out" });
      const t = el("text", { x: rimX, y: yOf(RIM_H) - 0.6 * k, "text-anchor": "middle", fill: "#ffb067", "font-size": Math.max(14, 1.1 * k), "font-weight": 700, "font-family": "Oswald, sans-serif" }, layer.fx);
      t.textContent = B.dunk ? "SLAM! +2" : `+${B.points}`;
      t.animate([{ transform: "translateY(0)", opacity: 1 }, { transform: `translateY(${-1.8 * k}px)`, opacity: 0 }], { duration: 900, easing: "ease-out" }).onfinish = () => t.remove();
      if (o.onScore) o.onScore(B.points, B.dunk ? "dunk" : B.points === 3 ? "three" : "two");
    }

    function startShot(type) {
      // turnAway can be a probability (e.g. 0.5 = on about half his shots)
      const M = { ...P.motion, turnAway: Math.random() < P.motion.turnAway ? 1 : 0 };
      const clip = build(type, M, posFt);
      const blend = 0.22;   // ease from wherever the figure is into the first frame
      shot = { ...clip, frames: [[0, { ...pose }], ...clip.frames.map(([t, p]) => [t + blend, p])], release: clip.release + blend,
        end: clip.end + blend, dribble: clip.dribble && [clip.dribble[0] + blend, clip.dribble[1] + blend, clip.dribble[2]], t: 0, released: false, type };
      lastX = pose.x;
      if (!held) newHeldBall(true);
      if (o.onShot) o.onShot(type);
      kick();
    }

    function tick(now) {
      const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
      last = now;
      if (shot) {
        shot.t += dt;
        pose = poseAt(shot.frames, shot.t);
        runPhase += ((pose.x - lastX) / 3) * Math.PI * 2;
        lastX = pose.x;
        if (!shot.released && shot.t >= shot.release) {
          shot.released = true;
          const J = joints(pose), b = held;
          held = null;
          if (b) {
            if (shot.kind === "dunk") launchDunk(b, J.ball);
            else launch(b, J.ball, posFt - pose.x >= THREE ? 3 : 2);
          }
        }
        if (shot.t >= shot.end) {
          // commit the distance the move covered (step-backs, dunks) to the player's spot
          posFt = Math.max(MIN_FT, Math.min(MAX_FT, posFt - pose.x));
          pose = { ...pose, x: 0 };
          lastX = 0;
          shot = null;
          newHeldBall(true);
          if (o.onMove) o.onMove(posFt);
          if (queue.length) startShot(queue.shift());
        }
      } else if (moveDir) {
        const before = posFt;
        posFt = Math.max(MIN_FT, Math.min(MAX_FT, posFt - moveDir * RUN * dt));
        runPhase += (Math.abs(posFt - before) / 3) * Math.PI * 2;
        pose = { ...pose, stride: Math.min(1, pose.stride + dt * 6), crouch: 0.2, lean: 6 + 6 * moveDir, face: Math.min(1, pose.face + dt * 6) };
        if (o.onMove) o.onMove(posFt);
      } else if (pose.stride > 0 || pose.face !== 1) {
        pose = { ...pose, stride: Math.max(0, pose.stride - dt * 6), face: Math.min(1, pose.face + dt * 6), lean: pose.lean + (6 - pose.lean) * Math.min(1, dt * 8) };
      }
      balls = balls.filter((B) => stepBall(B, dt));
      render();
      if (shot || balls.length || queue.length || moveDir || pose.stride > 0 || pose.face !== 1) raf = requestAnimationFrame(tick);
      else raf = 0;
    }
    function kick() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } }

    return {
      layout,
      shoot(type = "standard") {
        if (!shot) startShot(type);
        else if (queue.length < 4) queue.push(type);
      },
      dunk() {
        if (!shot) startShot("dunk");
        else if (queue.length < 4) queue.push("dunk");
      },
      move(d) { moveDir = d; if (d) kick(); },
      setPlayer(p) {
        if (p.player) P = profile(p.player);
        Object.assign(o, p);
        if (p.distFt != null) posFt = p.distFt;
        queue = []; shot = null; moveDir = 0; pose = { ...READY };
        if (W) layout(W);
      },
      get distance() { return posFt; },
      get busy() { return !!shot; },
    };
  }

  return { scene };
})();
