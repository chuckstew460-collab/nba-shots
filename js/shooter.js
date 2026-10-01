/* Side-view basketball scene used on the report page: a jointed player figure
   that takes a jump shot, a hoop with a net, and balls that fly on a real
   gravity arc and swish through. Everything is measured in feet and converted
   to pixels with k (px per ft), so the hoop is 10 ft high and the 3-point line
   is 23 ft 9 in from the rim.

   Hoops.scene(host, options) -> { shoot(style), setPlayer(opts), layout(width) }
   styles: "standard" (rise-and-shoot jumper), "pullup" (dribble, then rise),
           "stepback" (drive, step back, fade) */

const Hoops = (() => {
  const G = 32;                                   // gravity, ft/s²
  const RIM_H = 10, RIM_R = 0.75, BALL_R = 0.42, THREE = 23.75;
  const L = { thigh: 1.75, shin: 1.75, torso: 2.05, neck: 0.3, head: 0.42, ua: 1.15, fa: 1.1 };
  const STAND = L.thigh + L.shin;
  const NS = "http://www.w3.org/2000/svg";
  const SKIN = "#d5dae3", SKIN_BACK = "#8d95a5";

  // ---------------------------------------------------------------- poses
  // angles: 0 = pointing down, 90 = pointing at the hoop, 180 = straight up
  const READY = { x: 0, lift: 0, crouch: 0.12, lean: 6, sa: 28, sf: 105, ga: 34, gf: 100 };
  const DIP = { crouch: 0.55, lean: 12, sa: 22, sf: 95, ga: 28, gf: 92 };
  const DRIB = { crouch: 0.32, lean: 16, sa: 52, sf: 72, ga: 30, gf: 84 };
  const STYLES = {
    standard: { release: 0.62, frames: [
      [0.00, READY], [0.20, DIP],
      [0.38, { crouch: 0.25, lean: 6, sa: 115, sf: 168, ga: 105, gf: 165 }],
      [0.48, { crouch: 0, lift: 0.35, lean: 3, sa: 140, sf: 178, ga: 128, gf: 172 }],
      [0.62, { lift: 1.05, lean: 2, sa: 158, sf: 184, ga: 140, gf: 178 }],
      [0.74, { lift: 1.15, sa: 166, sf: 126, ga: 150, gf: 166 }],
      [0.98, { lift: 0.45, sa: 162, sf: 130 }],
      [1.12, { lift: 0, crouch: 0.42, sa: 150, sf: 135, ga: 120, gf: 140 }],
      [1.50, READY],
    ] },
    pullup: { release: 1.14, dribble: [0, 0.62, 0.31], frames: [
      [0.00, { ...DRIB, x: -1.2 }], [0.62, { ...DRIB, x: -0.1 }],
      [0.74, { ...DIP, x: 0 }],
      [0.90, { crouch: 0.25, lean: 6, sa: 115, sf: 168, ga: 105, gf: 165 }],
      [1.00, { crouch: 0, lift: 0.35, lean: 3, sa: 140, sf: 178, ga: 128, gf: 172 }],
      [1.14, { lift: 1.05, lean: 2, sa: 158, sf: 184, ga: 140, gf: 178 }],
      [1.26, { lift: 1.15, sa: 166, sf: 126, ga: 150, gf: 166 }],
      [1.50, { lift: 0.45, sa: 162, sf: 130 }],
      [1.64, { lift: 0, crouch: 0.42, sa: 150, sf: 135, ga: 120, gf: 140 }],
      [2.00, READY],
    ] },
    stepback: { release: 0.92, dribble: [0, 0.3, 0.3], frames: [
      [0.00, { ...DRIB, x: 1.3 }], [0.30, { ...DRIB, x: 1.6, lean: 12 }],
      [0.54, { ...DIP, x: 0.1, lean: -4 }],
      [0.68, { x: 0, crouch: 0.25, lean: -6, sa: 115, sf: 168, ga: 105, gf: 165 }],
      [0.78, { x: -0.1, crouch: 0, lift: 0.35, lean: -8, sa: 140, sf: 178, ga: 128, gf: 172 }],
      [0.92, { x: -0.3, lift: 1.05, lean: -10, sa: 158, sf: 184, ga: 140, gf: 178 }],
      [1.04, { x: -0.4, lift: 1.12, lean: -9, sa: 166, sf: 126, ga: 150, gf: 166 }],
      [1.28, { x: -0.55, lift: 0.42, lean: -6, sa: 162, sf: 130 }],
      [1.42, { x: -0.6, lift: 0, crouch: 0.42, lean: 0, sa: 150, sf: 135, ga: 120, gf: 140 }],
      [1.80, { ...READY, x: -0.6 }],
    ] },
  };
  // fill each keyframe forward so every frame is a full pose
  for (const st of Object.values(STYLES)) {
    let prev = { ...READY };
    st.frames = st.frames.map(([t, p]) => { prev = { ...prev, ...p }; return [t, prev]; });
    st.end = st.frames[st.frames.length - 1][0];
  }
  const KEYS = Object.keys(READY);
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const lerpPose = (a, b, u) => Object.fromEntries(KEYS.map((k) => [k, a[k] + (b[k] - a[k]) * u]));
  function poseAt(frames, t) {
    if (t <= frames[0][0]) return frames[0][1];
    for (let i = 1; i < frames.length; i++) {
      if (t <= frames[i][0]) {
        const [t0, p0] = frames[i - 1], [t1, p1] = frames[i];
        return lerpPose(p0, p1, ease((t - t0) / (t1 - t0)));
      }
    }
    return frames[frames.length - 1][1];
  }
  const dir = (deg) => { const r = (deg * Math.PI) / 180; return [Math.sin(r), Math.cos(r)]; };

  // ---------------------------------------------------------------- scene
  function scene(host, opts = {}) {
    const o = { distFt: 25, jersey: "#ff7a1a", trim: "#1a0d02", kMax: 20, spanFt: 39, onScore: null, onShot: null, ...opts };
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("class", "hoops-svg");
    svg.style.display = "block";
    host.appendChild(svg);
    const el = (tag, attrs = {}, parent = svg) => {
      const e = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      parent.appendChild(e);
      return e;
    };
    const uid = "h" + Math.random().toString(36).slice(2, 8);

    let W = 0, H = 0, k = 20, floorY = 0, rimX = 0, x0 = 0;
    let layer = {}, fig = {}, net = null;
    let pose = { ...READY }, shot = null, queue = [], balls = [], held = null, raf = 0, last = 0;

    const px = (ft) => ft * k;
    const yOf = (ftUp) => floorY - ftUp * k;

    function layout(width) {
      W = Math.max(280, Math.floor(width));
      k = Math.min(o.kMax, W / o.spanFt);
      floorY = Math.round(15.4 * k);
      H = floorY + Math.round(2 * k) + 6;
      rimX = W - 9 * k;
      x0 = rimX - o.distFt * k;
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
      // floor with planks
      el("rect", { x: 0, y: floorY, width: W, height: H - floorY, fill: `url(#${uid}-floor)` });
      for (let x = (rimX % (2.2 * k)) - 2.2 * k; x < W; x += 2.2 * k) el("line", { x1: x, x2: x - 0.8 * k, y1: floorY, y2: H, stroke: "rgba(255,255,255,0.05)" });
      el("line", { x1: 0, x2: W, y1: floorY, y2: floorY, stroke: "rgba(255,255,255,0.18)", "stroke-width": 1.5 });
      // baseline and 3-point line marks on the floor
      const xb = rimX + 5.25 * k, x3 = rimX - THREE * k;
      el("path", { d: `M${xb - 2},${floorY} L${xb + 2},${floorY} L${xb + 2 - 0.6 * k},${H} L${xb - 2 - 0.6 * k},${H} Z`, fill: "rgba(255,255,255,0.55)" });
      el("path", { d: `M${x3 - 2.5},${floorY} L${x3 + 2.5},${floorY} L${x3 + 2.5 - 0.6 * k},${H} L${x3 - 2.5 - 0.6 * k},${H} Z`, fill: "#ff7a1a" });
      const lab = el("text", { x: x3 + 8, y: floorY + 1.25 * k, fill: "#ffb067", "font-size": Math.max(10, 0.62 * k), "font-family": "Oswald, sans-serif", "letter-spacing": "0.08em" });
      lab.textContent = "3-POINT LINE · 23′9″";
      // stanchion, arm, backboard
      const xs = rimX + 8 * k, xbb = rimX + 1.25 * k;
      el("rect", { x: xs - 1.1 * k, y: yOf(2.6), width: 2.2 * k, height: 2.6 * k, rx: 0.3 * k, fill: "#2a3040" });
      el("rect", { x: xs - 0.22 * k, y: yOf(11.6), width: 0.44 * k, height: 9.2 * k, fill: "#3a4152" });
      el("path", { d: `M${xs},${yOf(11.4)} L${xbb + 0.2 * k},${yOf(11.4)} M${xs},${yOf(10.4)} L${xbb + 0.2 * k},${yOf(11.2)}`, stroke: "#3a4152", "stroke-width": 0.28 * k, fill: "none", "stroke-linecap": "round" });
      el("rect", { x: xbb, y: yOf(13), width: 0.2 * k, height: 3.5 * k, fill: "rgba(235,240,250,0.85)", rx: 1 });
      el("line", { x1: xbb - 0.05 * k, x2: rimX + RIM_R * k, y1: yOf(RIM_H) + 1, y2: yOf(RIM_H) + 1, stroke: "#6b7280", "stroke-width": 0.18 * k });

      layer.fig = el("g");
      layer.balls = el("g");
      layer.fx = el("g");
      // rim + net drawn on top so the ball passes "through" them
      const rimY = yOf(RIM_H);
      net = el("g", { transform: `translate(${rimX},${rimY})` });
      const ni = el("g", {}, net);
      const r = RIM_R * k, nb = 1.6 * k, bw = 0.42 * k;
      const strands = [[-r, -bw], [-r * 0.45, -bw * 0.4], [0, 0], [r * 0.45, bw * 0.4], [r, bw]];
      strands.forEach(([a, b]) => el("line", { x1: a, y1: 0, x2: b, y2: nb, stroke: "rgba(240,244,250,0.75)", "stroke-width": 1.1 }, ni));
      [0.33, 0.66].forEach((f) => {
        const y = nb * f, w = r - (r - bw) * f;
        el("path", { d: `M${-w},${y} L${-w * 0.5},${y + 0.18 * k} L0,${y} L${w * 0.5},${y + 0.18 * k} L${w},${y}`, stroke: "rgba(240,244,250,0.6)", "stroke-width": 1, fill: "none" }, ni);
      });
      el("line", { x1: -r, x2: r, y1: 0, y2: 0, stroke: "#ff7a1a", "stroke-width": Math.max(2.5, 0.17 * k), "stroke-linecap": "round" }, net);
      net.inner = ni;

      // figure parts (back limbs first)
      const st = (w, c) => ({ fill: "none", stroke: c, "stroke-width": w, "stroke-linecap": "round", "stroke-linejoin": "round" });
      fig.legB = el("polyline", st(0.36 * k, SKIN_BACK), layer.fig);
      fig.armB = el("polyline", st(0.27 * k, SKIN_BACK), layer.fig);
      fig.shortB = el("line", st(0.55 * k, o.jersey), layer.fig);
      fig.torsoTrim = el("line", st(0.86 * k + 3, o.trim), layer.fig);
      fig.torso = el("line", st(0.86 * k, o.jersey), layer.fig);
      fig.legF = el("polyline", st(0.38 * k, SKIN), layer.fig);
      fig.shortF = el("line", st(0.58 * k, o.jersey), layer.fig);
      fig.shoeB = el("line", st(0.26 * k, o.trim), layer.fig);
      fig.shoeF = el("line", st(0.28 * k, o.trim), layer.fig);
      fig.head = el("circle", { r: L.head * k, fill: SKIN }, layer.fig);
      fig.armF = el("polyline", st(0.28 * k, SKIN), layer.fig);
      if (o.label) {
        fig.label = el("text", { "text-anchor": "end", fill: "#c3c8d4", "font-size": Math.max(10, 0.6 * k), "font-family": "Inter, sans-serif" }, layer.fig);
      }
    }

    // forward kinematics: pose -> joint positions in px
    function joints(p) {
      const hipH = STAND * (1 - 0.32 * p.crouch) + p.lift;
      const hip = [x0 + p.x * k, floorY - hipH * k];
      const air = p.lift > 0.03;
      const footY = air ? Math.min(floorY, hip[1] + STAND * 0.985 * k) : floorY;
      const fF = [hip[0] + (air ? 0.15 : 0.45) * k, footY - (air ? 0.15 * k : 0)];
      const fB = [hip[0] - (air ? 0.4 : 0.55) * k, Math.min(floorY, footY + (air ? -0.25 * k : 0))];
      const knee = (H0, F) => {
        const a = L.thigh * k, b = L.shin * k;
        let dx = F[0] - H0[0], dy = F[1] - H0[1], d = Math.hypot(dx, dy);
        d = Math.max(Math.abs(a - b) + 0.01, Math.min(a + b - 0.01, d));
        const th = Math.atan2(dy, dx), A = Math.acos((a * a + d * d - b * b) / (2 * a * d));
        return [H0[0] + a * Math.cos(th - A), H0[1] + a * Math.sin(th - A)];
      };
      const tdir = [Math.sin((p.lean * Math.PI) / 180), -Math.cos((p.lean * Math.PI) / 180)];
      const sh = [hip[0] + tdir[0] * L.torso * k, hip[1] + tdir[1] * L.torso * k];
      const neck = [sh[0] + tdir[0] * L.neck * k, sh[1] + tdir[1] * L.neck * k];
      const head = [neck[0] + tdir[0] * L.head * k, neck[1] + tdir[1] * L.head * k];
      const arm = (ua, fa) => {
        const u = dir(ua), f = dir(fa);
        const e = [sh[0] + u[0] * L.ua * k, sh[1] + u[1] * L.ua * k];
        const h = [e[0] + f[0] * L.fa * k, e[1] + f[1] * L.fa * k];
        return [e, h, f];
      };
      const [eF, hF, fdir] = arm(p.sa, p.sf), [eB, hB] = arm(p.ga, p.gf);
      const ball = [hF[0] + fdir[0] * BALL_R * k * 1.05, hF[1] + fdir[1] * BALL_R * k * 1.05];
      return { hip, kF: knee(hip, fF), kB: knee(hip, fB), fF, fB, sh, head, eF, hF, eB, hB, ball };
    }

    const pts = (...p) => p.map((q) => q[0].toFixed(1) + "," + q[1].toFixed(1)).join(" ");
    function render() {
      if (!fig.torso) return;
      const J = joints(pose);
      const along = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      fig.legB.setAttribute("points", pts(J.hip, J.kB, J.fB));
      fig.legF.setAttribute("points", pts(J.hip, J.kF, J.fF));
      const set = (e, a, b) => { e.setAttribute("x1", a[0]); e.setAttribute("y1", a[1]); e.setAttribute("x2", b[0]); e.setAttribute("y2", b[1]); };
      set(fig.shortB, J.hip, along(J.hip, J.kB, 0.55));
      set(fig.shortF, J.hip, along(J.hip, J.kF, 0.55));
      set(fig.torso, J.hip, J.sh); set(fig.torsoTrim, J.hip, J.sh);
      set(fig.shoeB, J.fB, [J.fB[0] + 0.45 * k, J.fB[1]]);
      set(fig.shoeF, J.fF, [J.fF[0] + 0.5 * k, J.fF[1]]);
      fig.head.setAttribute("cx", J.head[0]); fig.head.setAttribute("cy", J.head[1]);
      fig.armB.setAttribute("points", pts(J.sh, J.eB, J.hB));
      fig.armF.setAttribute("points", pts(J.sh, J.eF, J.hF));
      if (fig.label) { fig.label.setAttribute("x", rimX - THREE * k - 0.5 * k); fig.label.setAttribute("y", floorY + 1.25 * k); fig.label.textContent = o.label; }
      if (held) {
        let b = J.ball;
        if (shot && shot.style.dribble) {
          const [d0, d1, per] = shot.style.dribble, t = shot.t;
          if (t >= d0 && t <= d1) {
            const ph = ((t - d0) % per) / per, down = Math.sin(Math.PI * ph);      // 0 -> 1 -> 0
            const hand = J.hF, floorB = floorY - BALL_R * k;
            b = [hand[0] + 0.35 * k, hand[1] + (floorB - hand[1]) * down];
          }
        }
        placeBall(held, b[0], b[1], held.rot);
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

    // ball flight in feet: from release point to the centre of the rim, then through the net
    function launch(ballObj, fromPx) {
      const X0 = (fromPx[0] - rimX) / k, Y0 = (floorY - fromPx[1]) / k;
      const dist = -X0, T = 0.95 + 0.009 * dist;
      const vx = dist / T, vy = (RIM_H - Y0 + 0.5 * G * T * T) / T;
      balls.push({ b: ballObj, X0, Y0, vx, vy, T, t: 0, phase: 0 });
    }

    function stepBall(B, dt) {
      B.t += dt;
      let X, Y;
      if (B.t <= B.T) {
        X = B.X0 + B.vx * B.t; Y = B.Y0 + B.vy * B.t - 0.5 * G * B.t * B.t;
        B.b.rot -= 540 * dt;
      } else {
        if (B.phase === 0) { B.phase = 1; swish(); }
        const tn = B.t - B.T, NET = 0.2;
        if (tn <= NET) { X = B.vx * 0.12 * tn; Y = RIM_H - 1.7 * (tn / NET); }
        else {
          if (!B.fall) B.fall = { x: B.vx * 0.12 * NET, y: RIM_H - 1.7, vx: -0.6 - Math.random() * 1.2, vy: -7, t: 0, bounces: 0 };
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

    function swish() {
      net.inner.animate([
        { transform: "scale(1,1) skewX(0deg)" }, { transform: "scale(0.82,1.35) skewX(-6deg)", offset: 0.25 },
        { transform: "scale(1.06,0.92) skewX(4deg)", offset: 0.55 }, { transform: "scale(1,1) skewX(0deg)" },
      ], { duration: 650, easing: "ease-out" });
      const t = el("text", { x: rimX, y: yOf(RIM_H) - 0.6 * k, "text-anchor": "middle", fill: "#ffb067", "font-size": Math.max(14, 1.1 * k), "font-weight": 700, "font-family": "Oswald, sans-serif" }, layer.fx);
      t.textContent = "+3";
      t.animate([{ transform: "translateY(0)", opacity: 1 }, { transform: `translateY(${-1.8 * k}px)`, opacity: 0 }], { duration: 900, easing: "ease-out" }).onfinish = () => t.remove();
      if (o.onScore) o.onScore();
    }

    function startShot(styleName) {
      const style = STYLES[styleName] || STYLES.standard;
      // blend from the current pose into the first frame
      const blend = 0.22;
      const frames = [[0, { ...pose }], ...style.frames.map(([t, p]) => [t + blend, p])];
      shot = { style: { ...style, dribble: style.dribble && [style.dribble[0] + blend, style.dribble[1] + blend, style.dribble[2]] }, frames, release: style.release + blend, end: style.end + blend, t: 0, released: false, name: styleName };
      if (!held) newHeldBall(true);
      if (o.onShot) o.onShot(styleName);
      kick();
    }

    function tick(now) {
      const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
      last = now;
      if (shot) {
        shot.t += dt;
        pose = poseAt(shot.frames, shot.t);
        if (!shot.released && shot.t >= shot.release) {
          shot.released = true;
          const J = joints(pose);
          const b = held; held = null;
          if (b) launch(b, J.ball);
        }
        if (shot.t >= shot.end) {
          shot = null;
          newHeldBall(true);
          if (queue.length) startShot(queue.shift());
        }
      }
      balls = balls.filter((B) => stepBall(B, dt));
      render();
      if (shot || balls.length || queue.length) raf = requestAnimationFrame(tick);
      else raf = 0;
    }
    function kick() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } }

    return {
      layout,
      shoot(style = "standard") {
        if (!shot) startShot(style);
        else if (queue.length < 4) queue.push(style);
      },
      setPlayer(p) {
        Object.assign(o, p);
        queue = []; shot = null; pose = { ...READY };
        if (W) layout(W);
      },
      get busy() { return !!shot; },
    };
  }

  return { scene, STYLES };
})();
