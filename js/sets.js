// Problem sets: a slideshow of circuits for students to work through one at a time.
//
// GitHub Pages can only serve files, so each set is a JSON file in the repo's
// sets/ folder, and students open it with  index.html?set=<slug>.
//
// {
//   "version": 1,
//   "title": "...", "description": "...",
//   "settings": { "ratio": 2, "arrowPlacement": "junctions" },
//   "problems": [{
//     "type": "predict" | "explore",
//     "instructions": "...",
//     "circuit": { n, p, w },                        same form as an exported circuit
//     "require": { "colors": true, "arrows": true, "rays": true },
//     "allowSettle": true,
//     "allowAnswer": false
//   }]
// }

import { deserialize, serialize } from './model.js';
import { PLACEMENTS } from './arrows.js';

export const SLUG_RE = /^[a-z0-9-]{1,60}$/;
export const RATIOS = [1.5, 2, 3, 4];
const MAX_TITLE = 100;
const MAX_TEXT = 1000;
const MAX_PROBLEMS = 60;

export function slugify(title) {
  const slug = String(title || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return slug || 'my-set';
}

export function newProblem(circuit) {
  return {
    type: 'predict',
    instructions: '',
    circuit: serialize(circuit),
    require: { colors: true, arrows: true, rays: true },
    allowSettle: true,
    allowAnswer: false,
  };
}

export function newSet(settings = {}) {
  return { version: 1, title: '', description: '', settings: normalizeSettings(settings), problems: [] };
}

const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

export function normalizeSettings(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const ratio = Number(s.ratio);
  const placement = s.arrowPlacement;
  return {
    ratio: RATIOS.includes(ratio) ? ratio : 2,
    arrowPlacement: typeof placement === 'string' && Object.hasOwn(PLACEMENTS, placement) ? placement : 'junctions',
  };
}

// One problem with defaults filled in. Throws if its circuit is broken.
export function normalizeProblem(p) {
  if (!p || typeof p !== 'object') throw new Error('is empty');
  let circuit;
  try {
    circuit = serialize(deserialize(p.circuit));
  } catch (err) {
    throw new Error(`has a broken circuit (${err.message})`);
  }
  const r = p.require && typeof p.require === 'object' ? p.require : {};
  const require = { colors: r.colors !== false, arrows: r.arrows !== false, rays: r.rays !== false };
  if (!require.colors && !require.arrows && !require.rays) Object.assign(require, { colors: true, arrows: true, rays: true });
  return {
    type: p.type === 'explore' ? 'explore' : 'predict',
    instructions: text(p.instructions, MAX_TEXT),
    circuit,
    require,
    allowSettle: p.allowSettle !== false,
    allowAnswer: p.allowAnswer === true,
  };
}

// A draft saved in this browser: keep whatever still makes sense, never throw.
export function normalizeDraft(data, fallbackSettings) {
  const d = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const problems = [];
  for (const p of Array.isArray(d.problems) ? d.problems.slice(0, MAX_PROBLEMS) : []) {
    try { problems.push(normalizeProblem(p)); } catch { /* drop it */ }
  }
  return {
    version: 1,
    title: text(d.title, MAX_TITLE),
    description: text(d.description, MAX_TEXT),
    settings: normalizeSettings(d.settings || fallbackSettings),
    problems,
  };
}

// Check a set file and fill in defaults. Throws an Error with a readable message.
export function validateSet(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('This is not a problem set file.');
  if (!Array.isArray(data.problems)) throw new Error('The set has no list of problems.');
  if (data.problems.length === 0) throw new Error('The set has no problems yet.');
  if (data.problems.length > MAX_PROBLEMS) throw new Error(`A set can have at most ${MAX_PROBLEMS} problems.`);
  return {
    version: 1,
    title: text(data.title, MAX_TITLE) || 'Problem set',
    description: text(data.description, MAX_TEXT),
    settings: normalizeSettings(data.settings),
    problems: data.problems.map((p, i) => {
      try {
        return normalizeProblem(p);
      } catch (err) {
        throw new Error(`Problem ${i + 1} ${err.message}.`);
      }
    }),
  };
}

export function serializeSet(set) {
  return `${JSON.stringify(set, null, 1)}\n`;
}

// Short fingerprint of a set, so saved progress resets when the teacher edits it.
export function fingerprint(set) {
  const s = JSON.stringify(set);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function progressKey(slug, set) {
  return `ccsim.progress.${slug}.${fingerprint(set)}`;
}

export function emptyProgress(set) {
  return {
    current: 0,
    name: '',
    problems: set.problems.map(() => ({ marks: null, checks: 0, firstCorrect: null, checksToCorrect: 0, viewed: false })),
  };
}

// Saved progress may come from an older visit; keep only what still fits.
export function restoreProgress(saved, set) {
  const fresh = emptyProgress(set);
  if (!saved || !Array.isArray(saved.problems) || saved.problems.length !== set.problems.length) return fresh;
  return {
    current: Math.min(Math.max(0, Number(saved.current) || 0), set.problems.length),
    name: text(saved.name, 80),
    problems: saved.problems.map((p, i) => ({ ...fresh.problems[i], ...p })),
  };
}

// Marks refer to parts by id, and ids are made fresh each time a circuit is
// loaded, so store parts by their position in the circuit instead.
export function packMarks(pred, circuit) {
  const index = new Map(circuit.parts.map((p, i) => [p.id, i]));
  return {
    colors: [...pred.colors],
    arrows: pred.arrows.map((a) => (a.site.kind === 'part'
      ? { ...a, site: { kind: 'part', part: index.get(a.site.id) } }
      : { ...a, site: { ...a.site } })),
    rays: [...pred.rays].map(([id, n]) => [index.get(id), n]),
  };
}

// Returns null if the saved marks are damaged (they are then simply dropped).
export function unpackMarks(packed, circuit, graph) {
  try {
    return unpackMarksUnsafe(packed, circuit, graph);
  } catch {
    return null;
  }
}

// `graph` (optional) is the circuit's built graph, used to drop marks on wires
// that do not exist.
function unpackMarksUnsafe(packed, circuit, graph) {
  const idAt = (i) => (Number.isInteger(i) ? circuit.parts[i]?.id : undefined);
  const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
  const branches = graph ? graph.branches.length : Infinity;
  const arrowOk = (a) => a && a.site && isInt(a.n, 1, 99) && (a.dir === 1 || a.dir === -1)
    && (a.site.kind === 'part'
      ? idAt(a.site.part) !== undefined
      : a.site.kind === 'branch' && isInt(a.site.b, 0, branches - 1) && Number.isFinite(a.t)
        && (!graph || graph.branches[a.site.b].segs.some((x) => x.seg === a.seg)));
  return {
    colors: new Map(packed.colors.filter(([b, level]) => isInt(b, 0, branches - 1) && isInt(level, 0, 8))),
    arrows: packed.arrows.filter(arrowOk).map((a) => (a.site.kind === 'part'
      ? { n: a.n, dir: a.dir, site: { kind: 'part', id: idAt(a.site.part) } }
      : { n: a.n, dir: a.dir, seg: a.seg, t: a.t, site: { kind: 'branch', b: a.site.b } })),
    rays: new Map(packed.rays.filter(([i, n]) => idAt(i) !== undefined && isInt(n, 0, 10)).map(([i, n]) => [idAt(i), n])),
  };
}

export function problemStatus(problem, state) {
  if (problem.type === 'explore') return state.viewed ? 'Viewed' : 'Not viewed yet';
  if (state.checksToCorrect === 1) return 'Correct on the first check';
  if (state.checksToCorrect > 1) return `Correct after ${state.checksToCorrect} checks`;
  if (state.checks > 0) return `Not correct yet (${state.checks} ${state.checks === 1 ? 'check' : 'checks'})`;
  return 'Not checked';
}
