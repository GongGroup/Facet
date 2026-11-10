/**
 * The public lattice helpers of F0-A (ledger L-F0-46, M7 §6.3): `facet.lattice.*` takes cells and indices only
 * (millerNormal, latticeDirection, isHexagonalCell, hklToHkil, hkilToHkl, uvwToUvtw, uvtwToUvw, centeredCellHint, the
 * functions of core/lattice.js themselves), and the surface normal of a structure is
 * `facet.analysis.surfaceNormal(s?, opts)` (M7 N-15: there is no `facet.lattice.surfaceNormal`).
 * main.js imports this module; the members are defined then (defineApi), before the API object exists.
 */
import { defineApi } from './namespaces.js';
import {
  millerNormal, latticeDirection, isHexagonalCell, hklToHkil, hkilToHkl, uvwToUvtw, uvtwToUvw, centeredCellHint, surfaceNormal,
} from '../core/lattice.js';

const OWNER = 'F0-A';

/** facet.lattice.<name>: [function, one-line signature for facet.reference() and Help › Scripting & API]. */
export const LATTICE_API = Object.freeze({
  millerNormal: [millerNormal, '(cell, [h, k, l]) → the unit normal [x, y, z] of the plane (h k l) of the cell'],
  latticeDirection: [latticeDirection, '(cell, [u, v, w]) → the unit vector [x, y, z] along [u v w] of the cell'],
  isHexagonalCell: [isHexagonalCell, '(cell, { lengthTol, angleTol }) → { axis, gamma: 120 | 60 } | null'],
  hklToHkil: [hklToHkil, '([h, k, l]) → [h, k, i, l] with i = −(h + k)'],
  hkilToHkl: [hkilToHkl, '([h, k, i, l]) → [h, k, l]'],
  uvwToUvtw: [uvwToUvtw, '([u, v, w], { integer }) → [U, V, T, W]'],
  uvtwToUvw: [uvtwToUvw, '([U, V, T, W]) → [u, v, w]'],
  centeredCellHint: [centeredCellHint, "(cell) → { kind: 'fcc' | 'bcc', toConventional } | null"],
});

/** The structure of the page's app (facet.structure), the default of analysis.surfaceNormal. */
const activeStructure = () => globalThis.facet?.structure ?? null;

/**
 * facet.analysis.surfaceNormal(s = the active structure, { frame, requireGap, exclude }): the vacuum axis of `s`,
 * its outward normal and whether surface tools apply (core/vacuum.js surfaceNormal), or null without a unit cell.
 */
export function surfaceNormalOf(s = activeStructure(), opts = {}) {
  if (!s) throw new Error('Load a structure first.');
  return surfaceNormal(s, opts ?? {});
}

for (const [name, [fn, sig]] of Object.entries(LATTICE_API)) defineApi(`lattice.${name}`, fn, { owner: OWNER, sig });
defineApi('analysis.surfaceNormal', surfaceNormalOf, {
  owner: OWNER, sig: '(s?, { frame, requireGap, exclude }) → { normal, axis, source, surface, vacuumAxes, cut } | null',
});
