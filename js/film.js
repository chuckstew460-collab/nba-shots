/* Film room (report section 9): a ~30-second reel stitched at playback time from
   three official highlight videos on YouTube. Nothing is downloaded or copied: the
   YouTube player streams each video and stops after ~10 seconds, then the next one
   starts. The YouTube script only loads when the reader presses play. */

// one clip per player in the top-15 chart, in its order; ~8 seconds each from official uploads
const REEL = [
  { id: "cHy7leb1LYM", start: 3, end: 11, who: "Stephen Curry", what: "From all 402 of his record threes, 2015-16", channel: "Golden State Warriors" },
  { id: "X9GddRiKdXg", start: 1, end: 9, who: "James Harden", what: "His signature step-back three", channel: "NBA" },
  { id: "qgKfJ5AVMaU", start: 1, end: 9, who: "Anthony Edwards", what: "Career-high 53 points and 10 threes vs. Detroit, Jan. 4, 2025", channel: "NBA" },
  { id: "9mey7rreVhY", start: 1, end: 9, who: "Malik Beasley", what: "Career-high 36 points and 9 threes vs. Philadelphia, Feb. 7, 2025", channel: "NBA" },
  { id: "VoqR1_UJjbk", start: 1, end: 9, who: "Klay Thompson", what: "14 threes vs. Chicago, Oct. 29, 2018", channel: "NBA" },
  { id: "DN2OwG5qE3c", start: 1, end: 9, who: "Paul George", what: "47 points and 8 threes vs. Portland, Feb. 11, 2019", channel: "NBA" },
  { id: "HHpdDCbUlLY", start: 1, end: 9, who: "Buddy Hield", what: "His first months with the Pacers, 2021-22", channel: "Indiana Pacers" },
];

(function filmRoom() {
  const frame = document.getElementById("film-frame");
  if (!frame) return;
  const startBtn = document.getElementById("film-start"), bars = document.getElementById("film-bars"), list = document.getElementById("film-list");
  const total = REEL.reduce((a, c) => a + (c.end - c.start), 0);
  let player = null, idx = 0, timer = 0, ytReady = null, live = false;   // live: the current clip has really started

  // poster: the three thumbnails side by side
  startBtn.innerHTML = `<span class="film-thumbs" style="grid-template-columns:repeat(${REEL.length},1fr)">${REEL.map((c) => `<img src="https://i.ytimg.com/vi/${c.id}/hqdefault.jpg" alt="" loading="lazy">`).join("")}</span>
    <span class="film-play"><svg width="26" height="26" viewBox="0 0 18 18" aria-hidden="true"><path d="M5 2.5l10 6.5-10 6.5z" fill="currentColor"/></svg></span>
    <span class="film-cta">Play the ${total}-second reel</span>`;
  bars.innerHTML = REEL.map((c, i) => `<div class="film-seg" style="flex:${c.end - c.start}"><i id="film-fill-${i}"></i></div>`).join("");
  list.innerHTML = REEL.map((c, i) => `<li><button type="button" data-i="${i}"><span class="film-n">${i + 1}</span><span><b>${c.who}</b><small>${c.what}</small>
    <small class="film-src">${c.channel} · <a href="https://www.youtube.com/watch?v=${c.id}&t=${c.start}s" target="_blank" rel="noopener">full video ↗</a></small></span></button></li>`).join("");
  document.getElementById("film-next").addEventListener("click", () => { if (player) { if (idx < REEL.length - 1) play(idx + 1); } else start(1); });

  function loadYT() {
    if (ytReady) return ytReady;
    ytReady = new Promise((resolve) => {
      if (window.YT && window.YT.Player) return resolve();
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(); };
      const s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(s);
    });
    return ytReady;
  }

  function mark() {
    list.querySelectorAll("button").forEach((b) => b.classList.toggle("on", +b.dataset.i === idx));
    REEL.forEach((_, i) => { if (i < idx) document.getElementById(`film-fill-${i}`).style.width = "100%"; if (i > idx) document.getElementById(`film-fill-${i}`).style.width = "0%"; });
  }
  function tick() {
    if (!player || !player.getCurrentTime) return;
    const c = REEL[idx], t = player.getCurrentTime();
    // right after a switch the player still reports the previous video; wait for the new one
    if (!live) {
      const vid = player.getVideoData ? player.getVideoData().video_id : c.id;
      if (vid === c.id && player.getPlayerState() === YT.PlayerState.PLAYING && Math.abs(t - c.start) < 3) live = true;
      else return;
    }
    document.getElementById(`film-fill-${idx}`).style.width = `${Math.max(0, Math.min(1, (t - c.start) / (c.end - c.start))) * 100}%`;
    if (t >= c.end - 0.15) next();
  }
  function play(i) {
    idx = i; live = false; mark();
    const c = REEL[i];
    player.loadVideoById({ videoId: c.id, startSeconds: c.start, endSeconds: c.end });
  }
  function next() {
    if (idx < REEL.length - 1) play(idx + 1);
    else { clearInterval(timer); timer = 0; document.getElementById(`film-fill-${idx}`).style.width = "100%"; frame.classList.add("done"); }
  }

  async function start(i = 0) {
    frame.classList.remove("done");
    if (player) { play(i); if (!timer) timer = setInterval(tick, 200); return; }
    startBtn.disabled = true;
    await loadYT();
    const holder = document.createElement("div");
    frame.appendChild(holder);
    idx = i; live = false; mark();
    player = new YT.Player(holder, {
      host: "https://www.youtube-nocookie.com", videoId: REEL[i].id, width: "100%", height: "100%",
      playerVars: { start: REEL[i].start, end: REEL[i].end, autoplay: 1, rel: 0, playsinline: 1, modestbranding: 1 },
      events: {
        onReady: () => { startBtn.hidden = true; timer = setInterval(tick, 200); },
        onStateChange: (e) => { if (e.data === YT.PlayerState.ENDED && live) next(); },
      },
    });
  }

  startBtn.addEventListener("click", () => start(0));
  list.addEventListener("click", (e) => { const b = e.target.closest("button[data-i]"); if (b && !e.target.closest("a")) start(+b.dataset.i); });
  document.getElementById("film-replay").addEventListener("click", () => start(0));
})();
