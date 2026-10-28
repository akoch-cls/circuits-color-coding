// Student slideshow: one problem at a time, then a summary.

import { deserialize } from './model.js';
import {
  SLUG_RE, validateSet, progressKey, emptyProgress, restoreProgress, packMarks, unpackMarks, problemStatus,
} from './sets.js';

const $ = (sel) => document.querySelector(sel);

export async function fetchSet(slug) {
  if (!SLUG_RE.test(slug)) throw new Error('That problem set link is not valid.');
  let res;
  try {
    res = await fetch(`sets/${slug}.json`, { cache: 'no-cache' });
  } catch {
    throw new Error('Could not reach the site to load the problem set.');
  }
  if (!res.ok) throw new Error(`Could not find the problem set “${slug}”.`);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`The problem set “${slug}” is not a valid set file.`);
  }
  return validateSet(data);
}

export function showSetError(message) {
  document.body.classList.add('in-set');
  $('#slideBar').hidden = false;
  $('#setTitle').textContent = 'Problem set';
  $('#slideCount').textContent = '';
  $('#slideInstructions').textContent = message;
  $('#slideNav').hidden = true;
  document.querySelector('.layout').hidden = true;
}

// slug: progress is remembered in this browser under the set's name.
// onExit: given for a teacher preview; shows an "Exit preview" button.
export function startPlayer(app, set, { slug = null, onExit = null } = {}) {
  const N = set.problems.length;
  const key = slug ? progressKey(slug, set) : null;
  const progress = key ? restoreProgress(app.store.get(key, null), set) : emptyProgress(set);
  const save = () => { if (key) app.store.set(key, progress); };
  let current = -1;

  app.locked = true;
  app.linkSettings = true;
  Object.assign(app.settings, set.settings);
  document.body.classList.add('in-set');
  $('#slideBar').hidden = false;
  $('#slideNav').hidden = false;
  $('#exitPreview').hidden = !onExit;
  $('#setTitle').textContent = set.title;

  function storeMarks() {
    if (current < 0 || current >= N || set.problems[current].type !== 'predict') return;
    progress.problems[current].marks = packMarks(app.pred, app.circuit);
    save();
  }

  app.onMarkupChange = storeMarks;
  app.onCheck = (result) => {
    if (current < 0 || current >= N) return;
    const st = progress.problems[current];
    st.checks += 1;
    if (st.checks === 1) st.firstCorrect = result.allGood;
    if (result.allGood && !st.checksToCorrect) st.checksToCorrect = st.checks;
    app.problem.checked = true;
    app.applySettingsUI();
    storeMarks();
    renderDots();
  };

  function renderDots() {
    const box = $('#slideDots');
    box.innerHTML = '';
    for (let i = 0; i <= N; i++) {
      const b = document.createElement('button');
      b.className = 'dot';
      if (i === N) {
        b.classList.add('dot-summary');
        b.textContent = '✓';
        b.title = 'Summary';
        b.setAttribute('aria-label', 'Summary');
      } else {
        const st = progress.problems[i];
        const done = set.problems[i].type === 'explore' ? st.viewed : st.checksToCorrect > 0;
        if (done) b.classList.add('done');
        else if (st.checks > 0) b.classList.add('tried');
        b.textContent = String(i + 1);
        b.setAttribute('aria-label', `Problem ${i + 1}`);
      }
      if (i === current) b.setAttribute('aria-current', 'step');
      b.addEventListener('click', () => show(i));
      box.appendChild(b);
    }
  }

  function show(i) {
    storeMarks();
    current = Math.max(0, Math.min(N, i));
    progress.current = current;
    $('#prevSlide').disabled = current === 0;
    $('#nextSlide').hidden = current === N;
    $('#nextSlide').textContent = current === N - 1 ? 'Finish →' : 'Next →';

    if (current === N) {
      app.problem = null;
      $('#slideCount').textContent = 'Summary';
      $('#slideInstructions').textContent = '';
      $('#slideInstructions').hidden = true;
      document.querySelector('.layout').hidden = true;
      renderSummary();
    } else {
      const prob = set.problems[current];
      const st = progress.problems[current];
      $('#summary').hidden = true;
      document.querySelector('.layout').hidden = false;
      $('#slideCount').textContent = `Problem ${current + 1} of ${N}`;
      $('#slideInstructions').textContent = prob.instructions;
      $('#slideInstructions').hidden = !prob.instructions;
      app.problem = { ...prob, checked: st.checks > 0 };
      app.loadCircuit(deserialize(prob.circuit), null);
      if (prob.type === 'predict' && st.marks) Object.assign(app.pred, unpackMarks(st.marks, app.circuit));
      st.viewed = true;
      app.setMode(prob.type === 'explore' ? 'explore' : 'predict');
      app.applySettingsUI();
      app.redraw();
    }
    save();
    renderDots();
  }

  function renderSummary() {
    $('#summary').hidden = false;
    $('#sumTitle').textContent = set.title;
    $('#sumDate').textContent = new Date().toLocaleString();
    $('#sumName').value = progress.name;
    const predict = set.problems.map((p, i) => [p, progress.problems[i]]).filter(([p]) => p.type === 'predict');
    const correct = predict.filter(([, st]) => st.checksToCorrect > 0).length;
    const firstTry = predict.filter(([, st]) => st.checksToCorrect === 1).length;
    $('#sumScore').textContent = predict.length
      ? `Correct: ${correct} of ${predict.length} problems (${firstTry} on the first check)`
      : '';
    const list = $('#sumList');
    list.innerHTML = '';
    set.problems.forEach((p, i) => {
      const st = progress.problems[i];
      const li = document.createElement('li');
      const ok = p.type === 'explore' ? st.viewed : st.checksToCorrect > 0;
      li.className = ok ? 'good' : (st.checks > 0 ? 'bad' : 'todo');
      const label = document.createElement('span');
      label.className = 'sum-label';
      label.textContent = `${i + 1}. ${p.instructions || p.circuit.n || 'Problem'}`;
      const status = document.createElement('span');
      status.className = 'sum-status';
      status.textContent = problemStatus(p, st);
      li.append(label, status);
      list.appendChild(li);
    });
  }

  $('#prevSlide').onclick = () => show(current - 1);
  $('#nextSlide').onclick = () => show(current + 1);
  $('#sumBack').onclick = () => show(0);
  $('#sumName').oninput = (ev) => { progress.name = ev.target.value.slice(0, 80); save(); };
  $('#exitPreview').onclick = () => {
    storeMarks();
    app.problem = null;
    app.onCheck = null;
    app.onMarkupChange = null;
    document.body.classList.remove('in-set');
    $('#slideBar').hidden = true;
    $('#summary').hidden = true;
    document.querySelector('.layout').hidden = false;
    app.restoreTeacherSettings();
    onExit();
  };

  show(progress.current);
}
