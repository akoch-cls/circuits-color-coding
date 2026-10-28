// Where flow arrows go.
//
// An arrow belongs to a "site": a wire run (branch) or a part (bulb or battery).
// Its direction (dir = +1 / -1) is relative to the site's own orientation:
// branch.start -> branch.end, or part.a -> part.b.

import { bounds } from './model.js';

export const S = 60; // pixels per grid unit

export const PLACEMENTS = {
  junctions: 'Bulbs and before/after junctions',
  bulbs: 'Bulbs only',
  wires: 'Middle of every wire',
  all: 'Bulbs and every wire',
};

export function circuitCenter(circuit) {
  const b = bounds(circuit);
  return [(b.minX + b.maxX) * S / 2, (b.minY + b.maxY) * S / 2];
}

// A point beside the circuit element, pushed outward (away from the center) so
// the arrow does not sit on top of the wire.
function offsetPose(x, y, ux, uy, center, off) {
  let nx = -uy;
  let ny = ux;
  if ((x - center[0]) * nx + (y - center[1]) * ny < 0) { nx = -nx; ny = -ny; }
  return { x: x + nx * off, y: y + ny * off, ux, uy };
}

// Point `t` (0..1 from seg.a to seg.b) along one segment of a branch.
export function branchPointPose(g, b, segIndex, t, center) {
  const br = g.branches[b];
  const item = br.segs.find((i) => i.seg === segIndex) || br.main;
  const s = g.segs[item.seg];
  const ax = s.a[0] * S; const ay = s.a[1] * S;
  const bx = s.b[0] * S; const by = s.b[1] * S;
  const len = Math.hypot(bx - ax, by - ay) || 1;
  let ux = (bx - ax) / len;
  let uy = (by - ay) / len;
  if (!item.fwd) { ux = -ux; uy = -uy; }
  return offsetPose(ax + (bx - ax) * t, ay + (by - ay) * t, ux, uy, center, 20);
}

export function branchMidPose(g, b, center) {
  return branchPointPose(g, b, g.branches[b].main.seg, 0.5, center);
}

// Just inside a branch, next to one of its end nodes.
export function branchEndPose(g, b, node, center) {
  const br = g.branches[b];
  const item = br.start === node ? br.segs[0] : br.segs[br.segs.length - 1];
  const s = g.segs[item.seg];
  const len = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) * S || 1;
  const d = Math.min(40, len / 2) / len;
  return branchPointPose(g, b, item.seg, s.na === node ? d : 1 - d, center);
}

export function partPose(part, center) {
  const cx = (part.a[0] + part.b[0]) * S / 2;
  const cy = (part.a[1] + part.b[1]) * S / 2;
  const dx = part.b[0] - part.a[0];
  const dy = part.b[1] - part.a[1];
  const len = Math.hypot(dx, dy) || 1;
  return offsetPose(cx, cy, dx / len, dy / len, center, part.type === 'battery' ? 40 : 50);
}

export function isJunction(g, node) {
  return g.degree[node] >= 3;
}

// Sites (and where to draw them) for the simulation's own arrows.
export function liveSites(g, circuit, placement) {
  const center = circuitCenter(circuit);
  const sites = [];
  const bulbs = placement === 'junctions' || placement === 'bulbs' || placement === 'all';
  if (bulbs) {
    circuit.parts.forEach((p) => {
      if (p.type !== 'battery') sites.push({ site: { kind: 'part', id: p.id }, pose: partPose(p, center) });
    });
  }
  g.branches.forEach((br, b) => {
    if (placement === 'wires' || placement === 'all') {
      sites.push({ site: { kind: 'branch', b }, pose: branchMidPose(g, b, center) });
    } else if (placement === 'junctions') {
      for (const node of new Set([br.start, br.end])) {
        if (isJunction(g, node)) sites.push({ site: { kind: 'branch', b }, pose: branchEndPose(g, b, node, center) });
      }
    }
  });
  return sites;
}

// Flow at a site, signed relative to the site's orientation.
export function siteFlow(g, an, site) {
  if (site.kind === 'branch') return an.branchI[site.b];
  if (g.battery && g.battery.part.id === site.id) return -an.I[g.batteryEdge];
  const e = g.partEdge.get(site.id);
  return e === undefined ? 0 : an.I[e];
}

// Where a student's arrow is drawn.
export function studentPose(g, circuit, arrow, center) {
  if (arrow.site.kind === 'part') {
    const part = circuit.parts.find((p) => p.id === arrow.site.id);
    return part ? partPose(part, center) : null;
  }
  return branchPointPose(g, arrow.site.b, arrow.seg, arrow.t, center);
}

// Position (in pixels) of a student's arrow on its wire, before the outward offset.
export function arrowAnchor(g, circuit, arrow) {
  if (arrow.site.kind === 'part') {
    const p = circuit.parts.find((q) => q.id === arrow.site.id);
    return p ? [(p.a[0] + p.b[0]) * S / 2, (p.a[1] + p.b[1]) * S / 2] : [0, 0];
  }
  const s = g.segs[arrow.seg];
  return [(s.a[0] + (s.b[0] - s.a[0]) * arrow.t) * S, (s.a[1] + (s.b[1] - s.a[1]) * arrow.t) * S];
}
