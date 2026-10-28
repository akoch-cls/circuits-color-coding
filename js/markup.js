// Predict mode: students paint wires, place arrows with tails and add bulb rays.
// Arrows go where the student clicks: beside a bulb, or at that spot on a wire.

import { arrowAnchor } from './arrows.js';

const MAX_TAILS = 9;
const MAX_RAYS = 10;
const NEAR = 34; // px: clicking this close to an existing arrow on the same wire edits it

const ARROW_TOOLS = ['tail+', 'tail-', 'flip'];

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

  function applyArrowTool(hit, ev) {
    const tool = app.pred.tool;
    const arrows = app.pred.arrows;
    if (hit.arrow) {
      editArrow(Number(hit.arrow.dataset.arrow), tool);
      return true;
    }
    if (hit.part) {
      const id = hit.part.dataset.part;
      const i = arrows.findIndex((a) => a.site.kind === 'part' && a.site.id === id);
      if (i >= 0) { editArrow(i, tool); return true; }
      if (tool === 'tail+') { arrows.push({ site: { kind: 'part', id }, n: 1, dir: 1 }); return true; }
      return false;
    }
    if (hit.branch) {
      const b = Number(hit.branch.dataset.branch);
      const segIndex = Number(hit.branch.dataset.seg);
      const [x, y] = app.svgPixel(ev);
      const i = nearestArrowOnBranch(b, x, y);
      if (i >= 0) { editArrow(i, tool); return true; }
      if (tool !== 'tail+') return false;
      const s = app.graph.segs[segIndex];
      const ax = s.a[0] * 60; const ay = s.a[1] * 60;
      const dx = s.b[0] * 60 - ax; const dy = s.b[1] * 60 - ay;
      const t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1);
      arrows.push({ site: { kind: 'branch', b }, seg: segIndex, t: Math.min(0.85, Math.max(0.15, t)), n: 1, dir: 1 });
      return true;
    }
    return false;
  }

  function apply(ev) {
    const pred = app.pred;
    const tool = pred.tool;
    const hit = pick(ev);
    let changed = false;

    if (ARROW_TOOLS.includes(tool)) {
      changed = applyArrowTool(hit, ev);
    } else if (hit.branch) {
      const b = Number(hit.branch.dataset.branch);
      if (tool === 'paint' && pred.colors.get(b) !== pred.swatch) { pred.colors.set(b, pred.swatch); changed = true; }
      if (tool === 'erase' && pred.colors.has(b)) { pred.colors.delete(b); changed = true; }
    } else if (hit.part) {
      const partId = hit.part.dataset.part;
      const part = app.circuit.parts.find((p) => p.id === partId);
      if (part && part.type !== 'battery') {
        const n = pred.rays.get(partId) || 0;
        if (tool === 'ray+') { pred.rays.set(partId, Math.min(MAX_RAYS, n + 1)); changed = true; }
        if (tool === 'ray-' && n > 0) { pred.rays.set(partId, n - 1); changed = true; }
      }
    }
    if (changed) {
      pred.check = null;
      pred.settled = false;
      app.redraw();
      app.renderFeedback();
    }
  }

  function down(ev) {
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
