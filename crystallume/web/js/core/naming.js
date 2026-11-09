/**
 * Names of generated structures (design brief C9): the shared pieces. The Python twin is `crystallume/core/naming.py`
 * with the same rules and messages, so both languages give the same names. The multiplication sign is always `×`,
 * never the letter x. The cell and surface tools add their naming functions to this file (supercell labels, Wood
 * notation, slabs, interfaces).
 */

/** The multiplication sign of generated names: "2×2×1", "p(3×3)". */
export const TIMES = '×';

/**
 * A name that ends in repeat counts: " 2×2×1", the older " 2x2x1", or the web app's former " (2×2×1)" (the
 * parentheses in pairs). ASCII digits only, as in Python.
 */
const REPEAT_SUFFIX = /^(.*\S)\s+(?:\(([0-9]+)[x×]([0-9]+)[x×]([0-9]+)\)|([0-9]+)[x×]([0-9]+)[x×]([0-9]+))$/;

/** A value in a message, as the Python twin writes it (numbers plainly, other values as JSON). */
const show = (v) => {
  if (typeof v === 'number' || typeof v === 'boolean' || v === undefined) return String(v);
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
};

/** A repeat count: an integer (2.0 is 2); TypeError `repeat counts must be whole numbers (got 1.5)` otherwise. */
function whole(r) {
  if (typeof r === 'number' && Number.isInteger(r)) return r + 0;
  throw new TypeError(`repeat counts must be whole numbers (got ${show(r)})`);
}

/** Repeat counts as written in names: formatRepeat([2, 2, 1]) → "2×2×1". */
export function formatRepeat(reps) {
  return Array.from(reps, (r) => String(whole(r))).join(TIMES);
}

/**
 * The name of a structure after repeating it `reps` = [nx, ny, nz] times. Unchanged when every count is 1; an empty
 * name stays empty. A name that already ends in repeat counts (" 2×2×1", " 2x2x1" or " (2×2×1)") gets the products
 * of the old and the new counts in their place, so that repeating twice reads like one repeat:
 * addRepeatSuffix('Cu fcc 2×1×1', [2, 1, 1]) → 'Cu fcc 4×1×1'. Any other name gets " 2×2×1" appended. The counts
 * must be three whole numbers ≥ 1 (RangeError `repeat counts must be whole numbers >= 1 (got 0)`).
 */
export function addRepeatSuffix(name, reps) {
  const counts = Array.from(reps, whole);
  if (counts.length !== 3) throw new RangeError(`a repeat suffix needs 3 counts (got ${counts.length})`);
  for (const c of counts) if (c < 1) throw new RangeError(`repeat counts must be whole numbers >= 1 (got ${c})`);
  const text = name == null ? '' : String(name);
  if (counts.every((c) => c === 1) || !text) return text;
  const m = REPEAT_SUFFIX.exec(text);
  if (m) {
    const old = m[2] !== undefined ? [m[2], m[3], m[4]] : [m[5], m[6], m[7]];
    return `${m[1]} ${formatRepeat(old.map((v, k) => Number(v) * counts[k]))}`;
  }
  return `${text} ${formatRepeat(counts)}`;
}
