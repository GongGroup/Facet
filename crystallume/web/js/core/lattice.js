/**
 * Lattice helpers: cell parameters ↔ cell matrices, fractional ↔ Cartesian coordinates, wrapping. The Python twin is
 * `crystallume/core/lattice.py`. Conventions: a cell is a 3×3 array whose rows are the lattice vectors a, b, c (Å),
 * `cart = frac · cell`, angles in degrees. Other modules add their lattice functions to this file.
 */
export { cellFromParams, cellParams, fracToCart, cartToFrac, det3, inv3 } from './util.js';
export { surfaceNormal } from './vacuum.js';

/**
 * Fractional coordinates wrapped into the cell along the periodic axes, as a new array of the same shape: one point
 * `[f0, f1, f2]`, or flat triples (a Float64Array or a plain array of 3n numbers). Along a periodic axis
 * `w = f − floor(f + eps)`, and `w ≥ 1 − eps` becomes 0: a coordinate within `eps` below a whole number is taken as
 * that number, so an atom at f = −1e-17 or 0.9999999999999 stays on the lower face (the result can be a hair, at most
 * `eps`, below 0). Non-periodic axes are copied. The rule of `Structure.wrap()` and Python's `wrap_fractional`; the
 * vacuum-gap analysis wraps with its own tolerance (`SURFACE_DEFAULTS.gapWrapEps`, core/vacuum.js).
 */
export function wrapFractional(frac, pbc = [true, true, true], eps = 1e-12) {
  if (!Array.isArray(frac) && !ArrayBuffer.isView(frac)) throw new TypeError('wrapFractional: frac must be an array of 3n numbers');
  if (frac.length % 3 !== 0) throw new RangeError(`wrapFractional: frac must hold 3n numbers (got ${frac.length})`);
  const periodic = typeof pbc === 'boolean' ? [pbc, pbc, pbc] : [0, 1, 2].map((k) => !!pbc?.[k]);
  const out = ArrayBuffer.isView(frac) ? Float64Array.from(frac) : frac.map(Number);
  for (let i = 0; i < out.length; i++) {
    if (!periodic[i % 3]) continue;
    const w = out[i] - Math.floor(out[i] + eps);
    out[i] = w >= 1 - eps ? 0 : w;
  }
  return out;
}
