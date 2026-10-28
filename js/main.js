import { deserialize, serialize, encodeShare, decodeShare, emptyCircuit, clone, key } from './model.js';
import {
  buildGraph, steadyState, steadySummary, initialState, stateFromNets, step, maxDifference, analyze, raysFor, MAX_TAILS,
} from './solver.js';
import { LEVELS, levelOf, levelPaint, paintFor, isOffGrid } from './colors.js';
import { draw, viewBoxFor } from './render.js';
import { PRESET_GROUPS } from './presets.js';
import { createEditor } from './editor.js';
import { createMarkup } from './markup.js';
import { checkPrediction } from './check.js';
import {
  PLACEMENTS, liveSites, siteFlow, studentPose, circuitCenter, directionChoices, S,
} from './arrows.js';
import { createSetBuilder } from './setbuilder.js';
import { startPlayer, fetchSet, showSetError } from './player.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const STUDENT = '#7c3aed';
const SETTLED = 1.5e-3;
const BASE_DT = 0.03;

const store = {
  get(k, fallback) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ }
  },
};

const DEFAULT_SETTINGS = { ratio: 2, snap: true, approx: false, allowAnswer: true, arrowPlacement: 'junctions' };

const app = {
  store,
  problem: null, // the current problem when working through a problem set
  circuit: emptyCircuit(),
  graph: null,
  target: null, // steady-state pressures
  ss: null, // steady-state summary (answer key)
  V: null, // live pressures
  running: false,
  speed: 1,
  mode: 'explore',
  locked: false, // opened from a student link that hides answers/settings
  settings: { ...DEFAULT_SETTINGS, ...store.get('ccsim.settings', {}) },
  layers: { colors: true, arrows: true, rays: true, badges: true },
  pred: { colors: new Map(), arrows: [], rays: new Map(), tool: 'paint', swatch: 8, check: null, view: 'mine' },
  build: { tool: 'wire', hover: null, preview: null, selected: null, undo: [] },
  settleSource: null, // 'prediction' when settling from the student's colors
  selection: null, // value of the circuit <select>
};

const svg = $('#stage');

// ---------------------------------------------------------------- physics state

app.rebuild = function rebuild({ animate = false, keepPrediction = false } = {}) {
  app.settleSource = null;
  const old = app.graph;
  const oldV = app.V;
  app.graph = buildGraph(app.circuit, app.settings.ratio);
  const g = app.graph;
  app.target = steadyState(g);
  app.ss = app.target ? steadySummary(g, app.target) : null;
  if (!keepPrediction) resetPrediction();

  if (!app.target) {
    app.V = null;
    app.running = false;
  } else if (animate && old && oldV) {
    // carry pressures over by grid position, so edits ripple through the circuit
    const byKey = new Map();
    old.nodes.forEach((n, i) => { if (!Number.isNaN(oldV[i])) byKey.set(key(n.x, n.y), oldV[i]); });
    const netVal = g.nets.map((nodes) => {
      const vals = nodes.map((i) => byKey.get(key(g.nodes[i].x, g.nodes[i].y))).filter((v) => v !== undefined);
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0.5;
    });
    app.V = stateFromNets(g, (net) => netVal[net]);
    app.running = maxDifference(g, app.V, app.target) > SETTLED;
  } else {
    app.V = app.target;
    app.running = false;
  }
  app.redraw();
};

app.startFrom = function startFrom(kind) {
  if (!app.target) return;
  if (kind === 'steady') {
    app.V = app.target;
    app.running = false;
  } else {
    app.V = initialState(app.graph, kind);
    app.running = true;
  }
  app.settleSource = null;
  updatePlayButton();
  app.redraw();
};

function frame() {
  if (app.running && app.V && app.target) {
    app.V = step(app.graph, app.V, BASE_DT * app.speed);
    if (maxDifference(app.graph, app.V, app.target) < SETTLED) {
      app.V = app.target;
      app.running = false;
      onSettled();
    }
    app.redraw();
  }
  requestAnimationFrame(frame);
}

function onSettled() {
  updatePlayButton();
  if (app.mode === 'predict' && app.settleSource === 'prediction') {
    runCheck();
    app.settleSource = null;
  }
}

// ---------------------------------------------------------------- drawing

function isChanging(V) {
  return Boolean(V && app.target) && maxDifference(app.graph, V, app.target) >= SETTLED;
}

function segPressure(V, s) {
  return (V[s.na] + V[s.nb]) / 2;
}

// While the circuit is changing, flows are usually between whole numbers of
// tails, so arrows get a partial last tail and "more in than out" stays visible.
// At steady state every arrow has whole tails.
function liveArrows(V) {
  const g = app.graph;
  const an = analyze(g, V);
  const changing = isChanging(V);
  const flows = liveSites(g, app.circuit, app.settings.arrowPlacement).map(({ site, pose }) => {
    const I = siteFlow(g, an, site);
    return { pose, I, r: Math.abs(I) / app.ss.unit };
  });
  // early on flows can be far bigger than at steady state: shrink every arrow
  // by the same amount so they still compare fairly
  const biggest = Math.max(0, ...flows.map((x) => x.r));
  const scale = biggest > MAX_TAILS ? MAX_TAILS / biggest : 1;
  const arrows = [];
  for (const { pose, I, r } of flows) {
    const n = r * scale;
    if (Math.abs(I) <= app.ss.zero || n < (changing ? 0.12 : 0.3)) continue;
    arrows.push({ pose, n: changing ? n : Math.min(MAX_TAILS, Math.max(1, Math.round(n))), dir: I >= 0 ? 1 : -1 });
  }
  return arrows;
}

function liveRays(V) {
  const rays = raysFor(analyze(app.graph, V).bulbs);
  return new Map([...rays].map(([id, n]) => [id, { n }]));
}

function badges(V) {
  const g = app.graph;
  if (!isChanging(V)) return [];
  const { netFlow } = analyze(g, V);
  const maxI = Math.max(1e-9, ...app.ss.branchI.map(Math.abs));
  const plus = g.netOf[g.battery.a];
  const minus = g.netOf[g.battery.b];
  const out = [];
  g.nets.forEach((nodes, net) => {
    if (net === plus || net === minus || g.floating[nodes[0]]) return;
    const flow = netFlow[net];
    const strength = Math.abs(flow) / maxI;
    if (strength < 0.04) return;
    let node = nodes[0];
    nodes.forEach((i) => { if (g.adj[i].length > g.adj[node].length) node = i; });
    out.push({ node, sign: Math.sign(flow), strength });
  });
  return out;
}

function predictionPaints() {
  const g = app.graph;
  const nodeLevel = new Map();
  app.pred.colors.forEach((level, b) => {
    for (const n of g.branches[b].nodes) if (!nodeLevel.has(n)) nodeLevel.set(n, level);
  });
  return {
    segPaint: (i) => {
      const level = app.pred.colors.get(g.segBranch[i]);
      return level === undefined ? null : levelPaint(level);
    },
    nodePaint: (n) => (nodeLevel.has(n) ? levelPaint(nodeLevel.get(n)) : null),
  };
}

app.redraw = function redraw() {
  const g = app.graph;
  if (!g) return;
  const building = app.mode === 'build';
  const ctx = {
    circuit: app.circuit,
    graph: g,
    viewBox: viewBoxFor(app.circuit, building),
    grid: building,
  };
  const L = app.layers;
  const view = app.mode === 'predict' ? app.pred.view : 'sim';
  const V = view === 'answer' ? app.target : app.V;

  if (view === 'mine') {
    Object.assign(ctx, predictionPaints());
    const center = circuitCenter(app.circuit);
    ctx.arrows = app.pred.arrows.map((a, i) => ({
      pose: studentPose(g, app.circuit, a, center), n: a.n, dir: a.dir, color: STUDENT,
      bad: app.pred.check?.badArrows.has(i), hit: i,
    })).filter((a) => a.pose);
    ctx.rays = new Map([...app.pred.rays].map(([id, n]) => [id, { n, color: STUDENT }]));
    ctx.ghost = picker?.pose;
    if (app.pred.check) {
      ctx.marks = { branches: app.pred.check.badBranches, bulbs: app.pred.check.badBulbs, nodes: app.pred.check.badNodes };
    }
  } else if (V) {
    const snap = app.settings.snap;
    if (L.colors) {
      ctx.segPaint = (i) => paintFor(segPressure(V, g.segs[i]), snap);
      ctx.nodePaint = (n) => paintFor(V[n], snap);
    }
    if (L.arrows) ctx.arrows = liveArrows(V);
    if (L.rays) ctx.rays = liveRays(V);
    if (L.badges) ctx.badges = badges(V);
    if (app.settings.approx && !app.locked && !isChanging(V) && app.ss) {
      ctx.approx = new Set(app.ss.branchP.map((p, b) => (!Number.isNaN(p) && isOffGrid(p) ? b : -1)).filter((b) => b >= 0));
    }
  }

  if (building) {
    ctx.hover = app.build.hover;
    ctx.preview = app.build.preview;
    ctx.selected = app.build.selected;
  }
  draw(svg, ctx);
  updateStatus();
};

const ERRORS = {
  'no-battery': 'Add a battery to make charge flow.',
  'multi-battery': 'This simulator works with one battery at a time.',
  short: 'Short circuit! A wire alone joins the + and − ends of the battery.',
};

function updateStatus() {
  updatePlayButton();
  const g = app.graph;
  const banner = $('#banner');
  const status = $('#status');
  const explain = $('#explain');
  const empty = app.circuit.parts.length === 0 && app.circuit.wires.length === 0;
  banner.hidden = !g.error || empty;
  banner.textContent = g.error ? ERRORS[g.error] : '';
  status.className = 'status';

  if (app.mode === 'predict' && app.pred.view === 'mine') {
    status.textContent = 'Your prediction';
    explain.textContent = 'Purple marks are yours. Use the tools to mark up the circuit.';
    return;
  }
  if (!app.target) {
    status.textContent = empty ? 'Empty circuit' : 'No steady flow';
    explain.textContent = empty ? 'Pick Build and start drawing.' : '';
    return;
  }
  if (app.mode === 'predict' && app.pred.view === 'answer') {
    status.textContent = 'Answer: steady state';
    status.classList.add('steady');
    explain.textContent = '';
    return;
  }
  if (isChanging(app.V)) {
    status.textContent = app.running ? 'Changing…' : 'Paused (not settled yet)';
    status.classList.add('changing');
    const b = app.layers.badges ? badges(app.V) : [];
    const parts = [];
    if (b.some((x) => x.sign > 0)) parts.push('Wires marked + get more flow in than out, so charge piles up and their pressure rises.');
    if (b.some((x) => x.sign < 0)) parts.push('Wires marked − lose more flow than they get, so their pressure drops.');
    explain.textContent = parts.join(' ') || 'Pressures are evening out.';
  } else {
    status.textContent = 'Steady state';
    status.classList.add('steady');
    explain.textContent = 'Every wire now gets exactly as much flow in as goes out, so nothing changes anymore.';
  }
}

// ---------------------------------------------------------------- prediction

function resetPrediction() {
  app.pred.colors = new Map();
  app.pred.arrows = [];
  app.pred.rays = new Map();
  app.pred.check = null;
  app.pred.settled = false;
  app.pred.view = 'mine';
  renderFeedback();
  syncViewButtons();
}

app.setView = function setView(view) {
  closePicker();
  app.pred.view = view;
  syncViewButtons();
  app.redraw();
};

function syncViewButtons() {
  $$('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === app.pred.view)));
  // playback and layers only apply when the simulation is on screen
  const marking = app.mode === 'predict' && app.pred.view === 'mine';
  $('#layers').hidden = marking;
  $('#playback').hidden = marking || (app.mode === 'predict' && app.pred.view === 'answer');
}

// byStudent: the student pressed Check (automatic re-checks are not counted).
function runCheck({ byStudent = false } = {}) {
  if (!app.ss) {
    app.pred.check = null;
    renderFeedback([{ kind: 'info', text: 'This circuit has no steady flow to check against.' }]);
    return;
  }
  app.pred.check = checkPrediction(app.graph, app.ss, app.pred, {
    circuit: app.circuit,
    placement: app.settings.arrowPlacement,
    require: app.problem?.require,
  });
  renderFeedback();
  app.redraw();
  if (byStudent && app.onCheck) app.onCheck(app.pred.check);
}

function renderFeedback(extra) {
  const list = $('#feedback');
  if (!list) return;
  const items = extra || (app.pred.check ? app.pred.check.messages : []);
  list.innerHTML = '';
  if (app.pred.check?.allGood) items.unshift({ kind: 'good', text: 'Everything matches the steady state. Nice work!' });
  for (const m of items) {
    const li = document.createElement('li');
    li.className = m.kind;
    li.textContent = m.text;
    list.appendChild(li);
  }
}
app.renderFeedback = () => renderFeedback();
app.runCheck = runCheck;

function settleFromPrediction() {
  if (!app.target) return;
  const g = app.graph;
  const sums = new Map();
  app.pred.colors.forEach((level, b) => {
    const net = g.netOf[g.branches[b].start];
    const s = sums.get(net) || [0, 0];
    sums.set(net, [s[0] + level / 8, s[1] + 1]);
  });
  app.V = stateFromNets(g, (net) => (sums.has(net) ? sums.get(net)[0] / sums.get(net)[1] : 0.5));
  app.running = true;
  app.pred.settled = true;
  app.settleSource = 'prediction';
  updatePlayButton();
  app.setView('sim');
}

// ---------------------------------------------------------------- arrow direction picker

let picker = null; // { pose } while the popup is open

const ARROW_SVG = '<svg viewBox="-16 -12 32 24" aria-hidden="true"><line x1="-12" y1="0" x2="10" y2="0" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><polyline points="3,-8 12,0 3,8" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Pop up the two directions an arrow can point at a bulb or a spot on a wire.
// opts: { site, seg, t, current (dir or 0), onPick(dir), onRemove (or null) }
app.pickDirection = function pickDirection(opts) {
  closePicker();
  const pose = studentPose(app.graph, app.circuit, { site: opts.site, seg: opts.seg, t: opts.t }, circuitCenter(app.circuit));
  if (!pose) return;
  picker = { pose };
  const box = $('#arrowPicker');
  box.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'picker-title';
  title.textContent = opts.current ? 'Change direction' : 'Which way does it flow?';
  const close = document.createElement('button');
  close.className = 'picker-close';
  close.setAttribute('aria-label', 'Close');
  close.textContent = '×';
  close.addEventListener('click', closePicker);
  title.appendChild(close);
  box.appendChild(title);
  const row = document.createElement('div');
  row.className = 'picker-row';
  for (const c of directionChoices(pose.ux, pose.uy)) {
    const b = document.createElement('button');
    b.className = 'picker-dir';
    b.setAttribute('aria-label', `Arrow pointing ${c.label}`);
    b.title = `Points ${c.label}`;
    if (c.dir === opts.current) b.setAttribute('aria-pressed', 'true');
    b.innerHTML = ARROW_SVG;
    b.firstChild.style.transform = `rotate(${c.angle}deg)`;
    b.addEventListener('click', () => { closePicker(); opts.onPick(c.dir); });
    row.appendChild(b);
  }
  box.appendChild(row);
  if (opts.onRemove) {
    const rm = document.createElement('button');
    rm.className = 'picker-remove';
    rm.textContent = 'Remove arrow';
    rm.addEventListener('click', () => { closePicker(); opts.onRemove(); });
    box.appendChild(rm);
  }
  box.hidden = false;
  // place it beside the spot, kept inside the circuit area
  const wrap = $('.stage-wrap').getBoundingClientRect();
  const pt = svg.createSVGPoint();
  pt.x = pose.x;
  pt.y = pose.y;
  const scr = pt.matrixTransform(svg.getScreenCTM());
  const w = box.offsetWidth;
  const h = box.offsetHeight;
  let left = scr.x - wrap.left + 22;
  let top = scr.y - wrap.top - h / 2;
  if (left + w > wrap.width - 8) left = scr.x - wrap.left - w - 22;
  left = Math.max(8, Math.min(left, wrap.width - w - 8));
  top = Math.max(8, Math.min(top, wrap.height - h - 8));
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
  box.querySelector('.picker-dir').focus({ preventScroll: true });
  app.redraw();
};

function closePicker() {
  if (!picker) return;
  picker = null;
  $('#arrowPicker').hidden = true;
  app.redraw();
}
app.closePicker = closePicker;

// ---------------------------------------------------------------- build helpers

app.pushUndo = function pushUndo() {
  app.build.undo.push(JSON.stringify(serialize(app.circuit)));
  if (app.build.undo.length > 100) app.build.undo.shift();
};

app.edit = function edit(fn) {
  app.pushUndo();
  fn(app.circuit);
  app.rebuild({ animate: true });
};

function undo() {
  const last = app.build.undo.pop();
  if (!last) return;
  const name = app.circuit.name;
  app.circuit = deserialize(JSON.parse(last));
  app.circuit.name = name;
  app.rebuild({ animate: true });
}

let toastTimer;
app.toast = function toast(msg) {
  const banner = $('#banner');
  banner.textContent = msg;
  banner.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => updateStatus(), 2600);
};

// ---------------------------------------------------------------- circuits list

function savedCircuits() {
  return store.get('ccsim.mycircuits', []);
}

function fillCircuitSelect() {
  const sel = $('#circuitSelect');
  sel.innerHTML = '';
  const addGroup = (label, items, prefix) => {
    if (!items.length) return;
    const og = document.createElement('optgroup');
    og.label = label;
    items.forEach((c, i) => {
      const o = document.createElement('option');
      o.value = `${prefix}:${i}`;
      o.textContent = c.n;
      og.appendChild(o);
    });
    sel.appendChild(og);
  };
  PRESET_GROUPS.forEach((grp, gi) => addGroup(grp.label, grp.items, `preset${gi}`));
  addGroup('My circuits', savedCircuits(), 'saved');
  const other = document.createElement('optgroup');
  other.label = 'Other';
  other.innerHTML = '<option value="blank">Blank — build your own</option>';
  if (app.selection === 'link') other.innerHTML += '<option value="link">Shared circuit</option>';
  sel.appendChild(other);
  if (app.selection) sel.value = app.selection;
}

function circuitFor(value) {
  if (value === 'blank') return emptyCircuit('My circuit');
  const [prefix, idx] = value.split(':');
  if (prefix === 'saved') return deserialize(savedCircuits()[Number(idx)]);
  const gi = Number(prefix.replace('preset', ''));
  return deserialize(PRESET_GROUPS[gi].items[Number(idx)]);
}

app.loadCircuit = loadCircuit;
function loadCircuit(circuit, selection) {
  closePicker();
  app.circuit = circuit;
  app.selection = selection;
  app.build.undo = [];
  app.build.selected = null;
  $('#nameInput').value = circuit.name;
  $('#circuitSelect').value = selection || ''; // blank when the circuit isn't from the menu
  $('#deleteSavedBtn').disabled = !String(selection).startsWith('saved:');
  app.rebuild();
}

// ---------------------------------------------------------------- modes & controls

app.setMode = setMode;
function setMode(mode) {
  closePicker();
  app.mode = mode;
  app.settleSource = null;
  $$('.modes [data-mode]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === mode)));
  $$('.mode-panel').forEach((p) => { p.hidden = p.dataset.panel !== mode; });
  document.body.classList.toggle('predicting', mode === 'predict');
  app.build.hover = null;
  app.build.preview = null;
  syncViewButtons();
  if (mode !== 'predict') {
    if (!app.running) app.V = app.target;
  }
  renderSwatches();
  app.redraw();
  if (mode === 'sets' && app.setBuilder) app.setBuilder.show();
}

function updatePlayButton() {
  $('#playBtn').textContent = app.running ? '⏸ Pause' : '▶ Play';
}

function renderSwatches() {
  const box = $('#swatches');
  box.innerHTML = '';
  const label = document.createElement('div');
  label.className = 'swatch-label';
  [...LEVELS].reverse().forEach((l, k) => {
    const level = 8 - k;
    const b = document.createElement('button');
    b.className = 'swatch';
    b.title = l.name;
    b.setAttribute('aria-label', l.name);
    b.style.background = l.solid || `repeating-linear-gradient(45deg, ${l.stripes[0]} 0 6px, ${l.stripes[1]} 6px 12px)`;
    if (app.mode === 'predict' && (!app.problem || app.problem.require.colors)) {
      b.setAttribute('aria-pressed', String(app.pred.swatch === level && app.pred.tool === 'paint'));
      b.addEventListener('click', () => {
        app.pred.swatch = level;
        setPredictTool('paint');
      });
    } else {
      b.tabIndex = -1;
    }
    b.addEventListener('mouseenter', () => { label.textContent = l.name; });
    b.addEventListener('mouseleave', () => { label.textContent = currentSwatchName(); });
    box.appendChild(b);
  });
  label.textContent = currentSwatchName();
  box.appendChild(label);
}

function currentSwatchName() {
  const painting = app.mode === 'predict' && (!app.problem || app.problem.require.colors);
  return painting ? `Painting: ${LEVELS[app.pred.swatch].name}` : 'Red (+ end of battery) down to blue (− end)';
}

function setPredictTool(tool) {
  closePicker();
  app.pred.tool = tool;
  $$('[data-ptool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ptool === tool)));
  renderSwatches();
}

function setBuildTool(tool) {
  app.build.tool = tool;
  app.build.selected = null;
  $$('[data-btool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.btool === tool)));
  app.redraw();
}

const ARROW_HINTS = {
  junctions: 'Arrows: put one beside each lit bulb and on the wires just before and after each junction. Use Add arrow on a bulb or a spot on a wire, then + Tail for more flow.',
  bulbs: 'Arrows: put one beside each lit bulb. Use Add arrow on a bulb, then + Tail for more flow.',
  wires: 'Arrows: put one on every wire that has flow. Use Add arrow on a spot on the wire, then + Tail for more flow.',
  all: 'Arrows: put one beside each lit bulb and on every wire that has flow. Use Add arrow on a bulb or a spot on a wire, then + Tail for more flow.',
};

// In a problem set, show only the tools and buttons this problem allows.
function syncProblemUI() {
  const pr = app.problem;
  const req = pr ? pr.require : { colors: true, arrows: true, rays: true };
  const show = (sel, on) => $$(sel).forEach((el) => { el.hidden = !on; });
  show('[data-ptool="paint"], [data-ptool="erase"]', req.colors);
  show('[data-ptool="arrow"], [data-ptool="flip"], [data-ptool="tail+"], [data-ptool="tail-"]', req.arrows);
  show('[data-ptool="ray+"], [data-ptool="ray-"]', req.rays);
  $('#arrowHint').hidden = !req.arrows;
  // in a set, settling (which shows the steady state) unlocks after a first Check
  const settle = !pr || (pr.allowSettle && pr.checked);
  show('#settleBtn, [data-view="sim"]', settle);
  const answer = pr ? pr.allowAnswer && pr.checked : !app.locked && app.settings.allowAnswer;
  $('#answerBtn').hidden = !answer;
  $('.view-toggle').hidden = !settle && !answer; // nothing to switch to
  if ((app.pred.view === 'sim' && !settle) || (app.pred.view === 'answer' && !answer)) app.setView('mine');
  const tool = $(`[data-ptool="${app.pred.tool}"]`);
  if (tool && tool.hidden) {
    const first = $$('[data-ptool]').find((b) => !b.hidden);
    if (first) setPredictTool(first.dataset.ptool);
  }
  const marks = [req.colors && 'color each wire', req.arrows && 'add arrows with tails', req.rays && 'add rays to the bulbs'].filter(Boolean);
  const list = marks.length > 1 ? `${marks.slice(0, -1).join(', ')} and ${marks.at(-1)}` : marks[0];
  const after = pr && pr.allowSettle && !pr.checked ? ' After your first check you can also let the circuit settle from your colors.' : '';
  $('#predictHint').textContent = `${list[0].toUpperCase()}${list.slice(1)}. Then check your work${settle ? ' or let the circuit settle from your colors' : ''}.${after}`;
  renderSwatches();
}

app.applySettingsUI = applySettingsUI;
function applySettingsUI() {
  syncProblemUI();
  $('#arrowHint').textContent = ARROW_HINTS[app.settings.arrowPlacement];
  $('#arrowPlacement').value = app.settings.arrowPlacement;
  $('#ratioSelect').value = String(app.settings.ratio);
  $('#snapSetting').checked = app.settings.snap;
  $('#approxSetting').checked = app.settings.approx;
  $('#answerSetting').checked = app.settings.allowAnswer;
  $('#settingsBtn').hidden = app.locked;
  const note = app.ss?.approx ? 'Note: the flows in this circuit do not divide into whole numbers of tails, so the arrow tails shown are rounded.' : '';
  $('#approxNote').textContent = note;
}

function saveSettings() {
  // settings that came from a student link apply to this visit only
  if (!app.linkSettings) store.set('ccsim.settings', app.settings);
}

function shareLink() {
  const mode = $('#linkMode').value;
  const hide = $('#linkHideAnswer').checked;
  const c = clone(app.circuit);
  c.name = $('#nameInput').value || c.name;
  const grading = `&r=${app.settings.ratio}&ap=${app.settings.arrowPlacement}`;
  return `${location.origin}${location.pathname}#c=${encodeShare(c)}&m=${mode}${hide ? '&a=0' : ''}${grading}`;
}

app.download = download;
app.copyText = async function copyText(text, done) {
  try {
    await navigator.clipboard.writeText(text);
    app.toast(done);
  } catch {
    prompt('Copy this:', text);
  }
};

function download(filename, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

app.svgPixel = function svgPixel(ev) {
  const pt = svg.createSVGPoint();
  pt.x = ev.clientX;
  pt.y = ev.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  return [p.x, p.y];
};

function svgPoint(ev) {
  const pt = svg.createSVGPoint();
  pt.x = ev.clientX;
  pt.y = ev.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  return [Math.round(p.x / S), Math.round(p.y / S)];
}

function wireEvents() {
  const editor = createEditor(app);
  const markup = createMarkup(app);

  svg.addEventListener('pointerdown', (ev) => {
    const target = ev.target.closest('[data-part], [data-branch]');
    svg.setPointerCapture(ev.pointerId);
    if (app.mode === 'build') editor.down(ev, svgPoint(ev), target);
    else if (app.mode === 'predict') markup.down(ev);
  });
  svg.addEventListener('pointermove', (ev) => {
    if (app.mode === 'build') editor.move(ev, svgPoint(ev));
    else if (app.mode === 'predict') markup.move(ev);
  });
  svg.addEventListener('pointerup', (ev) => {
    if (app.mode === 'build') editor.up(ev, svgPoint(ev));
    else if (app.mode === 'predict') markup.up(ev);
  });
  svg.addEventListener('pointerleave', () => { if (app.mode === 'build') editor.leave(); });

  $$('.modes [data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  $('#circuitSelect').addEventListener('change', (ev) => loadCircuit(circuitFor(ev.target.value), ev.target.value));

  // explore
  $$('[data-start]').forEach((b) => b.addEventListener('click', () => app.startFrom(b.dataset.start)));
  $('#playBtn').addEventListener('click', () => {
    if (!app.target) return;
    if (!app.running && maxDifference(app.graph, app.V, app.target) < SETTLED) {
      app.startFrom('mixed');
      return;
    }
    app.running = !app.running;
    updatePlayButton();
    app.redraw();
  });
  $('#stepBtn').addEventListener('click', () => {
    if (!app.target) return;
    app.running = false;
    for (let i = 0; i < 4; i++) app.V = step(app.graph, app.V, BASE_DT * app.speed);
    if (!isChanging(app.V)) app.V = app.target;
    app.redraw();
  });
  $('#speed').addEventListener('input', (ev) => { app.speed = Number(ev.target.value); });
  const placement = $('#arrowPlacement');
  placement.innerHTML = Object.entries(PLACEMENTS).map(([v, label]) => `<option value="${v}">${label}</option>`).join('');
  placement.value = app.settings.arrowPlacement;
  placement.addEventListener('change', () => {
    app.settings.arrowPlacement = placement.value;
    saveSettings();
    applySettingsUI();
    if (app.pred.check) runCheck();
    app.redraw();
  });
  $$('[data-layer]').forEach((c) => c.addEventListener('change', () => {
    app.layers[c.dataset.layer] = c.checked;
    app.redraw();
  }));

  // predict
  $$('[data-ptool]').forEach((b) => b.addEventListener('click', () => setPredictTool(b.dataset.ptool)));
  $$('[data-view]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.view === 'sim' && !app.pred.settled && !app.running) {
      settleFromPrediction();
      return;
    }
    app.setView(b.dataset.view);
  }));
  $('#checkBtn').addEventListener('click', () => { app.setView('mine'); runCheck({ byStudent: true }); });
  $('#settleBtn').addEventListener('click', settleFromPrediction);
  $('#clearMarksBtn').addEventListener('click', () => {
    resetPrediction();
    app.redraw();
    if (app.onMarkupChange) app.onMarkupChange();
  });

  // build
  $$('[data-btool]').forEach((b) => b.addEventListener('click', () => setBuildTool(b.dataset.btool)));
  $('#undoBtn').addEventListener('click', undo);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closePicker(); });
  document.addEventListener('keydown', (ev) => {
    if (app.mode === 'build' && (ev.ctrlKey || ev.metaKey) && ev.key === 'z' && !ev.target.closest('input, select, textarea')) { ev.preventDefault(); undo(); }
  });
  $('#clearBtn').addEventListener('click', () => {
    if (!confirm('Remove everything from this circuit?')) return;
    app.edit((c) => { c.parts = []; c.wires = []; });
  });
  $('#nameInput').addEventListener('input', (ev) => { app.circuit.name = ev.target.value; });
  $('#saveBtn').addEventListener('click', () => {
    const list = savedCircuits();
    const data = serialize(app.circuit);
    data.n = $('#nameInput').value.trim() || 'My circuit';
    const existing = list.findIndex((c) => c.n === data.n);
    if (existing >= 0) list[existing] = data; else list.push(data);
    store.set('ccsim.mycircuits', list);
    app.selection = `saved:${existing >= 0 ? existing : list.length - 1}`;
    fillCircuitSelect();
    $('#deleteSavedBtn').disabled = false;
    app.toast(`Saved “${data.n}” to My circuits on this computer.`);
  });
  $('#deleteSavedBtn').addEventListener('click', () => {
    if (!String(app.selection).startsWith('saved:')) return;
    const list = savedCircuits();
    list.splice(Number(app.selection.split(':')[1]), 1);
    store.set('ccsim.mycircuits', list);
    app.selection = 'blank';
    fillCircuitSelect();
    $('#deleteSavedBtn').disabled = true;
  });
  $('#exportBtn').addEventListener('click', () => {
    const data = serialize(app.circuit);
    data.n = $('#nameInput').value || data.n;
    download(`${data.n.replace(/[^\w-]+/g, '_') || 'circuit'}.json`, JSON.stringify(data, null, 1));
  });
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      loadCircuit(deserialize(JSON.parse(await file.text())), null);
    } catch (err) {
      app.toast(`That file is not a circuit (${err.message}).`);
    }
  });
  $('#copyLinkBtn').addEventListener('click', () => app.copyText(shareLink(), 'Student link copied. Paste it into your class page or assignment.'));

  // settings
  $('#settingsBtn').addEventListener('click', () => { applySettingsUI(); $('#settings').showModal(); });
  $('#ratioSelect').addEventListener('change', (ev) => {
    app.settings.ratio = Number(ev.target.value);
    saveSettings();
    app.rebuild({ animate: true, keepPrediction: true });
    if (app.pred.check) runCheck();
    applySettingsUI();
  });
  $('#snapSetting').addEventListener('change', (ev) => { app.settings.snap = ev.target.checked; saveSettings(); app.redraw(); });
  $('#approxSetting').addEventListener('change', (ev) => { app.settings.approx = ev.target.checked; saveSettings(); app.redraw(); });
  $('#answerSetting').addEventListener('change', (ev) => {
    app.settings.allowAnswer = ev.target.checked;
    saveSettings();
    applySettingsUI();
  });
}

async function init() {
  wireEvents();
  const setSlug = new URLSearchParams(location.search).get('set');
  if (setSlug !== null) {
    setPredictTool('paint');
    requestAnimationFrame(frame);
    try {
      startPlayer(app, await fetchSet(setSlug), { slug: setSlug });
    } catch (err) {
      showSetError(err.message);
    }
    return;
  }
  const params = new URLSearchParams(location.hash.slice(1));
  let circuit = null;
  if (params.get('c')) {
    try { circuit = decodeShare(params.get('c')); } catch { circuit = null; }
  }
  app.locked = params.get('a') === '0';
  const ap = params.get('ap');
  const ratio = Number(params.get('r'));
  if (ap !== null || params.has('r')) app.linkSettings = true;
  if (ap !== null && Object.hasOwn(PLACEMENTS, ap)) app.settings.arrowPlacement = ap;
  if ([1.5, 2, 3, 4].includes(ratio)) app.settings.ratio = ratio;
  app.setBuilder = createSetBuilder(app); // a new set starts from the settings in effect
  if (circuit) {
    app.selection = 'link';
    fillCircuitSelect();
    loadCircuit(circuit, 'link');
  } else {
    fillCircuitSelect();
    const first = 'preset0:0';
    loadCircuit(circuitFor(first), first);
  }
  applySettingsUI();
  setPredictTool('paint');
  setBuildTool('wire');
  const modes = app.locked ? ['explore', 'predict', 'build'] : ['explore', 'predict', 'build', 'sets'];
  const mode = modes.includes(params.get('m')) ? params.get('m') : 'explore';
  if (app.locked) {
    $$('.modes [data-mode]').forEach((b) => { b.hidden = b.dataset.mode !== mode; });
    $('[data-mode="sets"]').hidden = true;
    $('#arrowPlacement').closest('label').hidden = true;
  }
  setMode(mode);
  updatePlayButton();
  requestAnimationFrame(frame);
}

init();
