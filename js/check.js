// Compare a student's mark-up with the steady state.
//
// prediction = {
//   colors: Map(branch -> level 0..8),
//   arrows: [{ site: {kind:'branch', b} | {kind:'part', id}, seg, t, n, dir }]
//           dir +1 = branch.start -> branch.end, or part.a -> part.b
//           (seg, t) = where on the wire a branch arrow was drawn
// opts = { circuit, placement }   placement decides which places need an arrow
//   rays:   Map(partId -> n)
// }
// Feedback is in words only: no pressures or currents are ever shown.

import { isOffGrid } from './colors.js';
import { LIT } from './solver.js';
import { S, arrowAnchor, isJunction } from './arrows.js';

export function checkPrediction(g, ss, pred, opts = {}) {
  const result = {
    badBranches: new Set(), badArrows: new Set(), badBulbs: new Set(), badNodes: new Set(),
    messages: [],
  };
  const say = (kind, text) => result.messages.push({ kind, text });

  // --- wire colors ---
  let unpainted = 0;
  let wrongColor = 0;
  let floatingPainted = 0;
  g.branches.forEach((br, b) => {
    const level = pred.colors.get(b);
    const p = ss.branchP[b];
    if (Number.isNaN(p)) {
      if (level !== undefined) { floatingPainted++; result.badBranches.add(b); }
      return;
    }
    if (level === undefined) { unpainted++; result.badBranches.add(b); return; }
    const x = p * 8;
    const ok = isOffGrid(p) ? (level === Math.floor(x) || level === Math.ceil(x)) : level === Math.round(x);
    if (!ok) { wrongColor++; result.badBranches.add(b); }
  });
  if (unpainted) say('bad', `${plural(unpainted, 'wire still needs', 'wires still need')} a color.`);
  if (wrongColor) say('bad', `${plural(wrongColor, 'wire has', 'wires have')} the wrong pressure color (outlined in red). Remember: wires tied straight to the battery are red or blue, and pressure only changes across a bulb.`);
  if (floatingPainted) say('bad', 'Some colored wires are not part of a complete path to the battery, so they have no pressure difference to show. Leave them uncolored.');
  if (!unpainted && !wrongColor && !floatingPainted) say('good', 'All wire colors match the steady state.');

  // --- arrows: each one must match the flow where it was drawn ---
  const arrows = pred.arrows || [];
  const truthOf = (site) => (site.kind === 'branch'
    ? { T: ss.branchTails[site.b], dir: ss.branchDir[site.b] }
    : ss.partTruth.get(site.id) || { T: 0, dir: 1 });
  let backwards = 0; let extra = 0;
  const ratios = [];
  arrows.forEach((a, i) => {
    const { T, dir } = truthOf(a.site);
    if (T === 0) { extra++; result.badArrows.add(i); return; }
    if (a.dir !== dir) { backwards++; result.badArrows.add(i); return; }
    ratios.push({ i, r: a.n / T });
  });
  // The student may use any tail size, as long as every arrow uses the same one.
  let wrongAmount = 0;
  if (ratios.length) {
    const counts = new Map();
    ratios.forEach(({ r }) => counts.set(r, (counts.get(r) || 0) + 1));
    let best = ratios[0].r;
    counts.forEach((c, r) => { if (c > counts.get(best) || (c === counts.get(best) && r < best)) best = r; });
    ratios.forEach(({ i, r }) => { if (r !== best) { wrongAmount++; result.badArrows.add(i); } });
  }

  // Which places need an arrow depends on the class convention (teacher setting).
  const placement = opts.placement || 'junctions';
  const onBranch = (b) => arrows.some((a) => a.site.kind === 'branch' && a.site.b === b);
  const onPart = (id) => arrows.some((a) => a.site.kind === 'part' && a.site.id === id);
  let missingBulbs = 0; let missingWires = 0;
  if (placement !== 'wires') {
    ss.bulbs.forEach((bb) => {
      if (ss.partTruth.get(bb.part.id).T > 0 && !onPart(bb.part.id)) { missingBulbs++; result.badBulbs.add(bb.part.id); }
    });
  }
  g.branches.forEach((br, b) => {
    if (!ss.branchTails[b] || onBranch(b)) return;
    const atJunction = isJunction(g, br.start) || isJunction(g, br.end);
    const needed = placement === 'wires' || placement === 'all' || (placement === 'junctions' && atJunction);
    if (!needed) return;
    missingWires++;
    result.badBranches.add(b);
    if (placement === 'junctions') [br.start, br.end].forEach((n) => { if (isJunction(g, n)) result.badNodes.add(n); });
  });
  if (missingBulbs) say('bad', `${plural(missingBulbs, 'lit bulb needs', 'lit bulbs need')} an arrow showing the flow through it.`);
  if (missingWires) {
    say('bad', placement === 'junctions'
      ? 'Some wires going into or out of a junction (circled) need an arrow.'
      : `${plural(missingWires, 'wire with flow needs', 'wires with flow need')} an arrow.`);
  }
  if (backwards) say('bad', `${plural(backwards, 'arrow points', 'arrows point')} the wrong way. Flow goes from high pressure toward low pressure.`);
  if (extra) say('bad', 'Some arrows are where there is no flow (no pressure difference drives flow there).');
  if (wrongAmount) say('bad', `${plural(wrongAmount, 'arrow has', 'arrows have')} the wrong number of tails compared with the rest of the circuit.`);

  // --- the student's own arrows must obey "in = out" ---
  // Arrows on one stretch of wire must agree with each other.
  let alongWire = 0;
  g.branches.forEach((_, b) => {
    const list = arrows.map((a, i) => ({ a, i })).filter(({ a }) => a.site.kind === 'branch' && a.site.b === b);
    if (list.some(({ a }) => a.n !== list[0].a.n || a.dir !== list[0].a.dir)) {
      alongWire++;
      list.forEach(({ i }) => result.badArrows.add(i));
    }
  });
  if (alongWire) say('bad', 'Arrows on the same stretch of wire must match: flow is not gained or lost along a wire.');

  // At every node where a wire run ends, flow in must equal flow out.
  const anchor = (a) => arrowAnchor(g, opts.circuit, a);
  const nearestOnBranch = (b, node) => {
    const nx = g.nodes[node].x * S; const ny = g.nodes[node].y * S;
    let best = null; let bestD = Infinity;
    arrows.forEach((a, i) => {
      if (a.site.kind !== 'branch' || a.site.b !== b) return;
      const [x, y] = anchor(a);
      const d = Math.hypot(x - nx, y - ny);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  };
  let junctionErrors = 0; let bulbErrors = 0;
  g.nodes.forEach((_, node) => {
    if (g.degree[node] < 2 || (g.degree[node] === 2 && !g.isTerminal[node])) return;
    const flows = []; // [arrow index, sign into node]
    let complete = true;
    g.branches.forEach((br, b) => {
      for (const end of ['start', 'end']) {
        if (br[end] !== node) continue;
        const i = nearestOnBranch(b, node);
        if (i === null) { complete = false; continue; }
        const into = (end === 'end') === (arrows[i].dir === 1);
        flows.push([i, into ? 1 : -1]);
      }
    });
    opts.circuit.parts.forEach((p) => {
      const ends = [];
      if (g.nodeIndex.get(`${p.a[0]},${p.a[1]}`) === node) ends.push('a');
      if (g.nodeIndex.get(`${p.b[0]},${p.b[1]}`) === node) ends.push('b');
      if (!ends.length) return;
      const i = arrows.findIndex((a) => a.site.kind === 'part' && a.site.id === p.id);
      if (i < 0) { complete = false; return; }
      for (const end of ends) flows.push([i, (end === 'b') === (arrows[i].dir === 1) ? 1 : -1]);
    });
    if (!complete || flows.length < 2) return;
    const net = flows.reduce((acc, [i, sign]) => acc + sign * arrows[i].n, 0);
    if (net === 0) return;
    result.badNodes.add(node);
    flows.forEach(([i]) => result.badArrows.add(i));
    if (isJunction(g, node)) junctionErrors++; else bulbErrors++;
  });
  if (junctionErrors) say('bad', 'At a junction (circled), the tails flowing in do not equal the tails flowing out. Charge cannot pile up or vanish at a junction in steady state.');
  if (bulbErrors) say('bad', 'The flow into a bulb (or the battery) must equal the flow out of it (circled). Bulbs light up without using up any flow.');

  if (!missingBulbs && !missingWires && !backwards && !extra && !wrongAmount && !alongWire && !junctionErrors && !bulbErrors) {
    say('good', arrows.length ? 'All arrows match the steady-state flow.' : 'No arrows are needed here.');
  }

  // --- brightness: rays must rank the bulbs correctly ---
  const bulbs = ss.bulbs.map((b) => ({ id: b.part.id, P: b.P, n: pred.rays.get(b.part.id) || 0 }));
  let offWrong = 0; let rankWrong = 0;
  bulbs.forEach((b) => {
    const lit = b.P > LIT;
    if (lit !== (b.n > 0)) { offWrong++; result.badBulbs.add(b.id); }
  });
  for (let i = 0; i < bulbs.length; i++) {
    for (let j = i + 1; j < bulbs.length; j++) {
      const a = bulbs[i]; const c = bulbs[j];
      if (a.P <= LIT || c.P <= LIT) continue;
      const truth = Math.abs(a.P - c.P) <= 0.03 * Math.max(a.P, c.P) ? 0 : Math.sign(a.P - c.P);
      if (Math.sign(a.n - c.n) !== truth) {
        rankWrong++; result.badBulbs.add(a.id); result.badBulbs.add(c.id);
      }
    }
  }
  if (offWrong) say('bad', 'Check which bulbs are lit: a bulb glows only when there is a pressure difference across it.');
  if (rankWrong) say('bad', 'Some bulbs are ranked wrong: brighter bulbs need more rays, and equally bright bulbs need the same number.');
  if (!offWrong && !rankWrong) say('good', 'Bulb brightness ranking is correct.');

  result.allGood = result.messages.every((m) => m.kind === 'good');
  return result;
}

function plural(n, one, many) {
  if (n === 1) return `One ${one}`;
  return `${n === 2 ? 'Two' : 'Some'} ${many}`;
}
