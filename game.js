"use strict";

/* CuteClaw — a toddler-friendly claw machine.
 *
 * No fail state, no timer: slide the crane over the plushie you want, press
 * DROP, and the claw does the rest. Landing a prize pops confetti, a happy
 * sound and the plushie joins the prize tray at the bottom.
 */

/* ---------- DOM ---------- */
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const scoreEl = document.getElementById("scoreNum");
const overlay = document.getElementById("overlay");
const playBtn = document.getElementById("playBtn");
const dropBtn = document.getElementById("dropBtn");
const joyEl = document.getElementById("joy");
const joyKnob = document.getElementById("joyKnob");
const soundBtn = document.getElementById("soundBtn");
const soundIcon = document.getElementById("soundIcon");
const endTitle = document.getElementById("endTitle");
const taglineEl = document.getElementById("taglineEl");

/* ---------- Layout (logical canvas units; CSS scales the canvas to fit) ---------- */
const VW = 360;
const VH = 640;

const FRAME = 10;          // machine frame thickness
const MARQUEE_H = 56;      // candy header strip
const RAIL_Y = MARQUEE_H + 22;   // the rail the crane rides on
const PLAY_L = FRAME + 8;   // inside the glass
const PLAY_R = VW - FRAME - 8;
const FLOOR_Y = 536;       // top of the floor slab
const TUNNEL_TOP = FLOOR_Y + 18;
const TUNNEL_BOT = VH - 52;      // where the prize tray starts
const CHUTE_X0 = PLAY_L;         // chute mouth spans the bottom-left corner
const CHUTE_X1 = PLAY_L + 66;
const CHUTE_MID = (CHUTE_X0 + CHUTE_X1) / 2;
const LIP_X0 = CHUTE_X1;         // the low wall that guards the chute edge
const LIP_X1 = CHUTE_X1 + 6;
const LIP_H = 30;
const PILE_L = CHUTE_X1 + 30;    // plushies spawn clear of the chute lip
const PILE_R = PLAY_R - 8;

const GRAVITY = 1500;
const CABLE_MIN = 6;
const CABLE_MAX = FLOOR_Y - RAIL_Y - 52;
const CRANE_SPEED = 190;         // px/s at full joystick deflection
const CRANE_ACCEL = 1500;
const CABLE_SPEED = 270;
const GRAB_REACH = 20;           // how far past its radius the claw can still grab
const CLAWSWAP = -8;             // the claw sinks this far past a plushie's radius
const PER_ROW = 5;               // plushies that fit side by side on the floor
const ROUND_SIZE = 10;           // two tidy rows, which settle instead of jamming
const SOLVER_PASSES = 2;         // pair-collision passes per step
const SLEEP_SPEED = 16;         // px/s below which a plushie counts as still
const SLEEP_TIME = 0.5;         // seconds of stillness before it dozes off

const STORAGE = { sound: "cutyclaw.sound" };

/* ---------- Plushie catalog ---------- */
const PLUSHIES = [
  { id: "corgi", name: "Corgi", src: "assets/plush/corgi.webp", r: 22, tint: "#ffd7a1" },
  { id: "fluffy-cat", name: "Kitten", src: "assets/plush/fluffy-cat.webp", r: 21, tint: "#ffe6f2" },
  { id: "tuxedo-cat", name: "Tuxedo Cat", src: "assets/plush/tuxedo-cat.webp", r: 20, tint: "#e8e8ff" },
  { id: "kitten-purple", name: "Purple Kitten", src: "assets/plush/kitten-purple.webp", r: 21, tint: "#efe4ff" },
  { id: "rabbit", name: "Bunny", src: "assets/plush/rabbit.webp", r: 22, tint: "#ffe3ee" },
  { id: "elephant", name: "Elephant", src: "assets/plush/elephant.webp", r: 23, tint: "#e3f4ff" },
  { id: "octopus", name: "Octopus", src: "assets/plush/octopus.webp", r: 21, tint: "#ffe0ec" },
  { id: "owl", name: "Owl", src: "assets/plush/owl.webp", r: 20, tint: "#ffeed6" },
  { id: "turtle", name: "Turtle", src: "assets/plush/turtle.webp", r: 21, tint: "#e2f7e9" },
  { id: "whale", name: "Whale", src: "assets/plush/whale.webp", r: 21, tint: "#dff1ff" },
  { id: "dolphin", name: "Dolphin", src: "assets/plush/dolphin.webp", r: 20, tint: "#dff6ff" },
  { id: "bluebird", name: "Bluebird", src: "assets/plush/bluebird.webp", r: 19, tint: "#dff0ff" },
  { id: "frog", name: "Frog", src: "assets/plush/frog.webp", r: 19, tint: "#e6ffe0" },
  { id: "snake", name: "Snake", src: "assets/plush/snake.webp", r: 19, tint: "#eaffd8" },
  { id: "starfish", name: "Starfish", src: "assets/plush/starfish.webp", r: 19, tint: "#fff0c9" },
];

/* ---------- Images ---------- */
const images = new Map();
let artLoaded = 0;

function loadImg(src) {
  if (images.has(src)) return images.get(src);
  const im = new Image();
  im.onload = () => { artLoaded++; };
  im.onerror = () => { artLoaded++; };
  im.src = src;
  images.set(src, im);
  return im;
}
PLUSHIES.forEach((p) => loadImg(p.src));

/* ---------- Audio ---------- */
let audioCtx = null;
let soundOn = (() => {
  try { return localStorage.getItem(STORAGE.sound) !== "0"; } catch (_) { return true; }
})();

function ensureAudio() {
  if (!soundOn) return null;
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function tone({ freq = 440, dur = 0.12, type = "sine", gain = 0.05, slide = 0, delay = 0 }) {
  const ac = ensureAudio();
  if (!ac) return;
  const t0 = ac.currentTime + delay;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(ac.destination);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

let lastMoveBlip = -1;
const sfxMove = (now) => {
  if (now - lastMoveBlip < 0.16) return;   // one soft blip every 160ms, not one per frame
  lastMoveBlip = now;
  tone({ freq: 190, dur: 0.07, type: "triangle", gain: 0.028 });
};
const sfxDrop = () => tone({ freq: 420, dur: 0.16, type: "square", gain: 0.035, slide: -180 });
const sfxClose = () => tone({ freq: 260, dur: 0.1, type: "square", gain: 0.04, slide: -60 });
const sfxGrab = () => tone({ freq: 520, dur: 0.1, type: "triangle", gain: 0.05, slide: 160 });
const sfxMiss = () => tone({ freq: 300, dur: 0.22, type: "sine", gain: 0.04, slide: -120 });
const sfxThud = () => tone({ freq: 150, dur: 0.06, type: "sine", gain: 0.02, slide: -40 });
const sfxPrize = () => {
  [523, 659, 784, 1046].forEach((f, i) =>
    tone({ freq: f, dur: 0.18, type: "triangle", gain: 0.05, delay: i * 0.09 })
  );
};

/* ---------- Game state ---------- */
const CLAW = {
  IDLE: "idle",        // waiting at the top, claws open
  DESCEND: "descend",  // cable paying out
  CLOSE: "close",      // prongs snapping shut
  LIFT: "lift",        // cable retracting
  CARRY: "carry",      // holding a prize at the top; player may steer
  RELEASE: "release",  // prongs opening to let go
  DELIVER: "deliver",  // winning animation through the chute
};

const state = {
  claw: CLAW.IDLE,
  autoMode: false,     // carrying a prize and steering itself home
  closingOn: null,     // plushie the prongs are shutting on
  closingD: 0,         // ...and how centred that grab was
  craneX: VW / 2,
  craneV: 0,
  cable: CABLE_MIN,
  prong: 0,            // 0 = wide open, 1 = fully closed
  held: null,
  prize: null,         // plushie currently animating down the chute
  carryTimer: 0,
  score: 0,
  toys: [],
  roster: [],          // ids in play this round
  tray: [],            // ids of won plushies, oldest first
  started: false,
  wonAll: false,
};

let axis = 0;          // joystick, -1..1
let keyAxis = 0;       // keyboard arrows
let simTime = 0;       // simulated seconds, used to throttle the move blip

/* ---------- Small helpers ---------- */
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);

/** Point of the claw's grab centre (between the prongs). */
function clawY() { return RAIL_Y + 16 + state.cable; }

/** True when a plushie at x has no floor beneath it and drops into the chute. */
function overChute(x) { return x < CHUTE_X1; }

/* ---------- Physics: circles with a floor, walls and each other ---------- */
function makeToy(kind, x, y) {
  return {
    kind,
    x, y,
    vx: 0, vy: 0,
    r: kind.r,
    ang: rand(-0.25, 0.25),
    angVel: rand(-1.2, 1.2),
    grabDx: 0,
    held: false,
    asleep: false,
    sleepT: 0,
    squish: 0,
    contacts: 0,
    collected: false,
  };
}

/** Wake a plushie up (the claw touched it, or a neighbour pushed it). */
function wake(t) {
  t.asleep = false;
  t.sleepT = 0;
}

/** Resolve one circle against the glass walls, the chute mouth and the floor. */
function collideWithWorld(toy) {
  const r = toy.r;

  if (toy.x - r < PLAY_L) {
    toy.x = PLAY_L + r;
    toy.vx = Math.abs(toy.vx) * 0.4;
    toy.angVel += toy.vx * 0.01;
  }
  if (toy.x + r > PLAY_R) {
    toy.x = PLAY_R - r;
    toy.vx = -Math.abs(toy.vx) * 0.4;
    toy.angVel -= toy.vx * 0.01;
  }

  // Over the chute mouth there is no floor: the plushie falls through and is won.
  if (overChute(toy.x)) {
    if (toy.y > TUNNEL_TOP + 6) {
      toy.y = TUNNEL_TOP + 6;
      toy.x = lerp(toy.x, CHUTE_MID, 0.25);
      collect(toy);
    }
    return;
  }

  // The chute is guarded by a low wall, so a plushie rolling around the floor
  // cannot wander in on its own. Only the claw can drop one in, from above the
  // wall: a plushie whose right edge is still left of the wall falls straight
  // through the open mouth.
  if (toy.x - r < LIP_X1 && toy.x + r > LIP_X0 && toy.y + r > FLOOR_Y - LIP_H) {
    toy.x = LIP_X1 + r;
    toy.vx = Math.max(0, toy.vx);
  }

  if (toy.y + r > FLOOR_Y) {
    toy.y = FLOOR_Y - r;
    if (toy.vy > 0) {
      toy.squish = Math.min(1, toy.vy / 700);
      if (toy.vy > 220) sfxThud();
      toy.vy = -toy.vy * 0.18;
      if (Math.abs(toy.vy) < 40) toy.vy = 0;
      toy.angVel *= 0.7;
    }
    toy.vx *= 0.8;              // plushies do not slide around on the floor
    toy.angVel *= 0.7;
  }
}

/** Positional correction + soft bounce between two plushies. */
function collidePair(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const min = a.r + b.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= min * min || d2 === 0) return;

  const d = Math.sqrt(d2);
  const nx = dx / d;
  const ny = dy / d;
  const overlap = (min - d) / 2;

  a.x -= nx * overlap; a.y -= ny * overlap;
  b.x += nx * overlap; b.y += ny * overlap;
  a.contacts++;
  b.contacts++;

  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const along = rvx * nx + rvy * ny;
  if (along >= 0) return;         // already separating, nothing to do

  // A resting contact kills the closing speed and rubs off some of the
  // sideways slide, which is what lets a pile actually settle instead of
  // creeping across the floor forever. n points from a to b, so a moves back
  // along -n and b forward along +n.
  const bounce = along < -120 ? -along * 0.45 : 0;
  const closing = -along - bounce;
  a.vx -= nx * closing; a.vy -= ny * closing;
  b.vx += nx * closing; b.vy += ny * closing;

  // friction along the contact
  const tx = rvx - nx * along;
  const ty = rvy - ny * along;
  const tangent = Math.hypot(tx, ty);
  if (tangent > 0.0001) {
    const grip = 0.25;            // rubbery plushie on rubbery plushie
    a.vx += (tx / tangent) * grip * tangent;
    a.vy += (ty / tangent) * grip * tangent;
    b.vx -= (tx / tangent) * grip * tangent;
    b.vy -= (ty / tangent) * grip * tangent;
  }

  if (along < -60) {               // only a real shove wakes the pile up
    a.angVel -= along * 0.004;
    b.angVel += along * 0.004;
    wake(a);
    wake(b);
  }
}

/** The claw is kinematic: it scoops plushies aside but is never pushed itself. */
function collideWithClaw(toy) {
  if (toy.held) return;
  // While the prongs shut they close AROUND a plushie instead of shoving it
  // away, otherwise the claw pushes its own target out of the jaws.
  if (state.claw === CLAW.CLOSE) return;

  const cy = clawY() + 12;
  const spread = lerp(26, 11, state.prong);
  const tips = [state.craneX, state.craneX - spread, state.craneX + spread];

  for (const tx of tips) {
    const dx = toy.x - tx;
    const dy = toy.y - cy;
    const min = toy.r + 9;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min || d2 === 0) continue;
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const ny = dy / d;
    toy.x += nx * (min - d);
    toy.y += ny * (min - d) * 0.35;
    const into = -(toy.vx * nx + toy.vy * ny);
    if (into > 0) {
      toy.vx += nx * into * 0.9;
      toy.vy += ny * into * 0.3;
    }
    wake(toy);
  }
}

function stepPhysics(dt) {
  simTime += dt;

  // crane: steering is only allowed while idle or while carrying a prize
  const want = clamp(axis + keyAxis, -1, 1);
  const canMove = state.claw === CLAW.IDLE || state.claw === CLAW.CARRY;
  let target = canMove ? want * CRANE_SPEED : 0;

  if (state.claw === CLAW.CARRY && state.autoMode) {
    // glide home over the chute instead of waiting for the player
    const home = CHUTE_MID - (state.held ? state.held.grabDx : 0);
    const d = home - state.craneX;
    target = Math.abs(d) < 3 ? 0 : Math.sign(d) * Math.min(CRANE_SPEED, Math.abs(d) * 6);
  }

  const dv = CRANE_ACCEL * dt;
  if (Math.abs(target - state.craneV) > dv) {
    state.craneV += Math.sign(target - state.craneV) * dv;
    if (target !== 0) sfxMove(simTime);
  } else {
    state.craneV = target;
  }
  state.craneX = clamp(state.craneX + state.craneV * dt, PLAY_L + 16, PLAY_R - 16);

  // claw cable
  switch (state.claw) {
    case CLAW.DESCEND: {
      state.cable = Math.min(CABLE_MAX, state.cable + CABLE_SPEED * dt);
      // stop as soon as a plushie is between the jaws, so grabs land on the top
      // of the pile instead of plunging all the way to the floor. Stopping at
      // the edge of reach instead would shut the prongs on thin air, so the
      // claw has to sink in past the plushie's radius. The reach test is the
      // same one tryGrab() uses, so the claw always has a target.
      if (grabCandidate(CLAWSWAP) || state.cable >= CABLE_MAX) {
        // remember what we are closing on: the prongs take a moment to shut,
        // and the pile may shift a little in the meantime
        const hit = grabCandidate(CLAWSWAP);
        state.closingOn = hit ? hit.toy : null;
        state.closingD = hit ? hit.d : 0;   // how centred the grab looked, back then
        state.claw = CLAW.CLOSE;
        sfxClose();
      }
      break;
    }
    case CLAW.CLOSE:
      state.prong = Math.min(1, state.prong + 3.4 * dt);
      if (state.prong >= 1) tryGrab();
      break;
    case CLAW.LIFT:
      state.cable = Math.max(CABLE_MIN, state.cable - (CABLE_SPEED + 40) * dt);
      if (state.cable <= CABLE_MIN) {
        state.cable = CABLE_MIN;
        if (state.held) {
          state.claw = CLAW.CARRY;
          state.carryTimer = 0;
          state.autoMode = false;
        } else {
          state.claw = CLAW.IDLE;
          state.prong = 0;
        }
      }
      break;
    case CLAW.CARRY:
      state.carryTimer += dt;
      if (state.autoMode) {
        const home = CHUTE_MID - (state.held ? state.held.grabDx : 0);
        if (Math.abs(home - state.craneX) < 5) release();
      } else if (state.carryTimer > 6) {
        state.autoMode = true;   // never leave a toddler stuck holding a prize
      }
      break;
    case CLAW.RELEASE:
      state.prong = Math.max(0, state.prong - 3.2 * dt);
      if (state.prong <= 0) { state.prong = 0; state.claw = CLAW.IDLE; }
      break;
    default:
      break;
  }

  // plushies
  for (const t of state.toys) {
    if (t.held) {
      // ride along under the claw with a little swing
      const tx = state.craneX + t.grabDx;
      const ty = clawY() + 12 + t.r * 0.9;
      t.x = lerp(t.x, tx, Math.min(1, 14 * dt));
      t.y = lerp(t.y, ty, Math.min(1, 14 * dt));
      t.ang = lerp(t.ang, 0, Math.min(1, 8 * dt));
      continue;
    }

    // sleeping plushies are still shoved around by the claw
    collideWithClaw(t);
    if (t.asleep) continue;

    t.vy += GRAVITY * dt;
    // a touch of air drag keeps the pile from jittering forever
    t.vx *= 0.995;
    t.vy *= 0.999;
    t.x += t.vx * dt;
    t.y += t.vy * dt;
    t.ang += t.angVel * dt;
    t.angVel *= 0.96;
    t.squish = Math.max(0, t.squish - dt * 3);

    collideWithWorld(t);
  }

  // plushie vs plushie, a couple of passes so stacks find their rest quickly.
  // collect() only flags plushies, so the array stays stable while we iterate.
  // Contacts are cleared here, not at the end of the step: the sleep test
  // above reads the ones this loop is about to build.
  for (const t of state.toys) t.contacts = 0;
  for (let pass = 0; pass < SOLVER_PASSES; pass++) {
    for (let i = 0; i < state.toys.length; i++) {
      const a = state.toys[i];
      if (a.held || a.collected) continue;
      for (let j = i + 1; j < state.toys.length; j++) {
        const b = state.toys[j];
        if (b.held || b.collected) continue;
        collidePair(a, b);
      }
    }
  }

  // Pair separation can nudge a plushie through the floor, so resolve the
  // world once more now that every position is final.
  for (const t of state.toys) {
    if (t.held) continue;
    if (overChute(t.x)) wake(t);   // never doze off hovering over the chute
    collideWithWorld(t);
  }

  // Dozing off is decided AFTER collisions have run. Judging it inside the
  // integration loop above would read the velocity before the contact solver
  // had absorbed gravity, so nothing in the pile would ever look still enough
  // to sleep. A plushie needs to be slow AND held up: the floor, or another
  // plushie underneath (t.contacts).
  for (const t of state.toys) {
    if (t.held) continue;
    const supported = !overChute(t.x) && (t.y + t.r > FLOOR_Y - 4 || t.contacts > 0);
    if (supported && Math.abs(t.vx) < SLEEP_SPEED && Math.abs(t.vy) < SLEEP_SPEED) {
      t.sleepT += dt;
      if (t.sleepT > SLEEP_TIME) t.asleep = true;
    } else {
      t.sleepT = 0;
    }
  }

  // retire plushies that fell into the chute
  if (state.toys.some((t) => t.collected)) {
    state.toys = state.toys.filter((t) => !t.collected);
  }

  if (state.prize) stepPrize(dt);

  for (const p of particles) stepParticle(p, dt);
  toast.t -= dt;
}

/* ---------- Grabbing / releasing ---------- */
/** The plushie currently inside the claw's reach, or null.
 *  `extra` is how far past its own radius still counts as a grab. */
function grabCandidate(extra = GRAB_REACH) {
  const cy = clawY() + 12;
  let best = null;
  let bestD = Infinity;
  for (const t of state.toys) {
    if (t.held || t.collected) continue;
    const d = Math.hypot(t.x - state.craneX, t.y - cy);
    if (d < t.r + extra && d < bestD) {
      best = t;
      bestD = d;
    }
  }
  return best ? { toy: best, d: bestD } : null;
}

function tryGrab() {
  const cy = clawY() + 12;
  const fresh = grabCandidate();
  let best = fresh ? fresh.toy : null;
  let bestD = fresh ? fresh.d : Infinity;

  // Nothing in reach any more? Snap onto whatever the claw was closing on, as
  // long as it has not been shoved far away.
  if (!best && state.closingOn && !state.closingOn.held && !state.closingOn.collected) {
    const d = Math.hypot(state.closingOn.x - state.craneX, state.closingOn.y - cy);
    if (d < state.closingOn.r + 28) {
      best = state.closingOn;
      // judge it on how centred the claw was when it began shutting, not on
      // how far the plushie drifted while the prongs moved
      bestD = state.closingD || d;
    }
  }
  state.closingOn = null;
  state.closingD = 0;
  state.claw = CLAW.LIFT;

  if (!best) {
    sfxMiss();
    puff(state.craneX, cy, 6);
    toast.msg = "So close!";
    toast.t = 1.5;
    return;
  }

  // A dead-centre grab is certain; a grab that caught the plushie by one edge
  // often slips. Gentle enough that a toddler who aims properly almost always
  // wins, and always gets a cheerful sound for trying.
  // A dead-centre grab is certain; catching a plushie by one edge often slips.
// Tuned so a toddler who lines the crane up wins most of the time, while
// grabbing a plushie by the very edge still feels like a real chance.
const centred = clamp(1 - (bestD / best.r - 0.45) / 1.6, 0.3, 1);
  if (Math.random() > centred) {
    sfxMiss();
    puff(best.x, best.y, 8);
    toast.msg = "Wiggle wiggle!";
    toast.t = 1.5;
    return;
  }

  best.held = true;
  best.asleep = false;
  best.vx = 0;
  best.vy = 0;
  best.grabDx = clamp(best.x - state.craneX, -10, 10);
  state.held = best;
  sfxGrab();
}

function requestDrop() {
  if (!state.started || state.wonAll) return;
  if (state.claw === CLAW.IDLE) {
    state.claw = CLAW.DESCEND;
    state.autoMode = false;
    sfxDrop();
  } else if (state.claw === CLAW.CARRY) {
    release();
  }
}

function release() {
  const t = state.held;
  state.held = null;
  state.autoMode = false;
  state.carryTimer = 0;
  state.claw = CLAW.RELEASE;
  if (!t) return;

  t.held = false;
  t.asleep = false;
  t.vx = state.craneV * 0.4;
  t.vy = 30;

  if (overChute(t.x)) {
    // straight down the chute: take it home
    state.claw = CLAW.DELIVER;
    state.prize = t;
    const i = state.toys.indexOf(t);
    if (i >= 0) state.toys.splice(i, 1);
  } else {
    puff(t.x, t.y, 7);
    toast.msg = "Back in the pile!";
    toast.t = 1.5;
  }
}

/* ---------- Winning ---------- */
function collect(toy) {
  if (toy.collected) return;
  toy.collected = true;     // the step loop retires it once iteration finishes

  state.score += 1;
  state.tray.push(toy.kind.id);
  scoreEl.textContent = String(state.score);

  sfxPrize();
  confetti(CHUTE_MID, TUNNEL_TOP - 4);
  toast.msg = `Yay! A ${toy.kind.name}!`;
  toast.t = 2;

  if (state.tray.length === state.roster.length && !state.wonAll) {
    state.wonAll = true;
    endTitle.textContent = "All plushies!";
    taglineEl.textContent = `You won every single one! ★${state.score}`;
    playBtn.textContent = "PLAY AGAIN";
    setTimeout(() => { if (state.wonAll) showOverlay(); }, 1100);
  }
}

function stepPrize(dt) {
  const p = state.prize;
  p.vy += GRAVITY * 0.6 * dt;
  p.y += p.vy * dt;
  p.x = lerp(p.x, CHUTE_MID, Math.min(1, 6 * dt));
  p.ang += p.angVel * dt;
  p.angVel *= 0.95;

  if (p.y > TUNNEL_BOT - 14) {
    collect(p);
    state.prize = null;
    state.claw = CLAW.RELEASE;
  }
}

/* ---------- Particles & toast ---------- */
const particles = [];

function spark(x, y, color) {
  particles.push({
    kind: "spark", x, y, vx: rand(-40, 40), vy: rand(-70, -20),
    life: rand(0.4, 0.8), max: 0.8, color, size: rand(2, 4),
  });
}

function puff(x, y, n) {
  for (let i = 0; i < n; i++) {
    particles.push({
      kind: "puff", x, y, vx: rand(-70, 70), vy: rand(-90, -20),
      life: rand(0.3, 0.6), max: 0.6, color: "rgba(255,255,255,0.9)", size: rand(4, 9),
    });
  }
}

const CONFETTI_COLORS = ["#ff8fab", "#7ee8fa", "#ffd166", "#95e1d3", "#c8b6ff", "#ffffff"];

function confetti(x, y) {
  for (let i = 0; i < 26; i++) {
    particles.push({
      kind: "confetti", x, y, vx: rand(-160, 160), vy: rand(-320, -120),
      life: rand(0.8, 1.5), max: 1.5, color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      size: rand(4, 8), spin: rand(-8, 8), ang: rand(0, 6), vx2: rand(-4, 4),
    });
  }
  for (let i = 0; i < 10; i++) spark(x + rand(-24, 24), y + rand(-16, 16), "#fff3a6");
}

function stepParticle(p, dt) {
  p.life -= dt;
  if (p.life <= 0) return;
  p.vy += (p.kind === "confetti" ? 620 : 900) * dt;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  if (p.kind === "confetti") { p.ang += p.spin * dt; p.vx *= 0.99; p.vx2 += dt; }
}

const toast = { msg: "", t: 0 };

/* ---------- Drawing ---------- */
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawMachine() {
  // outer frame
  ctx.fillStyle = "#ff8fab";
  roundRect(0, 0, VW, VH, 22);
  ctx.fill();

  // glass play area
  const g = ctx.createLinearGradient(0, MARQUEE_H, 0, FLOOR_Y);
  g.addColorStop(0, "#eafaff");
  g.addColorStop(0.55, "#f6f0ff");
  g.addColorStop(1, "#ffeaf4");
  ctx.fillStyle = g;
  roundRect(FRAME, MARQUEE_H, VW - FRAME * 2, FLOOR_Y - MARQUEE_H + 24, 14);
  ctx.fill();

  // marquee
  ctx.save();
  roundRect(FRAME, FRAME, VW - FRAME * 2, MARQUEE_H - 6, 12);
  ctx.clip();
  const stripes = ctx.createLinearGradient(0, 0, VW, 0);
  stripes.addColorStop(0, "#ffd166");
  stripes.addColorStop(0.5, "#ff8fab");
  stripes.addColorStop(1, "#c8b6ff");
  ctx.fillStyle = stripes;
  ctx.fillRect(FRAME, FRAME, VW - FRAME * 2, MARQUEE_H - 6);

  // candy dots
  for (let i = 0; i < 14; i++) {
    const x = FRAME + 12 + i * ((VW - FRAME * 2 - 24) / 13);
    ctx.beginPath();
    ctx.arc(x, FRAME + 12, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fill();
  }
  ctx.restore();

  ctx.fillStyle = "#fff";
  ctx.font = "900 25px Nunito, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("CuteClaw", VW / 2, FRAME + 30);
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.strokeText("CuteClaw", VW / 2, FRAME + 30);

  // rail
  ctx.fillStyle = "rgba(90,59,82,0.16)";
  roundRect(PLAY_L, RAIL_Y - 5, PLAY_R - PLAY_L, 10, 5);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  roundRect(PLAY_L + 4, RAIL_Y - 3, PLAY_R - PLAY_L - 8, 3, 2);
  ctx.fill();

  // glass shine
  ctx.save();
  roundRect(FRAME, MARQUEE_H, VW - FRAME * 2, FLOOR_Y - MARQUEE_H + 24, 14);
  ctx.clip();
  ctx.fillStyle = "rgba(255,255,255,0.30)";
  ctx.beginPath();
  ctx.moveTo(PLAY_L - 20, FLOOR_Y + 20);
  ctx.lineTo(PLAY_L + 70, MARQUEE_H - 10);
  ctx.lineTo(PLAY_L + 110, MARQUEE_H - 10);
  ctx.lineTo(PLAY_L + 20, FLOOR_Y + 20);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.beginPath();
  ctx.moveTo(PLAY_L + 120, FLOOR_Y + 20);
  ctx.lineTo(PLAY_L + 190, MARQUEE_H - 10);
  ctx.lineTo(PLAY_L + 214, MARQUEE_H - 10);
  ctx.lineTo(PLAY_L + 144, FLOOR_Y + 20);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // floor slab with the chute gap
  ctx.fillStyle = "#ffb3c6";
  roundRect(PLAY_L, FLOOR_Y, PLAY_R - PLAY_L, 18, 6);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  roundRect(PLAY_L + 2, FLOOR_Y + 2, PLAY_R - PLAY_L - 4, 5, 3);
  ctx.fill();

  // chute mouth
  ctx.fillStyle = "#5a3b52";
  roundRect(CHUTE_X0, FLOOR_Y - 2, CHUTE_X1 - CHUTE_X0, 22, 8);
  ctx.fill();

  // tunnel walls
  ctx.fillStyle = "rgba(90,59,82,0.14)";
  roundRect(PLAY_L, TUNNEL_TOP, CHUTE_X1 - CHUTE_X0, TUNNEL_BOT - TUNNEL_TOP, 6);
  ctx.fill();

  // prize tray
  ctx.fillStyle = "#ffffff";
  roundRect(PLAY_L, TUNNEL_BOT, PLAY_R - PLAY_L, VH - FRAME - TUNNEL_BOT, 10);
  ctx.fill();
  ctx.fillStyle = "#ffd166";
  roundRect(PLAY_L, TUNNEL_BOT, PLAY_R - PLAY_L, 6, 3);
  ctx.fill();
  ctx.fillStyle = "#8d6b80";
  ctx.font = "800 11px Nunito, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("MY PLUSHIES", PLAY_L + 8, TUNNEL_BOT + 18);

  const tray = state.tray.slice(-5);
  tray.forEach((id, i) => {
    const kind = PLUSHIES.find((p) => p.id === id);
    if (!kind) return;
    const img = images.get(kind.src);
    const x = PLAY_L + 26 + i * 30;
    const y = TUNNEL_BOT + 30;
    const s = img.naturalWidth ? 26 / Math.max(img.naturalWidth, img.naturalHeight) : 0.02;
    ctx.drawImage(img, x - (img.naturalWidth * s) / 2, y - (img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
  });
}

function drawToy(toy) {
  const img = images.get(toy.kind.src);
  if (!img || !img.naturalWidth) return;
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  // fit the plushie inside its physics circle
  const s = (toy.r * 2.15) / Math.max(w, h);
  const dw = w * s;
  const dh = h * s;

  ctx.save();
  ctx.translate(toy.x, toy.y);
  ctx.rotate(toy.ang);
  const sq = 1 + toy.squish * 0.12;
  ctx.scale(1 / sq, sq);

  // soft shadow
  if (!toy.held) {
    ctx.fillStyle = "rgba(90,59,82,0.12)";
    ctx.beginPath();
    ctx.ellipse(0, toy.r - 1, toy.r * 0.85, toy.r * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.drawImage(img, -dw / 2, -dh / 2 + toy.r * 0.35, dw, dh);
  ctx.restore();
}

function drawClaw() {
  const cx = state.craneX;
  const cy = clawY();

  // cable
  ctx.strokeStyle = "rgba(90,59,82,0.55)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, RAIL_Y);
  ctx.lineTo(cx, cy);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - 1, RAIL_Y);
  ctx.lineTo(cx - 1, cy);
  ctx.stroke();

  // carriage on the rail
  ctx.fillStyle = "#7ee8fa";
  roundRect(cx - 22, RAIL_Y - 13, 44, 20, 7);
  ctx.fill();
  ctx.fillStyle = "#4fc9e0";
  roundRect(cx - 22, RAIL_Y + 1, 44, 6, 3);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(cx - 12, RAIL_Y - 4, 3.4, 0, Math.PI * 2);
  ctx.arc(cx + 12, RAIL_Y - 4, 3.4, 0, Math.PI * 2);
  ctx.fill();

  // claw head
  const grad = ctx.createLinearGradient(cx, cy - 8, cx, cy + 14);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(1, "#cbd5e1");
  ctx.fillStyle = grad;
  roundRect(cx - 15, cy - 8, 30, 16, 6);
  ctx.fill();
  ctx.strokeStyle = "rgba(90,59,82,0.25)";
  ctx.lineWidth = 1.5;
  roundRect(cx - 15, cy - 8, 30, 16, 6);
  ctx.stroke();

  // three prongs
  const open = lerp(0.95, 0.16, state.prong);
  for (const dir of [-1, 0, 1]) {
    ctx.save();
    ctx.translate(cx, cy + 6);
    ctx.rotate(dir * open);
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(dir * 3, 0);
    ctx.quadraticCurveTo(dir * 15, 10, dir * 13, 26);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(dir * 3, -1);
    ctx.quadraticCurveTo(dir * 14, 9, dir * 12, 24);
    ctx.stroke();
    ctx.restore();
  }
}

function drawParticles() {
  for (const p of particles) {
    const t = clamp(p.life / p.max, 0, 1);
    ctx.globalAlpha = t;
    if (p.kind === "confetti") {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.ang);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    } else if (p.kind === "spark") {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * t, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (1.4 - t * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawToast() {
  if (toast.t <= 0 || !toast.msg) return;
  const alpha = clamp(toast.t / 0.4, 0, 1);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = "900 18px Nunito, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const w = Math.min(VW - 40, ctx.measureText(toast.msg).width + 30);
  const x = (VW - w) / 2;
  const y = MARQUEE_H + 96;   // clear of the crane, the claw and the pile
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  roundRect(x, y - 17, w, 34, 17);
  ctx.fill();
  ctx.strokeStyle = "#ffb3c6";
  ctx.lineWidth = 3;
  roundRect(x, y - 17, w, 34, 17);
  ctx.stroke();
  ctx.fillStyle = "#ff5c8a";
  ctx.fillText(toast.msg, VW / 2, y + 1);
  ctx.restore();
}

function draw() {
  ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
  ctx.clearRect(0, 0, VW, VH);
  drawMachine();

  // toys, back to front by y so the pile looks layered
  const sorted = state.toys.slice().sort((a, b) => (a.held === b.held ? a.y - b.y : a.held ? 1 : -1));
  for (const t of sorted) drawToy(t);
  if (state.prize) drawToy(state.prize);

  drawClaw();
  drawParticles();
  drawToast();
}

/* ---------- Canvas sizing ---------- */
// All drawing is done in the 360x640 logical grid above; the backing store is
// scaled up for sharp lines on high-density phone screens.
let RENDER_SCALE = 1;

function setupCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  RENDER_SCALE = dpr;
  canvas.width = Math.round(VW * dpr);
  canvas.height = Math.round(VH * dpr);
}
window.addEventListener("resize", setupCanvas);
setupCanvas();

/* ---------- Loop ---------- */
const FIXED = 1 / 60;
let acc = 0;
let lastTs = 0;

function frame(ts) {
  requestAnimationFrame(frame);
  if (!lastTs) lastTs = ts;
  let dt = (ts - lastTs) / 1000;
  lastTs = ts;
  if (dt > 0.1) dt = 0.1;          // returning from a background tab
  acc += dt;
  let steps = 0;
  while (acc >= FIXED && steps < 6) {
    stepPhysics(FIXED);
    acc -= FIXED;
    steps++;
  }
  if (steps === 6) acc = 0;
  draw();
}

/* ---------- Pile setup ---------- */
function fillPile() {
  // Pick a round's worth of plushies at random: two tidy rows fit side by side
  // and settle properly, and every round brings a slightly different pile.
  const pool = PLUSHIES.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const kinds = pool.slice(0, ROUND_SIZE);

  const spanX = PILE_R - PILE_L;
  state.roster = kinds.map((k) => k.id);
  state.toys = kinds.map((kind, i) => {
    const x = PILE_L + (spanX * ((i % PER_ROW) + 0.5)) / PER_ROW + rand(-2, 2);
    const y = FLOOR_Y - 26 - Math.floor(i / PER_ROW) * 44 - rand(0, 6);
    return makeToy(kind, clamp(x, PILE_L, PILE_R - kind.r), clamp(y, MARQUEE_H + 70, FLOOR_Y - kind.r));
  });

  state.score = 0;
  state.tray = [];
  state.prize = null;
  state.held = null;
  state.wonAll = false;
  state.claw = CLAW.IDLE;
  state.prong = 0;
  state.cable = CABLE_MIN;
  state.craneV = 0;
  state.carryTimer = 0;
  state.autoMode = false;
  scoreEl.textContent = "0";
  particles.length = 0;
  toast.t = 0;
}

function startGame() {
  fillPile();
  state.started = true;
  ensureAudio();
  tone({ freq: 523, dur: 0.14, type: "triangle", gain: 0.05 });
  tone({ freq: 784, dur: 0.2, type: "triangle", gain: 0.05, delay: 0.11 });
  hideOverlay();
  toast.msg = "Slide the joystick!";
  toast.t = 2.2;
}

/* ---------- Overlay ---------- */
function showOverlay() {
  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
}

function hideOverlay() {
  overlay.classList.add("hidden");
  overlay.setAttribute("aria-hidden", "true");
}

playBtn.addEventListener("click", startGame);

/* ---------- Joystick ---------- */
let joyPointer = null;
// knob travel in CSS px, scaled to the element width so it looks right on
// a phone and on a tablet alike
function joyTravel() { return Math.max(26, joyEl.getBoundingClientRect().width * 0.33); }

function setAxis(nx) {
  axis = clamp(nx, -1, 1);
  joyKnob.style.transform = `translate(calc(-50% + ${axis * joyTravel()}px), -50%)`;
  joyEl.setAttribute("aria-valuenow", String(Math.round(axis * 100)));
}

function joyFromEvent(e) {
  const rect = joyEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  setAxis((e.clientX - cx) / (rect.width * 0.42));
}

joyEl.addEventListener("pointerdown", (e) => {
  joyPointer = e.pointerId;
  joyEl.classList.add("active");
  joyEl.setPointerCapture(e.pointerId);
  joyFromEvent(e);
  e.preventDefault();
});
joyEl.addEventListener("pointermove", (e) => {
  if (joyPointer !== e.pointerId) return;
  joyFromEvent(e);
  e.preventDefault();
});
function joyEnd(e) {
  if (joyPointer !== e.pointerId) return;
  joyPointer = null;
  joyEl.classList.remove("active");
  setAxis(0);
}
joyEl.addEventListener("pointerup", joyEnd);
joyEl.addEventListener("pointercancel", joyEnd);
joyEl.addEventListener("keydown", (e) => {
  if (e.key === "ArrowLeft") { setAxis(-1); e.preventDefault(); }
  if (e.key === "ArrowRight") { setAxis(1); e.preventDefault(); }
});
joyEl.addEventListener("keyup", (e) => {
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") setAxis(0);
});

/* ---------- Drop button ---------- */
dropBtn.addEventListener("click", requestDrop);
dropBtn.addEventListener("pointerdown", () => dropBtn.classList.add("pressed"));
["pointerup", "pointercancel", "pointerleave"].forEach((ev) =>
  dropBtn.addEventListener(ev, () => dropBtn.classList.remove("pressed"))
);

/* ---------- Keyboard ---------- */
const keys = new Set();
window.addEventListener("keydown", (e) => {
  if (e.key === " " || e.key === "ArrowDown") {
    e.preventDefault();
    requestDrop();
    return;
  }
  keys.add(e.key);
  updateKeyAxis();
});
window.addEventListener("keyup", (e) => {
  keys.delete(e.key);
  updateKeyAxis();
});

function updateKeyAxis() {
  const left = keys.has("ArrowLeft") || keys.has("a") || keys.has("A");
  const right = keys.has("ArrowRight") || keys.has("d") || keys.has("D");
  keyAxis = (right ? 1 : 0) - (left ? 1 : 0);
}

/* ---------- Sound toggle ---------- */
function renderSound() {
  soundBtn.setAttribute("aria-pressed", soundOn ? "true" : "false");
  soundIcon.textContent = soundOn ? "🔊" : "🔇";
}
soundBtn.addEventListener("click", () => {
  soundOn = !soundOn;
  try { localStorage.setItem(STORAGE.sound, soundOn ? "1" : "0"); } catch (_) {}
  renderSound();
  if (soundOn) tone({ freq: 660, dur: 0.12, type: "triangle", gain: 0.05 });
});

/* ---------- Lifecycle ---------- */
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    setAxis(0);
    joyEl.classList.remove("active");
  }
  lastTs = 0;
  acc = 0;
});

canvas.addEventListener("pointerdown", () => {
  // tapping the machine also works as "drop", handy for little fingers
  if (state.started) requestDrop();
});

// hold the intro panel until the plushies have decoded, then prime the pile
let readyTries = 0;
(function waitForArt() {
  if (artLoaded >= PLUSHIES.length || readyTries > 100) {
    fillPile();
    showOverlay();
  } else {
    readyTries++;
    setTimeout(waitForArt, 60);
  }
})();

renderSound();
requestAnimationFrame(frame);

/* ---------- Offline play ---------- */
// Registering the worker is what lets CuteClaw keep working with no signal,
// like a real machine. It is skipped on file:// where there is no worker
// support, and a failure here must never stop the game from loading.
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
