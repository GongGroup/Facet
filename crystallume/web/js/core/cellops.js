/**
 * Cell and lattice operations of the cell tools (M1): pure functions (s, …, opts) → a cell-operation result
 * (`cellOpResult`). Each works on a copy of its input structure (never modified) and returns the new structure with
 * what callers need to follow the change: the source map, the index map and image shifts that carry the selection
 * and the measurements across (`app.editActive(…, { indexMap, imageShift, latticeChanged })`), the integer change of
 * basis, a label for read-outs and one-time notes. The in-place methods of Structure (reduceCell, setCell,
 * reorient, …) are thin wrappers (`r = cellops.op(this, …)` then `this._adopt(r.structure)`); the commands, the
 * surface, adsorbate and interface tools call the functions here.
 *
 * Conventions (design brief C1): cell rows are the lattice vectors, cart = frac · cell; an integer matrix P gives the
 * new cell P · cell and the fractional coordinates f · inv(P) (core/intmath.js); a deformation F acts on row vectors,
 * cell' = cell · Fᵀ. Source maps run new → old: src[j] is the input atom that new atom j comes from.
 *
 * The Python twin is `crystallume/core/cellops.py` (CellOpResult and the same functions in snake_case, the same
 * contract). This module does not import core/structure.js, which imports it for the thin methods (ledger L-M1-08):
 * new structures come from `s.constructor`, and F0-D's markEdited is reached through the structure itself
 * (see markEditedOf).
 *
 * The module is written by several tasks, each inside its own segment (`// --- surface-modeling <name> ---` …
 * `// --- end <name> ---`, plan.md §2.2): `M1-T3a` the supercell family (makeSupercell, redefineLattice,
 * makeRightHanded, reduceCell, conventionalCell, the wrapping rule), `M1-T3b` continuous deformations and rigid
 * operations (setCell, setLatticeParameters, deform, applyStrain, reorient, permuteCellAxes, shiftOrigin,
 * wrapIntoCell), `M1-T10` the two hooks beginCellOp and finishCellOp (stubs until M1-T10 fills them in), the
 * info-handler registry re-exported from core/infohandlers.js, and referenceMesh.
 *
 * The hooks (plan.md P-05): every structure operation of M1 — the ones here and primitiveCell in
 * core/translations.js — calls `before = beginCellOp(s)` on its input first thing and `finishCellOp(out, ctx,
 * before)` on its result as the last step before it makes the result object. The operations never drop derived
 * information, call info handlers or rename structures themselves: the hooks do. Their signatures and the fields of
 * ctx (see finishCellOp) are fixed.
 */

/** The fields of a cell-operation result (CellOpResult of the Python twin, camelCase). */
const RESULT_FIELDS = Object.freeze(['structure', 'src', 'indexMap', 'imageShift', 'matrix', 'label', 'notes', 'changed',
  'latticeChanged', 'rotation', 'moved']);
/** The fields without a default. */
const RESULT_REQUIRED = Object.freeze(['structure', 'changed', 'latticeChanged']);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v);
const isList = (v) => Array.isArray(v) || (ArrayBuffer.isView(v) && !(v instanceof DataView));

/**
 * The result of a cell operation (ledger L-M1-08) from `fields`: `structure`, `changed` and `latticeChanged` are
 * required, the others default to "nothing"; an unknown field (a snake_case name, a typo) throws TypeError.
 * - structure: the new structure (the input is never modified)
 * - src: new → old source map (= structure.sourceMap); null: the same atoms
 * - indexMap: old → new, for the selection and the measurements (a primitive cell: orbitOf, each input atom to the
 *   representative of its orbit); null: the inverse of src
 * - imageShift: per input atom, the integer new-lattice translation k by which the operation moved it
 *   (r' = r + k · new cell; M1 §4.3); null: no atom moved
 * - matrix: the integer change of basis, new cell = matrix · old cell; null for primitive cells and rotations
 * - label: a label for the read-out and the toast, e.g. `c(2×2)`; names never use it (lead decision L-19)
 * - notes: one-time notes (M1 §3.17), shown as toasts; never written into info
 * - changed: false when the operation did nothing (the cell was already reduced, …)
 * - latticeChanged: the lattice basis changed, so image offsets of measurements no longer mean the same (true for
 *   supercells and changes of basis, false for strain, cell parameters, shifts and wraps; M1 §4.3)
 * - rotation: the rotation R of a reorientation (cart' = cart · Rᵀ), else null
 * - moved: the number of atoms that wrapping moved by a lattice vector
 */
export function cellOpResult(fields) {
  if (!isPlainObject(fields)) throw new TypeError('cellOpResult needs an object of fields');
  for (const k of Object.keys(fields)) {
    if (!RESULT_FIELDS.includes(k)) throw new TypeError(`cellOpResult: unknown field '${k}'`);
  }
  const missing = RESULT_REQUIRED.filter((k) => fields[k] === undefined);
  if (missing.length) throw new TypeError(`cellOpResult needs ${missing.join(', ')}`);
  return {
    structure: fields.structure,
    src: fields.src ?? null,
    indexMap: fields.indexMap ?? null,
    imageShift: fields.imageShift ?? null,
    matrix: fields.matrix ?? null,
    label: fields.label ?? null,
    notes: fields.notes ?? [],
    changed: fields.changed,
    latticeChanged: fields.latticeChanged,
    rotation: fields.rotation ?? null,
    moved: fields.moved ?? 0,
  };
}

// --- surface-modeling M1-T3a ---
// --- end M1-T3a ---

// --- surface-modeling M1-T3b ---
// --- end M1-T3b ---

// --- surface-modeling M1-T10 ---
/** The values of ctx.kind (M1 §3.15, ledger L-M1-14). */
const CTX_KINDS = Object.freeze(['supercell', 'basis', 'primitive', 'rotation', 'deform', 'translate']);
/** The fields every ctx must have; the others may be left out (= null). */
const CTX_REQUIRED = Object.freeze(['kind', 'old', 'new', 'mark']);
/** CARTESIAN_VECTOR_PROPS of core/structure.js: the per-atom Cartesian vectors that turn with a rigid rotation. */
const VECTOR_PROPS = Object.freeze(['velocities', 'momenta', 'initial_magmoms']);

const isVector3 = (v) => isList(v) && v.length === 3 && typeof v[0] === 'number' && typeof v[1] === 'number' && typeof v[2] === 'number';

function rotationRows(R) {
  const ok = isList(R) && R.length === 3
    && Array.from(R).every((r) => isList(r) && r.length === 3 && Array.from(r).every((x) => typeof x === 'number' && Number.isFinite(x)));
  if (!ok) throw new Error('rotation must be a 3x3 matrix of finite numbers');
  return Array.from(R, (r) => Array.from(r));
}

/**
 * markEdited(s, kind, { rotation }) of core/structure.js (F0-D §3.7) without importing that module. The table of
 * edit kinds, its error for an unknown kind and the touch() come from the structure itself: setPositions with an
 * empty list of atoms writes no coordinate and then applies markEdited(s, kind). For 'rotate' with a rotation the
 * Cartesian vector properties turn first, as markEdited turns them (rows v' = v · Rᵀ, a property only when every row
 * is three numbers; the same error for a bad rotation). Returns `s`.
 */
function markEditedOf(s, kind, rotation = null) {
  if (kind === 'rotate' && rotation != null) {
    const R = rotationRows(rotation);
    for (const key of VECTOR_PROPS) {
      const col = s.props?.[key];
      if (!isList(col) || !col.length || !Array.from(col).every(isVector3)) continue;
      s.props[key] = Array.from(col, (v) => [0, 1, 2].map((i) => R[i][0] * v[0] + R[i][1] * v[1] + R[i][2] * v[2]));
    }
  }
  s.setPositions({ indices: [], positions: [] }, { mark: kind });
  return s;
}

/**
 * What finishCellOp needs to know about structure `s` before a cell operation changes it. Call it on the input
 * structure first thing, before anything is computed, and pass the result on to finishCellOp unchanged; callers treat
 * it as opaque. This stub (M1-T1) returns `{ name: s.name }`. M1-T10 makes it `autoNameState(s)`, `{ name, suffix,
 * auto }` (ledger L-X-07, rule 1): whether the structure carries its automatic name, judged by `info.surface.autoName`
 * alone, the only sentinel of an automatic name (lead decision L-12).
 */
export function beginCellOp(s) {
  return { name: s.name };
}

/**
 * Bring the derived information of structure `s`, the result of a cell operation, up to date (in place). Call it once
 * on the result, as the last step before the result object is made: after the positions, the cell, the per-atom
 * properties, the constraint flags (applyBasisChange), the adsorbate ids and `info.supercellMatrix` are final, so that
 * the info handlers and the name see the finished structure. `before` is what beginCellOp returned for the input.
 * `ctx` (ledger L-M1-14; the Python twin uses the same keys in snake_case: id_offset, lattice_points, id_map):
 * - kind: 'supercell', 'basis' (redefined, reduced, conventional or right-handed cell, renamed axes), 'primitive',
 *   'rotation', 'deform' (setCell, cell parameters, strain) or 'translate' (origin shift, wrap)
 * - old: the input structure (unchanged); new: the result, the same object as `s`
 * - mark: the markEdited kind (M1 §3.4): 'repeat' for a diagonal supercell, 'cell' for any other new lattice,
 *   'rotate' for a rigid rotation, null when nothing derived goes stale (origin shift, wrap, renamed axes)
 * - matrix: the integer change of basis, new cell = matrix · old cell (P, U or C); else null
 * - transform: a primitive cell: { num: 3×3 int, den: int }, new cell = num / den · old cell
 * - rotation: a rotation R (3×3, cart' = cart · Rᵀ); deformation: a deformation F (cell' = cell · Fᵀ)
 * - src: the new → old source map (null: the same atoms)
 * - images: a supercell: |det P|; idOffset: the adsorbate_id increment from one image to the next;
 *   latticePoints: supercellLatticePoints(P), the translation of each image
 * - idMap: a primitive cell: old adsorbate_id → new; perm: renamed axes: the permutation of the cell vectors
 * kind, old, new and mark are required; leave out (or set to null) what does not apply. A ctx that is not an object,
 * misses a required field, has another kind or another `new` throws (TypeError, Error) before anything changes.
 *
 * This stub (M1-T1) only applies markEdited(s, ctx.mark, { rotation: ctx.rotation }), and nothing when mark is null.
 * M1-T10 replaces the body with markEdited, then applyInfoHandlers(ctx), then refreshAutoName(s, before,
 * { cellChange: { matrix, cell: the old cell, previous: the old info.supercellMatrix } }) and, when that returns
 * false, s.name = renameAfterCellChange(…) (ledger L-X-07, rule 4: names after the info handlers, so that they see
 * the rewritten records and ids). The surface-cell label in a name is computed from the accumulated
 * info.supercellMatrix alone: a preset's own label (`c(2×2)`) goes into the result's `label` for the read-out and the
 * toast, never into the name (lead decision L-19).
 */
export function finishCellOp(s, ctx, before) {
  checkContext(s, ctx);
  if (ctx.mark != null) markEditedOf(s, ctx.mark, ctx.rotation ?? null);
}

function checkContext(s, ctx) {
  if (!isPlainObject(ctx)) throw new TypeError('finishCellOp: ctx must be an object');
  const missing = CTX_REQUIRED.filter((k) => ctx[k] === undefined);
  if (missing.length) throw new Error(`finishCellOp: ctx needs 'kind', 'old', 'new' and 'mark' (missing ${missing.map((k) => `'${k}'`).join(', ')})`);
  if (!CTX_KINDS.includes(ctx.kind)) {
    throw new Error(`finishCellOp: unknown kind '${String(ctx.kind)}' (use ${CTX_KINDS.slice(0, -1).join(', ')} or ${CTX_KINDS.at(-1)})`);
  }
  if (ctx.new !== s) throw new Error('finishCellOp: ctx.new must be the structure being finished');
}
// --- end M1-T10 ---
