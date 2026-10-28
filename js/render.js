// SVG drawing. Pressure is a translucent highlighter stroke behind black wires,
// like a hand-colored worksheet. Flow is an arrow with one or more tails, and
// brightness is a starburst of rays around each bulb.

import { stripeDefs } from './colors.js';
import { bounds } from './model.js';
import { S } from './arrows.js';

export { S };
const BULB_R = 22;
const INK = '#1f2430';
const STUDENT = '#7c3aed';
const BAD = '#e11d48';

const px = (p) => [p[0] * S, p[1] * S];
const f = (n) => Math.round(n * 10) / 10;

export function viewBoxFor(circuit, building) {
  let { minX, minY, maxX, maxY } = bounds(circuit);
  if (building) {
    minX = Math.min(minX, 0); minY = Math.min(minY, 0);
    maxX = Math.max(maxX, 16); maxY = Math.max(maxY, 10);
  }
  const m = building ? 1 : 1.3;
  return [(minX - m) * S, (minY - m) * S, (maxX - minX + 2 * m) * S, (maxY - minY + 2 * m) * S];
}

// ctx: {
//   circuit, graph, viewBox, building,
//   segPaint(segIndex) -> paint | null       highlighter for wire segments
//   nodePaint(nodeIndex) -> paint | null     highlighter for part leads
//   arrows: [{ pose: {x, y, ux, uy}, n, dir, color, bad, hit }]   hit = index for clicking
//   rays: Map(partId -> { n, color })
//   badges: [{ node, sign, strength }]
//   marks: { branches:Set, bulbs:Set, nodes:Set }
//   approx: Set(branch)                       '≈' markers (teacher view)
//   grid, hover:[x,y], preview:[{a,b}], selected: partId, labels: bool
// }
export function draw(svg, ctx) {
  const vb = ctx.viewBox;
  svg.setAttribute('viewBox', vb.join(' '));
  const g = ctx.graph;
  const out = [];
  out.push(`<defs>${stripeDefs()}</defs>`);

  if (ctx.grid) out.push(gridDots(vb));

  // highlighter layer
  const hl = [];
  g.segs.forEach((s, i) => {
    const paint = ctx.segPaint && ctx.segPaint(i);
    if (paint) hl.push(line(px(s.a), px(s.b), paint, 18));
  });
  for (const p of ctx.circuit.parts) {
    const leads = partLeads(p);
    const na = g.nodeIndex.get(`${p.a[0]},${p.a[1]}`);
    const nb = g.nodeIndex.get(`${p.b[0]},${p.b[1]}`);
    const pa = ctx.nodePaint && ctx.nodePaint(na);
    const pb = ctx.nodePaint && ctx.nodePaint(nb);
    if (pa) hl.push(line(leads.a[0], leads.a[1], pa, 18));
    if (pb) hl.push(line(leads.b[0], leads.b[1], pb, 18));
  }
  out.push(`<g class="hl" opacity="0.62">${hl.join('')}</g>`);

  // check marks under the ink
  if (ctx.marks) {
    const mk = [];
    ctx.marks.branches.forEach((b) => {
      for (const { seg } of g.branches[b].segs) {
        const s = g.segs[seg];
        mk.push(`<line x1="${f(s.a[0] * S)}" y1="${f(s.a[1] * S)}" x2="${f(s.b[0] * S)}" y2="${f(s.b[1] * S)}" stroke="${BAD}" stroke-width="34" stroke-linecap="round" fill="none" opacity="0.22" class="mark"/>`);
      }
    });
    out.push(mk.join(''));
  }

  // wires
  out.push(g.segs.map((s) => line(px(s.a), px(s.b), INK, 2.6)).join(''));

  // parts
  for (const p of ctx.circuit.parts) out.push(drawPart(p, ctx));

  // junction dots
  g.nodes.forEach((n, i) => {
    if (g.adj[i].length >= 3 || (g.adj[i].length >= 2 && g.isTerminal[i])) {
      out.push(`<circle cx="${n.x * S}" cy="${n.y * S}" r="4.5" fill="${INK}"/>`);
    }
  });

  // rays
  if (ctx.rays) {
    for (const p of ctx.circuit.parts) {
      const r = ctx.rays.get(p.id);
      if (r && r.n > 0 && p.type !== 'battery') out.push(starburst(p, r.n, r.color || INK));
    }
  }

  // arrows
  if (ctx.arrows) for (const a of ctx.arrows) out.push(arrowAt(a));

  // approx markers
  if (ctx.approx) {
    ctx.approx.forEach((b) => {
      const { x, y } = midOfBranch(g, b);
      out.push(`<text x="${f(x)}" y="${f(y + 5)}" class="approx" text-anchor="middle">≈</text>`);
    });
  }

  // bad junctions
  if (ctx.marks) {
    ctx.marks.nodes.forEach((node) => {
      const n = g.nodes[node];
      out.push(`<circle cx="${n.x * S}" cy="${n.y * S}" r="17" fill="none" stroke="${BAD}" stroke-width="3" stroke-dasharray="5 4" class="mark"/>`);
    });
  }

  // pile-up badges
  if (ctx.badges) for (const b of ctx.badges) out.push(badge(g, b));

  // hit targets (on top, invisible)
  g.segs.forEach((s, i) => {
    out.push(`<line x1="${s.a[0] * S}" y1="${s.a[1] * S}" x2="${s.b[0] * S}" y2="${s.b[1] * S}" stroke="transparent" stroke-width="24" stroke-linecap="round" data-seg="${i}" data-branch="${g.segBranch[i]}" data-wire="${s.wire}" class="hit"/>`);
  });
  for (const p of ctx.circuit.parts) {
    const [cx, cy] = centerPx(p);
    out.push(`<circle cx="${cx}" cy="${cy}" r="${BULB_R + 8}" fill="transparent" data-part="${p.id}" class="hit"/>`);
  }
  if (ctx.arrows) {
    ctx.arrows.forEach((a) => {
      if (a.hit !== undefined) out.push(`<circle cx="${f(a.pose.x)}" cy="${f(a.pose.y)}" r="17" fill="transparent" data-arrow="${a.hit}" class="hit"/>`);
    });
  }

  // editor overlays
  if (ctx.preview) {
    for (const s of ctx.preview) out.push(`<line x1="${s.a[0] * S}" y1="${s.a[1] * S}" x2="${s.b[0] * S}" y2="${s.b[1] * S}" stroke="${STUDENT}" stroke-width="3" stroke-dasharray="6 5" pointer-events="none"/>`);
  }
  if (ctx.hover) {
    out.push(`<circle cx="${ctx.hover[0] * S}" cy="${ctx.hover[1] * S}" r="7" fill="none" stroke="${STUDENT}" stroke-width="2.5" pointer-events="none"/>`);
  }
  svg.innerHTML = out.join('');
}

function line(a, b, stroke, width) {
  return `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round"/>`;
}

function gridDots(vb) {
  const [x0, y0, w, h] = vb;
  const id = 'griddots';
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="${S}" height="${S}" x="${-S / 2}" y="${-S / 2}">`
    + `<circle cx="${S / 2}" cy="${S / 2}" r="2" fill="#b8bdc9"/></pattern>`
    + `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="url(#${id})" pointer-events="none"/>`;
}

function centerPx(p) {
  return [(p.a[0] + p.b[0]) * S / 2, (p.a[1] + p.b[1]) * S / 2];
}

function axis(p) {
  const [ax, ay] = px(p.a);
  const [bx, by] = px(p.b);
  const len = Math.hypot(bx - ax, by - ay) || 1;
  return { ux: (bx - ax) / len, uy: (by - ay) / len, len };
}

// Lead lines from each terminal to the body of the part.
function partLeads(p) {
  const [cx, cy] = centerPx(p);
  const { ux, uy } = axis(p);
  const r = p.type === 'battery' ? 14 : BULB_R;
  return {
    a: [px(p.a), [cx - ux * r, cy - uy * r]],
    b: [[cx + ux * r, cy + uy * r], px(p.b)],
  };
}

function drawPart(p, ctx) {
  const leads = partLeads(p);
  const [cx, cy] = centerPx(p);
  const { ux, uy } = axis(p);
  const vx = -uy; const vy = ux;
  let body = line(leads.a[0], leads.a[1], INK, 2.6) + line(leads.b[0], leads.b[1], INK, 2.6);
  const sel = ctx.selected === p.id ? ' class="selected"' : '';
  const bad = ctx.marks && ctx.marks.bulbs.has(p.id);
  if (p.type === 'battery') {
    // two cells: long plate (+) then short plate, from the + end
    const plates = [[-14, 17], [-5, 9], [5, 17], [14, 9]];
    body += `<rect x="${f(cx - 18)}" y="${f(cy - 20)}" width="36" height="40" fill="#fff" opacity="0" />`;
    for (const [o, h] of plates) {
      const x = cx + ux * o; const y = cy + uy * o;
      body += line([x - vx * h, y - vy * h], [x + vx * h, y + vy * h], INK, h > 10 ? 3 : 5);
    }
    const lx = cx - ux * 24 + vx * 20; const ly = cy - uy * 24 + vy * 20;
    body += `<text x="${f(lx)}" y="${f(ly + 6)}" class="plus" text-anchor="middle">+</text>`;
  } else {
    body += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${BULB_R}" fill="#fff" stroke="${bad ? BAD : INK}" stroke-width="${bad ? 4 : 2.6}"${bad ? ' stroke-dasharray="6 4"' : ''}/>`;
    body += `<text x="${f(cx)}" y="${f(cy + 8)}" class="bulb-label" text-anchor="middle">${p.type}</text>`;
  }
  return `<g${sel}>${body}</g>`;
}

function starburst(p, n, color) {
  const [cx, cy] = centerPx(p);
  const { ux, uy } = axis(p);
  const lead = Math.atan2(uy, ux);
  const keepOut = Math.PI * 0.16; // leave room around the two leads
  let s = '';
  for (let i = 0; i < n; i++) {
    let ang = lead + Math.PI / 4 + (i * 2 * Math.PI) / n;
    // nudge rays that would sit on top of a lead
    const rel = ((ang - lead) % Math.PI + Math.PI) % Math.PI; // 0..PI from the lead axis
    if (rel < keepOut) ang += keepOut - rel;
    if (rel > Math.PI - keepOut) ang -= rel - (Math.PI - keepOut);
    const c = Math.cos(ang); const sn = Math.sin(ang);
    s += line([cx + c * (BULB_R + 6), cy + sn * (BULB_R + 6)], [cx + c * (BULB_R + 17), cy + sn * (BULB_R + 17)], color, 2.6);
  }
  return `<g pointer-events="none">${s}</g>`;
}

function midOfBranch(g, b) {
  const s = g.segs[g.branches[b].main.seg];
  return { x: (s.a[0] + s.b[0]) * S / 2, y: (s.a[1] + s.b[1]) * S / 2 };
}

function arrowAt(a) {
  const { x, y, ux, uy } = a.pose;
  const angle = Math.atan2(uy, ux) * 180 / Math.PI + (a.dir < 0 ? 180 : 0);
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(angle)})" pointer-events="none">${arrowGlyph(a.n, a.color || INK, a.bad)}</g>`;
}

// An arrow pointing along +x with `n` parallel tails feeding one head.
export function arrowGlyph(n, color, bad) {
  const gap = 4.2;
  const spread = (n - 1) * gap;
  const h = Math.max(6, spread / 2 + 4);
  let s = '';
  if (bad) s += `<ellipse cx="0" cy="0" rx="25" ry="${f(h + 7)}" fill="none" stroke="${BAD}" stroke-width="2.5" stroke-dasharray="5 4"/>`;
  for (let i = 0; i < n; i++) {
    const y = -spread / 2 + i * gap;
    s += `<line x1="-15" y1="${f(y)}" x2="6" y2="${f(y * 0.55)}" stroke="${color}" stroke-width="2" stroke-linecap="round"/>`;
  }
  s += `<polyline points="4,${f(-h)} 14,0 4,${f(h)}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>`;
  return s;
}

function badge(g, b) {
  const n = g.nodes[b.node];
  const x = n.x * S; const y = n.y * S;
  const rising = b.sign > 0;
  const col = rising ? '#dc2626' : '#2563eb';
  const label = rising ? 'piling up' : 'draining';
  const o = Math.min(1, 0.35 + b.strength);
  return `<g class="badge" opacity="${f(o)}" pointer-events="none" transform="translate(${f(x)} ${f(y)})">`
    + `<circle r="13" fill="#fff" stroke="${col}" stroke-width="3"/>`
    + `<text y="6" text-anchor="middle" class="badge-sign" fill="${col}">${rising ? '+' : '−'}</text>`
    + `<text y="30" text-anchor="middle" class="badge-label" fill="${col}">${label}</text></g>`;
}
