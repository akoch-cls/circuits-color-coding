import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deserialize } from '../js/model.js';
import { buildGraph, steadyState, steadySummary } from '../js/solver.js';
import { checkPrediction } from '../js/check.js';
import { PRESET_GROUPS } from '../js/presets.js';

const all = PRESET_GROUPS.flatMap((g) => g.items);

function setup(prefix) {
  const c = deserialize(all.find((p) => p.n.startsWith(prefix)));
  const g = buildGraph(c, 2);
  const ss = steadySummary(g, steadyState(g));
  return { c, g, ss };
}

// The answer key written as a student prediction, with tails scaled by `scale`.
function perfect({ g, ss }, scale = 1) {
  const colors = new Map();
  const tails = new Map();
  g.branches.forEach((_, b) => {
    if (!Number.isNaN(ss.branchP[b])) colors.set(b, Math.round(ss.branchP[b] * 8));
    if (ss.branchTails[b]) tails.set(b, { n: ss.branchTails[b] * scale, dir: ss.branchDir[b] });
  });
  return { colors, tails, rays: new Map(ss.rays) };
}

test('the answer key passes, and doubled tails are fine', () => {
  for (const name of ['5A', '5B', '5C', '5D', '4D']) {
    const s = setup(name);
    assert.ok(checkPrediction(s.g, s.ss, perfect(s)).allGood, name);
    assert.ok(checkPrediction(s.g, s.ss, perfect(s, 2)).allGood, `${name} x2`);
  }
});

test('a broken junction rule is circled', () => {
  const s = setup('5D');
  const pred = perfect(s);
  // the wire feeding the top junction, between the first bulb and the split
  const junction = s.g.nodeIndex.get('6,2');
  const feed = s.g.branches.findIndex((br) => br.end === junction || br.start === junction);
  assert.equal(s.ss.branchTails[feed], 3);
  pred.tails.set(feed, { ...pred.tails.get(feed), n: 2 });
  const r = checkPrediction(s.g, s.ss, pred);
  assert.ok(!r.allGood);
  assert.ok(r.badNodes.size >= 1);
  assert.ok(r.messages.some((m) => /junction/.test(m.text)));
});

test('flow used up by a bulb is flagged', () => {
  const s = setup('5A');
  const pred = perfect(s, 2);
  const someBranch = [...pred.tails.keys()][0];
  pred.tails.set(someBranch, { ...pred.tails.get(someBranch), n: 1 });
  const r = checkPrediction(s.g, s.ss, pred);
  assert.ok(r.messages.some((m) => /using up/.test(m.text)));
});

test('wrong color, backwards arrow and equal-brightness ranking are caught', () => {
  const s = setup('5C');
  const pred = perfect(s);
  const [b0] = pred.colors.keys();
  pred.colors.set(b0, (pred.colors.get(b0) + 2) % 9);
  const t = [...pred.tails.keys()][1];
  pred.tails.set(t, { ...pred.tails.get(t), dir: -pred.tails.get(t).dir });
  const L = s.c.parts.find((p) => p.type === 'L');
  pred.rays.set(L.id, 1); // now dimmer than the round bulbs
  const r = checkPrediction(s.g, s.ss, pred);
  assert.ok(r.badBranches.has(b0));
  assert.ok(r.messages.some((m) => /wrong way/.test(m.text)));
  assert.ok(r.badBulbs.has(L.id));
});
