import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deserialize } from '../js/model.js';
import { buildGraph, steadyState, steadySummary } from '../js/solver.js';
import { checkPrediction } from '../js/check.js';
import { liveSites } from '../js/arrows.js';
import { PRESET_GROUPS } from '../js/presets.js';

const all = PRESET_GROUPS.flatMap((g) => g.items);

function setup(prefix) {
  const c = deserialize(all.find((p) => p.n.startsWith(prefix)));
  const g = buildGraph(c, 2);
  const ss = steadySummary(g, steadyState(g));
  return { c, g, ss };
}

// The answer key written as a student prediction: arrows wherever the class
// convention puts them, with tails scaled by `scale`.
function perfect({ c, g, ss }, { scale = 1, placement = 'junctions' } = {}) {
  const colors = new Map();
  g.branches.forEach((_, b) => {
    if (!Number.isNaN(ss.branchP[b])) colors.set(b, Math.round(ss.branchP[b] * 8));
  });
  const arrows = [];
  for (const { site } of liveSites(g, c, placement)) {
    const truth = site.kind === 'branch'
      ? { T: ss.branchTails[site.b], dir: ss.branchDir[site.b] }
      : ss.partTruth.get(site.id);
    if (!truth.T) continue;
    const a = { site, n: truth.T * scale, dir: truth.dir };
    if (site.kind === 'branch') { a.seg = g.branches[site.b].main.seg; a.t = 0.5; }
    arrows.push(a);
  }
  return { colors, arrows, rays: new Map(ss.rays) };
}

const run = (s, pred, placement = 'junctions') => checkPrediction(s.g, s.ss, pred, { circuit: s.c, placement });

test('the answer key passes for every placement, and doubled tails are fine', () => {
  for (const name of ['5A', '5B', '5C', '5D', '4B', '4D']) {
    const s = setup(name);
    for (const placement of ['junctions', 'bulbs', 'wires', 'all']) {
      assert.ok(run(s, perfect(s, { placement }), placement).allGood, `${name} ${placement}`);
    }
    assert.ok(run(s, perfect(s, { scale: 2 })).allGood, `${name} x2`);
  }
});

test('a missing arrow at a bulb or beside a junction is flagged', () => {
  const s = setup('5D');
  const pred = perfect(s);
  pred.arrows = pred.arrows.filter((a) => a.site.kind !== 'part');
  assert.ok(run(s, pred).messages.some((m) => /lit bulbs? needs? an arrow/.test(m.text)));
  const pred2 = perfect(s);
  pred2.arrows = pred2.arrows.filter((a) => a.site.kind !== 'branch');
  const r = run(s, pred2);
  assert.ok(r.messages.some((m) => /junction/.test(m.text)));
  assert.ok(r.badNodes.size >= 1);
});

test('a broken junction rule is circled', () => {
  const s = setup('5D');
  const pred = perfect(s);
  const junction = s.g.nodeIndex.get('6,2');
  const feed = s.g.branches.findIndex((br) => br.end === junction || br.start === junction);
  const a = pred.arrows.find((x) => x.site.kind === 'branch' && x.site.b === feed);
  assert.equal(a.n, 3);
  a.n = 2;
  const r = run(s, pred);
  assert.ok(!r.allGood);
  assert.ok(r.badNodes.has(junction));
  assert.ok(r.messages.some((m) => /tails flowing in do not equal/.test(m.text)));
});

test('flow used up by a bulb is flagged', () => {
  const s = setup('5A');
  const pred = perfect(s, { placement: 'all', scale: 2 });
  pred.arrows.find((a) => a.site.kind === 'branch').n = 1;
  const r = run(s, pred, 'all');
  assert.ok(r.messages.some((m) => /using up/.test(m.text)));
});

test('arrows anywhere on a wire are accepted, but must agree along it', () => {
  const s = setup('5C');
  const pred = perfect(s, { placement: 'bulbs' });
  const b = 0;
  const truth = { n: s.ss.branchTails[b], dir: s.ss.branchDir[b] };
  const seg = s.g.branches[b].segs[0].seg;
  pred.arrows.push({ site: { kind: 'branch', b }, seg, t: 0.2, ...truth });
  assert.ok(run(s, pred, 'bulbs').allGood);
  pred.arrows.push({ site: { kind: 'branch', b }, seg, t: 0.8, n: truth.n + 1, dir: truth.dir });
  assert.ok(run(s, pred, 'bulbs').messages.some((m) => /same stretch of wire/.test(m.text)));
});

test('wrong color, backwards arrow and equal-brightness ranking are caught', () => {
  const s = setup('5C');
  const pred = perfect(s);
  const [b0] = pred.colors.keys();
  pred.colors.set(b0, (pred.colors.get(b0) + 2) % 9);
  pred.arrows[1].dir = -pred.arrows[1].dir;
  const L = s.c.parts.find((p) => p.type === 'L');
  pred.rays.set(L.id, 1); // now dimmer than the round bulbs
  const r = run(s, pred);
  assert.ok(r.badBranches.has(b0));
  assert.ok(r.messages.some((m) => /wrong way/.test(m.text)));
  assert.ok(r.badBulbs.has(L.id));
});
