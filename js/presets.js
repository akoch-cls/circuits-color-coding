// Built-in circuits. Each is stored in the same compact form as saved files and
// share links: p = [type, ax, ay, bx, by] (battery: a is +), w = [ax, ay, bx, by].

// Battery on the left (+ at top), optional bulbs along the top and bottom rails,
// then parallel columns of bulbs in series (listed top to bottom).
function ladder(name, { top = [], cols = [['R']], bottom = [] }) {
  const p = [];
  const w = [];
  const nmax = Math.max(...cols.map((c) => c.length));
  const Y = Math.max(3 * nmax + 1, 4);
  const by = Math.floor(Y / 2) - 1;
  p.push(['battery', 0, by, 0, by + 2]);
  w.push([0, 0, 0, by], [0, by + 2, 0, Y]);
  let xt = 0;
  for (const t of top) { w.push([xt, 0, xt + 1, 0]); p.push([t, xt + 1, 0, xt + 3, 0]); xt += 3; }
  let xb = 0;
  for (const t of bottom) { w.push([xb, Y, xb + 1, Y]); p.push([t, xb + 1, Y, xb + 3, Y]); xb += 3; }
  const x0 = Math.max(xt, xb) + 2;
  cols.forEach((col, j) => {
    const x = x0 + 3 * j;
    const n = col.length;
    const rem = Y - 2 * n;
    let y = 0;
    for (let i = 0; i <= n; i++) {
      const gap = Math.floor(rem / (n + 1)) + (i < rem % (n + 1) ? 1 : 0);
      w.push([x, y, x, y + gap]);
      y += gap;
      if (i < n) { p.push([col[i], x, y, x, y + 2]); y += 2; }
    }
  });
  const xl = x0 + 3 * (cols.length - 1);
  w.push([xt, 0, xl, 0], [xb, Y, xl, Y]);
  return { n: name, p, w };
}

const worksheet = [
  {
    n: '5A · two round in series',
    p: [['battery', 3, 6, 5, 6], ['R', 1, 5, 1, 3], ['R', 7, 3, 7, 5]],
    w: [[1, 6, 3, 6], [5, 6, 7, 6], [1, 6, 1, 5], [1, 3, 1, 1], [1, 1, 7, 1], [7, 1, 7, 3], [7, 5, 7, 6]],
  },
  {
    n: '5B · four long bulbs',
    p: [['battery', 1, 2, 1, 4], ['L', 4, 1, 4, 3], ['L', 8, 1, 8, 3], ['L', 10, 2, 12, 2], ['L', 3, 7, 5, 7]],
    w: [
      [1, 2, 1, 1], [1, 1, 8, 1],
      [4, 3, 4, 4], [4, 4, 10, 4], [8, 3, 8, 4],
      [10, 2, 10, 4], [12, 2, 12, 4], [10, 4, 12, 4],
      [1, 4, 1, 7], [1, 5, 6, 5], [6, 5, 6, 4],
      [1, 7, 3, 7], [5, 7, 6, 7], [6, 7, 6, 5],
    ],
  },
  {
    n: '5C · round, round, long in series',
    p: [['battery', 3, 7, 5, 7], ['R', 1, 5, 1, 3], ['R', 3, 1, 5, 1], ['L', 7, 3, 7, 5]],
    w: [[1, 7, 3, 7], [5, 7, 7, 7], [1, 7, 1, 5], [1, 3, 1, 1], [1, 1, 3, 1], [5, 1, 7, 1], [7, 1, 7, 3], [7, 5, 7, 7]],
  },
  {
    n: '5D · round, (long ∥ round), long',
    p: [['battery', 1, 4, 1, 6], ['R', 2, 2, 4, 2], ['L', 6, 3, 6, 5], ['R', 9, 3, 9, 5], ['L', 4, 7, 2, 7]],
    w: [
      [1, 4, 1, 2], [1, 2, 2, 2], [4, 2, 9, 2],
      [6, 2, 6, 3], [6, 5, 6, 7], [9, 2, 9, 3], [9, 5, 9, 7],
      [4, 7, 9, 7], [2, 7, 1, 7], [1, 7, 1, 6],
    ],
  },
  ladder('4A · one round bulb', { cols: [['R']] }),
  ladder('4B · round then two round in parallel', { top: ['R'], cols: [['R'], ['R']] }),
  ladder('4C · two round in series', { cols: [['R', 'R']] }),
  ladder('4D · round ∥ round ∥ three round', { cols: [['R'], ['R'], ['R', 'R', 'R']] }),
  ladder('4E · two round in parallel', { cols: [['R'], ['R']] }),
];

const shorted = ladder('Round bulb with a bypass wire', { cols: [['R', 'R']] });
shorted.w.push([2, 4, 3, 4], [3, 4, 3, 6], [3, 6, 2, 6]);

// Same two bulbs with the wire between them removed.
const open = ladder('Broken wire (open circuit)', { cols: [['R', 'R']] });
open.w = open.w.filter((s) => !(s[0] === 2 && s[1] === 3 && s[2] === 2 && s[3] === 4));

const basics = [
  ladder('One round bulb', { cols: [['R']] }),
  ladder('One long bulb', { cols: [['L']] }),
  ladder('Two round in series', { cols: [['R', 'R']] }),
  ladder('Two long in series', { cols: [['L', 'L']] }),
  ladder('Round + long in series', { cols: [['R', 'L']] }),
  ladder('Three round in series', { cols: [['R', 'R', 'R']] }),
  ladder('Two round in parallel', { cols: [['R'], ['R']] }),
  ladder('Round ∥ long', { cols: [['R'], ['L']] }),
  ladder('Three round in parallel', { cols: [['R'], ['R'], ['R']] }),
  ladder('Round then two round in parallel', { top: ['R'], cols: [['R'], ['R']] }),
  ladder('Long then two round in parallel', { top: ['L'], cols: [['R'], ['R']] }),
  ladder('Round then two long in parallel', { top: ['R'], cols: [['L'], ['L']] }),
  ladder('Round ∥ (two round in series)', { cols: [['R'], ['R', 'R']] }),
  ladder('Long ∥ (two round in series)', { cols: [['L'], ['R', 'R']] }),
  shorted,
  open,
];

export const PRESET_GROUPS = [
  { label: 'Circuit Review worksheet', items: worksheet },
  { label: 'Basics', items: basics },
];
