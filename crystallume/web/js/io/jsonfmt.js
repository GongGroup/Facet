/** Native JSON: a structure (`crystallume.structure/1`) or a whole project (`crystallume.project/1`). */
import { Structure } from '../core/structure.js';

export function readJSON(text) {
  const o = JSON.parse(text);
  if (/^(crystallume|atomscope)\.project/.test(o.schema ?? '')) {   // atomscope: the former name
    const err = new Error('This is a project file');
    err.project = o;
    throw err;
  }
  if (Array.isArray(o.symbols) && Array.isArray(o.positions)) return Structure.fromJSON(o);
  // ASE-style / pymatgen-ish fallbacks
  if (Array.isArray(o.numbers) && Array.isArray(o.positions)) return Structure.fromJSON({ ...o, symbols: o.numbers.map(String) });
  if (Array.isArray(o.sites) && o.lattice?.matrix) {
    return Structure.fromJSON({
      name: o.formula ?? 'pymatgen structure', cell: o.lattice.matrix,
      symbols: o.sites.map((s) => s.species?.[0]?.element ?? s.label),
      positions: o.sites.map((s) => s.xyz),
    });
  }
  throw new Error('JSON: expected a Crystallume structure (symbols + positions) or a project file.');
}

export const writeJSON = (s) => JSON.stringify(s.toJSON(), null, 1);
