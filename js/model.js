// Circuit data model.
//
// A circuit lives on an integer grid. Every element touches the grid at two points:
//   parts: { id, type: 'battery' | 'R' | 'L', a: [x, y], b: [x, y] }
//          (for a battery, `a` is the + terminal and `b` is the - terminal)
//   wires: { id, a: [x, y], b: [x, y] }
// Elements connect wherever they share a grid point. A wire also connects to any
// element endpoint that lies along it (a "T" junction).

let counter = 0;
export function uid(prefix) {
  counter += 1;
  return `${prefix}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function key(x, y) {
  return `${x},${y}`;
}

export function emptyCircuit(name = 'Untitled circuit') {
  return { name, parts: [], wires: [] };
}

export function clone(circuit) {
  return deserialize(serialize(circuit));
}

// Split wires at every element endpoint that lies strictly inside them, so the
// solver sees each junction as a node.
export function normalizeWires(circuit) {
  const pts = new Map();
  const add = (p) => pts.set(key(p[0], p[1]), p);
  circuit.wires.forEach((w) => { add(w.a); add(w.b); });
  circuit.parts.forEach((p) => { add(p.a); add(p.b); });

  const out = [];
  for (const w of circuit.wires) {
    const [ax, ay] = w.a;
    const [bx, by] = w.b;
    const dx = bx - ax;
    const dy = by - ay;
    if (dx === 0 && dy === 0) continue;
    const inner = [];
    for (const p of pts.values()) {
      const px = p[0] - ax;
      const py = p[1] - ay;
      if (px * dy - py * dx !== 0) continue;
      const t = (px * dx + py * dy) / (dx * dx + dy * dy);
      if (t > 1e-9 && t < 1 - 1e-9) inner.push([t, p]);
    }
    inner.sort((u, v) => u[0] - v[0]);
    let prev = w.a;
    for (const [, p] of inner) {
      out.push({ a: prev, b: p, wire: w.id });
      prev = p;
    }
    out.push({ a: prev, b: w.b, wire: w.id });
  }
  // Overlapping wires would otherwise become parallel copies of one stretch.
  const seen = new Set();
  return out.filter((s) => {
    const ka = key(s.a[0], s.a[1]);
    const kb = key(s.b[0], s.b[1]);
    const k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function bounds(circuit) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const take = (p) => {
    minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
  };
  circuit.wires.forEach((w) => { take(w.a); take(w.b); });
  circuit.parts.forEach((p) => { take(p.a); take(p.b); });
  if (minX === Infinity) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

// Compact JSON form used for files, local storage and share links.
export function serialize(circuit) {
  return {
    n: circuit.name,
    p: circuit.parts.map((p) => [p.type, p.a[0], p.a[1], p.b[0], p.b[1]]),
    w: circuit.wires.map((w) => [w.a[0], w.a[1], w.b[0], w.b[1]]),
  };
}

export function deserialize(data) {
  if (!data || !Array.isArray(data.p) || !Array.isArray(data.w)) {
    throw new Error('Not a circuit file');
  }
  const num = (v) => {
    const n = Number(v);
    if (!Number.isInteger(n)) throw new Error('Bad coordinate');
    return n;
  };
  return {
    name: String(data.n || 'Untitled circuit'),
    parts: data.p.map(([type, ax, ay, bx, by]) => {
      if (!['battery', 'R', 'L'].includes(type)) throw new Error(`Unknown part ${type}`);
      return { id: uid('p'), type, a: [num(ax), num(ay)], b: [num(bx), num(by)] };
    }),
    wires: data.w.map(([ax, ay, bx, by]) => ({ id: uid('w'), a: [num(ax), num(ay)], b: [num(bx), num(by)] })),
  };
}

function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeShare(circuit) {
  return toBase64Url(JSON.stringify(serialize(circuit)));
}

export function decodeShare(s) {
  return deserialize(JSON.parse(fromBase64Url(s)));
}
