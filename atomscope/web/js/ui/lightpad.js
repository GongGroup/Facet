/**
 * Light pad: a sphere seen from the viewer, lit analytically by the current rig, with one draggable
 * dot per light (key, fill, rim and the extra lights).
 *
 * Mapping (rig frame = camera frame while lights follow the camera; see render/lighting.js):
 *   a light in front sits over the point of the sphere it lights most (orthographic projection);
 *   a light from behind sits in the ring around the sphere, further out the more it comes from behind.
 *
 *   lightPad({ get, set }) → element with .redraw()
 *     get()            → the lighting settings (scene.lighting)
 *     set(path, value) → write a value under lighting, e.g. set('key.azimuth', -40) or set('extra.0.intensity', 2)
 *   litSphereURL(lighting, size) → PNG data URL of the lit sphere alone (used by the preset cards)
 */
import { h } from './dom.js';

const DEG = Math.PI / 180;
const MAX_INTENSITY = 6;
const HINT = 'Drag to move a light · scroll to change its brightness';

// ------------------------------------------------------------------ colour and direction helpers
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSRGB = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
function hexLin(hex, fallback = [1, 1, 1]) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!m) return fallback;
  const x = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1];
  return [0, 2, 4].map((i) => toLin(parseInt(x.slice(i, i + 2), 16) / 255));
}
const luma = (hex) => { const [r, g, b] = hexLin(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
/** Same convention as lighting.js: azimuth 0° = from the viewer (+z), +90° = from the right (+x). */
const dirOf = (az, el) => [Math.cos(el * DEG) * Math.sin(az * DEG), Math.sin(el * DEG), Math.cos(el * DEG) * Math.cos(az * DEG)];
const anglesOf = ([x, y, z]) => ({ azimuth: Math.atan2(x, z) / DEG, elevation: Math.asin(Math.max(-1, Math.min(1, y))) / DEG });
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Khronos PBR Neutral tone mapping (close to the default 'neutral' of the 3D view). */
function neutral(c) {
  let [r, g, b] = c;
  const x = Math.min(r, g, b), off = x < 0.08 ? x - 6.25 * x * x : 0.04;
  r -= off; g -= off; b -= off;
  const peak = Math.max(r, g, b), start = 0.76;
  if (peak < start) return [r, g, b];
  const d = 1 - start, np = 1 - (d * d) / (peak + d - start), k = np / peak;
  r *= k; g *= k; b *= k;
  const t = 1 - 1 / (0.15 * (peak - np) + 1);
  return [r + (np - r) * t, g + (np - g) * t, b + (np - b) * t];
}

/**
 * Rough radiance of each environment map for the preview: a sky gradient by height plus bright
 * lobes where the softboxes / sun are (directions in the environment's own frame).
 */
const ENV_PREVIEW = {
  room: { top: [1.05, 1.05, 1.05], mid: [0.72, 0.72, 0.72], bot: [0.4, 0.4, 0.4], lobes: [[0, 75, [1, 1, 1], 1.6, 6]] },
  studio: { top: [0.34, 0.36, 0.39], mid: [0.2, 0.21, 0.23], bot: [0.12, 0.12, 0.13], lobes: [[-40, 35, [1, 0.95, 0.9], 4, 26], [55, 8, [0.88, 0.92, 1], 1.4, 26], [0, 82, [1, 1, 1], 1.6, 18], [160, 25, [1, 1, 1], 3, 30]] },
  sky: { top: [0.5, 0.68, 0.98], mid: [1.05, 1.08, 1.12], bot: [0.3, 0.25, 0.2], lobes: [[-30, 55, [1, 0.94, 0.82], 3.5, 60]] },
  sunset: { top: [0.07, 0.06, 0.24], mid: [1.1, 0.45, 0.16], bot: [0.04, 0.03, 0.05], lobes: [[-62, 8, [1, 0.55, 0.25], 6, 36]] },
  dark: { top: [0.006, 0.006, 0.007], mid: [0.004, 0.004, 0.004], bot: [0.002, 0.002, 0.002], lobes: [[-72, 22, [1, 1, 1], 3.2, 30], [160, 12, [0.72, 0.8, 1], 2.6, 30]] },
};

/** Prepared lights for the shader loop. */
function rig(L) {
  const lights = [];
  const add = (p) => { if (p && (p.intensity ?? 0) > 0) lights.push({ d: dirOf(p.azimuth ?? 0, p.elevation ?? 0), c: hexLin(p.color).map((v) => v * p.intensity) }); };
  add(L.key); add(L.fill); add(L.rim); (L.extra ?? []).forEach(add);
  const amb = hexLin(L.ambient?.color).map((v) => v * (L.ambient?.intensity ?? 0));
  const hi = L.hemi?.intensity ?? 0;
  const sky = hexLin(L.hemi?.sky).map((v) => v * hi), ground = hexLin(L.hemi?.ground, [0.2, 0.2, 0.2]).map((v) => v * hi);
  let env = null;
  if (L.env?.enabled && (L.env.intensity ?? 0) > 0) {
    const e = ENV_PREVIEW[L.env.map] ?? ENV_PREVIEW.room, k = L.env.intensity, rot = L.env.rotation ?? 0;
    env = { k, top: e.top, mid: e.mid, bot: e.bot, lobes: e.lobes.map(([az, el, c, p, n]) => ({ d: dirOf(az + rot, el), c, p, n })) };
  }
  return { lights, amb, sky, ground, env, exposure: L.exposure ?? 1 };
}
function envAt(env, v, spec) {
  const y = v[1];
  let c = y >= 0 ? lerp3(env.mid, env.top, Math.pow(y, 0.6)) : lerp3(env.mid, env.bot, Math.min(1, -y * 3));
  for (const lo of env.lobes) {
    const t = Math.max(0, dot3(v, lo.d));
    const w = spec ? lo.p * Math.pow(t, lo.n) : lo.p * 0.14 * t * t;
    c = [c[0] + lo.c[0] * w, c[1] + lo.c[1] * w, c[2] + lo.c[2] * w];
  }
  return c;
}

/** Shade one sphere of radius r (device px) into an ImageData. */
function shadeSphere(L, r) {
  const R = rig(L), size = Math.ceil(2 * r) + 2, img = new ImageData(size, size), px = img.data;
  const albedo = 0.5, ks = 0.35, shin = 48, c0 = size / 2;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = (i + 0.5 - c0) / r, y = -(j + 0.5 - c0) / r, q = x * x + y * y;
      const cover = Math.max(0, Math.min(1, (1 - Math.sqrt(q)) * r + 0.5));
      if (cover <= 0) continue;
      const z = Math.sqrt(Math.max(0, 1 - q)), n = [x, y, z];
      let dr = 0, dg = 0, db = 0, sr = 0, sg = 0, sb = 0;
      for (const l of R.lights) {
        const nl = dot3(n, l.d);
        if (nl <= 0) continue;
        const hv = [l.d[0], l.d[1], l.d[2] + 1], hn = Math.hypot(...hv);
        const s = ks * Math.pow(Math.max(0, dot3(n, hv) / hn), shin) * nl;
        dr += l.c[0] * nl; dg += l.c[1] * nl; db += l.c[2] * nl;
        sr += l.c[0] * s; sg += l.c[1] * s; sb += l.c[2] * s;
      }
      const t = 0.5 + 0.5 * y;
      dr = (dr + R.amb[0] + R.ground[0] + (R.sky[0] - R.ground[0]) * t) / Math.PI;
      dg = (dg + R.amb[1] + R.ground[1] + (R.sky[1] - R.ground[1]) * t) / Math.PI;
      db = (db + R.amb[2] + R.ground[2] + (R.sky[2] - R.ground[2]) * t) / Math.PI;
      if (R.env) {
        const ed = envAt(R.env, n, false);
        dr += ed[0] * R.env.k; dg += ed[1] * R.env.k; db += ed[2] * R.env.k;
        const refl = [2 * z * x, 2 * z * y, 2 * z * z - 1];            // reflect the view ray (0,0,1)
        const F = 0.05 + 0.5 * Math.pow(1 - z, 5), es = envAt(R.env, refl, true);
        sr += es[0] * R.env.k * F; sg += es[1] * R.env.k * F; sb += es[2] * R.env.k * F;
      }
      const e = R.exposure;
      const c = neutral([(albedo * dr + sr) * e, (albedo * dg + sg) * e, (albedo * db + sb) * e]);
      const o = 4 * (j * size + i);
      px[o] = 255 * toSRGB(Math.max(0, Math.min(1, c[0])));
      px[o + 1] = 255 * toSRGB(Math.max(0, Math.min(1, c[1])));
      px[o + 2] = 255 * toSRGB(Math.max(0, Math.min(1, c[2])));
      px[o + 3] = 255 * cover;
    }
  }
  return img;
}

const thumbCache = new Map();
/** PNG data URL of the lit sphere (CSS size `size`, rendered at the screen's pixel ratio). */
export function litSphereURL(lighting, size = 40) {
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const key = `${size}|${dpr}|${JSON.stringify(lighting)}`;
  if (thumbCache.has(key)) return thumbCache.get(key);
  const img = shadeSphere(lighting, (size * dpr) / 2 - 1);
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d').putImageData(img, 0, 0);
  let url = '';
  try { url = c.toDataURL('image/png'); } catch { /* canvas blocked */ }
  if (thumbCache.size > 64) thumbCache.clear();
  thumbCache.set(key, url);
  return url;
}

// ------------------------------------------------------------------ the pad
/** The lights of a rig as pad entries: {id, name, short, p}. */
function entries(L) {
  const out = [
    { id: 'key', name: 'Key', short: 'K', p: L.key ?? {} },
    { id: 'fill', name: 'Fill', short: 'F', p: L.fill ?? {} },
    { id: 'rim', name: 'Rim', short: 'R', p: L.rim ?? {} },
  ];
  (L.extra ?? []).forEach((p, i) => out.push({ id: `extra.${i}`, name: `Light ${i + 1}`, short: String(i + 1), p: p ?? {} }));
  return out;
}

export function lightPad({ get, set, onSelect }) {
  const canvas = h('canvas.lp-canvas', { tabindex: '0', role: 'application', 'data-tip': HINT,
    'aria-label': 'Light directions. Drag a dot to move a light, scroll on it to change its brightness. Keyboard: arrow keys move the selected light, plus and minus change its brightness, [ and ] pick another light.' });
  const legend = h('div.lp-legend', { role: 'listbox', 'aria-label': 'Lights' });
  const status = h('div.lp-status', { 'aria-live': 'polite' });
  const root = h('div.lightpad', h('div.lp-stage', canvas), h('div.lp-side', legend), status);
  let selected = 'key', drag = null, hover = null, pending = null, raf = 0, geo = null;

  const css = (name, fb) => getComputedStyle(root).getPropertyValue(name).trim() || fb;
  const find = (id) => entries(get()).find((e) => e.id === id) ?? entries(get())[0];

  /** Screen position of a direction, and the inverse. */
  const toXY = (d) => {
    const { cx, cy, rs, rr } = geo, len = Math.hypot(d[0], d[1]);
    const ux = len > 1e-9 ? d[0] / len : 0, uy = len > 1e-9 ? d[1] / len : 1;   // straight behind: top of the ring
    const r = d[2] >= 0 ? rs * len : rs + (rr - rs) * (Math.acos(Math.max(-1, Math.min(1, d[2]))) / DEG - 90) / 90;
    return [cx + ux * r, cy - uy * r];
  };
  const fromXY = (x, y) => {
    const { cx, cy, rs, rr } = geo, dx = x - cx, dy = cy - y, rho = Math.hypot(dx, dy);
    const ux = rho > 1e-9 ? dx / rho : 0, uy = rho > 1e-9 ? dy / rho : 1;
    const th = rho <= rs ? Math.asin(Math.min(1, rho / rs)) : (90 + 90 * Math.min(1, (rho - rs) / (rr - rs))) * DEG;
    return anglesOf([Math.sin(th) * ux, Math.sin(th) * uy, Math.cos(th)]);
  };

  function draw() {
    const w = canvas.clientWidth, hgt = canvas.clientHeight;
    if (!w || !hgt) return;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hgt * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hgt * dpr); }
    const rr = Math.min(w, hgt) / 2 - 14;
    geo = { cx: w / 2, cy: hgt / 2, rr, rs: rr * 0.62 };
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hgt);
    const L = get(), line = css('--line-strong', '#bcc4ce'), muted = css('--muted', '#5d6874'), accent = css('--accent', '#c9821a');
    const panel = css('--panel', '#f8f9fb'), fg2 = css('--fg-2', '#39414b');
    // ring for lights from behind
    g.save();
    g.beginPath(); g.arc(geo.cx, geo.cy, rr, 0, 2 * Math.PI); g.arc(geo.cx, geo.cy, geo.rs + 1, 0, 2 * Math.PI, true);
    g.fillStyle = css('--panel-3', '#e3e7ec'); g.globalAlpha = 0.55; g.fill('evenodd'); g.globalAlpha = 1;
    g.setLineDash([3, 4]); g.strokeStyle = line; g.lineWidth = 1;
    g.beginPath(); g.arc(geo.cx, geo.cy, rr, 0, 2 * Math.PI); g.stroke();
    g.setLineDash([]);
    g.fillStyle = muted; g.font = `500 9.5px ${css('--font-ui', 'sans-serif')}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('BEHIND', geo.cx, geo.cy + (rr + geo.rs) / 2 + 0.5);
    g.restore();
    // the lit sphere
    const img = shadeSphere(L, geo.rs * dpr);
    const off = document.createElement('canvas');
    off.width = img.width; off.height = img.height;
    off.getContext('2d').putImageData(img, 0, 0);
    g.drawImage(off, geo.cx - img.width / dpr / 2, geo.cy - img.height / dpr / 2, img.width / dpr, img.height / dpr);
    // light dots, back to front
    const list = entries(L).map((e) => ({ ...e, d: dirOf(e.p.azimuth ?? 0, e.p.elevation ?? 0) })).sort((a, b) => a.d[2] - b.d[2]);
    for (const e of list) {
      const [x, y] = toXY(e.d), on = (e.p.intensity ?? 0) > 0, r = e.id === 'key' ? 9 : 7.5;
      e.xy = [x, y];
      g.save();
      if (e.d[2] < 0) g.globalAlpha = 0.85;
      if (e.id === selected) { g.beginPath(); g.arc(x, y, r + 4, 0, 2 * Math.PI); g.strokeStyle = accent; g.lineWidth = 2.5; g.stroke(); }
      else if (e.id === hover) { g.beginPath(); g.arc(x, y, r + 3.5, 0, 2 * Math.PI); g.strokeStyle = line; g.lineWidth = 2; g.stroke(); }
      g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI);
      if (on) { g.fillStyle = e.p.color ?? '#ffffff'; g.fill(); g.strokeStyle = 'rgba(0,0,0,.55)'; g.lineWidth = 1.5; g.stroke(); g.beginPath(); g.arc(x, y, r - 1.6, 0, 2 * Math.PI); g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 1; g.stroke(); }
      else { g.globalAlpha *= 0.85; g.fillStyle = panel; g.fill(); g.globalAlpha = e.d[2] < 0 ? 0.85 : 1; g.setLineDash([2, 2]); g.strokeStyle = fg2; g.lineWidth = 1.3; g.stroke(); g.setLineDash([]); }
      g.fillStyle = on ? (luma(e.p.color ?? '#fff') > 0.35 ? '#14171b' : '#ffffff') : fg2;
      g.font = `600 ${e.id === 'key' ? 10 : 9}px ${css('--font-ui', 'sans-serif')}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(e.short, x, y + 0.5);
      g.restore();
    }
    geo.list = list;
    drawLegend(L);
  }

  let legendSig = '';
  function drawLegend(L) {
    const es = entries(L);
    if (!es.some((e) => e.id === selected)) selected = 'key';
    const s = es.find((e) => e.id === selected);
    status.textContent = s ? describe(s) : '';
    const sig = JSON.stringify([selected, es.map((e) => [e.id, e.p.color, e.p.intensity, Math.round(e.p.azimuth ?? 0), Math.round(e.p.elevation ?? 0)])]);
    if (sig === legendSig) return;
    legendSig = sig;
    legend.replaceChildren(...es.map((e) => {
      const on = (e.p.intensity ?? 0) > 0;
      const b = h('button.lp-item', { type: 'button', role: 'option', 'aria-selected': String(e.id === selected), 'data-tip': e.id.startsWith('extra') ? `Select ${e.name.toLowerCase()}` : `Select the ${e.name.toLowerCase()} light` },
        h('span.lp-dot', { style: { background: on ? (e.p.color ?? '#fff') : 'transparent' }, 'data-off': on ? null : 'true' }),
        h('span.lp-name', e.name), h('span.lp-val', on ? (+e.p.intensity).toFixed(2) : 'off'));
      b.addEventListener('click', () => { select(e.id); canvas.focus({ preventScroll: true }); });
      return b;
    }));
  }

  function select(id) { selected = id; onSelect?.(id); draw(); }

  const write = (id, vals) => { for (const [k, v] of Object.entries(vals)) set(`${id}.${k}`, v); draw(); };
  const flush = () => { raf = 0; if (pending) { const p = pending; pending = null; write(p.id, p.vals); } };
  const queue = (id, vals) => { pending = { id, vals }; if (!raf) raf = requestAnimationFrame(flush); };

  const local = (ev) => { const r = canvas.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  const hit = (x, y, slop) => {
    let best = null, bd = Infinity;
    for (const e of [...(geo?.list ?? [])].reverse()) {
      const d = Math.hypot(e.xy[0] - x, e.xy[1] - y);
      if (d < bd && d <= (e.id === 'key' ? 9 : 7.5) + slop) { best = e; bd = d; }
    }
    return best;
  };

  canvas.addEventListener('pointerdown', (ev) => {
    if (!geo || ev.button > 0) return;
    const [x, y] = local(ev), slop = ev.pointerType === 'touch' ? 14 : 6;
    let e = hit(x, y, slop);
    if (!e) {
      // inside the pad: move the selected light here (handy on touch screens)
      if (Math.hypot(x - geo.cx, y - geo.cy) > geo.rr + 6) return;
      e = find(selected);
      queue(e.id, roundAngles(fromXY(x, y)));
    }
    ev.preventDefault();
    selected = e.id; onSelect?.(e.id);
    drag = { id: e.id, pid: ev.pointerId };
    try { canvas.setPointerCapture?.(ev.pointerId); } catch { /* synthetic or already released pointer */ }
    canvas.classList.add('dragging');
    draw();
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!geo) return;
    const [x, y] = local(ev);
    if (drag && ev.pointerId === drag.pid) { queue(drag.id, roundAngles(fromXY(x, y))); return; }
    const e = hit(x, y, 4)?.id ?? null;
    canvas.style.cursor = e ? 'grab' : 'crosshair';
    if (e !== hover) { hover = e; draw(); }
  });
  const end = (ev) => {
    if (!drag || ev.pointerId !== drag.pid) return;
    drag = null; canvas.classList.remove('dragging');
    if (raf) { cancelAnimationFrame(raf); flush(); }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { if (hover) { hover = null; draw(); } });
  canvas.addEventListener('wheel', (ev) => {
    if (!geo) return;
    const [x, y] = local(ev);
    const e = hit(x, y, 6);
    if (!e) return;               // let the panel scroll
    ev.preventDefault();
    selected = e.id;
    const step = ev.shiftKey ? 0.02 : 0.1;
    bump(e.id, ev.deltaY < 0 ? step : -step);
  }, { passive: false });

  function bump(id, delta) {
    const cur = find(id).p.intensity ?? 0;
    write(id, { intensity: Math.round(Math.max(0, Math.min(MAX_INTENSITY, cur + delta)) * 100) / 100 });
  }

  canvas.addEventListener('keydown', (ev) => {
    const e = find(selected), p = e.p;
    let handled = true;
    const step = ev.shiftKey ? 1 : 5;
    if (ev.key === 'ArrowLeft') write(e.id, { azimuth: wrap180((p.azimuth ?? 0) - step) });
    else if (ev.key === 'ArrowRight') write(e.id, { azimuth: wrap180((p.azimuth ?? 0) + step) });
    else if (ev.key === 'ArrowUp') write(e.id, { elevation: Math.min(90, (p.elevation ?? 0) + step) });
    else if (ev.key === 'ArrowDown') write(e.id, { elevation: Math.max(-90, (p.elevation ?? 0) - step) });
    else if (ev.key === '+' || ev.key === '=' || ev.key === 'PageUp') bump(e.id, 0.1);
    else if (ev.key === '-' || ev.key === '_' || ev.key === 'PageDown') bump(e.id, -0.1);
    else if (ev.key === ']' || ev.key === '[') {
      const es = entries(get()), i = es.findIndex((x) => x.id === selected);
      select(es[(i + (ev.key === ']' ? 1 : es.length - 1)) % es.length].id);
    } else handled = false;
    if (handled) { ev.preventDefault(); ev.stopPropagation(); }
  });

  // redraw when the panel is laid out or resized, and when the interface theme changes
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (!root.isConnected) { ro.disconnect(); mo?.disconnect(); return; } draw(); }) : null;
  ro?.observe(canvas);
  const mo = typeof MutationObserver === 'function' ? new MutationObserver(() => { if (!root.isConnected) { mo.disconnect(); ro?.disconnect(); return; } draw(); }) : null;
  mo?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (!ro) requestAnimationFrame(draw);

  root.redraw = () => { if (!drag) draw(); };
  root.select = select;
  root.selected = () => selected;
  return root;
}

/** 'Key · 38° left · 34° up' — where a light comes from, in words. */
function describe(e) {
  const az = Math.round(wrap180(e.p.azimuth ?? 0)), el = Math.round(e.p.elevation ?? 0);
  const side = az === 0 ? 'front' : az === 180 || az === -180 ? 'behind' : `${Math.abs(az)}° ${az < 0 ? 'left' : 'right'}${Math.abs(az) > 90 ? ', behind' : ''}`;
  const off = (e.p.intensity ?? 0) > 0 ? '' : ' · off';
  return `${e.name} · ${side} · ${Math.abs(el)}° ${el < 0 ? 'down' : 'up'}${off}`;
}

const wrap180 = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
const roundAngles = ({ azimuth, elevation }) => ({ azimuth: Math.round(wrap180(azimuth)), elevation: Math.round(elevation) });
