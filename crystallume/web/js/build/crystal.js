/** Crystal prototypes (conventional cells). Extend via `prototypes.register(...)`. */
import { Structure } from '../core/structure.js';
import { cellFromParams, fracToCart } from '../core/util.js';
import { normalizeSymbol } from '../core/elements.js';

const FCC = [[0, 0, 0], [0, 0.5, 0.5], [0.5, 0, 0.5], [0.5, 0.5, 0]];
const shift = (pts, d) => pts.map((p) => p.map((v, k) => v + d[k]));

/**
 * Each prototype: {id, name, roles:[labels], defaults:{elements, a, c?, u?}, spacegroup, lattice:'cubic'|'hexagonal'|'tetragonal',
 *                  sites(params) -> [[roleIndex, [fx,fy,fz]], ...], description}
 */
const registry = new Map();

export const prototypes = {
  register(p) { registry.set(p.id, p); return () => registry.delete(p.id); },
  get: (id) => registry.get(id),
  list: () => [...registry.values()],
};

const cubic = (id, name, roles, els, a, sg, sites, description) => prototypes.register({
  id, name, roles, defaults: { elements: els, a }, spacegroup: sg, lattice: 'cubic', sites, description,
});

cubic('sc', 'Simple cubic', ['A'], ['Po'], 3.35, 'Pm-3m', () => [[0, [0, 0, 0]]], 'One atom per cube corner — α-Po.');
cubic('bcc', 'Body-centred cubic', ['A'], ['Fe'], 2.866, 'Im-3m', () => [[0, [0, 0, 0]], [0, [0.5, 0.5, 0.5]]], 'Fe, W, Cr, Na…');
cubic('fcc', 'Face-centred cubic', ['A'], ['Cu'], 3.615, 'Fm-3m', () => FCC.map((p) => [0, p]), 'Cu, Al, Au, Ag, Pt, Ni…');
cubic('diamond', 'Diamond', ['A'], ['Si'], 5.431, 'Fd-3m', () => [...FCC, ...shift(FCC, [0.25, 0.25, 0.25])].map((p) => [0, p]), 'Si, Ge, C (diamond)');
cubic('zincblende', 'Zinc blende', ['A', 'B'], ['Ga', 'As'], 5.653, 'F-43m', () => [...FCC.map((p) => [0, p]), ...shift(FCC, [0.25, 0.25, 0.25]).map((p) => [1, p])], 'GaAs, ZnS, InP, SiC-3C');
cubic('rocksalt', 'Rock salt', ['A', 'B'], ['Na', 'Cl'], 5.64, 'Fm-3m', () => [...FCC.map((p) => [0, p]), ...shift(FCC, [0.5, 0, 0]).map((p) => [1, p.map((v) => v % 1)])], 'NaCl, MgO, NiO, PbTe');
cubic('cscl', 'Caesium chloride', ['A', 'B'], ['Cs', 'Cl'], 4.123, 'Pm-3m', () => [[0, [0, 0, 0]], [1, [0.5, 0.5, 0.5]]], 'CsCl, β-brass CuZn');
cubic('fluorite', 'Fluorite', ['A', 'X'], ['Ca', 'F'], 5.463, 'Fm-3m', () => {
  const x = [];
  for (const a of [0.25, 0.75]) for (const b of [0.25, 0.75]) for (const c of [0.25, 0.75]) x.push([1, [a, b, c]]);
  return [...FCC.map((p) => [0, p]), ...x];
}, 'CaF₂, UO₂, CeO₂ (AX₂)');
cubic('perovskite', 'Cubic perovskite', ['A', 'B', 'X'], ['Sr', 'Ti', 'O'], 3.905, 'Pm-3m', () => [
  [0, [0, 0, 0]], [1, [0.5, 0.5, 0.5]], [2, [0.5, 0.5, 0]], [2, [0.5, 0, 0.5]], [2, [0, 0.5, 0.5]],
], 'SrTiO₃, BaTiO₃, CsPbI₃ (ABX₃) — BX₆ octahedra');

prototypes.register({
  id: 'rutile', name: 'Rutile', roles: ['A', 'X'], defaults: { elements: ['Ti', 'O'], a: 4.594, c: 2.959, u: 0.305 }, spacegroup: 'P4₂/mnm', lattice: 'tetragonal',
  sites: ({ u }) => [[0, [0, 0, 0]], [0, [0.5, 0.5, 0.5]], [1, [u, u, 0]], [1, [1 - u, 1 - u, 0]], [1, [0.5 + u, 0.5 - u, 0.5]], [1, [0.5 - u, 0.5 + u, 0.5]]],
  description: 'TiO₂, SnO₂, MnO₂ — edge-sharing octahedra chains',
});
prototypes.register({
  id: 'hcp', name: 'Hexagonal close-packed', roles: ['A'], defaults: { elements: ['Mg'], a: 3.209, c: 5.211 }, spacegroup: 'P6₃/mmc', lattice: 'hexagonal',
  sites: () => [[0, [1 / 3, 2 / 3, 0.25]], [0, [2 / 3, 1 / 3, 0.75]]], description: 'Mg, Ti, Zn, Co, Zr…',
});
prototypes.register({
  id: 'wurtzite', name: 'Wurtzite', roles: ['A', 'B'], defaults: { elements: ['Zn', 'O'], a: 3.25, c: 5.207, u: 0.382 }, spacegroup: 'P6₃mc', lattice: 'hexagonal',
  sites: ({ u }) => [[0, [1 / 3, 2 / 3, 0]], [0, [2 / 3, 1 / 3, 0.5]], [1, [1 / 3, 2 / 3, u]], [1, [2 / 3, 1 / 3, 0.5 + u]]], description: 'ZnO, GaN, AlN, CdS',
});
prototypes.register({
  id: 'graphite', name: 'Graphite (AB)', roles: ['A'], defaults: { elements: ['C'], a: 2.464, c: 6.711 }, spacegroup: 'P6₃/mmc', lattice: 'hexagonal',
  sites: () => [[0, [0, 0, 0.25]], [0, [0, 0, 0.75]], [0, [1 / 3, 2 / 3, 0.25]], [0, [2 / 3, 1 / 3, 0.75]]], description: 'Bernal-stacked graphite',
});
prototypes.register({
  id: 'graphene', name: 'Graphene (2D)', roles: ['A'], defaults: { elements: ['C'], a: 2.46, c: 15 }, spacegroup: 'P6/mmm', lattice: 'hexagonal', twoD: true,
  sites: () => [[0, [1 / 3, 2 / 3, 0.5]], [0, [2 / 3, 1 / 3, 0.5]]], description: 'Honeycomb monolayer; c is the vacuum spacing',
});
prototypes.register({
  id: 'hbn', name: 'Hexagonal BN (2D)', roles: ['A', 'B'], defaults: { elements: ['B', 'N'], a: 2.504, c: 15 }, spacegroup: 'P-6m2', lattice: 'hexagonal', twoD: true,
  sites: () => [[0, [1 / 3, 2 / 3, 0.5]], [1, [2 / 3, 1 / 3, 0.5]]], description: 'h-BN monolayer',
});
prototypes.register({
  id: 'mos2', name: 'MoS₂ 2H monolayer', roles: ['M', 'X'], defaults: { elements: ['Mo', 'S'], a: 3.16, c: 18 }, spacegroup: 'P-6m2', lattice: 'hexagonal', twoD: true,
  sites: ({ c }) => { const dz = 1.585 / c; return [[0, [1 / 3, 2 / 3, 0.5]], [1, [2 / 3, 1 / 3, 0.5 + dz]], [1, [2 / 3, 1 / 3, 0.5 - dz]]]; },
  description: 'Transition-metal dichalcogenide (MoS₂, WS₂, MoSe₂)',
});

/**
 * Build a crystal.
 * @param {string} id prototype id
 * @param {{elements?:string[], a?:number, c?:number, u?:number, repeat?:[number,number,number]}} params
 */
export function buildCrystal(id, params = {}) {
  const p = registry.get(id);
  if (!p) throw new Error(`Unknown prototype "${id}"`);
  const prm = { ...p.defaults, ...Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== '')) };
  const els = (prm.elements ?? p.defaults.elements).map(normalizeSymbol);
  const a = +prm.a, c = +(prm.c ?? prm.a);
  if (!(a > 0.5)) throw new Error('Lattice constant a must be larger than 0.5 Å');
  let cell;
  if (p.lattice === 'hexagonal') cell = cellFromParams(a, a, c, 90, 90, 120);
  else if (p.lattice === 'tetragonal') cell = cellFromParams(a, a, c);
  else cell = cellFromParams(a, a, a);
  const sites = p.sites({ ...prm, a, c });
  const symbols = sites.map(([r]) => els[r] ?? els[0]);
  const positions = sites.map(([, f]) => fracToCart(f, cell));
  const formulaName = new Structure({ symbols }).formula({ reduce: true });
  let s = new Structure({
    name: `${formulaName} (${p.name})`, symbols, positions, cell, pbc: p.twoD ? [true, true, false] : [true, true, true],
    info: { source: `builder:${id}`, prototype: id, spacegroup: p.spacegroup },
  });
  const rep = prm.repeat ?? [1, 1, 1];
  if (rep.some((v) => v > 1)) {
    s = s.repeat(...rep.map((v) => Math.max(1, v | 0)));
    s.name = `${formulaName} (${p.name}) ${rep.join("×")}`;
  }
  return s;
}
