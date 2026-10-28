// Compare a student's mark-up with the steady state.
//
// prediction = {
//   colors: Map(branch -> level 0..8),
//   tails:  Map(branch -> { n, dir })   dir +1 = from branch.start toward branch.end
//   rays:   Map(partId -> n)
// }
// Feedback is in words only: no pressures or currents are ever shown.

import { isOffGrid } from './colors.js';
import { LIT } from './solver.js';

export function checkPrediction(g, ss, pred) {
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

  // --- arrows (direction, and tails in the right proportion) ---
  let missing = 0; let backwards = 0; let extra = 0;
  const ratios = [];
  g.branches.forEach((_, b) => {
    const T = ss.branchTails[b];
    const s = pred.tails.get(b);
    const n = s ? s.n : 0;
    if (T === 0) {
      if (n > 0) { extra++; result.badArrows.add(b); }
      return;
    }
    if (n === 0) { missing++; result.badArrows.add(b); return; }
    if (s.dir !== ss.branchDir[b]) { backwards++; result.badArrows.add(b); return; }
    ratios.push({ b, r: n / T });
  });
  // The student may use any tail size, as long as every arrow uses the same one.
  let wrongAmount = 0;
  if (ratios.length) {
    const counts = new Map();
    ratios.forEach(({ r }) => counts.set(r, (counts.get(r) || 0) + 1));
    let best = ratios[0].r;
    counts.forEach((c, r) => { if (c > counts.get(best) || (c === counts.get(best) && r < best)) best = r; });
    ratios.forEach(({ b, r }) => { if (r !== best) { wrongAmount++; result.badArrows.add(b); } });
  }
  if (missing) say('bad', `${plural(missing, 'wire with flow is', 'wires with flow are')} missing an arrow.`);
  if (backwards) say('bad', `${plural(backwards, 'arrow points', 'arrows point')} the wrong way. Flow goes from high pressure toward low pressure.`);
  if (extra) say('bad', 'Some arrows are on wires with no flow (no pressure difference drives flow there).');
  if (wrongAmount) say('bad', `${plural(wrongAmount, 'arrow has', 'arrows have')} the wrong number of tails compared with the rest of the circuit.`);
  if (!missing && !backwards && !extra && !wrongAmount) say('good', 'All arrows match the steady-state flow.');

  // --- junction rule and "bulbs don't use up flow", from the student's own arrows ---
  const flowAt = (node, b) => {
    const s = pred.tails.get(b);
    if (!s || !s.n) return 0;
    const br = g.branches[b];
    const out = (br.start === node && s.dir === 1) || (br.end === node && s.dir === -1);
    return out ? -s.n : s.n;
  };
  const branchesAt = (node) => {
    const list = [];
    g.branches.forEach((br, b) => {
      if (br.start === node) list.push(b);
      if (br.end === node && br.end !== br.start) list.push(b);
    });
    return list;
  };
  let junctionErrors = 0;
  g.nodes.forEach((_, node) => {
    if (g.isTerminal[node]) return;
    const list = branchesAt(node);
    if (list.length < 3 || list.some((b) => !pred.tails.get(b)?.n)) return;
    const net = list.reduce((acc, b) => acc + flowAt(node, b), 0);
    if (net !== 0) { junctionErrors++; result.badNodes.add(node); }
  });
  if (junctionErrors) say('bad', 'At a junction (circled), the tails flowing in do not equal the tails flowing out. Charge cannot pile up or vanish at a junction in steady state.');

  let bulbErrors = 0;
  g.edges.forEach((e) => {
    if (e.kind === 'wire') return;
    const sideA = branchesAt(e.a);
    const sideB = branchesAt(e.b);
    if (sideA.length !== 1 || sideB.length !== 1) return;
    if (countEdgesAt(g, e.a) !== 2 || countEdgesAt(g, e.b) !== 2) return;
    const fa = flowAt(e.a, sideA[0]); // into node a from its wire
    const fb = flowAt(e.b, sideB[0]);
    if (!fa || !fb) return;
    if (fa + fb !== 0) {
      bulbErrors++;
      if (e.kind === 'bulb') result.badBulbs.add(e.part.id);
      result.badArrows.add(sideA[0]); result.badArrows.add(sideB[0]);
    }
  });
  if (bulbErrors) say('bad', 'The flow into a bulb (or the battery) must equal the flow out of it. Bulbs light up without using up any flow.');

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

function countEdgesAt(g, node) {
  return g.edges.reduce((n, e) => n + (e.a === node) + (e.b === node), 0);
}

function plural(n, one, many) {
  if (n === 1) return `One ${one}`;
  return `${n === 2 ? 'Two' : 'Some'} ${many}`;
}
