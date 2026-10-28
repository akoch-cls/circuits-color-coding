// Build mode: draw wires, place and arrange parts on the grid.

import { uid } from './model.js';

const same = (p, q) => p[0] === q[0] && p[1] === q[1];

// Horizontal then vertical path between two grid points.
function lPath(s, e) {
  if (same(s, e)) return [];
  if (s[0] === e[0] || s[1] === e[1]) return [{ a: s, b: e }];
  const corner = [e[0], s[1]];
  return [{ a: s, b: corner }, { a: corner, b: e }];
}

// Wire ends touching a part's terminals, so they follow the part when it moves.
function attachedEnds(circuit, part) {
  const list = [];
  for (const w of circuit.wires) {
    for (const end of ['a', 'b']) {
      if (same(w[end], part.a)) list.push({ w, end, term: 'a' });
      else if (same(w[end], part.b)) list.push({ w, end, term: 'b' });
    }
  }
  return list;
}

export function createEditor(app) {
  let drag = null;

  function down(ev, gp, target) {
    const tool = app.build.tool;
    const partId = target?.dataset.part;
    const wireId = target?.dataset.wire;
    const part = partId && app.circuit.parts.find((p) => p.id === partId);

    if (tool === 'wire') {
      drag = { kind: 'wire', start: gp };
    } else if (tool === 'R' || tool === 'L' || tool === 'battery') {
      app.edit((c) => {
        if (tool === 'battery') {
          const had = c.parts.length;
          c.parts = c.parts.filter((p) => p.type !== 'battery');
          if (c.parts.length < had) app.toast('A circuit has one battery, so the old one was moved here.');
        }
        c.parts.push({ id: uid('p'), type: tool, a: [gp[0] - 1, gp[1]], b: [gp[0] + 1, gp[1]] });
      });
    } else if (tool === 'move' && part) {
      app.pushUndo();
      app.build.selected = part.id;
      drag = {
        kind: 'move', part, start: gp, a: [...part.a], b: [...part.b],
        ends: attachedEnds(app.circuit, part).map((x) => ({ ...x, orig: [...x.w[x.end]] })),
      };
    } else if (tool === 'rotate' && part) {
      app.edit((c) => {
        const p = c.parts.find((q) => q.id === part.id);
        const ends = attachedEnds(c, p);
        const cx = (p.a[0] + p.b[0]) / 2;
        const cy = (p.a[1] + p.b[1]) / 2;
        const rot = (q) => [Math.round(cx - (q[1] - cy)), Math.round(cy + (q[0] - cx))];
        p.a = rot(p.a);
        p.b = rot(p.b);
        ends.forEach(({ w, end, term }) => { w[end] = [...p[term]]; });
      });
    } else if (tool === 'delete') {
      if (part) app.edit((c) => { c.parts = c.parts.filter((p) => p.id !== part.id); });
      else if (wireId) app.edit((c) => { c.wires = c.wires.filter((w) => w.id !== wireId); });
    }
  }

  function move(ev, gp) {
    const changed = !app.build.hover || !same(app.build.hover, gp);
    app.build.hover = gp;
    if (drag?.kind === 'wire') {
      app.build.preview = lPath(drag.start, gp);
      app.redraw();
    } else if (drag?.kind === 'move') {
      const dx = gp[0] - drag.start[0];
      const dy = gp[1] - drag.start[1];
      const p = drag.part;
      if (p.a[0] === drag.a[0] + dx && p.a[1] === drag.a[1] + dy) return;
      p.a = [drag.a[0] + dx, drag.a[1] + dy];
      p.b = [drag.b[0] + dx, drag.b[1] + dy];
      drag.ends.forEach(({ w, end, orig }) => { w[end] = [orig[0] + dx, orig[1] + dy]; });
      app.rebuild({ animate: true });
    } else if (changed) {
      app.redraw();
    }
  }

  function up(ev, gp) {
    if (drag?.kind === 'wire') {
      const segs = lPath(drag.start, gp);
      app.build.preview = null;
      if (segs.length) {
        app.edit((c) => segs.forEach((s) => c.wires.push({ id: uid('w'), a: [...s.a], b: [...s.b] })));
      } else {
        app.redraw();
      }
    }
    drag = null;
  }

  function leave() {
    app.build.hover = null;
    app.redraw();
  }

  return { down, move, up, leave };
}
