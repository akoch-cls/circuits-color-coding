// Physics for the CASTLE "electric pressure" model.
//
// Every grid point an element touches is a node. Wires are edges with a tiny
// resistance; bulbs are edges with resistance 1 (round, R) or `ratio` (long, L).
// The battery holds its + terminal at pressure 1 and its - terminal at 0.
//
// Each free node also holds a little charge, like a reservoir: when more flows in
// than out, charge piles up and its pressure rises. That is what drives a wrong
// starting picture toward the steady state:
//     C dV/dt = (flow in) - (flow out)
// stepped with implicit Euler so it stays stable even with near-zero wire resistance.

import { normalizeWires, key } from './model.js';

export const WIRE_G = 1e4;
const ZERO_FLOW = 0.004; // fraction of the largest flow treated as "no flow"

export function buildGraph(circuit, ratio = 2) {
  const g = {
    nodes: [], nodeIndex: new Map(), edges: [], segs: [], error: null,
    partEdge: new Map(), battery: null, batteryEdge: -1,
  };
  const nid = (p) => {
    const k = key(p[0], p[1]);
    if (!g.nodeIndex.has(k)) {
      g.nodeIndex.set(k, g.nodes.length);
      g.nodes.push({ x: p[0], y: p[1] });
    }
    return g.nodeIndex.get(k);
  };

  g.segs = normalizeWires(circuit);
  g.segs.forEach((s) => {
    s.na = nid(s.a);
    s.nb = nid(s.b);
    s.edge = g.edges.length;
    g.edges.push({ kind: 'wire', a: s.na, b: s.nb, g: WIRE_G });
  });

  const batteries = [];
  for (const p of circuit.parts) {
    const a = nid(p.a);
    const b = nid(p.b);
    if (p.type === 'battery') {
      batteries.push({ part: p, a, b });
      continue;
    }
    g.partEdge.set(p.id, g.edges.length);
    g.edges.push({ kind: 'bulb', type: p.type, a, b, g: p.type === 'L' ? 1 / ratio : 1, part: p });
  }

  const n = g.nodes.length;
  g.isTerminal = new Uint8Array(n);
  circuit.parts.forEach((p) => {
    g.isTerminal[g.nodeIndex.get(key(...p.a))] = 1;
    g.isTerminal[g.nodeIndex.get(key(...p.b))] = 1;
  });

  // Nets: groups of nodes joined by wire alone. A net is one "wire" to a student.
  const wireUF = unionFind(n);
  g.segs.forEach((s) => wireUF.union(s.na, s.nb));
  const netId = new Map();
  g.netOf = new Int32Array(n);
  g.nets = [];
  for (let i = 0; i < n; i++) {
    const r = wireUF.find(i);
    if (!netId.has(r)) { netId.set(r, g.nets.length); g.nets.push([]); }
    g.netOf[i] = netId.get(r);
    g.nets[netId.get(r)].push(i);
  }

  buildBranches(g);

  if (batteries.length === 0) return finish(g, 'no-battery');
  if (batteries.length > 1) return finish(g, 'multi-battery');
  const bat = batteries[0];
  g.battery = bat;
  g.batteryEdge = g.edges.length;
  g.edges.push({ kind: 'battery', a: bat.a, b: bat.b, g: 0, part: bat.part });
  if (bat.a === bat.b || g.netOf[bat.a] === g.netOf[bat.b]) return finish(g, 'short');

  // Anything not joined to the battery (through wires or bulbs) has no pressure.
  const uf = unionFind(n);
  g.edges.forEach((e) => { if (e.kind !== 'battery') uf.union(e.a, e.b); });
  const ra = uf.find(bat.a);
  const rb = uf.find(bat.b);
  g.floating = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = uf.find(i);
    if (r !== ra && r !== rb) g.floating[i] = 1;
  }

  g.free = [];
  g.freeIndex = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    if (g.floating[i] || i === bat.a || i === bat.b) continue;
    g.freeIndex[i] = g.free.length;
    g.free.push(i);
  }
  // Each net holds the same amount of charge per unit pressure, shared by its nodes.
  g.cap = g.free.map((i) => 1 / g.nets[g.netOf[i]].length);

  // Conductance matrix restricted to free nodes, with the battery as boundary values.
  const m = g.free.length;
  g.G = new Float64Array(m * m);
  g.b = new Float64Array(m);
  const fixedV = (i) => (i === bat.a ? 1 : 0);
  for (const e of g.edges) {
    if (e.kind === 'battery' || g.floating[e.a]) continue;
    const fa = g.freeIndex[e.a];
    const fb = g.freeIndex[e.b];
    if (fa >= 0) g.G[fa * m + fa] += e.g;
    if (fb >= 0) g.G[fb * m + fb] += e.g;
    if (fa >= 0 && fb >= 0) {
      g.G[fa * m + fb] -= e.g;
      g.G[fb * m + fa] -= e.g;
    } else if (fa >= 0) {
      g.b[fa] += e.g * fixedV(e.b);
    } else if (fb >= 0) {
      g.b[fb] += e.g * fixedV(e.a);
    }
  }
  return finish(g, null);
}

function finish(g, error) {
  g.error = error;
  if (error) {
    g.floating = new Uint8Array(g.nodes.length).fill(1);
    g.free = [];
  }
  return g;
}

function unionFind(n) {
  const parent = Int32Array.from({ length: n }, (_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  return { find, union: (a, b) => { parent[find(a)] = find(b); } };
}

// A branch is a run of wire between junctions or part terminals. It carries a
// single flow, so it gets one arrow and one color in the student's mark-up.
function buildBranches(g) {
  const n = g.nodes.length;
  const adj = Array.from({ length: n }, () => []);
  g.segs.forEach((s, i) => { adj[s.na].push(i); adj[s.nb].push(i); });
  g.adj = adj;
  const isJunction = (i) => g.isTerminal[i] || adj[i].length !== 2;
  const used = new Uint8Array(g.segs.length);
  g.branches = [];
  g.segBranch = new Int32Array(g.segs.length);

  const walk = (start, first) => {
    const segs = [];
    const nodes = [start];
    let node = start;
    let s = first;
    for (;;) {
      used[s] = 1;
      g.segBranch[s] = g.branches.length;
      const seg = g.segs[s];
      const fwd = seg.na === node;
      segs.push({ seg: s, fwd });
      node = fwd ? seg.nb : seg.na;
      nodes.push(node);
      if (isJunction(node)) break;
      const next = adj[node].find((t) => !used[t]);
      if (next === undefined) break;
      s = next;
    }
    let main = segs[0];
    let best = -1;
    for (const item of segs) {
      const sg = g.segs[item.seg];
      const len = Math.hypot(sg.b[0] - sg.a[0], sg.b[1] - sg.a[1]);
      if (len > best) { best = len; main = item; }
    }
    g.branches.push({ segs, nodes, start, end: node, main });
  };

  for (let i = 0; i < n; i++) {
    if (!isJunction(i)) continue;
    for (const s of adj[i]) if (!used[s]) walk(i, s);
  }
  for (let s = 0; s < g.segs.length; s++) if (!used[s]) walk(g.segs[s].na, s);
}

// ---- linear algebra -------------------------------------------------------

function luFactor(A, n) {
  const piv = Int32Array.from({ length: n }, (_, i) => i);
  for (let k = 0; k < n; k++) {
    let p = k;
    let max = Math.abs(A[k * n + k]);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(A[i * n + k]);
      if (v > max) { max = v; p = i; }
    }
    if (p !== k) {
      for (let j = 0; j < n; j++) {
        const t = A[k * n + j]; A[k * n + j] = A[p * n + j]; A[p * n + j] = t;
      }
      const t = piv[k]; piv[k] = piv[p]; piv[p] = t;
    }
    const d = A[k * n + k];
    if (d === 0) continue;
    for (let i = k + 1; i < n; i++) {
      const f = (A[i * n + k] /= d);
      if (f !== 0) for (let j = k + 1; j < n; j++) A[i * n + j] -= f * A[k * n + j];
    }
  }
  return { A, piv, n };
}

function luSolve({ A, piv, n }, rhs) {
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) x[i] = rhs[piv[i]];
  for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) x[i] -= A[i * n + j] * x[j];
  for (let i = n - 1; i >= 0; i--) {
    for (let j = i + 1; j < n; j++) x[i] -= A[i * n + j] * x[j];
    x[i] /= A[i * n + i] || 1;
  }
  return x;
}

// ---- states ---------------------------------------------------------------

function fullFromFree(g, xf) {
  const V = new Float64Array(g.nodes.length).fill(NaN);
  if (g.error) return V;
  V[g.battery.a] = 1;
  V[g.battery.b] = 0;
  g.free.forEach((i, k) => { V[i] = xf[k]; });
  return V;
}

export function steadyState(g) {
  if (g.error) return null;
  if (!g._ssLU) g._ssLU = luFactor(Float64Array.from(g.G), g.free.length);
  return fullFromFree(g, luSolve(g._ssLU, g.b));
}

// Build a starting state. `valueForNet(netIndex)` gives each net's pressure (0..1).
// Wires joined straight to the battery always start at the battery's pressure.
export function stateFromNets(g, valueForNet) {
  const plusNet = g.netOf[g.battery.a];
  const minusNet = g.netOf[g.battery.b];
  const xf = g.free.map((i) => {
    const net = g.netOf[i];
    if (net === plusNet) return 1;
    if (net === minusNet) return 0;
    return valueForNet(net);
  });
  return fullFromFree(g, xf);
}

export function initialState(g, kind, rand = Math.random) {
  if (g.error) return null;
  const netVals = g.nets.map(() => rand());
  const pick = {
    low: () => 0,
    high: () => 1,
    mid: () => 0.5,
    mixed: (net) => netVals[net],
  }[kind];
  return stateFromNets(g, pick);
}

// One implicit-Euler step: (C/dt + G) V_new = (C/dt) V_old + b
export function step(g, V, dt) {
  if (g.error) return V;
  const m = g.free.length;
  if (!g._tLU || g._tLU.dt !== dt) {
    const A = Float64Array.from(g.G);
    for (let k = 0; k < m; k++) A[k * m + k] += g.cap[k] / dt;
    g._tLU = { dt, lu: luFactor(A, m) };
  }
  const rhs = new Float64Array(m);
  for (let k = 0; k < m; k++) rhs[k] = g.b[k] + (g.cap[k] / dt) * V[g.free[k]];
  return fullFromFree(g, luSolve(g._tLU.lu, rhs));
}

export function maxDifference(g, V1, V2) {
  let d = 0;
  for (const i of g.free) d = Math.max(d, Math.abs(V1[i] - V2[i]));
  return d;
}

// ---- reading the state ----------------------------------------------------

// Flow along every edge from a to b (battery: flow through it from - to +).
export function edgeCurrents(g, V) {
  const I = new Float64Array(g.edges.length);
  if (!V || g.error) return I;
  g.edges.forEach((e, k) => {
    if (e.kind === 'battery') return;
    const d = V[e.a] - V[e.b];
    I[k] = Number.isNaN(d) ? 0 : e.g * d;
  });
  if (g.batteryEdge >= 0) {
    let out = 0;
    g.edges.forEach((e, k) => {
      if (e.kind === 'battery') return;
      if (e.a === g.battery.a) out += I[k];
      if (e.b === g.battery.a) out -= I[k];
    });
    I[g.batteryEdge] = out;
  }
  return I;
}

export function analyze(g, V) {
  const I = edgeCurrents(g, V);
  const branchI = g.branches.map((b) => {
    const e = g.segs[b.main.seg].edge;
    return b.main.fwd ? I[e] : -I[e];
  });
  const bulbs = [];
  g.edges.forEach((e, k) => {
    if (e.kind !== 'bulb') return;
    bulbs.push({ part: e.part, edge: k, I: I[k], P: I[k] * I[k] / e.g });
  });
  // Net in-flow through bulbs: positive means charge is piling up in that wire.
  const netFlow = new Float64Array(g.nets.length);
  g.edges.forEach((e, k) => {
    if (e.kind !== 'bulb') return;
    netFlow[g.netOf[e.b]] += I[k];
    netFlow[g.netOf[e.a]] -= I[k];
  });
  return { I, branchI, bulbs, netFlow };
}

// Pressure of a branch = average of its nodes (they are equal at steady state).
export function branchPressure(g, V, b) {
  if (!V) return NaN;
  let s = 0;
  for (const i of g.branches[b].nodes) s += V[i];
  return s / g.branches[b].nodes.length;
}

// Size of one arrow tail: the largest flow that divides every flow into a small
// whole number of tails.
export function tailsUnit(mags) {
  if (mags.length === 0) return { unit: 1, approx: false };
  const min = Math.min(...mags);
  for (let d = 1; d <= 6; d++) {
    const u = min / d;
    const ok = mags.every((m) => {
      const r = m / u;
      return Math.abs(r - Math.round(r)) < 0.08 && Math.round(r) <= 12;
    });
    if (ok) return { unit: u, approx: false };
  }
  return { unit: min, approx: true };
}

// Steady-state answer key: pressure levels, tails and rays.
export function steadySummary(g, V) {
  const an = analyze(g, V);
  const maxI = Math.max(0, ...an.branchI.map(Math.abs), ...an.bulbs.map((b) => Math.abs(b.I)));
  const zero = maxI * ZERO_FLOW + 1e-9;
  const mags = [...an.branchI, ...an.bulbs.map((b) => b.I)].map(Math.abs).filter((x) => x > zero);
  const { unit, approx } = tailsUnit(mags);
  const branchTails = an.branchI.map((i) => (Math.abs(i) > zero ? Math.max(1, Math.round(Math.abs(i) / unit)) : 0));
  const branchDir = an.branchI.map((i) => (i >= 0 ? 1 : -1));
  const bulbTails = new Map(an.bulbs.map((b) => [b.part.id, Math.abs(b.I) > zero ? Math.max(1, Math.round(Math.abs(b.I) / unit)) : 0]));
  const rays = raysFor(an.bulbs);
  const power = new Map(an.bulbs.map((b) => [b.part.id, b.P]));
  const branchP = g.branches.map((_, b) => branchPressure(g, V, b));
  return { ...an, unit, approx, zero, branchTails, branchDir, bulbTails, rays, power, branchP };
}

export const LIT = 0.004; // power (relative to one round bulb alone) below which a bulb looks off

// Rays grow with brightness (power), measured against one round bulb across the
// battery (8 rays), so brightness can be compared between circuits. Within one
// circuit a brighter bulb always gets more rays and equal bulbs get equal rays.
export function raysFor(bulbs) {
  const rays = new Map();
  const lit = bulbs.filter((b) => b.P > LIT).sort((u, v) => u.P - v.P);
  bulbs.forEach((b) => { if (b.P <= LIT) rays.set(b.part.id, 0); });
  let groupP = null;
  let prev = 0;
  for (const b of lit) {
    let r = Math.min(10, Math.max(1, Math.round(8 * Math.sqrt(b.P))));
    if (groupP !== null && b.P <= groupP * 1.03) {
      r = prev;
    } else {
      if (groupP !== null) r = Math.max(r, prev + 1);
      groupP = b.P;
    }
    rays.set(b.part.id, r);
    prev = r;
  }
  return rays;
}
