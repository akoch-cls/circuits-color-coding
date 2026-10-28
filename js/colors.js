// Pressure -> color. Pressure runs from 0 (battery -, blue) to 1 (battery +, red).
// The 9 levels are red, orange, yellow, green, blue plus the striped steps between them.

export const BASE = {
  red: '#f04e4e',
  orange: '#f59a3a',
  yellow: '#f5d90a',
  green: '#4cc764',
  blue: '#5a8dee',
};

const SOLID = [BASE.blue, BASE.green, BASE.yellow, BASE.orange, BASE.red];

export const LEVELS = [
  { name: 'Blue', solid: BASE.blue },
  { name: 'Green-blue', stripes: [BASE.green, BASE.blue] },
  { name: 'Green', solid: BASE.green },
  { name: 'Yellow-green', stripes: [BASE.yellow, BASE.green] },
  { name: 'Yellow', solid: BASE.yellow },
  { name: 'Orange-yellow', stripes: [BASE.orange, BASE.yellow] },
  { name: 'Orange', solid: BASE.orange },
  { name: 'Red-orange', stripes: [BASE.red, BASE.orange] },
  { name: 'Red', solid: BASE.red },
];

export function levelOf(p) {
  return Math.round(Math.min(1, Math.max(0, p)) * 8);
}

// True when a pressure falls between two of the 9 steps.
export function isOffGrid(p) {
  const x = Math.min(1, Math.max(0, p)) * 8;
  return Math.abs(x - Math.round(x)) > 0.08;
}

export function levelPaint(level) {
  const l = LEVELS[level];
  return l.solid || `url(#lvl-${level})`;
}

function mix(c1, c2, t) {
  const a = parseInt(c1.slice(1), 16);
  const b = parseInt(c2.slice(1), 16);
  const ch = (v, s) => (v >> s) & 255;
  const out = [16, 8, 0].map((s) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t));
  return `#${out.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function smoothPaint(p) {
  const x = Math.min(1, Math.max(0, p)) * 4;
  const i = Math.min(3, Math.floor(x));
  return mix(SOLID[i], SOLID[i + 1], x - i);
}

export function paintFor(p, snap) {
  if (p === null || p === undefined || Number.isNaN(p)) return null;
  return snap ? levelPaint(levelOf(p)) : smoothPaint(p);
}

// SVG <pattern>s for the striped levels.
export function stripeDefs(prefix = 'lvl') {
  return LEVELS.map((l, i) => {
    if (!l.stripes) return '';
    const [c1, c2] = l.stripes;
    return `<pattern id="${prefix}-${i}" patternUnits="userSpaceOnUse" width="14" height="14" patternTransform="rotate(45)">`
      + `<rect width="7" height="14" fill="${c1}"/><rect x="7" width="7" height="14" fill="${c2}"/></pattern>`;
  }).join('');
}
