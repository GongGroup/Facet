/** Minimal single-series line chart (SVG) with area fill, recessive grid and a hover crosshair. */
import { h } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

function niceTicks(max, count = 4) {
  const raw = max / count, mag = 10 ** Math.floor(Math.log10(raw || 1)), step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? raw;
  const out = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

/**
 * @param {{x:number[], y:number[], xLabel:string, yLabel:string, fmtX?:(v)=>string, fmtY?:(v)=>string, height?:number}} o
 */
export function lineChart(o) {
  const W = 280, H = o.height ?? 150, L = 30, R = 8, T = 8, B = 24;
  const xmax = Math.max(...o.x), ymax = Math.max(1e-9, ...o.y) * 1.08;
  const X = (v) => L + (v / xmax) * (W - L - R), Y = (v) => T + (1 - v / ymax) * (H - T - B);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': `${o.yLabel} versus ${o.xLabel}`, style: 'display:block;overflow:visible' });
  const grid = s('g', { stroke: 'var(--line)', 'stroke-width': '1' });
  const labels = s('g', { fill: 'var(--muted)', 'font-size': '9.5', 'font-family': 'var(--font-mono)' });
  for (const t of niceTicks(ymax / 1.08)) {
    grid.append(s('line', { x1: L, x2: W - R, y1: Y(t), y2: Y(t), 'stroke-dasharray': t === 0 ? '' : '2 3' }));
    const tx = s('text', { x: L - 4, y: Y(t) + 3, 'text-anchor': 'end' }); tx.textContent = String(+t.toFixed(3)); labels.append(tx);
  }
  for (const t of niceTicks(xmax, 4)) {
    const tx = s('text', { x: X(t), y: H - 10, 'text-anchor': 'middle' }); tx.textContent = String(+t.toFixed(3)); labels.append(tx);
  }
  const xl = s('text', { x: W - R, y: H - 1, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': '9.5' }); xl.textContent = o.xLabel; labels.append(xl);
  const pts = o.x.map((x, i) => `${X(x).toFixed(1)},${Y(o.y[i]).toFixed(1)}`);
  const area = s('path', { d: `M${X(o.x[0])},${Y(0)} L${pts.join(' L')} L${X(o.x.at(-1))},${Y(0)} Z`, fill: 'var(--accent)', 'fill-opacity': '0.14' });
  const line = s('polyline', { points: pts.join(' '), fill: 'none', stroke: 'var(--accent-strong)', 'stroke-width': '2', 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
  const cross = s('line', { y1: T, y2: H - B, stroke: 'var(--fg-2)', 'stroke-width': '1', visibility: 'hidden' });
  const dot = s('circle', { r: '4', fill: 'var(--accent-strong)', stroke: 'var(--panel)', 'stroke-width': '2', visibility: 'hidden' });
  const hit = s('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' });
  svg.append(grid, area, line, labels, cross, dot, hit);
  const tip = h('div', { style: { position: 'absolute', pointerEvents: 'none', padding: '4px 7px', borderRadius: '6px', background: 'var(--fg)', color: 'var(--panel)', font: '500 11px var(--font-mono)', whiteSpace: 'nowrap', visibility: 'hidden', transform: 'translate(-50%, -130%)' } });
  const wrap = h('div', { style: { position: 'relative' } }, svg, tip);
  hit.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    const xv = ((vx - L) / (W - L - R)) * xmax;
    let k = 0, best = Infinity;
    o.x.forEach((x, i) => { const d = Math.abs(x - xv); if (d < best) { best = d; k = i; } });
    const px = X(o.x[k]), py = Y(o.y[k]);
    cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', px); dot.setAttribute('cy', py); dot.setAttribute('visibility', 'visible');
    tip.textContent = `${o.xLabel.split(' ')[0]} ${(o.fmtX ?? String)(o.x[k])} · ${o.yLabel} ${(o.fmtY ?? String)(o.y[k])}`;
    tip.style.left = `${(px / W) * 100}%`; tip.style.top = `${(py / H) * 100}%`; tip.style.visibility = 'visible';
  });
  hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); tip.style.visibility = 'hidden'; });
  return wrap;
}
