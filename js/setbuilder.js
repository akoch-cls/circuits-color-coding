// Teacher "Sets" tab: put circuits in order, set what each problem asks for,
// preview it as a student, and download the set file to upload to the repo.

import { deserialize, serialize } from './model.js';
import { PLACEMENTS } from './arrows.js';
import { buildGraph } from './solver.js';
import {
  newSet, newProblem, validateSet, serializeSet, slugify, normalizeDraft, normalizeSettings,
} from './sets.js';
import { startPlayer, fetchSet } from './player.js';

const $ = (sel) => document.querySelector(sel);
const DRAFT_KEY = 'ccsim.setDraft';

export function createSetBuilder(app) {
  const currentSettings = () => normalizeSettings(app.settings);
  // a draft saved in this browser may be old or damaged; keep what still works
  let draft = normalizeDraft(app.store.get(DRAFT_KEY, null), currentSettings());
  let selected = draft.problems.length ? 0 : -1;

  const save = () => app.store.set(DRAFT_KEY, draft);
  const problem = () => draft.problems[selected];

  // Each set keeps its own grading settings (a new set starts from the teacher's).
  function finishedSet() {
    return validateSet(draft);
  }

  // Returns false if the teacher chose to keep the current draft.
  function okToReplace() {
    return !draft.problems.length
      || confirm('Replace the set you are working on? Download it first if you want to keep it.');
  }

  function studentLink(slug) {
    return `${location.origin}${location.pathname}?set=${slug}`;
  }

  function renderList() {
    const list = $('#problemList');
    list.innerHTML = '';
    draft.problems.forEach((p, i) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.className = 'problem-item';
      if (i === selected) b.setAttribute('aria-current', 'true');
      const kind = document.createElement('span');
      kind.className = `kind kind-${p.type}`;
      kind.textContent = p.type === 'explore' ? 'Explore' : 'Predict';
      const name = document.createElement('span');
      name.textContent = `${i + 1}. ${p.instructions || p.circuit.n || 'Circuit'}`;
      b.append(name, kind);
      b.addEventListener('click', () => select(i));
      li.appendChild(b);
      list.appendChild(li);
    });
    $('#problemListEmpty').hidden = draft.problems.length > 0;
  }

  function renderEditor() {
    const p = problem();
    $('#problemEditor').hidden = !p;
    if (!p) return;
    $('#probNum').textContent = String(selected + 1);
    $('#probType').value = p.type;
    $('#probInstr').value = p.instructions;
    $('#reqColors').checked = p.require.colors;
    $('#reqArrows').checked = p.require.arrows;
    $('#reqRays').checked = p.require.rays;
    $('#probSettle').checked = p.allowSettle;
    $('#probAnswer').checked = p.allowAnswer;
    $('#predictOptions').disabled = p.type === 'explore';
    let noFlow = false;
    try {
      noFlow = Boolean(buildGraph(deserialize(p.circuit), draft.settings.ratio).error);
    } catch {
      noFlow = true;
    }
    $('#probWarning').hidden = !noFlow;
    $('#probUp').disabled = selected === 0;
    $('#probDown').disabled = selected === draft.problems.length - 1;
  }

  function render() {
    $('#setTitleInput').value = draft.title;
    $('#setDescInput').value = draft.description;
    const st = draft.settings;
    const cur = currentSettings();
    $('#setSettingsNote').textContent = `This set grades with: long bulb ${st.ratio}× the round bulb, arrows at “${PLACEMENTS[st.arrowPlacement].toLowerCase()}”.`;
    $('#useMySettings').hidden = st.ratio === cur.ratio && st.arrowPlacement === cur.arrowPlacement;
    renderList();
    renderEditor();
  }

  function select(i) {
    selected = i;
    const p = problem();
    if (p) app.loadCircuit(deserialize(p.circuit), null);
    renderList();
    renderEditor();
  }

  function replaceDraft(set) {
    draft = normalizeDraft(set, currentSettings());
    selected = draft.problems.length ? 0 : -1;
    save();
    $('#publishSteps').hidden = true;
    render();
    if (selected >= 0) select(0);
  }

  function edit(fn) {
    fn(problem());
    save();
    renderList();
    renderEditor();
  }

  // --- set details ---
  $('#setTitleInput').addEventListener('input', (ev) => { draft.title = ev.target.value; save(); });
  $('#setDescInput').addEventListener('input', (ev) => { draft.description = ev.target.value; save(); });

  // --- problem list ---
  $('#addProblemBtn').addEventListener('click', () => {
    if (!app.circuit.parts.length) {
      app.toast('Choose a circuit or build one first, then add it here.');
      return;
    }
    draft.problems.push(newProblem(app.circuit));
    selected = draft.problems.length - 1;
    save();
    renderList();
    renderEditor();
  });
  const move = (d) => {
    const j = selected + d;
    if (j < 0 || j >= draft.problems.length) return;
    const [p] = draft.problems.splice(selected, 1);
    draft.problems.splice(j, 0, p);
    selected = j;
    save();
    renderList();
    renderEditor();
  };
  $('#probUp').addEventListener('click', () => move(-1));
  $('#probDown').addEventListener('click', () => move(1));
  $('#probRemove').addEventListener('click', () => {
    if (!confirm(`Remove problem ${selected + 1} from the set?`)) return;
    draft.problems.splice(selected, 1);
    selected = Math.min(selected, draft.problems.length - 1);
    save();
    renderList();
    renderEditor();
  });
  $('#probReplace').addEventListener('click', () => {
    if (!app.circuit.parts.length) return;
    edit((p) => { p.circuit = serialize(app.circuit); });
    app.toast(`Problem ${selected + 1} now uses the circuit on screen.`);
  });

  // --- problem options ---
  $('#probType').addEventListener('change', (ev) => edit((p) => { p.type = ev.target.value; }));
  $('#probInstr').addEventListener('input', (ev) => {
    problem().instructions = ev.target.value;
    save();
    renderList();
  });
  [['#reqColors', 'colors'], ['#reqArrows', 'arrows'], ['#reqRays', 'rays']].forEach(([sel, mark]) => {
    $(sel).addEventListener('change', (ev) => {
      const next = { ...problem().require, [mark]: ev.target.checked };
      if (!next.colors && !next.arrows && !next.rays) {
        ev.target.checked = true;
        app.toast('A Predict problem needs at least one kind of mark.');
        return;
      }
      edit((p) => { p.require = next; });
    });
  });
  $('#probSettle').addEventListener('change', (ev) => edit((p) => { p.allowSettle = ev.target.checked; }));
  $('#probAnswer').addEventListener('change', (ev) => edit((p) => { p.allowAnswer = ev.target.checked; }));

  // --- preview, download, open ---
  const withSet = (fn) => {
    let set;
    try {
      set = finishedSet();
    } catch (err) {
      app.toast(err.message);
      return;
    }
    fn(set);
  };
  $('#previewSetBtn').addEventListener('click', () => withSet((set) => {
    const back = selected;
    startPlayer(app, set, {
      onExit: () => {
        app.setMode('sets');
        if (back >= 0) select(back);
      },
    });
  }));
  $('#downloadSetBtn').addEventListener('click', () => withSet((set) => {
    const slug = slugify(set.title);
    app.download(`${slug}.json`, serializeSet(set));
    $('#publishFile').textContent = `${slug}.json`;
    $('#publishLink').value = studentLink(slug);
    $('#publishSteps').hidden = false;
  }));
  $('#copySetLink').addEventListener('click', () => app.copyText($('#publishLink').value, 'Student link copied.'));
  $('#useMySettings').addEventListener('click', () => {
    draft.settings = currentSettings();
    save();
    render();
  });
  $('#openSetBtn').addEventListener('click', () => { if (okToReplace()) $('#openSetFile').click(); });
  $('#openSetFile').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      replaceDraft(validateSet(JSON.parse(await file.text())));
    } catch (err) {
      app.toast(err instanceof SyntaxError ? 'That file is not a problem set.' : err.message);
    }
  });
  $('#openSiteBtn').addEventListener('click', async () => {
    const name = $('#openSlug').value.trim().replace(/\.json$/i, '');
    if (!name) {
      app.toast('Type the name of a set on the site (its file name without .json).');
      return;
    }
    if (!okToReplace()) return;
    const slug = slugify(name);
    try {
      replaceDraft(await fetchSet(slug));
      app.toast(`Opened “${draft.title}” for editing.`);
    } catch (err) {
      app.toast(err.message);
    }
  });
  $('#newSetBtn').addEventListener('click', () => {
    if (!okToReplace()) return;
    replaceDraft(newSet(currentSettings()));
  });

  return {
    // called when the Sets tab opens; leaves the circuit on screen alone so a
    // circuit just built in Build can be added
    show() {
      render();
    },
  };
}
