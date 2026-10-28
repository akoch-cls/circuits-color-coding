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
| **Predict** | Students paint wires, add arrows with tails, and add rays to bulbs. **Check my work** outlines anything wrong and explains why in words. **Let it settle** starts the simulation *from the student's own colors*, so they see how their wrong picture changes into the right one. |
| **Build** | Draw wires by dragging between grid dots, and click to place round bulbs, long bulbs and the battery. Use *Move*, *Rotate* and *Delete* to rearrange. The colors update live, so adding or removing a bulb visibly re-settles the circuit. |

### What Check looks at
- **Colors:** each wire must match its steady-state step. If the true pressure falls between two steps, either neighbor is accepted.
- **Arrows:** directions must be right, and tails must be *in proportion*. A student may draw every arrow with twice as many tails, as long as they do it consistently.
- **The junction rule:** at every junction, tails in must equal tails out.
- **"Bulbs don't use up flow":** tails into a bulb (or the battery) must equal tails out.
- **Brightness:** rays must *rank* the bulbs correctly (brighter means more rays, equal means the same number, unlit means none).

## Making activities

1. Go to **Build**, choose a worksheet circuit or *Blank*, and edit or draw your circuit.
2. Give it a name. **Save to My circuits** keeps it in this browser. **Export file** saves a `.json` file you can share with colleagues, and they can load it with **Import file**.
3. Choose whether the student link opens in *Predict* or *Explore* mode, and click **Copy student link**. The whole circuit lives in the link, so there is no account or server. Leave *Hide the Answer button and settings* ticked for assessments.

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
js/editor.js        Build mode
js/markup.js        Predict mode tools
js/check.js         Check my work
js/presets.js       built-in circuits
tests/              node --test unit tests
```
