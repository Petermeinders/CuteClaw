# CuteClaw

A cute claw machine for little ones. Slide the crane over the plushie you want,
press **DROP**, and watch the claw do the work. No timer, no losing, no red
crosses — just a pile of cuddly friends and a very shiny claw.

Works offline, installs like an app, and runs entirely in the browser with no
build step and no dependencies.

## Play

Open `index.html`, or serve the folder:

```sh
python3 -m http.server 8000     # then visit http://localhost:8000
```

## Controls

| Input | Action |
|---|---|
| Joystick (slide left/right) | Move the crane along the rail |
| **DROP!** button | Lower the claw; press again to let go while carrying |
| Arrow keys / `A` `D` | Move the crane |
| `Space` / `ArrowDown` | Same as the DROP button |
| Tap the machine | Also drops the claw |

Win the plushie by carrying it over the chute in the bottom-left corner and
releasing it. If nobody touches the crane for a few seconds while carrying, it
steers itself home and drops it in — a toddler can never get stuck.

## How it plays

- **No fail states.** A grab that slips just says "Wiggle wiggle!" and the
  plushie drops back into the pile. Nothing is ever taken away.
- **A gentle skill curve.** A grab lined up on the middle of a plushie almost
  always succeeds; one that catches it by the edge often slips.
- **The pile is real.** Plushies are circles with gravity, friction and
  contact, so they stack, settle and sleep. The claw scoops them aside as it
  comes down.
- **The chute has a low wall**, so plushies cannot wander into it on their own.
  Only the claw can drop one in.
- Every round deals a fresh pile of ten from the fifteen plushies.

## Layout

```
index.html        markup and the on-screen controls
styles.css        candy-pastel theme, mobile-first
game.js           the whole game: physics, claw state machine, drawing
sw.js             service worker (offline play)
manifest.json     PWA manifest
assets/plush/     plushie sprites (webp)
assets/icons/     app icons
scripts/          one-off tooling, not used at runtime
```

## Development

Run the headless test suite — it stubs the DOM and canvas, then plays the game
to check the physics settles, the claw walks its states, prizes are delivered
and restart works:

```sh
node scripts/smoke-test.mjs
```

Regenerate the app icons after swapping the icon sprite:

```sh
python3 scripts/make_icons.py
```

Check what the game actually renders, without a screen to look at. It writes
`__shot.html` (git-ignored) from `index.html`, so the page is the real one:

```sh
node scripts/make-shot-page.cjs
python3 -m http.server 8000
firefox --headless --screenshot /tmp/shot.png "http://127.0.0.1:8000/__shot.html?pose=settle"
```

`pose` is one of `intro`, `settle`, `grab`, `carry`, `miss` or `win`.

Both scripts are one-off tooling; the game itself never runs them.

## Notes

- The canvas draws a fixed 360x640 logical grid and is scaled for the display,
  including high-density phone screens.
- Gameplay is tuned to be gentle on purpose. If you want a real challenge
  later, `centred` in `tryGrab()` controls how forgiving a grab is, and
  `autoMode` in the `CARRY` state controls the hands-off delivery.
- Sounds are WebAudio blips, generated at runtime. The speaker button in the
  header mutes them and the choice is remembered.