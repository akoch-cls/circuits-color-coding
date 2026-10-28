import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deserialize } from '../js/model.js';
import {
  buildGraph, steadyState, steadySummary, initialState, step, maxDifference, analyze,
} from '../js/solver.js';
import { levelOf, LEVELS } from '../js/colors.js';
import { PRESET_GROUPS } from '../js/presets.js';

const all = PRESET_GROUPS.flatMap((g) => g.items);
const preset = (prefix) => deserialize(all.find((p) => p.n.startsWith(prefix)));

function solve(c, ratio = 2) {
  const g = buildGraph(c, ratio);
  const V = steadyState(g);
  return { g, V, s: steadySummary(g, V) };
}

// Index of the wire run passing through grid point (x, y).
function branchAt(g, x, y) {
  const s = g.segs.findIndex(({ a, b }) => {
    const cross = (x - a[0]) * (b[1] - a[1]) - (y - a[1]) * (b[0] - a[0]);
    const inX = Math.min(a[0], b[0]) <= x && x <= Math.max(a[0], b[0]);
    const inY = Math.min(a[1], b[1]) <= y && y <= Math.max(a[1], b[1]);
    return cross === 0 && inX && inY;
  });
  return g.segBranch[s];
}

function colorAt({ g, s }, x, y) {
  return LEVELS[levelOf(s.branchP[branchAt(g, x, y)])].name;
}

test('every preset builds and solves', () => {
  for (const p of all) {
    const g = buildGraph(deserialize(p), 2);
    assert.equal(g.error, null, p.n);
    assert.ok(steadyState(g), p.n);
  }
});

test('5A: middle wire is yellow, bulbs equally bright', () => {
  const r = solve(preset('5A'));
  assert.equal(colorAt(r, 1, 6), 'Red');
  assert.equal(colorAt(r, 4, 1), 'Yellow');
  assert.equal(colorAt(r, 1, 2), 'Yellow');
  assert.equal(colorAt(r, 7, 6), 'Blue');
  const rays = [...r.s.rays.values()];
  assert.equal(rays[0], rays[1]);
});

test('5C: wires go red, orange, yellow, blue; long bulb brightest', () => {
  const r = solve(preset('5C'));
  assert.equal(colorAt(r, 1, 7), 'Red');
  assert.equal(colorAt(r, 1, 1), 'Orange');
  assert.equal(colorAt(r, 7, 1), 'Yellow');
  assert.equal(colorAt(r, 7, 7), 'Blue');
  const c = preset('5C');
  const [rA, rB] = c.parts.filter((p) => p.type === 'R');
  const L = c.parts.find((p) => p.type === 'L');
  const r2 = solve(c);
  assert.equal(r2.s.rays.get(rA.id), r2.s.rays.get(rB.id));
  assert.ok(r2.s.rays.get(L.id) > r2.s.rays.get(rA.id));
});

test('5D: middle wires round to orange and yellow; tails 3, 1, 2', () => {
  const r = solve(preset('5D'));
  assert.equal(colorAt(r, 6, 2), 'Orange');
  assert.equal(colorAt(r, 6, 7), 'Yellow');
  const tails = (x, y) => r.s.branchTails[branchAt(r.g, x, y)];
  assert.equal(tails(1, 3), 3); // battery wire carries everything
  assert.equal(tails(6, 6), 1); // long-bulb branch
  assert.equal(tails(9, 6), 2); // round-bulb branch
});

test('5B: two lit long bulbs, two shorted (off) bulbs', () => {
  const { s } = solve(preset('5B'));
  const rays = s.bulbs.map((b) => s.rays.get(b.part.id)).sort();
  assert.deepEqual(rays.map((x) => x > 0), [false, false, true, true]);
});

test('two round in parallel: equal tails, battery wire doubles', () => {
  const r = solve(preset('Two round in parallel'));
  const bulbTails = [...r.s.bulbTails.values()];
  assert.deepEqual(bulbTails, [1, 1]);
  assert.equal(Math.max(...r.s.branchTails), 2);
});

test('junction rule holds at every node at steady state', () => {
  for (const p of all) {
    const { g, V } = solve(deserialize(p));
    const { I } = analyze(g, V);
    const sum = new Float64Array(g.nodes.length);
    g.edges.forEach((e, k) => {
      if (e.kind === 'battery') { sum[e.a] += I[k]; sum[e.b] -= I[k]; return; }
      sum[e.a] -= I[k]; sum[e.b] += I[k];
    });
    sum.forEach((v) => assert.ok(Math.abs(v) < 1e-6, `${p.n}: ${v}`));
  }
});

test('transient settles to steady state from wrong starts', () => {
  for (const p of all) {
    const g = buildGraph(deserialize(p), 2);
    const target = steadyState(g);
    for (const kind of ['low', 'high', 'mixed']) {
      let V = initialState(g, kind);
      for (let i = 0; i < 4000 && maxDifference(g, V, target) > 1e-3; i++) V = step(g, V, 0.02);
      assert.ok(maxDifference(g, V, target) <= 1e-3, `${p.n} from ${kind}`);
    }
  }
});

test('pressure rises where more flows in than out', () => {
  const g = buildGraph(preset('Two round in series'), 2);
  const V0 = initialState(g, 'low');
  const mid = g.nodeIndex.get('2,3');
  const { netFlow } = analyze(g, V0);
  assert.ok(netFlow[g.netOf[mid]] > 0);
  const V1 = step(g, V0, 0.02);
  assert.ok(V1[mid] > V0[mid]);
});

test('parts not joined to the battery have no pressure', () => {
  const c = preset('One round bulb');
  c.parts.push({ id: 'x', type: 'R', a: [10, 10], b: [12, 10] });
  const { g, V, s } = solve(c);
  assert.ok(Number.isNaN(V[g.nodeIndex.get('10,10')]));
  assert.equal(s.rays.get('x'), 0);
});

test('open circuit: no flow, bulbs off', () => {
  const { s } = solve(preset('Broken wire'));
  assert.ok([...s.rays.values()].every((r) => r === 0));
  assert.ok(s.branchTails.every((t) => t === 0));
});

test('short circuit and missing battery are reported', () => {
  const c = preset('One round bulb');
  c.wires.push({ id: 'short', a: [0, 0], b: [0, 4] });
  assert.equal(buildGraph(c).error, 'short');
  const d = preset('One round bulb');
  d.parts = d.parts.filter((p) => p.type !== 'battery');
  assert.equal(buildGraph(d).error, 'no-battery');
});
