/* Arcade sound effects for the playable court on the report page.
   Every sound is synthesized with the Web Audio API (filtered noise and oscillators):
   there are no audio files, so nothing is copied from a broadcast or a game.
   Nothing plays until the reader interacts with the court; the speaker button or the
   M key mutes everything, and the choice is remembered in this browser. */

const Sfx = (() => {
  const KEY = "deeprange-muted", LEVEL = 0.7;
  let ctx = null, master = null, noiseBuf = null, muted = false;
  try { muted = localStorage.getItem(KEY) === "1"; } catch (e) { /* storage blocked: default to sound on */ }

  function init() {
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return true; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : LEVEL;
    const comp = ctx.createDynamicsCompressor();       // keeps stacked sounds (dunk + crowd) from clipping
    master.connect(comp); comp.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }
  const ready = () => !muted && init();

  // filtered noise burst: filters is a list of [type, freq, Q] (freq can sweep to freqTo)
  function noise(t, dur, { filters = [["bandpass", 1000, 1]], gain = 0.3, attack = 0.005, freqTo = null, lfo = 0, lfoDepth = 0 } = {}) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    let node = src;
    filters.forEach(([type, f, q], i) => {
      const bq = ctx.createBiquadFilter();
      bq.type = type; bq.frequency.setValueAtTime(f, t); bq.Q.value = q;
      if (freqTo && i === 0) bq.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
      node.connect(bq); node = bq;
    });
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    node.connect(g);
    if (lfo) {                                          // tremolo, for the crowd's rumble
      const trem = ctx.createGain(), osc = ctx.createOscillator(), depth = ctx.createGain();
      osc.frequency.value = lfo; depth.gain.value = lfoDepth; trem.gain.value = 1 - lfoDepth;
      osc.connect(depth); depth.connect(trem.gain); g.connect(trem); trem.connect(master);
      osc.start(t); osc.stop(t + dur + 0.05);
    } else g.connect(master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }
  function tone(t, { freq, freqTo = null, dur, gain, type = "sine", attack = 0.002 }) {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqTo) osc.frequency.exponentialRampToValueAtTime(freqTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(master);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  const api = {
    unlock: init,                                       // call from any click or key press
    get muted() { return muted; },
    setMuted(m) {
      muted = m;
      try { localStorage.setItem(KEY, m ? "1" : "0"); } catch (e) { /* ignore */ }
      if (master) master.gain.setTargetAtTime(m ? 0 : LEVEL, ctx.currentTime, 0.02);
    },

    // ball on hardwood: a short low thump plus a little slap
    bounce(strength = 1) {
      if (!ready()) return;
      const t = ctx.currentTime, s = Math.max(0.15, Math.min(1, strength));
      tone(t, { freq: 170, freqTo: 55, dur: 0.12, gain: 0.5 * s });
      noise(t, 0.035, { filters: [["lowpass", 900, 0.7]], gain: 0.12 * s });
    },
    // release: a soft whoosh as the ball leaves the hand
    release() {
      if (!ready()) return;
      noise(ctx.currentTime, 0.3, { filters: [["bandpass", 600, 0.9]], freqTo: 2400, gain: 0.05, attack: 0.04 });
    },
    // nothing but net: a bright airy swish, then the net settling
    swish(heat = 0) {
      if (!ready()) return;
      const t = ctx.currentTime;
      noise(t, 0.22, { filters: [["highpass", 2600, 0.7], ["bandpass", 6200, 0.6]], gain: 0.26, attack: 0.004 });
      noise(t + 0.07, 0.2, { filters: [["highpass", 3200, 0.7]], gain: 0.1, attack: 0.01 });
      if (heat) api.crackle(heat >= 2 ? 10 : 5, 0.5);
    },
    // dunk: a thud, a ringing rim and the backboard rattling
    dunk(heat = 0) {
      if (!ready()) return;
      const t = ctx.currentTime;
      tone(t, { freq: 110, freqTo: 42, dur: 0.3, gain: 0.7 });
      [[523, 0.12], [1307, 0.08], [2213, 0.05], [3391, 0.03]].forEach(([f, g]) =>
        tone(t + 0.005, { freq: f * (0.98 + Math.random() * 0.04), dur: 0.9, gain: g, type: "triangle" }));
      for (let i = 0; i < 6; i++) noise(t + i * 0.035, 0.06, { filters: [["bandpass", 1700, 2]], gain: 0.14 * Math.pow(0.7, i) });
      api.crowd(heat ? 0.9 : 0.55);
    },
    // crowd roar, scaled by intensity (0-1)
    crowd(intensity = 0.5) {
      if (!ready()) return;
      const t = ctx.currentTime, dur = 1.4 + intensity * 1.4, peak = 0.07 + intensity * 0.16;
      noise(t, dur, { filters: [["bandpass", 900, 0.6], ["lowpass", 2600, 0.7]], gain: peak, attack: 0.25, lfo: 5.5, lfoDepth: 0.25 });
      noise(t + 0.05, dur * 0.9, { filters: [["bandpass", 1700, 0.8]], gain: peak * 0.55, attack: 0.3, lfo: 7, lfoDepth: 0.3 });
    },
    // fire crackles
    crackle(n = 8, over = 0.6) {
      if (!ready()) return;
      const t = ctx.currentTime;
      for (let i = 0; i < n; i++) noise(t + Math.random() * over, 0.012 + Math.random() * 0.02, { filters: [["highpass", 2200, 0.7]], gain: 0.05 + Math.random() * 0.1, attack: 0.001 });
    },
    // the streak catches fire: a rising whoosh, crackles and the crowd
    ignite(level = 1) {
      if (!ready()) return;
      const t = ctx.currentTime;
      noise(t, 0.7, { filters: [["lowpass", 280, 0.8]], freqTo: 4200, gain: 0.16 + level * 0.06, attack: 0.08 });
      api.crackle(8 + level * 6, 0.8);
      api.crowd(Math.min(1, 0.45 + level * 0.25));
    },
    // the streak runs out: a short fizzle
    cool() {
      if (!ready()) return;
      const t = ctx.currentTime;
      tone(t, { freq: 620, freqTo: 220, dur: 0.45, gain: 0.06, type: "triangle" });
      noise(t, 0.5, { filters: [["highpass", 3000, 0.7]], freqTo: 900, gain: 0.04, attack: 0.02 });
    },
  };
  return api;
})();
