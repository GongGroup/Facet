/**
 * What each file writer can store: the capability table of the export check (F0-D §3.12.1). exportReport
 * (io/index.js) compares a writer's capabilities with the structure to tell what the file loses (warnings) and what
 * changes without affecting a calculation (notes). The built-in formats carry the rows of WRITER_CAPABILITIES; a
 * plugin format declares its own `capabilities` (formats.register validates them), the server-only formats copy
 * theirs from GET /formats (a Python plugin declares them with ctx.register_writer), and a format without
 * capabilities gets no report at all (nothing is guessed).
 *
 * | id | label | frames | cell | constraints | occupancy | order | pbc | overlap | handedness | velocities |
 * |---|---|---|---|---|---|---|---|---|---|---|
 * | json | Crystallume JSON | all | true | lattice | true | keep | stored | false | false | true |
 * | extxyz | Extended XYZ | all | true | cartesian | true | keep | stored | true | false | true |
 * | xyz | plain XYZ | all | false | none | false | keep | none | false | false | false |
 * | poscar | POSCAR | one | required | lattice | false | species | periodic | true | true | true |
 * | cif | CIF | one | required | none | true | keep | periodic | true | false | false |
 * | pdb | PDB | all | true | none | false | keep | periodic | false | false | false |
 *
 * `frames`: all frames or one (the report names the frame written); `cell`: stored, not stored or required;
 * `constraints`: selective dynamics along the cell vectors (lattice), along x, y, z (cartesian: ASE's move_mask) or
 * not at all; `order`: kept, or grouped by species (POSCAR); `pbc`: stored in the file, T T T whenever there is a
 * cell (periodic), or no cell (none); `overlap`, `handedness`: look for atoms closer than 0.5 Å and for a
 * left-handed cell; `velocities` (optional, OPTIONAL_CAPABILITIES): props.velocities is written. Lead decision L-01
 * asks for a note when velocities are dropped; the column is an addition to the nine of F0-D §3.12.1 (ledger
 * L-F0-25), so a format may leave it out, and then the export check says nothing about velocities.
 *
 * The Python twin is crystallume/io/capabilities.py: the same table, the same validation and, word for word, the
 * same messages (a test compares the two tables).
 */

/** The capabilities, in table order, with their allowed values (null: a non-empty string). */
export const CAPABILITY_VALUES = Object.freeze({
  label: null,
  frames: Object.freeze(['all', 'one']),
  cell: Object.freeze([true, false, 'required']),
  constraints: Object.freeze(['lattice', 'cartesian', 'none']),
  occupancy: Object.freeze([true, false]),
  order: Object.freeze(['keep', 'species']),
  pbc: Object.freeze(['stored', 'periodic', 'none']),
  overlap: Object.freeze([true, false]),
  handedness: Object.freeze([true, false]),
  velocities: Object.freeze([true, false]),
});
/**
 * The capabilities a format may leave out (null or undefined count as left out): velocities, which lead decision
 * L-01 added to the table of F0-D §3.12.1. Every other key of CAPABILITY_VALUES is required.
 */
export const OPTIONAL_CAPABILITIES = Object.freeze(['velocities']);

const KEYS = Object.keys(CAPABILITY_VALUES);
const REQUIRED = KEYS.filter((k) => !OPTIONAL_CAPABILITIES.includes(k));
const row = (label, frames, cell, constraints, occupancy, order, pbc, overlap, handedness, velocities) =>
  Object.freeze({ label, frames, cell, constraints, occupancy, order, pbc, overlap, handedness, velocities });

/** The capabilities of the built-in writers (frozen; the table above). */
export const WRITER_CAPABILITIES = Object.freeze({
  json: row('Crystallume JSON', 'all', true, 'lattice', true, 'keep', 'stored', false, false, true),
  extxyz: row('Extended XYZ', 'all', true, 'cartesian', true, 'keep', 'stored', true, false, true),
  xyz: row('plain XYZ', 'all', false, 'none', false, 'keep', 'none', false, false, false),
  poscar: row('POSCAR', 'one', 'required', 'lattice', false, 'species', 'periodic', true, true, true),
  cif: row('CIF', 'one', 'required', 'none', true, 'keep', 'periodic', true, false, false),
  pdb: row('PDB', 'all', true, 'none', false, 'keep', 'periodic', false, false, false),
});

/** The overlap check of the export is skipped (with a note) for structures with more atoms than this. */
export const OVERLAP_CHECK_MAX_ATOMS = 200000;
/** A site whose occupancy differs from 1 by more than this is partially occupied. */
export const OCCUPANCY_TOLERANCE = 1e-6;

const choices = (values) => (values.every((v) => typeof v === 'boolean') ? 'true or false' : `one of ${values.map(String).join(', ')}`);
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v);

/**
 * Check the capabilities `caps` of writer `name` and return them as a new frozen object in table order. Every key
 * of CAPABILITY_VALUES is required except those of OPTIONAL_CAPABILITIES, which may be left out, null or undefined
 * (and are then left out of the result), and no other key is allowed; booleans must be true or false. Throws an
 * Error naming the writer and the key, e.g. `writer 'myfmt': capabilities.constraints must be one of lattice, cartesian, none`.
 */
export function validateCapabilities(name, caps) {
  const where = `writer '${name}'`;
  if (!isPlainObject(caps)) {
    throw new Error(`${where}: capabilities must be an object with the keys ${REQUIRED.join(', ')} (optional: ${OPTIONAL_CAPABILITIES.join(', ')})`);
  }
  const unknown = Object.keys(caps).filter((k) => !KEYS.includes(k));
  if (unknown.length) throw new Error(`${where}: unknown capability '${unknown[0]}' (known: ${KEYS.join(', ')})`);
  const out = {};
  for (const key of KEYS) {
    const values = CAPABILITY_VALUES[key];
    const value = caps[key];
    if (value == null && OPTIONAL_CAPABILITIES.includes(key)) continue;
    if (values === null) {
      if (typeof value !== 'string' || !value.trim()) throw new Error(`${where}: capabilities.${key} must be a non-empty string`);
    } else if (!values.includes(value)) {
      throw new Error(`${where}: capabilities.${key} must be ${choices(values)}`);
    }
    out[key] = value;
  }
  return Object.freeze(out);
}
