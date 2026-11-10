/**
 * 2D overlay keys drawn by the viewer on its overlay canvas and into image exports:
 *   • a colour legend — element chips for element schemes, a colormap bar with min / max or category
 *     chips for per-atom schemes (the `legend` info attached by computeColors());
 *   • rows from overlay legend layers (viewer.overlays.add({tier: 'legend', items})): a swatch — a halo
 *     ring, a dot or a line — and a label each, e.g. "Fixed (18)";
 *   • a length scale bar snapped to 1 / 2 / 5 × 10ⁿ Å.
 * They stack in the bottom-right corner, scale bar lowest. All sizes are CSS pixels multiplied by `scale`.
 */
import { COLORMAPS, rgbToHex } from './colors.js';

/** Largest 1/2/5 × 10ⁿ length (Å) not longer than `maxLen`. */
export function niceLength(maxLen) {
  if (!(maxLen > 0) || !Number.isFinite(maxLen)) return 0;
  const p = 10 ** Math.floor(Math.log10(maxLen));
  for (const m of [5, 2, 1]) if (m * p <= maxLen) return m * p;
  return p;
}

/** Short number for legend ends: integers stay integers, others get 2–3 significant digits. */
export function formatValue(v, integer = false) {
  if (!Number.isFinite(v)) return '–';
  if (integer) return String(Math.round(v));
  const a = Math.abs(v);
  if (a !== 0 && (a < 0.01 || a >= 1e5)) return v.toExponential(1);
  return String(+v.toFixed(a >= 100 ? 0 : a >= 10 ? 1 : 2));
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

function theme(dark) {
  return dark
    ? { panel: 'rgba(16,18,22,0.72)', line: 'rgba(255,255,255,0.14)', fg: '#eef1f4', muted: 'rgba(238,241,244,0.68)', chipEdge: 'rgba(255,255,255,0.35)' }
    : { panel: 'rgba(255,255,255,0.84)', line: 'rgba(20,23,27,0.12)', fg: '#14171b', muted: 'rgba(20,23,27,0.62)', chipEdge: 'rgba(0,0,0,0.25)' };
}

/** Measure (and optionally draw) the colour legend box; returns {w, h}. */
function colorBox(g, info, { scale: s, font, dark, x = 0, y = 0, draw = false, maxWidth = 220 }) {
  const t = theme(dark);
  const pad = 8 * s;
  if (info.kind === 'gradient') {
    const barW = 150 * s, barH = 9 * s;
    g.font = `500 ${11 * s}px ${font}`;
    const label = String(info.label ?? '');
    const w = Math.max(barW, g.measureText(label).width) + 2 * pad;
    const h = pad + 13 * s + barH + 15 * s + pad * 0.6;
    if (!draw) return { w, h };
    roundRect(g, x, y, w, h, 8 * s); g.fillStyle = t.panel; g.fill(); g.strokeStyle = t.line; g.lineWidth = 1 * s; g.stroke();
    g.textAlign = 'left'; g.textBaseline = 'top'; g.fillStyle = t.fg;
    g.fillText(label, x + pad, y + pad);
    const by = y + pad + 15 * s, bx = x + pad;
    const map = COLORMAPS[info.colormap] ?? COLORMAPS.viridis;
    const grad = g.createLinearGradient(bx, 0, bx + barW, 0);
    for (let k = 0; k <= 16; k++) grad.addColorStop(k / 16, rgbToHex(map(k / 16)));
    g.fillStyle = grad;
    roundRect(g, bx, by, barW, barH, 2.5 * s); g.fill();
    g.strokeStyle = t.line; g.stroke();
    g.font = `500 ${10.5 * s}px ${font}`; g.fillStyle = t.muted; g.textBaseline = 'top';
    g.textAlign = 'left'; g.fillText(formatValue(info.min, info.integer), bx, by + barH + 3 * s);
    g.textAlign = 'right'; g.fillText(formatValue(info.max, info.integer), bx + barW, by + barH + 3 * s);
    return { w, h };
  }
  // element chips (or a scheme's categories under its title), wrapped into rows
  const categories = info.kind === 'categories';
  const items = (info.items ?? []).map((it) => ({ text: String((categories ? it.label : it.symbol) ?? ''), color: it.color }));
  const title = categories && info.label ? String(info.label) : '';
  const shown = items.slice(0, 16);
  g.font = `600 ${11 * s}px ${font}`;
  const chipH = 16 * s, gap = 6 * s, dot = 5 * s;
  const widths = shown.map((it) => dot * 2 + 5 * s + g.measureText(it.text).width);
  const more = items.length - shown.length;
  if (more > 0) widths.push(g.measureText(`+${more}`).width);
  const inner = Math.min(maxWidth * s, Math.max(...widths, 10 * s) * 4 + gap * 3);
  const rows = [];
  let row = [], rw = 0;
  widths.forEach((cw, k) => {
    if (row.length && rw + gap + cw > inner) { rows.push(row); row = []; rw = 0; }
    row.push(k); rw += (row.length > 1 ? gap : 0) + cw;
  });
  if (row.length) rows.push(row);
  const rowW = (r) => r.reduce((a, k, j) => a + widths[k] + (j ? gap : 0), 0);
  g.font = `500 ${11 * s}px ${font}`;
  const titleW = title ? Math.min(maxWidth * s, g.measureText(title).width) : 0;
  const titleH = title ? 15 * s : 0;
  const w = Math.max(...rows.map(rowW), titleW, 10 * s) + 2 * pad;
  const h = titleH + rows.length * chipH + (rows.length - 1) * 2 * s + 2 * pad - 2 * s;
  if (!draw) return { w, h };
  roundRect(g, x, y, w, h, 8 * s); g.fillStyle = t.panel; g.fill(); g.strokeStyle = t.line; g.lineWidth = 1 * s; g.stroke();
  if (title) { g.textAlign = 'left'; g.textBaseline = 'top'; g.fillStyle = t.fg; g.fillText(fitText(g, title, w - 2 * pad), x + pad, y + pad); }
  g.font = `600 ${11 * s}px ${font}`;
  g.textBaseline = 'middle'; g.textAlign = 'left';
  rows.forEach((r, ri) => {
    let cx = x + pad;
    const cy = y + pad + titleH + ri * (chipH + 2 * s) + chipH / 2 - 1 * s;
    for (const k of r) {
      if (k >= shown.length) { g.fillStyle = t.muted; g.fillText(`+${more}`, cx, cy); cx += widths[k] + gap; continue; }
      const it = shown[k];
      g.beginPath(); g.arc(cx + dot, cy, dot, 0, Math.PI * 2); g.fillStyle = it.color; g.fill();
      g.lineWidth = 1 * s; g.strokeStyle = t.chipEdge; g.stroke();
      g.fillStyle = t.fg; g.fillText(it.text, cx + dot * 2 + 5 * s, cy);
      cx += widths[k] + gap;
    }
  });
  return { w, h };
}

/** `text`, shortened with an ellipsis to fit `maxW` canvas pixels in the current font. */
function fitText(g, text, maxW) {
  if (g.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (g.measureText(`${text.slice(0, mid)}…`).width <= maxW) lo = mid; else hi = mid - 1; }
  return `${text.slice(0, lo)}…`;
}

/** A legend row's swatch centred at (cx, cy): a halo ring around a grey atom, a dot or a short line. */
function drawSwatch(g, sw, cx, cy, s, t, dark) {
  g.save();
  g.globalAlpha = sw.opacity ?? 1;
  if (sw.kind === 'line') {
    g.strokeStyle = sw.color; g.lineWidth = 2.2 * s; g.lineCap = 'round';
    if (sw.dashed) g.setLineDash([3 * s, 2.5 * s]);
    g.beginPath(); g.moveTo(cx - 7 * s, cy); g.lineTo(cx + 7 * s, cy); g.stroke();
  } else if (sw.kind === 'halo') {
    // as a two-colour halo draws it: the atom, a dark inner line, the coloured ring
    g.beginPath(); g.arc(cx, cy, 3.6 * s, 0, Math.PI * 2); g.fillStyle = dark ? '#5b636d' : '#c2c8cf'; g.fill();
    g.beginPath(); g.arc(cx, cy, 4.4 * s, 0, Math.PI * 2); g.strokeStyle = dark ? '#000000' : '#14171b'; g.lineWidth = 1.1 * s; g.stroke();
    g.beginPath(); g.arc(cx, cy, 5.9 * s, 0, Math.PI * 2); g.strokeStyle = sw.color; g.lineWidth = 2 * s; g.stroke();
  } else {
    g.beginPath(); g.arc(cx, cy, 5 * s, 0, Math.PI * 2); g.fillStyle = sw.color; g.fill();
    g.lineWidth = 1 * s; g.strokeStyle = t.chipEdge; g.stroke();
  }
  g.restore();
}

/** Measure (and optionally draw) the box of overlay legend rows [{label, swatch}]; returns {w, h} (null without rows). */
function rowsBox(g, items, { scale: s, font, dark, x = 0, y = 0, draw = false, maxWidth = 240, maxRows = 12 }) {
  const shown = (items ?? []).slice(0, maxRows);
  if (!shown.length) return null;
  const t = theme(dark);
  const pad = 8 * s, rowH = 18 * s, sw = 14 * s, gap = 6 * s;
  const more = (items?.length ?? 0) - shown.length;
  g.font = `500 ${11 * s}px ${font}`;
  const maxText = maxWidth * s - sw - gap - 2 * pad;
  const labels = shown.map((it) => fitText(g, it.label, maxText));
  if (more > 0) labels.push(`+${more} more`);
  const w = sw + gap + Math.max(...labels.map((l) => g.measureText(l).width), 10 * s) + 2 * pad;
  const h = labels.length * rowH + 2 * pad - 4 * s;
  if (!draw) return { w, h };
  roundRect(g, x, y, w, h, 8 * s); g.fillStyle = t.panel; g.fill(); g.strokeStyle = t.line; g.lineWidth = 1 * s; g.stroke();
  g.textAlign = 'left'; g.textBaseline = 'middle';
  labels.forEach((label, k) => {
    const cy = y + pad + k * rowH + rowH / 2 - 2 * s;
    if (k < shown.length) drawSwatch(g, shown[k].swatch ?? {}, x + pad + sw / 2, cy, s, t, dark);
    g.font = `500 ${11 * s}px ${font}`;
    g.fillStyle = k < shown.length ? t.fg : t.muted;
    g.fillText(label, x + pad + sw + gap, cy);
  });
  return { w, h };
}

/** Measure (and optionally draw) the scale bar; returns {w, h} or null when no sensible length fits. */
function scaleBox(g, pxPerA, { scale: s, font, dark, x = 0, y = 0, draw = false }) {
  if (!(pxPerA > 0) || !Number.isFinite(pxPerA)) return null;
  const len = niceLength((140 * s) / pxPerA);
  if (!len) return null;
  const barPx = len * pxPerA;
  if (barPx < 24 * s) return null;
  const t = theme(dark);
  const pad = 8 * s;
  const label = `${len >= 1 ? len : +len.toPrecision(2)} Å`;
  g.font = `600 ${11 * s}px ${font}`;
  const w = Math.max(barPx, g.measureText(label).width) + 2 * pad;
  const h = pad + 13 * s + 8 * s + pad * 0.8;
  if (!draw) return { w, h };
  roundRect(g, x, y, w, h, 8 * s); g.fillStyle = t.panel; g.fill(); g.strokeStyle = t.line; g.lineWidth = 1 * s; g.stroke();
  g.fillStyle = t.fg; g.textAlign = 'center'; g.textBaseline = 'top';
  g.fillText(label, x + w / 2, y + pad);
  const by = y + pad + 17 * s, bx = x + (w - barPx) / 2;
  g.strokeStyle = t.fg; g.lineWidth = 2 * s; g.lineCap = 'butt';
  g.beginPath();
  g.moveTo(bx, by - 4 * s); g.lineTo(bx, by + 1 * s); g.lineTo(bx + barPx, by + 1 * s); g.lineTo(bx + barPx, by - 4 * s);
  g.stroke();
  return { w, h };
}

/**
 * Draw the scale bar, the colour legend and the overlay legend rows stacked in the bottom-right corner
 * (in that order, upwards).
 * opts = { legend: info|null, items: [{label, swatch: {kind: 'halo'|'dot'|'line', color, opacity, dashed}}],
 *          pxPerAngstrom: number|null, width, height, scale, dark, font, right = 16, bottom = 16 (CSS px insets) }
 * Returns the height used (in canvas pixels).
 */
export function drawLegends(g, { legend = null, items = [], pxPerAngstrom = null, width, height, scale = 1, dark = false, font = 'system-ui, sans-serif', right = 16, bottom = 16 } = {}) {
  const s = scale;
  const opt = { scale: s, font, dark };
  g.save();
  let yBottom = height - bottom * s;
  const xRight = width - right * s;
  const used0 = yBottom;
  if (pxPerAngstrom) {
    const m = scaleBox(g, pxPerAngstrom, opt);
    if (m) { scaleBox(g, pxPerAngstrom, { ...opt, draw: true, x: xRight - m.w, y: yBottom - m.h }); yBottom -= m.h + 8 * s; }
  }
  if (legend && (legend.kind === 'gradient' || legend.items?.length)) {
    const m = colorBox(g, legend, opt);
    if (yBottom - m.h > 0) colorBox(g, legend, { ...opt, draw: true, x: xRight - m.w, y: yBottom - m.h });
    yBottom -= m.h + 8 * s;
  }
  const m = items?.length ? rowsBox(g, items, opt) : null;
  if (m) {
    if (yBottom - m.h > 0) rowsBox(g, items, { ...opt, draw: true, x: xRight - m.w, y: yBottom - m.h });
    yBottom -= m.h + 8 * s;
  }
  g.restore();
  return used0 - yBottom;
}
