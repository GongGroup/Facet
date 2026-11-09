/**
 * Crystal prototypes (conventional cells). Extend via `prototypes.register(...)`.
 *
 * The default and tabulated lattice parameters come from `reference.js`, which scripts/gen_reference_data.py
 * writes from the Python builder (crystallume/build/crystal.py); `referenceParameters` and `buildCrystal` apply
 * the same rules, so both languages build the same structures (tests/test_build.py compares them).
 */
import { Structure } from '../core/structure.js';
import { cellFromParams, fracToCart } from '../core/util.js';
import { element, normalizeSymbol } from '../core/elements.js';
import * as REF from './reference.js';

const FCC = [[0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]];
const shift = (pts, d) => pts.map((p) => p.map((v, k) => v + d[k]));
/** Python's `x % 1.0` (exact for these coordinates; negative values wrap to [0, 1) as in Python). */
const mod1 = (v) => { const r = v % 1; return r < 0 ? r + 1 : r; };

const SQ3 = Math.sqrt(3);
const IDEAL_CA = Math.sqrt(8 / 3);
/** Prototypes that keep the reference c/a when only a is given. */
const KEEP_C_OVER_A = new Set(['hcp', 'wurtzite', 'rutile']);

/**
 * Each prototype: {id, name, roles:[labels], defaults:{elements, a, c?, u?, thickness?}, spacegroup, lattice:'cubic'|'hexagonal'|'tetragonal',
 *                  sites(params) -> [[roleIndex, [fx,fy,fz]], ...], description, twoD?}
 * The built-in prototypes take `defaults` from reference.js (the parameters of their example compound).
 */
const registry = new Map();

export const prototypes = {
  register(p) { registry.set(p.id, p); return () => registry.delete(p.id); },
  get: (id) => registry.get(id),
  list: () => [...registry.values()],
};

/** The defaults of a built-in prototype from the generated table: example elements, a, c and the parameters. */
function tableDefaults(id) {
  const t = REF.PROTOTYPES[id];
  return { elements: [...t.defaultElements], a: t.defaultA, ...(t.defaultC != null ? { c: t.defaultC } : {}), ...t.params };
}

const cubic = (id, name, roles, sg, sites, description) => prototypes.register({
  id, name, roles, defaults: tableDefaults(id), spacegroup: sg, lattice: 'cubic', sites, description,
});
const other = (p) => prototypes.register({ ...p, defaults: tableDefaults(p.id) });

cubic('sc', 'Simple cubic', ['A'], 'Pm-3m', () => [[0, [0, 0, 0]]], 'One atom per cube corner — α-Po.');
cubic('bcc', 'Body-centred cubic', ['A'], 'Im-3m', () => [[0, [0, 0, 0]], [0, [0.5, 0.5, 0.5]]], 'Fe, W, Cr, Na…');
cubic('fcc', 'Face-centred cubic', ['A'], 'Fm-3m', () => FCC.map((p) => [0, p]), 'Cu, Al, Au, Ag, Pt, Ni…');
cubic('diamond', 'Diamond', ['A'], 'Fd-3m', () => [...FCC, ...shift(FCC, [0.25, 0.25, 0.25])].map((p) => [0, p]), 'Si, Ge, C (diamond)');
cubic('zincblende', 'Zinc blende', ['A', 'B'], 'F-43m', () => [...FCC.map((p) => [0, p]), ...shift(FCC, [0.25, 0.25, 0.25]).map((p) => [1, p])], 'GaAs, ZnS, InP, SiC-3C');
cubic('rocksalt', 'Rock salt', ['A', 'B'], 'Fm-3m', () => [...FCC.map((p) => [0, p]), ...shift(FCC, [0.5, 0, 0]).map((p) => [1, p.map(mod1)])], 'NaCl, MgO, NiO, PbTe');
cubic('cscl', 'Caesium chloride', ['A', 'B'], 'Pm-3m', () => [[0, [0, 0, 0]], [1, [0.5, 0.5, 0.5]]], 'CsCl, β-brass CuZn');
cubic('fluorite', 'Fluorite', ['A', 'X'], 'Fm-3m', () => [
  ...FCC.map((p) => [0, p]),
  ...shift(FCC, [0.25, 0.25, 0.25]).map((p) => [1, p.map(mod1)]),
  ...shift(FCC, [0.75, 0.75, 0.75]).map((p) => [1, p.map(mod1)]),
], 'CaF₂, UO₂, CeO₂ (AX₂)');
cubic('perovskite', 'Cubic perovskite', ['A', 'B', 'X'], 'Pm-3m', () => [
  [0, [0, 0, 0]], [1, [0.5, 0.5, 0.5]], [2, [0.5, 0.5, 0]], [2, [0.5, 0, 0.5]], [2, [0, 0.5, 0.5]],
], 'SrTiO₃, BaTiO₃, CsPbI₃ (ABX₃) — BX₆ octahedra');

other({
  id: 'rutile', name: 'Rutile', roles: ['A', 'X'], spacegroup: 'P4₂/mnm', lattice: 'tetragonal',
  sites: ({ u }) => [[0, [0, 0, 0]], [0, [0.5, 0.5, 0.5]], [1, [u, u, 0]], [1, [1 - u, 1 - u, 0]], [1, [0.5 + u, 0.5 - u, 0.5]], [1, [0.5 - u, 0.5 + u, 0.5]]],
  description: 'TiO₂, SnO₂, MnO₂ — edge-sharing octahedra chains',
});
other({
  id: 'hcp', name: 'Hexagonal close-packed', roles: ['A'], spacegroup: 'P6₃/mmc', lattice: 'hexagonal',
  sites: () => [[0, [1 / 3, 2 / 3, 0.25]], [0, [2 / 3, 1 / 3, 0.75]]], description: 'Mg, Ti, Zn, Co, Zr…',
});
other({
  id: 'wurtzite', name: 'Wurtzite', roles: ['A', 'B'], spacegroup: 'P6₃mc', lattice: 'hexagonal',
  sites: ({ u }) => [[0, [1 / 3, 2 / 3, 0]], [0, [2 / 3, 1 / 3, 0.5]], [1, [1 / 3, 2 / 3, u]], [1, [2 / 3, 1 / 3, 0.5 + u]]].map(([r, f]) => [r, f.map(mod1)]),
  description: 'ZnO, GaN, AlN, CdS',
});
other({
  id: 'graphite', name: 'Graphite (AB)', roles: ['A'], spacegroup: 'P6₃/mmc', lattice: 'hexagonal',
  sites: () => [[0, [0, 0, 0.25]], [0, [0, 0, 0.75]], [0, [1 / 3, 2 / 3, 0.25]], [0, [2 / 3, 1 / 3, 0.75]]], description: 'Bernal-stacked graphite',
});
other({
  id: 'graphene', name: 'Graphene (2D)', roles: ['A'], spacegroup: 'P6/mmm', lattice: 'hexagonal', twoD: true,
  sites: () => [[0, [1 / 3, 2 / 3, 0.5]], [0, [2 / 3, 1 / 3, 0.5]]], description: 'Honeycomb monolayer; c is the cell height',
});
other({
  id: 'hbn', name: 'Hexagonal BN (2D)', roles: ['A', 'B'], spacegroup: 'P-6m2', lattice: 'hexagonal', twoD: true,
  sites: () => [[0, [1 / 3, 2 / 3, 0.5]], [1, [2 / 3, 1 / 3, 0.5]]], description: 'h-BN monolayer; c is the cell height',
});
other({
  id: 'mos2', name: 'MoS₂ 2H monolayer', roles: ['M', 'X'], spacegroup: 'P-6m2', lattice: 'hexagonal', twoD: true,
  sites: ({ c, thickness }) => { const t = thickness / c; return [[0, [1 / 3, 2 / 3, 0.5]], [1, [2 / 3, 1 / 3, 0.5 - t / 2]], [1, [2 / 3, 1 / 3, 0.5 + t / 2]]]; },
  description: 'Transition-metal dichalcogenide (MoS₂, WS₂, MoSe₂); thickness = X–X height',
});

/** One element per role (missing roles take the first element, as the sites do). */
function roleElements(p, elements) {
  const els = (elements ?? p.defaults.elements).map(normalizeSymbol);
  return p.roles.map((_, i) => els[i] ?? els[0]);
}

/** `[a, c]` from the reference tables, else estimated from covalent radii (Python `_reference_cell`). */
function referenceCell(id, els) {
  const t = REF.PROTOTYPES[id];
  const hasC = t.defaultC != null;
  if (els.length === 1 && REF.REF_A[id]?.[els[0]] != null) {
    const a = REF.REF_A[id][els[0]];
    let c = REF.REF_C[id]?.[els[0]] ?? null;
    if (c == null && hasC) c = id === 'hcp' ? IDEAL_CA * a : t.defaultC;
    return [a, c];
  }
  const entry = REF.REF_COMPOUNDS[id]?.[els.join(' ')];
  if (entry) {
    let c = entry.c;
    if (c == null && hasC) c = t.is2D ? t.defaultC : null;
    return [entry.a, c];
  }
  const r = els.map((e) => element(e).rcov);
  switch (id) {
    case 'sc': return [2 * r[0], null];
    case 'bcc': return [4 * r[0] / SQ3, null];
    case 'fcc': return [2 * r[0] * Math.sqrt(2), null];
    case 'hcp': { const a = 2 * r[0]; return [a, IDEAL_CA * a]; }
    case 'diamond': return [8 * r[0] / SQ3, null];
    case 'zincblende': return [4 * (r[0] + r[1]) / SQ3, null];
    case 'wurtzite': { const a = (r[0] + r[1]) * Math.sqrt(8 / 3); return [a, IDEAL_CA * a]; }
    case 'rocksalt': return [2 * (r[0] + r[1]), null];
    case 'cscl': return [2 * (r[0] + r[1]) / SQ3, null];
    case 'fluorite': return [4 * (r[0] + r[1]) / SQ3, null];
    case 'perovskite': return [2 * (r[1] + r[2]), null];
    case 'rutile': { const a = (r[0] + r[1]) / (0.305 * Math.sqrt(2)); return [a, 0.644 * a]; }
    case 'graphene': return [2 * r[0] * SQ3, t.defaultC];
    case 'graphite': return [2 * r[0] * SQ3, 2.0 * 3.35];
    case 'hbn': return [(r[0] + r[1]) * SQ3, t.defaultC];
    case 'mos2': return [(r[0] + r[1]) * 1.32, t.defaultC];
    default: return [t.defaultA, hasC ? t.defaultC : null];
  }
}

/**
 * The lattice parameters `buildCrystal` uses for a prototype and elements when none are given (Python
 * `reference_parameters` in crystallume/build/crystal.py): `{a}` plus `c` for prototypes with a c axis (2D: the cell height) and the
 * prototype parameters (`u` for wurtzite and rutile, `thickness` for mos2); Å. Tabulated experimental values where
 * available, else estimates from covalent radii and the generic parameters (wurtzite u = 3/8, MX2 thickness 3.17 Å).
 * A prototype registered at run time gives its `defaults`.
 * @param {string} id prototype id
 * @param {string[]} [elements] one element per role (default: the prototype's example)
 */
export function referenceParameters(id, elements = null) {
  const p = registry.get(id);
  if (!p) throw new Error(`Unknown prototype "${id}"`);
  const t = REF.PROTOTYPES[id];
  if (!t) { const { elements: _, ...rest } = p.defaults; return rest; }
  const els = roleElements(p, elements);
  const [a, c] = referenceCell(id, els);
  const out = { a };
  if (t.defaultC != null) out.c = c;
  const params = { ...(REF.FALLBACK_PARAMS[id] ?? {}), ...(REF.REF_COMPOUNDS[id]?.[els.join(' ')]?.params ?? {}) };
  for (const k of Object.keys(t.params)) out[k] = params[k];
  return out;
}

/** `x` rounded to 6 decimals, as Python's `round(x, 6)` (for `info.a` and `info.c`). */
const round6 = (x) => Number(x.toFixed(6));

/**
 * Build a crystal. Omitted lattice parameters come from `referenceParameters`; when only `a` is given, hcp,
 * wurtzite and rutile keep the reference c/a (as the Python builder). For 2D prototypes `c` is the cell height.
 * @param {string} id prototype id
 * @param {{elements?:string[], a?:number, c?:number, u?:number, thickness?:number, repeat?:[number,number,number]}} params
 */
export function buildCrystal(id, params = {}) {
  const p = registry.get(id);
  if (!p) throw new Error(`Unknown prototype "${id}"`);
  const given = Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''));
  const els = roleElements(p, given.elements);
  const t = REF.PROTOTYPES[id];
  const ref = referenceParameters(id, els);
  const keys = t ? Object.keys(t.params) : Object.keys(ref).filter((k) => k !== 'a' && k !== 'c');
  const prm = Object.fromEntries(keys.map((k) => [k, given[k] != null ? +given[k] : ref[k]]));
  const a = given.a != null ? +given.a : +ref.a;
  if (!(a > 0.5)) throw new Error('Lattice constant a must be larger than 0.5 Å');
  const hasC = t ? t.defaultC != null : p.lattice !== 'cubic';
  let c = null;
  if (hasC) {
    if (given.c != null) c = +given.c;
    else if (given.a != null && KEEP_C_OVER_A.has(id) && ref.c != null && ref.a) c = ref.c / ref.a * a;   // keep the reference c/a ratio
    else c = ref.c ? ref.c : (t?.defaultC ?? a);
    if (!(c > 0.5)) throw new Error('Lattice constant c must be larger than 0.5 Å');
  }
  let cell;
  if (p.lattice === 'hexagonal') cell = cellFromParams(a, a, c, 90, 90, 120);
  else if (p.lattice === 'tetragonal') cell = cellFromParams(a, a, c);
  else cell = cellFromParams(a, a, a);
  const sites = p.sites({ ...given, ...prm, a, c: c ?? a });
  const symbols = sites.map(([r]) => els[r] ?? els[0]);
  const positions = sites.map(([, f]) => fracToCart(f, cell));
  const formulaName = new Structure({ symbols }).formula({ reduce: true });
  const info = { source: `builder:${id}`, prototype: id, spacegroup: t ? t.spacegroup : p.spacegroup };
  if (t) info.spacegroupNumber = t.spacegroupNumber;
  info.a = round6(a);
  if (c != null) info.c = round6(c);
  Object.assign(info, prm);
  let s = new Structure({
    name: `${formulaName} (${p.name})`, symbols, positions, cell, pbc: p.twoD ? [true, true, false] : [true, true, true], info,
  });
  const rep = given.repeat ?? [1, 1, 1];
  if (rep.some((v) => v > 1)) {
    s = s.repeat(...rep.map((v) => Math.max(1, v | 0)));
    s.name = `${formulaName} (${p.name}) ${rep.join("×")}`;
  }
  return s;
}
