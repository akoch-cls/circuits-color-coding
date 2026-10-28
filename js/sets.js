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
  const slug = String(title || '').toLowerCase().normalize('NFKD')
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

export function newSet() {
  return { version: 1, title: '', description: '', settings: { ratio: 2, arrowPlacement: 'junctions' }, problems: [] };
}

const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

// Check a set file and fill in defaults. Throws an Error with a readable message.
export function validateSet(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('This is not a problem set file.');
  if (!Array.isArray(data.problems)) throw new Error('The set has no list of problems.');
  if (data.problems.length === 0) throw new Error('The set has no problems yet.');
  if (data.problems.length > MAX_PROBLEMS) throw new Error(`A set can have at most ${MAX_PROBLEMS} problems.`);
  const settings = data.settings || {};
  const ratio = Number(settings.ratio);
  const placement = settings.arrowPlacement;
  return {
    version: 1,
    title: text(data.title, MAX_TITLE) || 'Problem set',
    description: text(data.description, MAX_TEXT),
    settings: {
      ratio: RATIOS.includes(ratio) ? ratio : 2,
      arrowPlacement: typeof placement === 'string' && Object.hasOwn(PLACEMENTS, placement) ? placement : 'junctions',
    },
    problems: data.problems.map((p, i) => {
      if (!p || typeof p !== 'object') throw new Error(`Problem ${i + 1} is empty.`);
      let circuit;
      try {
        circuit = serialize(deserialize(p.circuit));
      } catch (err) {
        throw new Error(`Problem ${i + 1} has a broken circuit (${err.message}).`);
      }
      const r = p.require || {};
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

export function unpackMarks(packed, circuit) {
  const idAt = (i) => circuit.parts[i]?.id;
  return {
    colors: new Map(packed.colors || []),
    arrows: (packed.arrows || [])
      .map((a) => (a.site.kind === 'part' ? { ...a, site: { kind: 'part', id: idAt(a.site.part) } } : { ...a, site: { ...a.site } }))
      .filter((a) => a.site.kind !== 'part' || a.site.id),
    rays: new Map((packed.rays || []).filter(([i]) => idAt(i)).map(([i, n]) => [idAt(i), n])),
  };
}

export function problemStatus(problem, state) {
  if (problem.type === 'explore') return state.viewed ? 'Viewed' : 'Not viewed yet';
  if (state.checksToCorrect === 1) return 'Correct on the first check';
  if (state.checksToCorrect > 1) return `Correct after ${state.checksToCorrect} checks`;
  if (state.checks > 0) return `Not correct yet (${state.checks} ${state.checks === 1 ? 'check' : 'checks'})`;
  return 'Not checked';
}
