/**
 * Analyses registry: everything listed under "Analyses" in the Structure panel.
 *   analyses.register({ id, name, description?, params?, run(structure, params, ctx) => result | Promise,
 *                       render?(result, el, ctx), auto?: bool | (structure) => bool, dependsOn?: [scene paths],
 *                       source?: 'built-in' | plugin name })
 * params use the builder schema: [{ name, type: 'int'|'float'|'string'|'element'|'bool'|'select',
 *   default, label?, min?, max?, step?, options? }] — `options` may be a function of the structure.
 * ctx = { app, scene, bondOptions, ui: { h, lineChart, kvTable, renderResult } } (ui only for render).
 * `auto` analyses run when the panel shows (results are cached per structure, params and the scene
 * values named in `dependsOn`); the others run when the user presses Run.
 */
import { rdf, coordinationStats } from './analysis.js';
import { getPath } from './util.js';

const registry = new Map();

export const analyses = {
  register(a) {
    if (!a?.id) throw new Error('analyses.register: missing id');
    if (typeof a.run !== 'function') throw new Error(`analyses.register: missing run() for “${a.id}”`);
    const entry = { name: a.id, description: '', params: [], source: 'plugin', ...a };
    registry.set(a.id, entry);
    return () => { if (registry.get(a.id) === entry) registry.delete(a.id); };
  },
  get: (id) => registry.get(id),
  list: () => [...registry.values()],
  /** Run analysis `id` with params (missing ones take their defaults). Always returns a Promise. */
  async run(id, structure, params = {}, ctx = {}) {
    const a = registry.get(id);
    if (!a) throw new Error(`Unknown analysis ${id}`);
    if (!structure) throw new Error('Load a structure first.');
    return a.run(structure, { ...defaultParams(a.params, structure), ...params }, ctx);
  },
};

/** Options of a select parameter as [{value, label}] (accepts strings, [value, label] pairs or objects). */
export function paramOptions(p, structure) {
  const raw = typeof p.options === 'function' ? p.options(structure) : p.options ?? [];
  return raw.map((o) => (Array.isArray(o) ? { value: o[0], label: o[1] ?? String(o[0]) } : typeof o === 'object' && o ? { value: o.value, label: o.label ?? String(o.value) } : { value: o, label: String(o) }));
}

/** {name: default} for a parameter schema. */
export function defaultParams(params = [], structure = null) {
  const out = {};
  for (const p of params ?? []) {
    if (!p?.name) continue;
    let v = p.default;
    if (v === undefined) {
      v = p.type === 'bool' ? false : p.type === 'select' ? paramOptions(p, structure)[0]?.value
        : p.type === 'int' || p.type === 'float' ? (p.min ?? 0) : p.type === 'element' ? 'C' : '';
    }
    out[p.name] = v;
  }
  return out;
}

// ------------------------------------------------------------------ structure keys (cache keys)
const serials = new WeakMap();
let nextSerial = 1;
/** A number unique to each Structure object (undo, redo and reopening make new objects). */
function serialOf(s) {
  let n = serials.get(s);
  if (n == null) { n = nextSerial++; serials.set(s, n); }
  return n;
}

const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
/**
 * Content digest of a structure as shown: symbols, current-frame positions, cell, periodicity and
 * frame count (two 32-bit hashes). Structures are edited in place, so the key cannot rely on object
 * identity or on event order; one pass over the arrays is cheap next to drawing them.
 */
export function structureDigest(s) {
  if (!s) return 'none';
  let a = 0x811c9dc5 | 0, b = 0x9e3779b9 | 0;
  const syms = s.symbols ?? [];
  for (let i = 0; i < syms.length; i++) {
    const sym = syms[i];
    const x = (sym.charCodeAt(0) | 0) + ((sym.length > 1 ? sym.charCodeAt(1) : 0) << 8) + ((sym.length > 2 ? sym.charCodeAt(2) : 0) << 16);
    a = Math.imul(a ^ x, 0x01000193); b = Math.imul(b ^ x, 0x85ebca6b) ^ (b >>> 13);
  }
  const extra = [];
  const p = s.positions ?? [];
  if (p instanceof Float64Array) {
    const w = new Uint32Array(p.buffer, p.byteOffset, p.length * 2);
    for (let k = 0; k < w.length; k++) { const x = w[k]; a = Math.imul(a ^ x, 0x01000193); b = Math.imul(b ^ x, 0x85ebca6b) ^ (b >>> 13); }
  } else extra.push(...p);
  for (const row of s.cell ?? []) extra.push(...row);
  for (const v of s.pbc ?? []) extra.push(v ? 1 : 0);
  extra.push(s.nFrames ?? 1, s.frame ?? 0, syms.length);
  for (const v of extra) {
    f64[0] = +v;
    for (let k = 0; k < 2; k++) { const x = u32[k]; a = Math.imul(a ^ x, 0x01000193); b = Math.imul(b ^ x, 0x85ebca6b) ^ (b >>> 13); }
  }
  return `${(a >>> 0).toString(36)}.${(b >>> 0).toString(36)}`;
}

/**
 * A key that changes whenever the active structure is switched, replaced (undo, redo, reopen) or
 * edited in place, or stepped to another frame — read straight from the structure, so it is already
 * current inside any 'structure' listener. `rev` (Structure.touch(), counted by every editing method)
 * makes edits of props and info visible too (fixed atoms, tags, notes), which the content digest
 * does not see; the digest still catches coordinates written directly by a script.
 */
export function structureKey(app) {
  const s = app.structure;
  if (!s) return 'none';
  return `${app.project?.activeStructure ?? ''}:${serialOf(s)}:${s.length}:${s.frame ?? 0}:${s.rev ?? 0}:${structureDigest(s)}`;
}

/**
 * Cache key for one analysis run: structure, params and the scene values the analysis depends on.
 * Pass `skey` (a structureKey() taken in the same synchronous step) to skip hashing the structure again.
 */
export function runKey(app, a, params, skey = structureKey(app)) {
  const deps = (a.dependsOn ?? []).map((p) => getPath(app.scene, p));
  return `${a.id}|${skey}|${JSON.stringify(params)}|${JSON.stringify(deps)}`;
}

// ------------------------------------------------------------------ built-in analyses
analyses.register({
  id: 'coordination',
  name: 'Coordination',
  description: 'Bonds per atom for each element, using the bond settings in the Scene tab.',
  source: 'built-in',
  auto: (s) => s.length <= 5000,
  dependsOn: ['display.bonds'],
  run: (s, params, ctx = {}) => coordinationStats(s, ctx.bondOptions ?? {}),
  render(stats, el, { ui }) {
    el.append(ui.kvTable(stats.map((x) => [`${x.element} ×${x.count}`, x.min === x.max ? `${x.min}` : `${x.mean.toFixed(2)} (${x.min}–${x.max})`])));
  },
});

analyses.register({
  id: 'rdf',
  name: 'Radial distribution g(r)',
  description: 'Pair-distance distribution. Periodic structures use minimum images; clusters give the normalised pair-distance histogram.',
  source: 'built-in',
  params: [
    { name: 'pair', type: 'select', label: 'Pair', default: '', options: (s) => {
      const els = s ? s.elements().sort() : [];
      return [['', 'All pairs'], ...els.flatMap((a, i) => els.slice(i).map((b) => [`${a}-${b}`, `${a}–${b}`]))];
    } },
    { name: 'rmax', type: 'float', label: 'r max (Å)', default: 8, min: 2, max: 20, step: 0.5 },
  ],
  run: (s, { pair, rmax }) => rdf(s, { rmax: Math.max(2, Math.min(20, +rmax || 8)), pair: pair ? String(pair).split('-') : null }),
  render(r, el, { ui }) {
    let peak = 0;
    r.g.forEach((v, i) => { if (v > r.g[peak]) peak = i; });
    el.append(ui.lineChart({ x: r.r, y: r.g, xLabel: 'r (Å)', yLabel: 'g(r)', fmtX: (v) => (+v).toFixed(2), fmtY: (v) => (+v).toFixed(2) }),
      ui.h('p.hint', `Highest peak at ${r.r[peak].toFixed(2)} Å${r.periodic ? '' : ' · cluster: normalised pair-distance histogram'}${r.sampled ? ' · sampled for speed' : ''}`));
  },
});
