// Predict mode: students paint wires, add arrows with tails and add bulb rays.

const MAX_TAILS = 9;
const MAX_RAYS = 10;

export function createMarkup(app) {
  let painting = false;

  function apply(el) {
    if (!el) return;
    const pred = app.pred;
    const tool = pred.tool;
    const branch = el.dataset.branch !== undefined ? Number(el.dataset.branch) : null;
    const partId = el.dataset.part;
    let changed = false;

    if (branch !== null) {
      if (tool === 'paint' && pred.colors.get(branch) !== pred.swatch) {
        pred.colors.set(branch, pred.swatch); changed = true;
      } else if (tool === 'erase' && pred.colors.has(branch)) {
        pred.colors.delete(branch); changed = true;
      } else if (tool === 'tail+') {
        const t = pred.tails.get(branch) || { n: 0, dir: 1 };
        pred.tails.set(branch, { ...t, n: Math.min(MAX_TAILS, t.n + 1) }); changed = true;
      } else if (tool === 'tail-' && pred.tails.has(branch)) {
        const t = pred.tails.get(branch);
        if (t.n <= 1) pred.tails.delete(branch); else pred.tails.set(branch, { ...t, n: t.n - 1 });
        changed = true;
      } else if (tool === 'flip' && pred.tails.has(branch)) {
        const t = pred.tails.get(branch);
        pred.tails.set(branch, { ...t, dir: -t.dir }); changed = true;
      }
    }
    if (partId) {
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

  function down(ev, target) {
    if (app.pred.view !== 'mine') app.setView('mine');
    apply(target);
    painting = app.pred.tool === 'paint' || app.pred.tool === 'erase';
  }

  function move(ev) {
    if (!painting) return;
    apply(document.elementFromPoint(ev.clientX, ev.clientY));
  }

  function up() {
    painting = false;
  }

  return { down, move, up };
}
