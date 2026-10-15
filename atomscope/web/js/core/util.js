/** Small math + misc helpers shared across modules. */

export const DEG = Math.PI / 180;

export function uid(prefix = 'id') {
  const a = new Uint8Array(5);
  (globalThis.crypto ?? { getRandomValues: (x) => x.map(() => (Math.random() * 256) | 0) }).getRandomValues(a);
  return prefix + '_' + [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;

export function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
export function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
export function norm(a) { return Math.hypot(a[0], a[1], a[2]); }
export function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
export function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
export function scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }

/** Lattice parameters (Å, degrees) -> 3x3 row-vector cell (a along x, b in xy plane). */
export function cellFromParams(a, b, c, alpha = 90, beta = 90, gamma = 90) {
  const ca = Math.cos(alpha * DEG), cb = Math.cos(beta * DEG), cg = Math.cos(gamma * DEG);
  const sg = Math.sin(gamma * DEG);
  const cx = c * cb;
  const cy = c * (ca - cb * cg) / sg;
  const cz = Math.sqrt(Math.max(0, c * c - cx * cx - cy * cy));
  const r = (v) => (Math.abs(v) < 1e-12 ? 0 : v);
  return [[r(a), 0, 0], [r(b * cg), r(b * sg), 0], [r(cx), r(cy), r(cz)]];
}

export function cellParams(cell) {
  const [A, B, C] = cell;
  const a = norm(A), b = norm(B), c = norm(C);
  const ang = (u, v, nu, nv) => Math.acos(clamp(dot(u, v) / (nu * nv), -1, 1)) / DEG;
  return { a, b, c, alpha: ang(B, C, b, c), beta: ang(A, C, a, c), gamma: ang(A, B, a, b) };
}

export function det3(m) {
  return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
}

export function inv3(m) {
  const d = det3(m);
  if (Math.abs(d) < 1e-12) throw new Error('Singular cell matrix');
  const [[a, b, c], [d1, e, f], [g, h, i]] = m;
  return [
    [(e * i - f * h) / d, (c * h - b * i) / d, (b * f - c * e) / d],
    [(f * g - d1 * i) / d, (a * i - c * g) / d, (c * d1 - a * f) / d],
    [(d1 * h - e * g) / d, (b * g - a * h) / d, (a * e - b * d1) / d],
  ];
}

/** frac (row) · cell -> cartesian */
export function fracToCart(f, cell) {
  return [
    f[0] * cell[0][0] + f[1] * cell[1][0] + f[2] * cell[2][0],
    f[0] * cell[0][1] + f[1] * cell[1][1] + f[2] * cell[2][1],
    f[0] * cell[0][2] + f[1] * cell[1][2] + f[2] * cell[2][2],
  ];
}

/** cartesian -> frac using a precomputed inverse cell */
export function cartToFrac(p, inv) {
  return [
    p[0] * inv[0][0] + p[1] * inv[1][0] + p[2] * inv[2][0],
    p[0] * inv[0][1] + p[1] * inv[1][1] + p[2] * inv[2][1],
    p[0] * inv[0][2] + p[1] * inv[1][2] + p[2] * inv[2][2],
  ];
}

/** Debounced call with flush() (run now, returns fn's result), cancel() and pending(). */
export function debounce(fn, ms) {
  let t = null;
  const f = (...args) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...args); }, ms); };
  f.flush = (...args) => { clearTimeout(t); t = null; return fn(...args); };
  f.cancel = () => { clearTimeout(t); t = null; };
  f.pending = () => t != null;
  return f;
}

/** Keys that must never be merged or set from untrusted data (prototype pollution). */
export const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);

export function deepMerge(target, src) {
  if (!src || typeof src !== 'object') return target;
  for (const [k, v] of Object.entries(src)) {
    if (UNSAFE.has(k)) continue;
    const t = Object.hasOwn(target, k) ? target[k] : undefined;
    if (v && typeof v === 'object' && !Array.isArray(v) && t && typeof t === 'object' && !Array.isArray(t)) {
      deepMerge(t, v);
    } else {
      target[k] = Array.isArray(v) ? v.slice() : (v && typeof v === 'object' ? deepMerge({}, v) : v);
    }
  }
  return target;
}

export const deepClone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

export function getPath(obj, path) {
  const keys = String(path).split('.');
  if (keys.some((k) => UNSAFE.has(k))) return undefined;
  return keys.reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setPath(obj, path, value) {
  const keys = String(path).split('.');
  if (keys.some((k) => UNSAFE.has(k))) return;
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!Object.hasOwn(o, keys[i]) || o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys.at(-1)] = value;
}

export function formatNumber(x, digits = 3) {
  if (!Number.isFinite(x)) return '—';
  return Number(x.toFixed(digits)).toString();
}

export function relativeTime(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = (Date.now() - t) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.round(s / 86400)} d ago`;
  return new Date(t).toLocaleDateString();
}

export function formatBytes(n) {
  if (!(n > 0)) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** File-name-safe version of a name (NFKC turns subscript digits such as Au₅₅ into Au55). */
export const slug = (s) => String(s || 'untitled').normalize('NFKC').trim().replace(/[^\w一-鿿.-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60).replace(/[-.]+$/, '') || 'untitled';
