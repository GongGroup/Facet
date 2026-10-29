/**
 * Colour schemes. A scheme maps an atom to a CSS/hex colour:
 *   colorSchemes.register({ id, name, description, group?: 'Element'|'Per atom', colorFor(symbol, index, ctx),
 *                           legend?(ctx) => { colormap, min, max, label } })
 * ctx = { model, settings, cn (coordination numbers), zMin, zMax, n, nSrc, prop, propName, propMin, propMax }
 * computeColors() returns the colours with a `legend` property describing them (see below).
 */
import { element } from '../core/elements.js';

const registry = new Map();
export const colorSchemes = {
  register(s) { registry.set(s.id, { group: 'Element', ...s }); return () => registry.delete(s.id); },
  get: (id) => registry.get(id),
  list: () => [...registry.values()],
};

// ---- colour maths -----------------------------------------------------------------
export function hexToRgb(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const v = parseInt(h, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}
export function rgbToHex([r, g, b]) {
  const c = (x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
function rgbToHsl([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function hslToRgb([h, s, l]) {
  if (!s) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}
export const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** sRGB hex → OKLCH [L 0–1, C, h°] (Björn Ottosson's OKLab). */
export function hexToOklch(hex) {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, Math.hypot(A, B), (Math.atan2(B, A) * 180 / Math.PI + 360) % 360];
}
function oklchToLinear(L, C, h) {
  const a = C * Math.cos(h * Math.PI / 180), b = C * Math.sin(h * Math.PI / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
}
/** OKLCH → sRGB hex; chroma is reduced until the colour fits the sRGB gamut. */
export function oklchToHex(L, C, h) {
  const fits = (c) => c.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  let rgb = oklchToLinear(L, C, h);
  if (!fits(rgb)) {
    let lo = 0, hi = C;
    for (let i = 0; i < 20; i++) { const mid = (lo + hi) / 2; if (fits(oklchToLinear(L, mid, h))) lo = mid; else hi = mid; }
    rgb = oklchToLinear(L, lo, h);
  }
  return rgbToHex(rgb.map((v) => { v = Math.min(1, Math.max(0, v)); return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; }));
}

export function viridis(t) {
  t = Math.min(1, Math.max(0, t));
  const c = [[0.2777273272234177, 0.005407344544966578, 0.3340998053353061], [0.1050930431085774, 1.404613529898575, 1.384590162594685],
    [-0.3308618287255563, 0.214847559468213, 0.09509516302823659], [-4.634230498983486, -5.799100973351585, -19.33244095627987],
    [6.228269936347081, 14.17993336680509, 56.69055260068105], [4.776384997670288, -13.74514537774601, -65.35303263337234],
    [-5.435455855934631, 4.645852612178535, 26.3124352495832]];
  return [0, 1, 2].map((k) => c[0][k] + t * (c[1][k] + t * (c[2][k] + t * (c[3][k] + t * (c[4][k] + t * (c[5][k] + t * c[6][k]))))));
}
export function turbo(x) {
  x = Math.min(1, Math.max(0, x));
  const v4 = [1, x, x * x, x * x * x], v2 = [v4[2] * v4[2], v4[3] * v4[2]];
  const d4 = (a) => a[0] * v4[0] + a[1] * v4[1] + a[2] * v4[2] + a[3] * v4[3];
  return [
    d4([0.13572138, 4.6153926, -42.66032258, 132.13108234]) + (-152.94239396 * v2[0] + 59.28637943 * v2[1]),
    d4([0.09140261, 2.19418839, 4.84296658, -14.18503333]) + (4.27729857 * v2[0] + 2.82956604 * v2[1]),
    d4([0.1066733, 12.64194608, -60.58204836, 110.36276771]) + (-89.90310912 * v2[0] + 27.34824973 * v2[1]),
  ].map((v) => Math.min(1, Math.max(0, v)));
}
function coolwarm(t) {
  t = Math.min(1, Math.max(0, t));
  const a = [0.230, 0.299, 0.754], m = [0.865, 0.865, 0.865], b = [0.706, 0.016, 0.150];
  return t < 0.5 ? mix(a, m, t * 2) : mix(m, b, (t - 0.5) * 2);
}
export const COLORMAPS = { viridis, turbo, coolwarm };

const CPK_CLASSIC = { H: '#FFFFFF', C: '#C8C8C8', N: '#8F8FFF', O: '#F00000', S: '#FFC832', P: '#FFA500', Cl: '#00FF00', B: '#00FF00', Fe: '#FFA500', Na: '#0000FF', Mg: '#228B22', Ca: '#808090', Zn: '#A52A2A', Cu: '#A52A2A', Ni: '#A52A2A', Br: '#A52A2A', F: '#DAA520', Si: '#DAA520', Au: '#DAA520', Ag: '#808090', I: '#A020F0', Li: '#B22222', Ba: '#FFA500', Mn: '#808090', Al: '#808090', Cr: '#808090', K: '#FF1493' };

/**
 * The Modern palette in OKLCH [L, C, h]: the familiar CPK hues (red O, blue N, grey C, white H, yellow S…)
 * at even, moderate chroma, with lightness tiers by role so neighbours stay apart. Elements not listed
 * follow their Jmol hue at the same chroma. Morandi, Vivid, Soft and Greyscale are derived from it.
 */
const MODERN = {
  H: [0.955, 0.004, 95], C: [0.56, 0.012, 255], N: [0.58, 0.15, 264], O: [0.64, 0.19, 27], F: [0.86, 0.12, 128],
  Cl: [0.74, 0.15, 145], Br: [0.52, 0.13, 32], I: [0.5, 0.15, 318], S: [0.87, 0.15, 98], P: [0.75, 0.15, 58],
  Se: [0.77, 0.14, 72], Te: [0.66, 0.12, 62], B: [0.79, 0.08, 22], Si: [0.8, 0.065, 72], As: [0.66, 0.12, 305], Sb: [0.6, 0.1, 305],
  Li: [0.74, 0.12, 305], Na: [0.64, 0.14, 300], K: [0.56, 0.14, 298], Rb: [0.5, 0.13, 296], Cs: [0.45, 0.12, 294],
  Be: [0.86, 0.13, 122], Mg: [0.78, 0.15, 135], Ca: [0.72, 0.12, 160], Sr: [0.68, 0.11, 175], Ba: [0.62, 0.1, 160],
  Al: [0.77, 0.035, 20], Ga: [0.7, 0.055, 20], In: [0.66, 0.055, 20], Sn: [0.62, 0.035, 200], Pb: [0.48, 0.02, 270], Bi: [0.56, 0.13, 318],
  Ge: [0.64, 0.04, 200], Sc: [0.88, 0.005, 250],
  Ti: [0.73, 0.03, 250], V: [0.69, 0.025, 285], Cr: [0.67, 0.065, 268], Mn: [0.62, 0.1, 302], Fe: [0.65, 0.145, 45], Co: [0.75, 0.1, 4],
  Ni: [0.75, 0.13, 145], Cu: [0.67, 0.115, 62], Zn: [0.63, 0.065, 280],
  Y: [0.83, 0.06, 196], Zr: [0.8, 0.06, 196], Nb: [0.74, 0.07, 205], Mo: [0.68, 0.085, 200], Tc: [0.63, 0.085, 200],
  Ru: [0.6, 0.085, 200], Rh: [0.57, 0.085, 220], Pd: [0.54, 0.085, 232], Ag: [0.83, 0.006, 250], Cd: [0.88, 0.1, 90],
  Hf: [0.74, 0.08, 240], Ta: [0.68, 0.1, 240], W: [0.63, 0.115, 242], Re: [0.58, 0.1, 240], Os: [0.54, 0.09, 238],
  Ir: [0.5, 0.09, 238], Pt: [0.85, 0.018, 270], Au: [0.83, 0.15, 88], Hg: [0.8, 0.03, 280], Tl: [0.62, 0.04, 20],
  He: [0.95, 0.03, 200], Ne: [0.86, 0.06, 220], Ar: [0.79, 0.07, 215], Kr: [0.72, 0.08, 215], Xe: [0.65, 0.09, 220],
};
const modernCache = new Map();
function modernLch(s) {
  if (MODERN[s]) return MODERN[s];
  if (!modernCache.has(s)) {
    const [L, C, h] = hexToOklch(element(s).jmol);
    modernCache.set(s, [0.5 + 0.4 * Math.min(1, Math.max(0, (L - 0.35) / 0.6)), Math.min(C * 0.6, 0.11), h]);
  }
  return modernCache.get(s);
}
/** A scheme from the Modern palette: `f([L, C, h]) => [L, C, h]` reshapes each colour. */
const fromModern = (f) => (s) => oklchToHex(...f(modernLch(s)));

// ---- built-in schemes -----------------------------------------------------------------
colorSchemes.register({ id: 'jmol', name: 'Jmol', description: 'The common CPK-derived palette used by Jmol and ASE', colorFor: (s) => element(s).jmol });
colorSchemes.register({ id: 'vesta', name: 'VESTA', description: 'Colours familiar from VESTA crystal drawings', colorFor: (s) => element(s).vesta });
colorSchemes.register({ id: 'cpk', name: 'CPK classic', description: 'Corey–Pauling–Koltun / RasMol', colorFor: (s) => CPK_CLASSIC[s] ?? '#FF1493' });
colorSchemes.register({
  id: 'pastel', name: 'Pastel', description: 'Softened Jmol colours for illustrations',
  colorFor: (s) => { const [h, sat, l] = rgbToHsl(hexToRgb(element(s).jmol)); return rgbToHex(hslToRgb([h, sat * 0.65, 0.62 + l * 0.28])); },
});
colorSchemes.register({
  id: 'muted', name: 'Muted', description: 'Desaturated, print-friendly colours',
  colorFor: (s) => { const [h, sat, l] = rgbToHsl(hexToRgb(element(s).jmol)); return rgbToHex(hslToRgb([h, sat * 0.45, 0.32 + l * 0.42])); },
});
colorSchemes.register({ id: 'modern', name: 'Modern', description: 'Familiar element hues at even, moderate saturation — clean on white and on dark', colorFor: fromModern((c) => c) });
colorSchemes.register({
  id: 'morandi', name: 'Morandi', description: 'Dusty, greyed-down Morandi tones that stay distinguishable',
  colorFor: fromModern(([L, C, h]) => [0.55 + (L - 0.5) * 0.6, Math.min(C * 0.45, 0.06), h]),
});
colorSchemes.register({
  id: 'vivid', name: 'Vivid', description: 'Bold, saturated poster colours with the familiar hues',
  colorFor: fromModern(([L, C, h]) => [0.53 + (L - 0.5) * 0.9, Math.min(C * 1.35, 0.21), h]),
});
colorSchemes.register({
  id: 'soft', name: 'Soft pastel', description: 'Light, gentle pastels for flat illustration',
  colorFor: fromModern(([L, C, h]) => [Math.min(0.96, 0.64 + L * 0.34), Math.min(C * 0.62, 0.1), h]),
});
colorSchemes.register({
  id: 'greyscale', name: 'Greyscale', description: 'Light greys in the Modern lightness order — for line art and black-and-white print',
  colorFor: fromModern(([L]) => [0.62 + 0.36 * L, 0, 0]),
});
colorSchemes.register({ id: 'mono', name: 'Single colour', description: 'Every atom in one colour (set below)', colorFor: (s, i, ctx) => ctx.settings.monoColor ?? '#c9ced6' });
colorSchemes.register({
  id: 'index', group: 'Per atom', name: 'Index (turbo)', description: 'Rainbow by atom index — handy for tracking order',
  colorFor: (s, i, ctx) => rgbToHex(turbo(ctx.nSrc > 1 ? ctx.srcIndex(i) / (ctx.nSrc - 1) : 0.5)),
  legend: (ctx) => ({ colormap: 'turbo', min: 0, max: Math.max(0, ctx.nSrc - 1), label: 'Atom index', integer: true }),
});
colorSchemes.register({
  id: 'height', group: 'Per atom', name: 'Height (viridis)', description: 'Colour by position along the screen-independent z axis',
  colorFor: (s, i, ctx) => rgbToHex(viridis((ctx.z(i) - ctx.zMin) / Math.max(1e-6, ctx.zMax - ctx.zMin))),
  legend: (ctx) => ({ colormap: 'viridis', min: ctx.zMin, max: ctx.zMax, label: 'Height z (Å)' }),
});
colorSchemes.register({
  id: 'coordination', group: 'Per atom', name: 'Coordination number', description: 'Colour by number of bonds (CN)',
  colorFor: (s, i, ctx) => { const cn = ctx.cn?.[i] ?? 0; return rgbToHex(turbo(Math.min(1, cn / 12))); },
  legend: () => ({ colormap: 'turbo', min: 0, max: 12, label: 'Coordination number', integer: true }),
});
colorSchemes.register({
  id: 'property', group: 'Per atom', name: 'Property (coolwarm)', description: 'Colour by a numeric per-atom property from the file (charges, forces…)',
  available: (structure) => Object.entries(structure?.props ?? {}).some(([, v]) => Array.isArray(v) && typeof v[0] === 'number'),
  colorFor: (s, i, ctx) => {
    const v = ctx.prop?.[ctx.srcIndex(i)];
    if (!Number.isFinite(v)) return '#9aa0a6';
    const span = Math.max(Math.abs(ctx.propMin), Math.abs(ctx.propMax)) || 1;
    return rgbToHex(coolwarm(0.5 + v / span / 2));
  },
  legend: (ctx) => {
    if (!ctx.prop) return null;
    const span = Math.max(Math.abs(ctx.propMin), Math.abs(ctx.propMax)) || 1;
    return { colormap: 'coolwarm', min: -span, max: span, label: ctx.propName ?? 'Property' };
  },
});

function finiteRange(arr) {
  let lo = Infinity, hi = -Infinity;
  for (const v of arr ?? []) if (typeof v === 'number' && Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return Number.isFinite(lo) ? [lo, hi] : [0, 0];
}

/**
 * Compute linear-space colours (Float32Array 3n, sRGB → linear) for every displayed atom.
 * The array carries a `legend` property:
 *   per-atom schemes → { kind: 'gradient', scheme, colormap, min, max, label, integer?, zMin, zMax, propMin, propMax }
 *   element schemes  → { kind: 'elements', scheme, items: [{ symbol, color }] }
 */
export function computeColors(model, structure, styleSettings, cn) {
  const scheme = registry.get(styleSettings.colorScheme) ?? registry.get('jmol');
  const n = model.n;
  let zMin = Infinity, zMax = -Infinity;
  for (let i = 0; i < n; i++) { const z = model.positions[3 * i + 2]; if (z < zMin) zMin = z; if (z > zMax) zMax = z; }
  if (!n) zMin = zMax = 0;
  const props = structure?.props ?? {};
  const propName = styleSettings.property ?? Object.keys(props).find((k) => Array.isArray(props[k]) && typeof props[k][0] === 'number');
  const prop = propName && Array.isArray(props[propName]) ? props[propName] : null;
  const [propMin, propMax] = finiteRange(prop);
  const ctx = {
    model, settings: styleSettings, cn, n, nSrc: structure?.length ?? n, zMin, zMax, prop, propName: prop ? propName : null,
    propMin, propMax,
    srcIndex: (i) => model.src[i], z: (i) => model.positions[3 * i + 2],
  };
  const overrides = styleSettings.colorOverrides ?? {};
  const out = new Float32Array(3 * n);
  const cache = new Map();
  const perAtom = scheme.group === 'Per atom';
  for (let i = 0; i < n; i++) {
    const sym = model.symbols[i];
    let hex = overrides[sym];
    if (!hex) {
      if (!perAtom && cache.has(sym)) hex = cache.get(sym);
      else { hex = scheme.colorFor(sym, i, ctx); if (!perAtom) cache.set(sym, hex); }
    }
    const rgb = hexToRgb(hex);
    out[3 * i] = srgbToLinear(rgb[0]); out[3 * i + 1] = srgbToLinear(rgb[1]); out[3 * i + 2] = srgbToLinear(rgb[2]);
    if (!perAtom && !cache.has(sym)) cache.set(sym, hex);
  }
  let legend = null;
  if (perAtom) {
    let info = null;
    try { info = scheme.legend?.(ctx) ?? null; } catch { info = null; }
    if (info) legend = { kind: 'gradient', scheme: scheme.id, colormap: info.colormap ?? 'viridis', min: info.min ?? 0, max: info.max ?? 1, label: info.label ?? scheme.name, integer: !!info.integer, zMin, zMax, propMin, propMax };
  } else {
    legend = { kind: 'elements', scheme: scheme.id, items: [...cache].map(([symbol, color]) => ({ symbol, color })) };
  }
  out.legend = legend;
  return out;
}

export function elementColorHex(sym, styleSettings) {
  const o = styleSettings.colorOverrides?.[sym];
  if (o) return o;
  const scheme = registry.get(styleSettings.colorScheme);
  if (!scheme || scheme.group === 'Per atom') return element(sym).jmol;
  return scheme.colorFor(sym, 0, { settings: styleSettings });
}

export const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
