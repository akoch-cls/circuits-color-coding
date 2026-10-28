import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deserialize } from '../js/model.js';
import { buildGraph, steadyState, steadySummary } from '../js/solver.js';
import { checkPrediction } from '../js/check.js';
import {
  validateSet, slugify, SLUG_RE, progressKey, restoreProgress, emptyProgress, packMarks, unpackMarks, problemStatus, newProblem,
} from '../js/sets.js';
import { PRESET_GROUPS } from '../js/presets.js';

const example = JSON.parse(readFileSync(new URL('../sets/circuit-review.json', import.meta.url)));
const preset = (prefix) => PRESET_GROUPS.flatMap((g) => g.items).find((p) => p.n.startsWith(prefix));

test('every set file in the repo is valid and its file name is a valid slug', () => {
  const set = validateSet(example);
  assert.equal(set.problems.length, 5);
  assert.ok(SLUG_RE.test('circuit-review'));
});

test('bad sets give readable errors', () => {
  assert.throws(() => validateSet(null), /not a problem set/);
  assert.throws(() => validateSet({ problems: [] }), /no problems/);
  assert.throws(() => validateSet({ problems: [{ circuit: { p: [['bomb', 0, 0, 1, 1]], w: [] } }] }), /Problem 1 has a broken circuit/);
});

test('defaults are filled and junk settings are replaced', () => {
  const set = validateSet({ settings: { ratio: 7, arrowPlacement: '__proto__' }, problems: [{ circuit: preset('5A') }] });
  assert.deepEqual(set.settings, { ratio: 2, arrowPlacement: 'junctions' });
  assert.deepEqual(set.problems[0].require, { colors: true, arrows: true, rays: true });
  assert.equal(set.problems[0].type, 'predict');
  assert.equal(set.problems[0].allowAnswer, false);
});

test('slugs are safe file names', () => {
  assert.equal(slugify('Series vs. Parallel #2!'), 'series-vs-parallel-2');
  assert.equal(slugify('   '), 'my-set');
  assert.ok(SLUG_RE.test(slugify('Ünïcödé — test')));
  assert.ok(!SLUG_RE.test('../secret'));
});

test('a colors-only problem ignores missing arrows and rays but still catches a wrong color', () => {
  const c = deserialize(preset('5C'));
  const g = buildGraph(c, 2);
  const ss = steadySummary(g, steadyState(g));
  const colors = new Map(g.branches.map((_, b) => [b, Math.round(ss.branchP[b] * 8)]));
  const pred = { colors, arrows: [], rays: new Map() };
  const require = { colors: true, arrows: false, rays: false };
  const ok = checkPrediction(g, ss, pred, { circuit: c, require });
  assert.ok(ok.allGood);
  assert.ok(!ok.messages.some((m) => /arrow|bulb/i.test(m.text)));
  colors.set(0, (colors.get(0) + 3) % 9);
  assert.ok(!checkPrediction(g, ss, pred, { circuit: c, require }).allGood);
});

test('saved marks survive a reload even though part ids change', () => {
  const c1 = deserialize(preset('5A'));
  const [bulb] = c1.parts.filter((p) => p.type === 'R');
  const pred = {
    colors: new Map([[0, 8]]),
    arrows: [{ site: { kind: 'part', id: bulb.id }, n: 2, dir: 1 }, { site: { kind: 'branch', b: 1 }, seg: 3, t: 0.4, n: 2, dir: -1 }],
    rays: new Map([[bulb.id, 3]]),
  };
  const packed = JSON.parse(JSON.stringify(packMarks(pred, c1)));
  const c2 = deserialize(preset('5A')); // fresh ids
  const back = unpackMarks(packed, c2);
  const bulb2 = c2.parts[c1.parts.indexOf(bulb)];
  assert.equal(back.colors.get(0), 8);
  assert.equal(back.arrows[0].site.id, bulb2.id);
  assert.deepEqual(back.arrows[1], pred.arrows[1]);
  assert.equal(back.rays.get(bulb2.id), 3);
});

test('progress starts over when the set changes', () => {
  const set = validateSet(example);
  const edited = validateSet({ ...example, title: 'Circuit Review (v2)' });
  assert.notEqual(progressKey('circuit-review', set), progressKey('circuit-review', edited));
  const saved = { ...emptyProgress(set), current: 3, name: 'Sam' };
  assert.equal(restoreProgress(saved, set).current, 3);
  const shorter = validateSet({ ...example, problems: example.problems.slice(0, 2) });
  assert.equal(restoreProgress(saved, shorter).current, 0);
});

test('summary wording', () => {
  const p = newProblem(deserialize(preset('5A')));
  const st = (o) => ({ checks: 0, checksToCorrect: 0, viewed: false, ...o });
  assert.equal(problemStatus(p, st({ checks: 1, checksToCorrect: 1 })), 'Correct on the first check');
  assert.equal(problemStatus(p, st({ checks: 4, checksToCorrect: 3 })), 'Correct after 3 checks');
  assert.equal(problemStatus(p, st({ checks: 2 })), 'Not correct yet (2 checks)');
  assert.equal(problemStatus(p, st({})), 'Not checked');
  assert.equal(problemStatus({ ...p, type: 'explore' }, st({ viewed: true })), 'Viewed');
});

test('accented titles make clean slugs', async () => {
  assert.equal(slugify('Résumé café'), 'resume-cafe');
});

test('oversized or out-of-range circuits are rejected with a readable error', () => {
  const huge = { p: [], w: Array.from({ length: 500 }, (_, i) => [i, 0, i + 1, 0]) };
  assert.throws(() => validateSet({ problems: [{ circuit: huge }] }), /Problem 1 has a broken circuit \(Circuit is too big\)/);
  assert.throws(() => validateSet({ problems: [{ circuit: { p: [['R', 0, 0, 1e300, 0]], w: [] } }] }), /Bad coordinate/);
  assert.throws(() => deserialize({ p: [5], w: [] }), /Bad part/);
});

test('damaged saved marks and drafts are dropped instead of breaking the page', async () => {
  const { normalizeDraft } = await import('../js/sets.js');
  const c = deserialize(preset('5A'));
  const g = buildGraph(c, 2);
  assert.equal(unpackMarks({ arrows: [{}] }, c, g), null);
  assert.equal(unpackMarks({ colors: 5 }, c, g), null);
  const cleaned = unpackMarks({
    colors: [[0, 8], [99, 4], [1, 42]],
    arrows: [{ site: { kind: 'branch', b: 500 }, seg: 0, t: 0.5, n: 1, dir: 1 }, { site: { kind: 'part', part: 7 }, n: 1, dir: 1 }],
    rays: [[0, 3], [9, 2]],
  }, c, g);
  assert.deepEqual([...cleaned.colors], [[0, 8]]);
  assert.equal(cleaned.arrows.length, 0);
  assert.equal(cleaned.rays.size, 1);
  const d = normalizeDraft({ title: 5, problems: [null, { circuit: 'x' }, { circuit: preset('5A'), require: 'all' }] }, { ratio: 3 });
  assert.equal(d.title, '');
  assert.equal(d.problems.length, 1);
  assert.deepEqual(d.problems[0].require, { colors: true, arrows: true, rays: true });
  assert.equal(d.settings.ratio, 3);
  assert.deepEqual(normalizeDraft('junk', {}).problems, []);
});

test('an opened set keeps its own grading settings', async () => {
  const { normalizeDraft } = await import('../js/sets.js');
  const set = validateSet({ settings: { ratio: 3, arrowPlacement: 'bulbs' }, problems: [{ circuit: preset('5A') }] });
  assert.deepEqual(normalizeDraft(set, { ratio: 2, arrowPlacement: 'junctions' }).settings, { ratio: 3, arrowPlacement: 'bulbs' });
});
