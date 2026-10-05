/* Headless smoke test for CuteClaw.
 *
 * Stubs just enough DOM + Canvas 2D to run the real game.js in node, then
 * drives the loop like a player would and asserts the game behaves:
 *   - no exceptions while the pile settles
 *   - plushies come to rest on the floor and stop jittering
 *   - the joystick drives the crane left and right
 *   - DROP walks the claw through descend -> close -> lift -> carry
 *   - a prize released over the chute increments the score
 *   - all plushies can be won, which triggers the celebration panel
 *   - restart resets the machine
 *
 * Run:  node scripts/smoke-test.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

/* ---- canvas 2d stub: swallow every draw call ---- */
function makeCtx() {
  const noop = () => {};
  const grad = { addColorStop: noop };
  return new Proxy(
    {
      measureText: (t) => ({ width: String(t).length * 9 }),
      createLinearGradient: () => grad,
      createRadialGradient: () => grad,
    },
    {
      get(target, prop) { return prop in target ? target[prop] : noop; },
      set() { return true; },
    }
  );
}

/* ---- DOM stub ---- */
const listeners = new Map();
const nodes = new Map();

function el(id) {
  return {
    id,
    style: {},
    classList: { add() {}, remove() {}, contains: () => false },
    textContent: "",
    naturalWidth: 400,
    naturalHeight: 400,
    getContext: () => makeCtx(),
    addEventListener(type, fn) {
      const key = `${id}:${type}`;
      if (!listeners.has(key)) listeners.set(key, []);
      listeners.get(key).push(fn);
    },
    removeEventListener() {},
    setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 20, top: 600, width: 220, height: 80 }),
    setAttribute() {},
    getAttribute: () => null,
  };
}

const getEl = (id) => {
  if (!nodes.has(id)) nodes.set(id, el(id));
  return nodes.get(id);
};

const sandbox = {
  console,
  Math,
  Date,
  Image: class {
    set src(v) { this._src = v; queueMicrotask(() => this.onload && this.onload()); }
    get src() { return this._src; }
    naturalWidth = 400;
    naturalHeight = 400;
    onload = null;
    onerror = null;
  },
  requestAnimationFrame: () => 0,
  setTimeout: () => 0,
  localStorage: {
    _v: {},
    getItem(k) { return this._v[k] ?? null; },
    setItem(k, v) { this._v[k] = String(v); },
  },
  document: { getElementById: getEl, addEventListener() {}, hidden: false },
  addEventListener() {},
  // no serviceWorker key, so the game skips offline registration under test
  navigator: { userAgent: "cuteclaw-test" },
  location: { protocol: "http:" },
  devicePixelRatio: 1,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.AudioContext = null;      // no WebAudio in node: tone() degrades to a no-op

vm.createContext(sandbox);

// game.js is a plain script, so its top-level const/let are lexical rather than
// global. Append a tiny epilogue that hands the pieces the test needs to globalThis.
const EPILOGUE = `
;globalThis.__api = {
  state, stepPhysics, draw, fillPile, requestDrop, clawY,
  PLUSHIES, FLOOR_Y, PLAY_L, PLAY_R, VW, VH, CABLE_MIN, CABLE_MAX,
  CHUTE_X0, CHUTE_X1, CHUTE_MID,
  get axis() { return axis; },
  set axis(v) { axis = v; },
  setJoystick: setAxis,
};`;

const code = readFileSync(path.join(root, "game.js"), "utf8");
vm.runInContext(code + EPILOGUE, sandbox, { filename: "game.js" });

const api = sandbox.__api;
const S = api.state;

const fire = (id, type, evt = {}) => {
  for (const fn of listeners.get(`${id}:${type}`) || []) fn({ preventDefault() {}, ...evt });
};

/** Run the fixed-step loop for `seconds` of simulated time. */
const run = (seconds) => {
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) api.stepPhysics(1 / 60);
};

let failures = 0;
function check(label, cond, extra = "") {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${extra ? `  (${extra})` : ""}`);
  }
}

console.log("CuteClaw smoke test\n");

/* 1. the pile settles instead of jittering forever */
api.fillPile();
run(4);
const resting = S.toys.filter((t) => t.asleep).length;
check("every plushie spawns", S.toys.length === S.roster.length, `got ${S.toys.length}`);
check("the pile comes to rest", resting >= S.toys.length - 2, `asleep ${resting}/${S.toys.length}`);
check(
  "nothing sinks through the floor",
  S.toys.every((t) => t.y + t.r <= api.FLOOR_Y + 1.5),
  `lowest ${Math.max(...S.toys.map((t) => t.y + t.r)).toFixed(1)} vs floor ${api.FLOOR_Y}`
);
check(
  "nothing escapes the glass",
  S.toys.every((t) => t.x - t.r >= api.PLAY_L - 1 && t.x + t.r <= api.PLAY_R + 1),
  `x ${Math.min(...S.toys.map((t) => t.x)).toFixed(1)}..${Math.max(...S.toys.map((t) => t.x)).toFixed(1)}`
);
check("no plushie wanders into the chute", S.toys.every((t) => t.x >= api.CHUTE_X1 - 30));

/* 2. the joystick drives the crane both ways */
S.craneX = api.VW / 2;
S.craneV = 0;
api.axis = -1;
run(1);
const leftX = S.craneX;
api.axis = 1;
run(2.5);
const rightX = S.craneX;
check("crane moves left", leftX < api.VW / 2, `x=${leftX.toFixed(1)}`);
check("crane moves right", rightX > leftX + 60, `x=${rightX.toFixed(1)}`);
api.axis = 0;
run(0.5);
check("crane stops when the joystick is released", Math.abs(S.craneV) < 1, `v=${S.craneV.toFixed(2)}`);

/* 3. DROP walks the claw through its state machine, and can pick something up */
S.started = true;
S.wonAll = false;
let held = null;
const seen = new Set();
for (let attempt = 0; attempt < 6 && !held; attempt++) {
  const target = S.toys.slice().sort((a, b) => a.y - b.y)[0];
  S.craneX = target.x;
  S.craneV = 0;
  api.axis = 0;
  run(0.2);
  api.requestDrop();
  for (let i = 0; i < 60 * 8; i++) {
    api.stepPhysics(1 / 60);
    seen.add(S.claw);
    if (S.held) { held = S.held; break; }
    if (S.claw === "idle" && i > 60) break;   // missed this attempt
  }
}
check("claw descends", seen.has("descend"));
check("claw closes", seen.has("close"));
check("claw lifts", seen.has("lift"));
check("claw carries a plushie", !!held, `states seen: ${[...seen].join(", ")}`);
if (held) {
  run(2.5);   // let the lift finish and the plushie swing up to the claw
  check(
    "held plushie rides under the claw",
    S.claw === "carry" && Math.abs(held.y - (api.clawY() + 12 + held.r * 0.9)) < 4,
    `claw=${S.claw} y=${held.y.toFixed(1)} want=${(api.clawY() + 12 + held.r * 0.9).toFixed(1)}`
  );
}

/* 4. letting go over the pile drops it back in, no score */
if (held) {
  const scoreBefore = S.score;
  const toy = held;
  S.craneX = toy.x;
  run(0.3);
  api.requestDrop();
  run(4);
  check("releasing over the pile does not score", S.score === scoreBefore);
  check("the plushie is back in the pile", S.toys.includes(toy) || S.prize === toy || S.score === scoreBefore + 1);
}

/* 5. a carried prize can be steered over the chute by hand and released */
{
  api.fillPile();
  S.started = true;
  S.wonAll = false;
  run(3);
  const toy = S.toys.slice().sort((a, b) => a.y - b.y)[0];
  toy.held = true;
  toy.grabDx = 0;
  S.held = toy;
  S.claw = "carry";
  S.cable = api.CABLE_MIN;
  S.craneX = toy.x;
  S.autoMode = false;

  // "player" steers left towards the chute mouth
  let guard = 0;
  while (Math.abs(S.craneX - api.CHUTE_MID) > 4 && guard++ < 600) {
    api.axis = api.CHUTE_MID < S.craneX ? -1 : 1;
    api.stepPhysics(1 / 60);
  }
  api.axis = 0;
  check("a carried prize can be steered over the chute", Math.abs(S.craneX - api.CHUTE_MID) < 8, `x=${S.craneX.toFixed(1)} want=${api.CHUTE_MID}`);

  const scoreBefore = S.score;
  api.requestDrop();          // press DROP to let go
  run(4);
  check("releasing over the chute scores", S.score === scoreBefore + 1, `score ${scoreBefore} -> ${S.score}`);
}

/* 6. auto-deliver: a carried prize steers home and scores on its own */
{
  const toy = S.toys.slice().sort((a, b) => a.y - b.y)[0];
  toy.held = true;
  toy.grabDx = 0;
  S.held = toy;
  S.claw = "carry";
  S.cable = api.CABLE_MIN;
  S.craneX = toy.x;
  S.autoMode = false;
  const scoreBefore = S.score;
  run(9);   // 6s of patience, then it takes over
  check("auto-deliver scores the plushie", S.score === scoreBefore + 1, `score ${scoreBefore} -> ${S.score}`);
  check("score element updated", getEl("scoreNum").textContent === String(S.score));
  check("tray records the plushie", S.tray.length === scoreBefore + 1);
}

/* 7. the whole machine can be emptied, which celebrates.
 *    Uses the real auto-deliver path: grab, wait, the crane steers home. */
let guard = 0;
while (S.toys.length && guard++ < 200) {
  const t = S.toys[0];
  t.held = true;
  t.grabDx = 0;
  S.held = t;
  S.claw = "carry";
  S.cable = api.CABLE_MIN;
  S.craneX = t.x;
  S.autoMode = false;
  run(10);
  if (S.held === t) {          // it slipped and dropped back in the pile
    t.held = false;
    S.held = null;
    S.claw = "idle";
  }
}
check("every plushie can be won", S.score === S.roster.length, `score ${S.score}`);
check("celebration fires", S.wonAll === true);
check("play again is offered", getEl("playBtn").textContent === "PLAY AGAIN");

/* 8. restart resets the machine */
fire("playBtn", "click");
run(3);
check("restart refills the pile", S.toys.length === S.roster.length, `toys ${S.toys.length}`);
check("restart resets the score", S.score === 0);
check("restart clears the tray", S.tray.length === 0);
check("restart returns the claw to idle", S.claw === "idle");

/* 9. drawing a frame must not throw */
try {
  api.draw();
  check("draw() runs clean", true);
} catch (err) {
  check("draw() runs clean", false, err.message);
}

/* 10. every asset referenced by the game is on disk */
const missing = api.PLUSHIES.filter((p) => {
  try { readFileSync(path.join(root, p.src)); return false; } catch { return true; }
});
check("all plushie sprites present", missing.length === 0, missing.map((m) => m.src).join(", "));
const icons = readdirSync(path.join(root, "assets/icons"));
check("icons present", icons.includes("icon-192.png") && icons.includes("icon-512.png"));

console.log(`\n${failures === 0 ? "PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
