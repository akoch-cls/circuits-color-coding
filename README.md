# Circuit Color Coding

A conceptual DC circuit simulator for the CASTLE-style "electric pressure" model. No numbers ever appear to students. Instead:

- **Wire color** shows electric pressure on a 9-step scale: red, red-orange, orange, orange-yellow, yellow, yellow-green, green, green-blue, blue. The striped steps sit between the solid colors.
- **Arrows with tails** show flow. More tails means more flow.
- **Rays (starbursts)** show bulb brightness.

Circuits use two bulb types: **R** (round, low resistance) and **L** (long, higher resistance).

## What makes it different: watching a circuit *settle*

Students can start a circuit from wrong pressures and watch it change into the steady state. A wire that gets more flow in than out shows a **+ piling up** marker, and its pressure (color) rises. A wire that loses more than it gets shows **− draining**, and its color falls. When every wire's inflow equals its outflow, the circuit stops changing. That is the steady state, and it is also where the junction rule comes from.

## Modes

| Mode | What it's for |
| --- | --- |
| **Explore** | Pick a circuit and press *Start all blue / all red / all yellow / mixed up* to watch it settle. Play, Pause, Step and a speed slider let you slow down the key moments for discussion. |
| **Predict** | Students paint wires, place arrows with tails (click a bulb, or click the spot on a wire where the arrow should go), and add rays to bulbs. **Check my work** outlines anything wrong and explains why in words. **Let it settle** starts the simulation *from the student's own colors*, so they see how their wrong picture changes into the right one. |
| **Build** | Draw wires by dragging between grid dots, and click to place round bulbs, long bulbs and the battery. Use *Move*, *Rotate* and *Delete* to rearrange. The colors update live, so adding or removing a bulb visibly re-settles the circuit. |

### Where arrows go
By default the simulation draws an arrow **beside every bulb** and **on the wires just before and after every junction**. You can change this under *Show → Arrows go at*:

- Bulbs and before/after junctions (default)
- Bulbs only
- Middle of every wire
- Bulbs and every wire

The same setting tells students where they need arrows (the Predict panel says so), and it decides what Check counts as missing.

### What Check looks at
- **Colors:** each wire must match its steady-state step. If the true pressure falls between two steps, either neighbor is accepted.
- **Arrows:** every arrow is graded where the student put it. Directions must be right, and tails must be *in proportion*: a student may draw every arrow with twice as many tails, as long as they do it consistently. Places the class convention requires (bulbs and/or junction wires) must have an arrow.
- **Along a wire:** two arrows on the same stretch of wire must match.
- **The junction rule:** at every junction, tails in must equal tails out (circled if not).
- **"Bulbs don't use up flow":** the arrow on a bulb must match the arrows on the wires either side of it.
- **Brightness:** rays must *rank* the bulbs correctly (brighter means more rays, equal means the same number, unlit means none).

## Problem sets (slideshow)

The **Sets** tab lets you put several circuits in order for students to work through **one at a time**, like a slideshow. They finish on a summary screen.

For each problem you choose:
- **Type.** *Predict*: students mark it up. *Explore*: students watch it settle, with nothing to mark.
- **Instructions** shown above the circuit.
- **Which marks are required** (any of wire colors, arrows, rays). Students only see the tools for those marks, and Check only grades those.
- Whether **Let it settle** is allowed, and whether the **Answer** appears after they press Check.

**Preview as a student** runs the set in place. When it's ready, click **Download set file**, then upload the file to the [`sets/`](sets/) folder on GitHub (*Add file → Upload files*). Students open it at `…/?set=<file-name>`, and the app shows you the exact link. Because GitHub Pages can only serve files, these JSON files *are* the database. See [`sets/README.md`](sets/README.md) for details. An example set, `circuit-review`, is included.

In a set, students see:
- one problem at a time, with Previous/Next and numbered dots (green = correct, red = tried)
- their marks restored when they come back to a problem, even after a reload
- at the end, a summary with the set title, date and time, an optional name box, and each problem's result: *correct on the first check*, *correct after N checks*, *not correct yet*, *not checked*, or *viewed*

Grading uses the long-vs-round ratio and arrow setting saved in the set file (your settings when you downloaded it).

## Making activities

1. Go to **Build**, choose a worksheet circuit or *Blank*, and edit or draw your circuit.
2. Give it a name. **Save to My circuits** keeps it in this browser. **Export file** saves a `.json` file you can share with colleagues, and they can load it with **Import file**.
3. Choose whether the student link opens in *Predict* or *Explore* mode, and click **Copy student link**. The whole circuit lives in the link, so there is no account or server. The link also carries your long-vs-round ratio and arrow setting, so students are graded the way you set things up (without changing their own saved settings). Leave *Hide the Answer button and settings* ticked for assessments: students then see only the mode you linked, with no Answer button, settings or arrow-placement choice.

## Teacher settings (⚙)

- **Long vs. round bulb.** The default is 2×. Among the ratios tested, 2× puts the most circuits of up to three bulbs exactly on the 9 color steps (32 of 58; 1.5× and 6× tie, and 4× gets only 20). It also reproduces the Circuit Review answer keys: 5C goes red → orange → yellow → blue, and 5D rounds to orange and yellow in the middle.
- **Snap colors** to the 9 steps, or show a smooth blend while the circuit is changing.
- **Mark ≈ wires**, whose true pressure falls between two steps. This is teacher-only and is hidden in locked student links.
- **Allow the Answer button** in Predict mode.

## Model details (for the curious)

- Every grid point a part or wire touches is a node. Bulbs conduct with resistance 1 (R) or the chosen ratio (L), and wires have a tiny resistance. The battery holds its + end at "red" and its − end at "blue".
- Each wire holds a little charge, like a reservoir. Pressure changes by *C dV/dt = flow in − flow out*. The app steps this with implicit Euler, which stays smooth even with near-zero wire resistance.
- Arrow tails use the largest flow "unit" that splits every flow in the circuit into a small whole number of tails.
- Rays grow with bulb power, measured against a single round bulb across the battery (8 rays), so brightness can also be compared *between* circuits.

## Running it

It's a static site: plain HTML, CSS and JavaScript modules, with no build step.

```bash
python3 -m http.server 8000   # then open http://localhost:8000
npm test                      # physics + checker unit tests (Node 18+)
```

### Publishing with GitHub Pages
In the repository go to **Settings → Pages**. Set *Source* to "Deploy from a branch", pick the branch and the `/ (root)` folder, and save. The site appears at `https://<user>.github.io/<repo>/`.

## Files

```
index.html          page layout
css/app.css         styles
js/model.js         circuit data, save/load, share links
js/solver.js        pressures, flows, settling over time, answer key
js/colors.js        pressure → 9-step colors and stripes
js/render.js        SVG drawing (highlighter wires, arrows, starbursts, markers)
js/arrows.js        where arrows go (bulbs, junctions, wires) and their flows
js/editor.js        Build mode
js/markup.js        Predict mode tools
js/check.js         Check my work
js/presets.js       built-in circuits
js/sets.js          problem set format, validation, saved progress
js/player.js        student slideshow and summary
js/setbuilder.js    teacher Sets tab
sets/               published problem sets (one JSON file each)
tests/              node --test unit tests
```
