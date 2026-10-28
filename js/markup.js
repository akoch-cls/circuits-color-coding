// Predict mode: students paint wires, place arrows with tails and add bulb rays.
// Arrows go where the student clicks: beside a bulb, or at that spot on a wire.
// A new arrow always starts by asking which way it points.

import { arrowAnchor, S } from './arrows.js';
import { MAX_TAILS } from './solver.js';

const MAX_RAYS = 10;
const NEAR = 34; // px: clicking this close to an existing arrow on the same wire edits it

const ARROW_TOOLS = ['arrow', 'tail+', 'tail-', 'flip'];

export function createMarkup(app) {
  let painting = false;

  // The element under the pointer that the current tool cares about. Arrows sit
  // on top of wires, so look through the whole stack.
  function pick(ev) {
    const tool = app.pred.tool;
    const stack = document.elementsFromPoint(ev.clientX, ev.clientY);
    const find = (attr) => stack.find((el) => el.dataset && el.dataset[attr] !== undefined);
    if (tool === 'paint' || tool === 'erase') return { branch: find('branch') };
    if (tool === 'ray+' || tool === 'ray-') return { part: find('part') };
    return { arrow: find('arrow'), part: find('part'), branch: find('branch') };
  }

  function nearestArrowOnBranch(b, x, y) {
    let best = -1; let bestD = NEAR;
    app.pred.arrows.forEach((a, i) => {
      if (a.site.kind !== 'branch' || a.site.b !== b) return;
      const [ax, ay] = arrowAnchor(app.graph, app.circuit, a);
      const d = Math.hypot(ax - x, ay - y);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  function editArrow(i, tool) {
    const arrows = app.pred.arrows;
    const a = arrows[i];
    if (tool === 'tail+') a.n = Math.min(MAX_TAILS, a.n + 1);
    if (tool === 'flip') a.dir = -a.dir;
    if (tool === 'tail-') {
      a.n -= 1;
      if (a.n <= 0) arrows.splice(i, 1);
    }
  }

  // Which arrow site was clicked, where on it, and the arrow already there (if any).
  function locate(hit, ev) {
    const arrows = app.pred.arrows;
    if (hit.arrow) {
      const a = arrows[Number(hit.arrow.dataset.arrow)];
      return a ? { site: a.site, seg: a.seg, t: a.t, existing: a } : null;
    }
    if (hit.part) {
      const id = hit.part.dataset.part;
      const site = { kind: 'part', id };
      return { site, existing: arrows.find((a) => a.site.kind === 'part' && a.site.id === id) || null };
    }
    if (hit.branch) {
      const b = Number(hit.branch.dataset.branch);
      const seg = Number(hit.branch.dataset.seg);
      const [x, y] = app.svgPixel(ev);
      const i = nearestArrowOnBranch(b, x, y);
      if (i >= 0) return { site: arrows[i].site, seg: arrows[i].seg, t: arrows[i].t, existing: arrows[i] };
      const s = app.graph.segs[seg];
      const ax = s.a[0] * S; const ay = s.a[1] * S;
      const dx = s.b[0] * S - ax; const dy = s.b[1] * S - ay;
      const t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1);
      return { site: { kind: 'branch', b }, seg, t: Math.min(0.85, Math.max(0.15, t)), existing: null };
    }
    return null;
  }

  // Ask which way the arrow points, then place it (or turn the existing one).
  function chooseDirection(spot) {
    const arrows = app.pred.arrows;
    const { existing } = spot;
    app.pickDirection({
      site: spot.site,
      seg: spot.seg,
      t: spot.t,
      current: existing ? existing.dir : 0,
      onPick: (dir) => {
        if (existing) {
          if (!arrows.includes(existing)) return;
          existing.dir = dir;
        } else {
          const a = { site: spot.site, n: 1, dir };
          if (spot.site.kind === 'branch') Object.assign(a, { seg: spot.seg, t: spot.t });
          arrows.push(a);
        }
        changed();
      },
      onRemove: existing ? () => {
        const i = arrows.indexOf(existing);
        if (i >= 0) arrows.splice(i, 1);
        changed();
      } : null,
    });
  }

  function applyArrowTool(hit, ev) {
    const tool = app.pred.tool;
    const spot = locate(hit, ev);
    if (!spot) return false;
    // Add Arrow always asks for a direction; + Tail asks when there is no arrow yet.
    if (tool === 'arrow' || (tool === 'tail+' && !spot.existing)) {
      chooseDirection(spot);
      return false;
    }
    if (!spot.existing) return false;
    editArrow(app.pred.arrows.indexOf(spot.existing), tool);
    return true;
  }

  function changed() {
    const pred = app.pred;
    pred.check = null;
    pred.settled = false;
    app.redraw();
    app.renderFeedback();
    if (app.onMarkupChange) app.onMarkupChange();
  }

  function apply(ev) {
    const pred = app.pred;
    const tool = pred.tool;
    const hit = pick(ev);
    let didChange = false;

    if (ARROW_TOOLS.includes(tool)) {
      didChange = applyArrowTool(hit, ev);
    } else if (hit.branch) {
      const b = Number(hit.branch.dataset.branch);
      if (tool === 'paint' && pred.colors.get(b) !== pred.swatch) { pred.colors.set(b, pred.swatch); didChange = true; }
      if (tool === 'erase' && pred.colors.has(b)) { pred.colors.delete(b); didChange = true; }
    } else if (hit.part) {
      const partId = hit.part.dataset.part;
      const part = app.circuit.parts.find((p) => p.id === partId);
      if (part && part.type !== 'battery') {
        const n = pred.rays.get(partId) || 0;
        if (tool === 'ray+') { pred.rays.set(partId, Math.min(MAX_RAYS, n + 1)); didChange = true; }
        if (tool === 'ray-' && n > 0) { pred.rays.set(partId, n - 1); didChange = true; }
      }
    }
    if (didChange) changed();
  }

  function down(ev) {
    app.closePicker();
    if (app.pred.view !== 'mine') app.setView('mine');
    apply(ev);
    painting = app.pred.tool === 'paint' || app.pred.tool === 'erase';
  }

  function move(ev) {
    if (painting) apply(ev);
  }

  function up() {
    painting = false;
  }

  return { down, move, up };
}
