// Builds a screenshot harness page straight from index.html so the captured
// layout is exactly the real one, with a small script appended that poses the
// game on load.
const fs = require("node:fs");

const html = fs.readFileSync("index.html", "utf8");

const harness = `
<script>
// Stop the game's own animation loop: without this the live loop redraws over
// the frame the harness poses, and the screenshot catches that instead.
window.requestAnimationFrame = function () { return 0; };
</script>
<!-- preload every sprite so the window load event waits for them -->
<div hidden aria-hidden="true">
${["bluebird", "corgi", "dolphin", "elephant", "fluffy-cat", "frog", "kitten-purple",
    "octopus", "owl", "rabbit", "snake", "starfish", "turtle", "tuxedo-cat", "whale"]
  .map((n) => `  <img src="assets/plush/${n}.webp" alt="">`).join("\n")}
</div>
`;

const script = `
<script>
const POSE = new URLSearchParams(location.search).get("pose") || "intro";

function startGame2() {
  document.getElementById("overlay").classList.add("hidden");
  state.started = true;
  scoreNum.textContent = "0";
}

function whenArtReady() {
  // must yield to the event loop, or the image onload handlers never run
  return new Promise((resolve) => {
    let tries = 0;
    (function tick() {
      if (artLoaded >= PLUSHIES.length || tries++ > 400) resolve();
      else setTimeout(tick, 25);
    })();
  });
}

async function pose() {
  await whenArtReady();
  fillPile();
  startGame2();
  if (POSE === "intro") { draw(); return; }

  for (let i = 0; i < 300; i++) stepPhysics(1 / 60);     // let the pile settle

  if (POSE === "grab" || POSE === "carry") {
    const toy = state.toys.slice().sort((a, b) => a.y - b.y)[0];
    state.craneX = toy.x; state.craneV = 0;
    if (POSE === "grab") {
      state.claw = "descend"; state.cable = 6;
      for (let i = 0; i < 300; i++) { stepPhysics(1 / 60); if (state.held) break; }
    } else {
      toy.held = true; toy.grabDx = 0; toy.grabDy = 6;
      state.held = toy;
      state.claw = "carry"; state.cable = 60; state.prong = 1; state.autoMode = false;
      state.craneX = 200; state.craneV = 0;
      for (let i = 0; i < 30; i++) stepPhysics(1 / 60);
    }
  }
  if (POSE === "miss") {
    state.claw = "close"; state.cable = 340; state.prong = 0.4;
    state.closingOn = null; state.closingD = 0;
    for (let i = 0; i < 4; i++) stepPhysics(1 / 60);
  }
  if (POSE === "win") {
    state.tray.push(...state.roster.slice(0, 5));
    state.score = 5;
    scoreNum.textContent = "5";
    for (let i = 0; i < 60; i++) { confetti(CHUTE_MID, TUNNEL_TOP - 4); stepPhysics(1 / 60); }
  }
  draw();

  // report the layout so pixels can be sampled in logical canvas coordinates
  const box = (el) => { const r = el.getBoundingClientRect();
    return [r.left, r.top, r.width, r.height].map((n) => Math.round(n * 10) / 10).join(","); };
  BEACON("pose=" + POSE + "&dpr=" + devicePixelRatio
    + "&canvas=" + box(document.getElementById("game"))
    + "&hud=" + box(document.getElementById("hud"))
    + "&controls=" + box(document.getElementById("controls"))
    + "&joy=" + box(document.getElementById("joy"))
    + "&drop=" + box(document.getElementById("dropBtn"))
    + "&body=" + box(document.body)
    + "&overlay=" + box(document.getElementById("overlay"))
    + "&toys=" + state.toys.length + "&art=" + artLoaded
    + "&claw=" + state.claw + "&cable=" + Math.round(state.cable)
    + "&started=" + state.started + "&held=" + (state.held ? 1 : 0)
    + "&heldAt=" + (state.held
        ? Math.round(state.held.x) + "," + Math.round(state.held.y)
          + (state.held.held ? ",held" : ",NOT-HELD")
        : "none")
    + "&heldKind=" + (state.held ? state.held.kind.id : "none")
    + "&heldSrc=" + (state.held ? state.held.kind.src : "none")
    + "&prize=" + (state.prize ? 1 : 0)
    + "&tray=" + state.tray.length
    + "&crane=" + Math.round(state.craneX) + "&clawY=" + Math.round(clawY())
    + "&backing=" + document.getElementById("game").width + "x"
      + document.getElementById("game").height
    + "&t0=" + (state.toys[0] ? Math.round(state.toys[0].x) + "," + Math.round(state.toys[0].y) : "-")
    // sample the pixels the browser actually holds, to tell a bad draw() apart
    // from a bad screenshot
    + "&px=" + [[200, 300], [140, 515], [180, 78], [30, 560]]
        .map(([x, y]) => { const d = ctx.getImageData(x, y, 1, 1).data;
          return x + ":" + y + "=" + d[0] + "," + d[1] + "," + d[2]; }).join(";"));
}

// The service worker would cache the harness page and the layout beacons, so
// drop it first and always ask for a fresh beacon.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
  if (window.caches) caches.keys().then((k) => k.forEach((k) => caches.delete(k)));
}
const BEACON = (q) => fetch("/__error?nocache=" + Date.now() + "&" + q);

window.addEventListener("error", (e) =>
  BEACON("msg=" + encodeURIComponent((e.message || "") + " @" + e.lineno)));
// A pending request keeps the window load event (and so the screenshot) from
// firing until the pose below has been drawn.
const gate = new Image();
gate.src = "/gate";

(async () => {
  try { await pose(); }
  catch (err) { BEACON("msg=" + encodeURIComponent("pose: " + err.message)); }
  BEACON("ready=" + POSE + "&art=" + artLoaded);
  // hand the real canvas bitmap to the dev server: the headless screenshot
  // path does not reliably include canvas layers
  canvas.toBlob((blob) => {
    const fr = new FileReader();
    fr.onload = () => fetch("/__shot?pose=" + POSE, {
      method: "POST", body: fr.result.split(",")[1] });
    fr.readAsDataURL(blob);
  });
})();
</script>
`;

fs.writeFileSync("__shot.html",
  html.replace("  <script src=\"game.js\"></script>",
    harness + "  <script src=\"game.js\"></script>\n" + script));
console.log("wrote __shot.html");
