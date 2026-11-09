// Extended XYZ (F0-D T5) and the reader fixes of the web CIF and PDB readers (S-6, S-7): what the shared cases of
// tests/data/surface/f0d/extxyz.json (run for both languages by cases.test.mjs) do not show. Run:
// node --test tests/js/io_extxyz.test.mjs (or through pytest: tests/test_js_unit.py).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as xyz from '../../crystallume/web/js/io/xyz.js';
import { parseStructure, exportStructure } from '../../crystallume/web/js/io/index.js';
import { readCIF } from '../../crystallume/web/js/io/cif.js';
import { readPDB } from '../../crystallume/web/js/io/pdb.js';
import { Structure } from '../../crystallume/web/js/core/structure.js';
import { repoPath } from './helpers.mjs';

const { readXYZ, writeXYZ, kvTokenize, convertValue, formatInfoValue, extxyzColumns } = xyz;
const T = true, F = false;
const ORTHO = [[4, 0, 0], [0, 4, 0], [0, 0, 20]];
const fixture = (name) => readFileSync(repoPath(`tests/data/surface/${name}`), 'utf8');

describe('comment line', () => {
  test('the old parseKeyValues is gone (kvTokenize replaces it)', () => {
    assert.equal(xyz.parseKeyValues, undefined);
    assert.deepEqual(Object.keys(xyz).sort(), ['convertValue', 'extxyzColumns', 'formatInfoValue', 'kvTokenize', 'readXYZ', 'writeXYZ']);
  });

  test('an ASE _JSON value with escaped quotes is no longer cut at the first quote (the old _JSON {\\ bug)', () => {
    const line = 'surface="_JSON {\\"miller\\": [1, 1, 1]}" pbc="T T T"';
    assert.deepEqual(kvTokenize(line), [['surface', '_JSON {"miller": [1, 1, 1]}'], ['pbc', 'T T T']]);
    assert.deepEqual(convertValue(kvTokenize(line)[0][1]), { miller: [1, 1, 1] });
  });

  test('whitespace is the Python set: U+001C and U+0085 split, U+FEFF does not', () => {
    assert.deepEqual(kvTokenize('a=1\x1cb=2\x85c=3\ufeffd=4'), [['a', '1'], ['b', '2'], ['c', '3\ufeffd=4']]);
  });

  test('values convert with ASCII numbers only', () => {
    assert.equal(convertValue('Infinity'), 'Infinity');
    assert.equal(convertValue('0x10'), '0x10');
    assert.equal(convertValue('1_000'), '1_000');
    assert.equal(convertValue('1e999'), '1e999');
    assert.deepEqual(convertValue('1,2 3'), [1, 2, 3]);
    assert.equal(convertValue(null), true);
    assert.equal(convertValue('_JSON [1, Infinity]'), '_JSON [1, Infinity]');
    assert.equal(convertValue('_JSON 1e400'), '_JSON 1e400');
  });

  test('info values: whole numbers of the calculated results read back as floats; typed arrays are lists', () => {
    assert.equal(formatInfoValue('energy', -71), '-71.0');
    assert.equal(formatInfoValue('n', -71), '-71');
    assert.equal(formatInfoValue('v', Float64Array.from([1.5, 2])), '"1.5 2.0"');
    assert.equal(formatInfoValue('x', NaN), null);
    assert.equal(formatInfoValue('x', [1, NaN]), null);
    assert.equal(formatInfoValue('x', { a: Infinity }), null);
    assert.equal(formatInfoValue('x', undefined), null);
    assert.equal(formatInfoValue('x', 10n), null);
  });
});

describe('reading', () => {
  test('every column is kept with its type, and the name never comes from config_type', () => {
    const text = '2\nLattice="5 0 0 0 5 0 0 0 5" Properties=species:S:1:pos:R:3:forces:R:3:label:S:1:fixed:L:1:tags:I:1 '
      + 'energy=-12.5 pbc="T T F" config_type=bulk\nSi 0 0 0 0.1 0 0 Si1 T 1\nSi 1.3 1.3 1.3 -0.1 0 0 Si2 F 2\n';
    const s = readXYZ(text, 'bulk-si.extxyz');
    assert.equal(s.name, 'bulk-si');
    assert.equal(readXYZ(text).name, 'XYZ structure');
    assert.deepEqual(s.props.forces, [[0.1, 0, 0], [-0.1, 0, 0]]);
    assert.deepEqual(s.props.label, ['Si1', 'Si2']);
    assert.deepEqual(s.props.fixed, [true, false]);
    assert.deepEqual(s.props.tags, [1, 2]);
    assert.equal(s.props.selective_dynamics, undefined);
    assert.deepEqual(s.info, { energy: -12.5, config_type: 'bulk' });
  });

  test('frames keep their own cells; only the first frame gives props and info', () => {
    const text = '1\nLattice="4 0 0 0 4 0 0 0 4" Properties=species:S:1:pos:R:3:q:R:1 pbc="T T T" e=1\nPt 0 0 0 0.5\n'
      + '1\nLattice="4 0 0 0 4 0 0 0 5" Properties=species:S:1:pos:R:3 pbc="T T T" e=2\nPt 0 0 1\n';
    const s = readXYZ(text);
    assert.equal(s.nFrames, 2);
    assert.deepEqual(s.props.q, [0.5]);
    assert.equal(s.info.e, 1);
    assert.deepEqual(s.getFrame(1).cell[2], [0, 0, 5]);
    assert.deepEqual(Array.from(s.getFrame(1).positions), [0, 0, 1]);
  });

  test('a count line that promises more atoms than the file has fails with a message, not a RangeError', () => {
    assert.throws(() => readXYZ('99999999999999999999\ncomment\n'), /^Error: XYZ: file ended early at line 3 \(frame 1 declares 99999999999999999999 atoms, found 0\)$/);
    assert.throws(() => readXYZ('007\nx\nO 0 0 0\n'), /declares 7 atoms, found 1/);
  });

  test('a byte-order mark and old Mac line breaks are accepted', () => {
    const s = readXYZ('\ufeff1\rplain\r\nO 0 0 0\r');
    assert.deepEqual(s.symbols, ['O']);
    assert.equal(s.name, 'plain');
  });

  test('the shared fixtures read through the format registry', () => {
    const s = parseStructure(fixture('ase329_fixcartesian.extxyz'), 'ase329_fixcartesian.extxyz');
    assert.equal(s.info.source, 'extxyz');
    assert.deepEqual(s.props.selective_dynamics[3], [false, false, true]);
    const old = parseStructure(fixture('crystallume031_sd.extxyz'), 'crystallume031_sd.extxyz');
    assert.deepEqual(old.props.selective_dynamics[1], [true, true, false]);
  });
});

describe('writing', () => {
  const slab = () => new Structure({
    name: 'Pt slab', symbols: ['Pt', 'Pt', 'O'], positions: [[0, 0, 0], [2, 2, 0], [0, 0, 2]], cell: ORTHO,
    props: { selective_dynamics: [[F, F, F], [T, T, F], [T, T, T]], tags: [2, 1, 0], labels: ['Pt1', 'Pt2', 'O1'] },
    info: { energy: -3.5, surface: { miller: [1, 1, 1] }, warnings: ['a note'], source: 'cif' },
  });

  test('props and info are written (the web writer wrote neither)', () => {
    const lines = writeXYZ(slab()).split('\n');
    assert.equal(lines[1], 'Lattice="4.00000000 0.00000000 0.00000000 0.00000000 4.00000000 0.00000000 0.00000000 0.00000000 20.00000000" '
      + 'Properties=species:S:1:pos:R:3:move_mask:L:3:tags:I:1:labels:S:1 pbc="T T T" name="Pt slab" energy=-3.5 '
      + 'surface="_JSON {\\"miller\\":[1,1,1]}"');
    assert.ok(lines[3].endsWith(' T T F 1 Pt2'));
  });

  test('a structure without a cell still gets Properties and pbc', () => {
    const s = new Structure({ name: 'CO', symbols: ['C', 'O'], positions: [[0, 0, 0], [0, 0, 1.13]] });
    const head = writeXYZ(s).split('\n')[1];
    assert.equal(head, 'Properties=species:S:1:pos:R:3 pbc="F F F" name=CO');
    assert.equal(writeXYZ(s, { extended: false }).split('\n')[1], 'CO');
  });

  test('every frame is written from its own arrays and the current frame is left as it was', () => {
    const s = slab();
    s.frames = [{ positions: Float64Array.from([0, 0, 0.5, 2, 2, 0.5, 0, 0, 2.5]), cell: [[4, 0, 0], [0, 4, 0], [0, 0, 22]] }];
    s.setFrame(1);
    const text = writeXYZ(s);
    assert.equal(s.frame, 1);
    const frames = text.split('\n');
    assert.ok(frames[1].includes('energy=-3.5') && !frames[6].includes('energy'));
    assert.ok(frames[6].startsWith('Lattice="4.00000000 0.00000000 0.00000000 0.00000000 4.00000000 0.00000000 0.00000000 0.00000000 22.00000000"'));
    assert.ok(frames[7].includes('0.50000000'));
  });

  test('extxyzColumns gives the move_mask with its tightened count and the props that are left out', () => {
    const s = slab();
    s.setProp('notes', ['a b', 'c', 'd']);
    const { columns, skipped } = extxyzColumns(s);
    assert.deepEqual(columns.map((c) => [c.name, c.type, c.width]), [['move_mask', 'L', 3], ['tags', 'I', 1], ['labels', 'S', 1]]);
    assert.equal(columns[0].tightened, 0);
    assert.deepEqual(skipped, [['notes', 'its values are not all numbers, booleans or single words']]);
  });

  test('numbers of float quantities are R columns even when whole', () => {
    const s = new Structure({ symbols: ['Na', 'Cl'], positions: [[0, 0, 0], [2.8, 0, 0]], props: { charges: [1, -1], initial_magmoms: [0, 0], n: [1, 2] } });
    assert.ok(writeXYZ(s).split('\n')[1].includes('Properties=species:S:1:pos:R:3:charges:R:1:initial_magmoms:R:1:n:I:1 '));
  });

  test('exportStructure writes extended XYZ with the constraints of the web model', () => {
    const { text, filename } = exportStructure(slab(), 'extxyz');
    assert.equal(filename, 'Pt-slab.extxyz');
    assert.ok(text.includes(':move_mask:L:3:'));
    assert.deepEqual(parseStructure(text, filename).props.selective_dynamics, slab().props.selective_dynamics);
  });
});

describe('CIF and PDB readers (F0-D S-6, S-7)', () => {
  test('CIF site labels are props.labels and the notes match the Python reader', () => {
    const cif = 'data_x\n_cell_length_a 4\n_cell_length_b 4\n_cell_length_c 4\n_symmetry_space_group_name_H-M "P 4/m m m"\n'
      + "loop_\n_atom_site_label\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\n_atom_site_occupancy\nFe1 0 0 0 0.5\n";
    const s = readCIF(cif);
    assert.deepEqual(s.props.labels, ['Fe1']);
    assert.equal(s.props.label, undefined);
    assert.deepEqual(s.info.warnings, [
      "no symmetry operators found for space group 'P 4/m m m'; atoms used as listed (P1)",
      'structure contains partially occupied sites (all sites kept)',
    ]);
    const quoted = readCIF(cif.replace('"P 4/m m m"', '"P 4\'"'));
    assert.equal(quoted.info.warnings[0], 'no symmetry operators found for space group "P 4\'"; atoms used as listed (P1)');
  });

  test('PDB residue names are props.residue_names and models of other sizes leave the Python note', () => {
    const atom = (n, x) => `ATOM  ${String(n).padStart(5)}  CA  GLY A   1    ${x.toFixed(3).padStart(8)}   0.000   0.000  1.00  0.00           C`;
    const pdb = ['MODEL        1', atom(1, 0), atom(2, 1.5), 'ENDMDL', 'MODEL        2', atom(1, 0), 'ENDMDL', 'END'].join('\n');
    const s = readPDB(pdb);
    assert.deepEqual(s.props.residue_names, ['GLY', 'GLY']);
    assert.equal(s.props.residue, undefined);
    assert.deepEqual(s.info.warnings, ['input contains 2 structures with different atom counts; only the first was loaded']);
  });
});
