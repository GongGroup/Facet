// The POSCAR reader and writer of the web app (web/js/io/poscar.js; F0-D §3.10 and the POSCAR items of §7.2):
// tolerant Selective dynamics flags (the reader used to drop them, the writer never wrote them), Cartesian files,
// repeated element blocks, XDATCAR frames with their own cells, CONTCAR velocities, no -0.0, the errors and the U1
// round trip of the CONTCAR fixture. The shared cases (tests/data/surface/f0d/poscar.json) run in cases.test.mjs.
// Run: node --test tests/js/io_poscar.test.mjs (or through pytest: tests/test_js_unit.py).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Structure } from '../../crystallume/web/js/core/structure.js';
import { readPOSCAR, writePOSCAR } from '../../crystallume/web/js/io/poscar.js';
import { detectFormat, exportStructure, formats, parseStructure } from '../../crystallume/web/js/io/index.js';
import { poscarCanonical } from './ops/f0d_poscar.mjs';
import { repoPath } from './helpers.mjs';

const T = true, F = false;
const CUBE4 = 'test\n1.0\n4.0 0.0 0.0\n0.0 4.0 0.0\n0.0 0.0 4.0\n';
const SD_NOTE = (n, line, what) => `selective dynamics: ${n} line(s) had missing or unreadable T/F flags (first: line ${line}, ${what}); those directions were read as T (free)`;
const GAAS = (species) => `GaAs slab\n1.0\n4.0 0.0 0.0\n0.0 4.0 0.0\n0.0 0.0 20.0\n${species}\n1 1 2 2\nDirect\n0 0 0\n0.5 0.5 0.1\n0 0 0.2\n0.5 0 0.2\n0 0.5 0.3\n0.5 0.5 0.3\n`;
const sdPoscar = (...rows) => `${CUBE4}Pt\n${rows.length}\nSelective dynamics\nDirect\n${rows.map((r) => `0.1 0.2 0.3 ${r}\n`).join('')}`;
const notes = (s) => s.info.warnings ?? [];
const close = (a, b, tol = 1e-12) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= tol);
const cube = (symbols, positions, props = {}) => new Structure({ name: 'cube', symbols, positions, cell: [[4, 0, 0], [0, 4, 0], [0, 0, 4]], props });
/** The species and counts lines of POSCAR text. */
const blocks = (text) => { const l = text.split('\n'); return [l[5].trim().split(/\s+/), l[6].trim().split(/\s+/).map(Number)]; };
const contcar = () => readFileSync(repoPath('tests/data/surface/contcar_pt111.vasp'), 'utf8');

describe('Selective dynamics: reading (F0-D §3.10.1)', () => {
  test('the table of flag words', () => {
    for (const [words, flags, problem] of [
      ['T T F', [T, T, F], null], ['.TRUE. .TRUE. .FALSE.', [T, T, F], null], ['.T. .F. .T.', [T, F, T], null],
      ['true false TRUE', [T, F, T], null], ['t f t', [T, F, T], null], ['T T F Si', [T, T, F], null],
      ['Si', [T, T, T], 'no flags'], ['F', [T, T, T], 'no flags'], ['', [T, T, T], 'no flags'],
      ['Fe Fe Fe', [T, T, T], "'Fe'"], ['T T F ! Pt1', [T, T, F], null],
    ]) {
      const s = readPOSCAR(sdPoscar(words));
      assert.deepEqual(s.props.selective_dynamics, [flags], words);
      assert.deepEqual(notes(s), problem ? [SD_NOTE(1, 10, problem)] : [], words);
    }
  });

  test('one note counts the lines and names the first problem', () => {
    const s = readPOSCAR(sdPoscar('T T F', 'T T', 'Fe T F', 'F F F', 'T .X. F'));
    assert.deepEqual(s.props.selective_dynamics, [[T, T, F], [T, T, T], [T, T, F], [F, F, F], [T, T, F]]);
    assert.deepEqual(notes(s), [SD_NOTE(3, 11, 'no flags')]);
    const vasp4 = 'Pt slab\n1.0\n4 0 0\n0 4 0\n0 0 4\n2\nSelective dynamics\nDirect\n0 0 0 T x T\n0.5 0.5 0.5\n';
    assert.deepEqual(notes(readPOSCAR(vasp4)), [SD_NOTE(2, 9, "'x'")]);
    assert.ok(!('selective_dynamics' in readPOSCAR(`${CUBE4}Pt\n1\nDirect\n0 0 0 F F F\n`).props));
  });

  test('flags of a Cartesian file refer to the cell vectors and are not converted (domain review F8)', () => {
    const s = readPOSCAR('tilted\n1.0\n4.0 0.0 0.0\n0.0 4.0 0.0\n1.5 0.8 20.0\nO\n2\nSelective dynamics\nCartesian\n0.0 0.0 0.0 T T F\n1.5 0.8 10.0 F F T\n');
    assert.deepEqual(s.props.selective_dynamics, [[T, T, F], [F, F, T]]);
    assert.ok(close(Array.from(s.positions), [0, 0, 0, 1.5, 0.8, 10]));
    const back = readPOSCAR(writePOSCAR(s));
    assert.deepEqual(back.props.selective_dynamics, s.props.selective_dynamics);
    assert.ok(close(Array.from(back.positions), Array.from(s.positions), 1e-9));
  });
});

describe('writing (F0-D §3.10.2)', () => {
  test('Selective dynamics whenever the key exists; flag rows follow their atoms', () => {
    const s = cube(['O', 'Ti', 'O', 'Ti'], [[0, 0, 0], [2, 0, 0], [0, 2, 0], [2, 2, 2]], { selective_dynamics: [[F, F, F], [T, T, F], [T, T, T], [F, F, T]] });
    const text = writePOSCAR(s);
    assert.deepEqual(blocks(text), [['O', 'Ti'], [2, 2]]);
    const rows = text.split('\n').slice(9, 13).map((r) => r.trim().split(/\s+/));
    assert.deepEqual(rows.map((r) => r.slice(3)), [['F', 'F', 'F'], ['T', 'T', 'T'], ['T', 'T', 'F'], ['F', 'F', 'T']]);
    assert.deepEqual(rows[1].slice(0, 3), ['0.0000000000', '0.5000000000', '0.0000000000']);
    s.addAtom('H', [1, 1, 3]);   // a new atom is free: the block stays
    const back = readPOSCAR(writePOSCAR(s));
    assert.deepEqual(back.symbols, ['O', 'O', 'Ti', 'Ti', 'H']);
    assert.deepEqual(back.props.selective_dynamics.at(-1), [T, T, T]);
    const free = cube(['Pt'], [[0, 0, 0]], { selective_dynamics: [[T, T, T]] });
    assert.ok(writePOSCAR(free).includes('Selective dynamics'));
    assert.deepEqual(readPOSCAR(writePOSCAR(free)).props.selective_dynamics, [[T, T, T]]);
    assert.ok(!writePOSCAR(cube(['Pt'], [[0, 0, 0]])).includes('Selective dynamics'));
    s.props.selective_dynamics[0] = null;   // one bad row used to drop the whole block
    assert.deepEqual(readPOSCAR(writePOSCAR(s)).props.selective_dynamics[0], [T, T, T]);
  });

  test('the export path of the app writes the flags (formats registry, exportStructure)', () => {
    const s = readPOSCAR(contcar(), 'CONTCAR');
    assert.equal(formats.get('poscar').write, writePOSCAR);
    const out = exportStructure(s, 'poscar');
    assert.ok(out.filename.endsWith('.vasp'));
    assert.ok(out.text.includes('Selective dynamics'));
    assert.equal(out.text.split('\n').filter((l) => /F {2}F {2}F$/.test(l)).length, 18);
  });

  test('the current frame is written', () => {
    const s = new Structure({ name: 'traj', symbols: ['H'], positions: [[0, 0, 0]], cell: [[4, 0, 0], [0, 4, 0], [0, 0, 4]],
      frames: [{ positions: [[2.5, 2.5, 2.5]], cell: [[5, 0, 0], [0, 5, 0], [0, 0, 5]] }] });
    s.setFrame(1);
    const back = readPOSCAR(writePOSCAR(s));
    assert.ok(close(Array.from(back.positions), [2.5, 2.5, 2.5], 1e-9));
    assert.deepEqual(back.cell, [[5, 0, 0], [0, 5, 0], [0, 0, 5]]);
  });

  test('order keep writes runs in memory order; other orders are refused', () => {
    const s = cube(['O', 'O', 'Ti', 'O'], [[0, 0, 0], [0, 2, 0], [2, 0, 0], [2, 2, 2]]);
    assert.deepEqual(blocks(writePOSCAR(s, { order: 'keep' })), [['O', 'Ti', 'O'], [2, 1, 1]]);
    assert.deepEqual(readPOSCAR(writePOSCAR(s, { order: 'keep' })).symbols, s.symbols);
    assert.throws(() => writePOSCAR(s, { order: 'sorted' }), { message: "order must be 'species' or 'keep'" });
    assert.throws(() => writePOSCAR(new Structure({ symbols: ['H'], positions: [[0, 0, 0]] })), /POSCAR needs a unit cell/);
  });

  test('no -0.0 (lead decision L-01)', () => {
    const s = new Structure({ name: 'noise', symbols: ['Pt', 'Pt'], positions: [[-1e-17, 2, -0], [1, -4e-12, 3]],
      cell: [[4, -1e-17, 0], [0, 4, -0], [-5e-12, 0, 4]] });
    const text = writePOSCAR(s);
    assert.ok(!text.includes('-0.0'), text);
    assert.equal(text.split('0.0000000000').length - 1, 9);
  });
});

describe('repeated element blocks (F0-D §3.10.4)', () => {
  test('Ga As H H / 1 1 2 2 round trip; a new H joins the first H block', () => {
    const s = readPOSCAR(GAAS('Ga As H H'));
    assert.deepEqual(s.props.poscar_species, ['Ga', 'As', 'H', 'H', 'H#2', 'H#2']);
    assert.deepEqual(blocks(writePOSCAR(s)), [['Ga', 'As', 'H', 'H'], [1, 1, 2, 2]]);
    s.addAtom('H', [2, 2, 8]);
    assert.equal(s.props.poscar_species.at(-1), 'H');
    assert.deepEqual(blocks(writePOSCAR(s)), [['Ga', 'As', 'H', 'H'], [1, 1, 3, 2]]);
    s.sortBySpecies();
    assert.deepEqual(s.props.poscar_species, ['Ga', 'As', 'H', 'H', 'H', 'H#2', 'H#2']);
  });

  test('raw words, element symbols on the species line, no key without repeats, stale labels', () => {
    const raw = readPOSCAR(GAAS('Ga As H.75 H1.25'));
    assert.deepEqual(raw.props.poscar_species, ['Ga', 'As', 'H.75', 'H.75', 'H1.25', 'H1.25']);
    assert.deepEqual(blocks(writePOSCAR(raw))[0], ['Ga', 'As', 'H', 'H']);
    assert.ok(!('poscar_species' in readPOSCAR(`${CUBE4}Ga As\n1 1\nDirect\n0 0 0\n0.5 0.5 0.5\n`).props));
    const stale = cube(['H', 'O', 'H'], [[0, 0, 0], [2, 0, 0], [0, 2, 0]], { poscar_species: ['H', 'H#2', 'H#2'] });
    assert.deepEqual(blocks(writePOSCAR(stale)), [['H', 'O', 'H'], [1, 1, 1]]);
  });
});

describe('XDATCAR (F0-D §3.10.5)', () => {
  const head = (a) => `H2\n           1\n    ${a.toFixed(6)}    0.000000    0.000000\n     0.000000   10.000000    0.000000\n     0.000000    0.000000   10.000000\n   H\n     2\n`;
  const text = `${head(10)}Direct configuration=     1\n  0.0 0.0 0.0\n  0.075 0.0 0.0\n`
    + `${head(11)}Direct configuration=     2\n  0.1 0.0 0.0\n  0.175 0.0 0.0\n`
    + 'Direct configuration=     3\n  0.2 0.0 0.0\n  0.275 0.0 0.0\n';

  test('each frame is converted with its own cell (ledger E-18)', () => {
    const s = readPOSCAR(text, 'XDATCAR');
    assert.equal(s.nFrames, 3);
    assert.deepEqual(s.frames[0].cell, [[11, 0, 0], [0, 10, 0], [0, 0, 10]]);
    assert.ok(close(Array.from(s.frames[0].positions), [1.1, 0, 0, 1.925, 0, 0], 1e-12));   // not 1.0 and 1.75
    assert.equal(s.frames[1].cell, null);
    assert.ok(close(Array.from(s.frames[1].positions), [2, 0, 0, 2.75, 0, 0], 1e-12));
    s.setFrame(1);
    assert.deepEqual(s.cell, [[11, 0, 0], [0, 10, 0], [0, 0, 10]]);
    s.setFrame(2);
    assert.deepEqual(s.cell, [[10, 0, 0], [0, 10, 0], [0, 0, 10]]);
  });

  test('a file named XDATCAR is read as POSCAR; a cut-off last configuration is skipped', () => {
    assert.equal(detectFormat('XDATCAR', text), 'poscar');
    assert.equal(parseStructure(text, 'XDATCAR').nFrames, 3);
    const cut = readPOSCAR(text.slice(0, text.lastIndexOf('  0.275')));
    assert.equal(cut.nFrames, 2);
    assert.deepEqual(notes(cut), ['XDATCAR: the last configuration is incomplete and was skipped']);
  });
});

describe('CONTCAR velocities (lead decision L-01, F0-D §3.10.6)', () => {
  const head = `${CUBE4}O Ti\n1 1\nDirect\n0 0 0\n0.5 0.5 0.5\n`;

  test('non-zero velocities are read as Cartesian Å/fs and written back with their atoms', () => {
    const s = readPOSCAR(`${head}\n  0.01 0.0 0.0\n  0.0 -0.02 0.005\n\n   1\n   1.0\n`);
    assert.deepEqual(s.props.velocities, [[0.01, 0, 0], [0, -0.02, 0.005]]);
    assert.deepEqual(notes(s), []);
    const text = writePOSCAR(s);
    assert.equal(text.split('\n')[10], '');
    assert.deepEqual(readPOSCAR(text).props.velocities, s.props.velocities);
    s.sortBySpecies(['Ti', 'O']);
    assert.deepEqual(readPOSCAR(writePOSCAR(s)).props.velocities, [[0, -0.02, 0.005], [0.01, 0, 0]]);
  });

  test('zero, scaled, Direct, lattice-velocity and incomplete blocks', () => {
    const zero = readPOSCAR(`${head}\n0 0 0\n0 0 0\n`);
    assert.ok(!('velocities' in zero.props));
    assert.equal(writePOSCAR(zero).split('\n').length, 11);
    const scaled = readPOSCAR(`${head.replace('1.0\n4.0', '2.0\n2.0').replaceAll('0.0 4.0', '0.0 2.0')}\n0.01 0 0\n0 0 0\n`);
    assert.deepEqual(scaled.cell, [[4, 0, 0], [0, 4, 0], [0, 0, 4]]);
    assert.deepEqual(scaled.props.velocities[0], [0.01, 0, 0]);   // the scale factor does not apply
    const direct = readPOSCAR(`${head}Direct\n0.01 0 0\n0 0.02 0\n`);
    assert.ok(close(direct.props.velocities.flat(), [0.04, 0, 0, 0, 0.08, 0]));
    assert.deepEqual(notes(direct), ['velocities in direct coordinates were converted to Å/fs assuming a time step of 1 fs']);
    const lattice = 'Lattice velocities and vectors\n1\n0 0 0\n0 0 0\n0 0 0\n4 0 0\n0 4 0\n0 0 4\n\n0.01 0 0\n0 0.02 0\n';
    assert.deepEqual(readPOSCAR(head + lattice).props.velocities, [[0.01, 0, 0], [0, 0.02, 0]]);
    const cut = readPOSCAR(`${head.replace('1 1\n', '1 2\n')}0 0.5 0\n\n0.01 0 0\n0 0.02 0\n`);
    assert.ok(!('velocities' in cut.props));
    assert.deepEqual(notes(cut), ['velocities: the block after the coordinates is incomplete (line 15); it was ignored']);
  });
});

describe('errors (the texts of the Python reader)', () => {
  test('they name the line', () => {
    for (const [text, message] of [
      [`${CUBE4}H\nx\nDirect\n0 0 0\n0 0 0\n`, "line 7: expected the atom counts (whole numbers), found 'x'"],
      [`${CUBE4}H\n2\nDirect\n0 0 0\n0 0\n`, 'line 10: expected three coordinates, found 2'],
      [`${CUBE4}H\n3\nDirect\n0 0 0\n0 0 0\n`, 'expected 3 coordinate line(s), found 2'],
      ['x\n1.0\n4 0 0\n0 inf 0\n0 0 4\nH\n1\nDirect\n0 0 0\n', "line 4: expected a number, found 'inf'"],
      ['not a poscar', 'POSCAR is too short: it needs a comment line, a scale factor, three lattice vectors, the atom counts and the coordinates'],
    ]) assert.throws(() => readPOSCAR(text), { message }, message);
  });
});

describe('the CONTCAR fixture (design brief U1, acceptance S14)', () => {
  test('read and written without an edit: the same file, order, flags and pbc, atoms within 1e-8 Å', () => {
    const original = contcar();
    const s = parseStructure(original, 'contcar_pt111.vasp');
    assert.deepEqual(s.pbc, [T, T, T]);
    assert.deepEqual(notes(s), []);
    assert.deepEqual(Object.keys(s.props), ['selective_dynamics']);
    assert.deepEqual(s.props.selective_dynamics, [...Array(18).fill([F, F, F]), ...Array(18).fill([T, T, T])]);
    const text = exportStructure(s, 'poscar').text;
    assert.deepEqual(poscarCanonical(text), poscarCanonical(original));
    assert.ok(!text.includes('-0.0'));
    const back = parseStructure(text, 'CONTCAR');
    assert.deepEqual(back.pbc, [T, T, T]);
    assert.deepEqual(back.symbols, s.symbols);
    assert.deepEqual(back.props.selective_dynamics, s.props.selective_dynamics);
    let shift = 0;
    for (let i = 0; i < s.length; i++) shift = Math.max(shift, Math.hypot(...[0, 1, 2].map((k) => back.pos(i)[k] - s.pos(i)[k])));
    assert.ok(shift <= 1e-8, `${shift}`);
    const f = back.fracPositions();
    assert.ok(Math.abs(f[3 * 3 + 2] - 0.99999) < 1e-9 && Math.abs(f[3 * 7 + 2] - 0.99999) < 1e-9 && f[2] === 0);   // not wrapped
  });
});
