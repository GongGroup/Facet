/**
 * Shared tolerances and defaults of the surface-modeling tools. Every module takes its tolerances from here instead
 * of writing literals, so that the web modules and the Python package use the same numbers: the Python twin is
 * `crystallume/core/defaults.py`, with the same keys in snake_case (`vacuumGapMin` ↔ `vacuum_gap_min`) and the same
 * values, which a test checks key by key. Modules add their own keys in both files at once.
 *
 * There is deliberately no `vacuum` key: the vacuum of a slab has no default and must always be given.
 *
 * | Key | Value | Unit | Use |
 * |---|---|---|---|
 * | `vacuumGapMin` | 5.0 | Å | a vacuum gap along a cell vector (never below 4.4 Å: bcc Cs d110 = 4.34 Å) |
 * | `surfaceHintGapMin` | 2.0 | Å | the threshold on the axis recorded in `info.surface.axis` |
 * | `blockGapMin` | 3.5 | Å | the gap that splits the atoms along an axis into blocks |
 * | `smallBlockFraction` | 0.5 | — | a block with at most this fraction of the main block's atoms floats in the vacuum |
 * | `gapWrapEps` | 1e-6 | fraction | vacuum-gap wrapping: `w = f − floor(f)`, `w > 1 − eps` → 0 |
 * | `positionTolerance` | 1e-5 | Å | positions, gap widths and thresholds compare within this |
 * | `flagTolerance` | 1e-6 | relative | constraint flags under a change of cell basis |
 * | `overlapDistance` | 0.5 | Å | atoms closer than this overlap (export check) |
 * | `micTie` | 1e-8 | Å | equal-length candidates of the minimum-image search |
 * // --- surface-modeling M1 ---
 * // --- end M1 ---
 *
 * // --- surface-modeling M2 ---
 * // --- end M2 ---
 *
 * // --- surface-modeling M3 ---
 * // --- end M3 ---
 *
 * // --- surface-modeling M4 ---
 * // --- end M4 ---
 *
 * // --- surface-modeling M5-adsorbates ---
 * // --- end M5-adsorbates ---
 *
 * // --- surface-modeling M5-sites ---
 * // --- end M5-sites ---
 *
 * // --- surface-modeling M6 ---
 * // --- end M6 ---
 */
export const SURFACE_DEFAULTS = Object.freeze({
  vacuumGapMin: 5.0,
  surfaceHintGapMin: 2.0,
  blockGapMin: 3.5,
  smallBlockFraction: 0.5,
  gapWrapEps: 1e-6,
  positionTolerance: 1e-5,
  flagTolerance: 1e-6,
  overlapDistance: 0.5,
  micTie: 1e-8,
  // --- surface-modeling M1 ---
  // --- end M1 ---

  // --- surface-modeling M2 ---
  // --- end M2 ---

  // --- surface-modeling M3 ---
  // --- end M3 ---

  // --- surface-modeling M4 ---
  // --- end M4 ---

  // --- surface-modeling M5-adsorbates ---
  // --- end M5-adsorbates ---

  // --- surface-modeling M5-sites ---
  // --- end M5-sites ---

  // --- surface-modeling M6 ---
  // --- end M6 ---
});
