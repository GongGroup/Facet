/**
 * Measurement references (v2): which atoms a kept distance, angle or dihedral joins, whatever the view does to them.
 *
 * A reference 'i:a,b,c' is atom i at its stored position (current frame) plus a·A + b·B + c·C, whole cell vectors.
 * A measurement is {type, refs}: 2, 3 or 4 references, the first at image 0,0,0 (moving every atom by a cell vector
 * changes nothing). The view draws a measurement on the drawn copies whose stored images match (render/display.js
 * `storedImage`), so a change of the wrapping rule (the vacuum-gap cut of user decision U1) never changes what a
 * measurement measures. Projects saved before refs existed hold {type, keys}: the images of those keys count from the
 * copy the view drew inside the cell (the [0, 1) wrapping); migrateMeasurementKeys turns them into refs.
 *
 * In the app a measurement also has an `id`, stable for the session (undo and redo keep it) and never saved.
 * Pure functions on plain data: the viewer, the app and the atom tools share them.
 */
import { inv3, cartToFrac } from './util.js';

/** Number of atoms of each measurement type (null prototype: 'toString' and the like are not types). */
const ARITY = Object.freeze(Object.assign(Object.create(null), { distance: 2, angle: 3, dihedral: 4 }));
const arity = (type) => (typeof type === 'string' ? ARITY[type] : undefined);
/** Fractional coordinates within this of 1 counted as 0 by the old [0, 1) wrapping (render/display.js). */
const WRAP_EPS = 1e-6;
const REF = /^(\d+):(-?\d+),(-?\d+),(-?\d+)$/;

/** {atom, image: [a, b, c]} of a reference 'i:a,b,c', or null when `ref` is not one. */
export function parseRef(ref) {
  if (typeof ref !== 'string') return null;
  const m = REF.exec(ref);
  if (!m) return null;
  const atom = Number(m[1]), image = [Number(m[2]) + 0, Number(m[3]) + 0, Number(m[4]) + 0];
  if (!Number.isSafeInteger(atom) || !image.every(Number.isSafeInteger)) return null;
  return { atom, image };
}

/** The reference 'i:a,b,c' of atom `atom` (a whole number ≥ 0) and image [a, b, c] (whole numbers). */
export function formatRef(atom, image) {
  if (!Number.isSafeInteger(atom) || atom < 0) throw new TypeError(`formatRef: the atom must be a whole number of at least 0 (got ${atom})`);
  const I = image == null ? [] : Array.from(image, Number);
  if (I.length !== 3 || !I.every(Number.isSafeInteger)) throw new TypeError('formatRef: the image must be three whole numbers');
  return `${atom}:${I[0] + 0},${I[1] + 0},${I[2] + 0}`;
}

/** The references moved by whole cells so that the first one has image 0,0,0; null when one is not a reference. */
export function normalizeRefs(refs) {
  if (!Array.isArray(refs) || !refs.length) return null;
  const parsed = refs.map(parseRef);
  if (parsed.some((p) => !p)) return null;
  const T = parsed[0].image;
  return parsed.map(({ atom, image }) => formatRef(atom, [image[0] - T[0], image[1] - T[1], image[2] - T[2]]));
}

/**
 * The points of the references (Float64Array, 3 per reference): the stored position of each atom (current frame, or
 * `positions`, a flat list of every atom's coordinates, such as a drag preview's) plus its image in cell vectors.
 * null when a reference is not one, names an atom the structure does not have, or uses an image without a cell.
 */
export function measurementPoints(structure, refs, { positions = null } = {}) {
  const s = structure;
  if (!s || !Array.isArray(refs) || !refs.length) return null;
  const pos = positions ?? s.positions;
  const cell = s.cell;
  const out = new Float64Array(3 * refs.length);
  for (let k = 0; k < refs.length; k++) {
    const r = parseRef(refs[k]);
    if (!r || r.atom >= s.length || 3 * r.atom + 2 >= pos.length) return null;
    const [a, b, c] = r.image;
    let x = pos[3 * r.atom], y = pos[3 * r.atom + 1], z = pos[3 * r.atom + 2];
    if (a || b || c) {
      if (!cell) return null;
      x += a * cell[0][0] + b * cell[1][0] + c * cell[2][0];
      y += a * cell[0][1] + b * cell[1][1] + c * cell[2][1];
      z += a * cell[0][2] + b * cell[1][2] + c * cell[2][2];
    }
    out[3 * k] = x; out[3 * k + 1] = y; out[3 * k + 2] = z;
  }
  return out;
}

function inverseOf(cell) {
  try {
    const inv = inv3(cell);
    return inv.every((r) => r.every(Number.isFinite)) ? inv : null;
  } catch { return null; }
}

/** The whole cells the old [0, 1) wrapping moved fractional coordinate f by, as a count to subtract: floor(f) (+1 just below an integer). */
function oldHome(f) {
  const fl = Math.floor(f);
  return fl + (f - fl > 1 - WRAP_EPS ? 1 : 0);
}

/**
 * Refs for the keys of a measurement saved before refs existed ('i:J' with J relative to the copy the view drew
 * inside the cell): with the old wrapping on (`wrap`, the project's display.wrap) each periodic axis gets
 * I = J − home_old(f_i) (f_i the atom's fractional coordinate, current frame), then the refs are normalised.
 * Keys of an atom the structure does not have keep their image. null when a key is malformed.
 */
export function migrateMeasurementKeys(structure, keys, { wrap = true } = {}) {
  if (!Array.isArray(keys) || !keys.length) return null;
  const parsed = keys.map(parseRef);
  if (parsed.some((p) => !p)) return null;
  const s = structure;
  const inv = wrap && s?.periodic ? inverseOf(s.cell) : null;
  return normalizeRefs(parsed.map(({ atom, image }) => {
    if (!inv || atom >= s.length) return formatRef(atom, image);
    const f = cartToFrac(s.pos(atom), inv);
    return formatRef(atom, image.map((J, k) => (s.pbc[k] ? J - oldHome(f[k]) : J)));
  }));
}

let seq = 0;
/** A new measurement id, unique for the session ('m1', 'm2', …). */
export function newMeasurementId() { seq += 1; return `m${seq}`; }

/**
 * The measurements of a list that can be shown, as {id, type, refs}: a known type with as many references as it
 * needs (refs normalised; keys of older projects migrated with migrateMeasurementKeys against `structure` and
 * `wrap`); others are dropped. Ids are kept (undo snapshots) unless missing or repeated, or `newIds` is true
 * (projects being opened).
 */
export function cleanMeasurementList(list, structure = null, { wrap = true, newIds = false } = {}) {
  const out = [], seen = new Set();
  for (const m of Array.isArray(list) ? list : []) {
    if (!m || typeof m !== 'object') continue;
    const n = arity(m.type);
    if (!n) continue;
    let refs = null;
    if (Array.isArray(m.refs)) refs = m.refs.length === n ? normalizeRefs(m.refs) : null;
    else if (Array.isArray(m.keys) && m.keys.length === n) refs = migrateMeasurementKeys(structure, m.keys, { wrap });
    if (!refs) continue;
    const id = !newIds && typeof m.id === 'string' && m.id && !seen.has(m.id) ? m.id : newMeasurementId();
    seen.add(id);
    out.push({ id, type: m.type, refs });
  }
  return out;
}

/**
 * Measurements after an edit (F0-A §3.9.4), in this order: ① atom indices through `map` (map[old] = new index;
 * −1, null or anything not a whole number ≥ 0 = removed, and a measurement on a removed atom is dropped);
 * ② `latticeChanged` (a supercell, a redefined lattice: the old whole-cell images mean nothing in the new basis):
 * measurements with any non-zero image are dropped; ③ `imageShift(oldIndex)` → [ka, kb, kc] (or null) when the edit
 * moved that atom's stored position by whole cells (r' = r + k·cell, e.g. wrapping it into the cell): I' = I − k,
 * then normalised. Atoms moved any other way need nothing: references follow the stored positions. Entries without
 * valid refs are kept as they are. Returns {list, removed}.
 */
export function remapMeasurementList(list, map, { imageShift = null, latticeChanged = false } = {}) {
  const out = [];
  let removed = 0;
  for (const m of Array.isArray(list) ? list : []) {
    const parsed = Array.isArray(m?.refs) && m.refs.length ? m.refs.map(parseRef) : null;
    if (!parsed || parsed.some((p) => !p)) { if (m) out.push(m); continue; }
    const atoms = parsed.map(({ atom }) => {
      const j = map ? map[atom] : atom;
      return Number.isInteger(j) && j >= 0 ? j : -1;
    });
    if (atoms.some((j) => j < 0)) { removed++; continue; }
    if (latticeChanged && parsed.some(({ image }) => image.some(Boolean))) { removed++; continue; }
    const images = parsed.map(({ atom, image }) => {
      const k = imageShift ? imageShift(atom) : null;
      if (k == null) return image;
      const K = Array.from(k, Number);
      if (K.length !== 3 || !K.every(Number.isInteger)) throw new TypeError(`imageShift(${atom}) must return three whole numbers (or null)`);
      return [image[0] - K[0], image[1] - K[1], image[2] - K[2]];
    });
    const next = { ...m, refs: normalizeRefs(atoms.map((j, t) => formatRef(j, images[t]))) };
    delete next.keys;
    out.push(next);
  }
  return { list: out, removed };
}

/**
 * The whole-cell moves of an edit that put structure `after` in the place of `before` with the same cell and pbc, as
 * an imageShift for remapMeasurementList: atom i (atom map[i] of `after`) that moved by exactly k cell vectors
 * (within 1e-6 in fractional coordinates on each periodic axis, k not all zero) gives k, other atoms null. Such a
 * move leaves a periodic structure as it was (wrapping atoms into the cell is one), so the measurement keeps its
 * value. null when the structures are the same object or the cells or pbc differ.
 */
export function wholeCellShifts(before, after, map) {
  if (!before || !after || before === after || !before.cell || !after.cell) return null;
  const pbc = after.pbc ?? [];
  for (let a = 0; a < 3; a++) {
    if (!!pbc[a] !== !!before.pbc?.[a]) return null;
    for (let c = 0; c < 3; c++) if (Math.abs(before.cell[a][c] - after.cell[a][c]) > 1e-9 * (1 + Math.abs(after.cell[a][c]))) return null;
  }
  const inv = inverseOf(after.cell);
  if (!inv) return null;
  return (i) => {
    const j = map ? map[i] : i;
    if (!Number.isInteger(j) || j < 0 || j >= after.length || i >= before.length) return null;
    const fo = cartToFrac(before.pos(i), inv), fn = cartToFrac(after.pos(j), inv);
    const k = [0, 1, 2].map((a) => (pbc[a] ? Math.round(fn[a] - fo[a]) : 0));
    if (!k.some(Boolean) || k.some((x, a) => !(Math.abs(fn[a] - fo[a] - x) <= 1e-6))) return null;
    return k.map((x) => x + 0);
  };
}

/** The note an edit's toast adds when it removed measurements ('' for none). */
export function measurementsRemovedNote(n) {
  if (!(n > 0)) return '';
  return n === 1 ? '1 measurement was removed.' : `${n} measurements were removed.`;
}
