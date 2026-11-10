// The export check on the web side (F0-D §3.12): the capability table and its validation in formats.register,
// exportReport and its rules, the synchronous contract of exportStructure (server formats through a fake store),
// and closeContacts against a brute-force search. The exact messages of every rule are shared cases in
// tests/data/surface/f0d/export.json (both languages); the Python side is tests/test_export.py.
// Run: node --test tests/js/export.test.mjs (or through pytest: tests/test_js_unit.py).
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Structure } from '../../crystallume/web/js/core/structure.js';
import { closeContacts } from '../../crystallume/web/js/core/contacts.js';
import { exportReport, exportStructure, formats, parseStructure } from '../../crystallume/web/js/io/index.js';
import { CAPABILITY_VALUES, OPTIONAL_CAPABILITIES, WRITER_CAPABILITIES, validateCapabilities } from '../../crystallume/web/js/io/capabilities.js';
import { writePOSCAR } from '../../crystallume/web/js/io/poscar.js';
import { installExtensions } from '../../crystallume/web/js/api/extensions.js';
import { repoPath } from './helpers.mjs';

const T = true, F = false;
const ORTHO = [[3, 0, 0], [0, 3, 0], [0, 0, 20]];
const HEX = [[2.77, 0, 0], [-1.385, 2.39889, 0], [0, 0, 20]];
const LEFT = [[0, 3, 0], [3, 0, 0], [0, 0, 20]];
const CONTCAR = readFileSync(repoPath('tests/data/surface/contcar_pt111.vasp'), 'utf8');

const two = ({ positions = [[0, 0, 1], [1.5, 1.5, 3]], cell = ORTHO, ...rest } = {}) => new Structure({ name: 'two', symbols: ['Pt', 'O'], positions, cell, ...rest });
const trajectory = (n = 3) => new Structure({
  name: 'traj', symbols: ['Pt', 'O'], positions: [[0, 0, 1], [1.5, 1.5, 3]], cell: ORTHO,
  frames: Array.from({ length: n - 1 }, (_, k) => ({ positions: [[0, 0, 1.1 + 0.1 * k], [1.5, 1.5, 3]] })),
});
const fixed = (flags) => new Structure({ symbols: flags.map(() => 'Pt'), positions: flags.map((_, i) => [0, 0, 1 + 2.3 * i]), cell: HEX, props: { selective_dynamics: flags } });
const has = (list, fragment) => list.some((m) => m.includes(fragment));
const MYFMT = { label: 'My format', frames: 'one', cell: true, constraints: 'none', occupancy: false, order: 'keep', pbc: 'stored', overlap: false, handedness: false, velocities: false };
/** The nine capabilities of ledger L-F0-25 (F0-D §3.12.1), without the optional velocities of lead decision L-01. */
const LEDGER = Object.fromEntries(Object.entries(MYFMT).filter(([k]) => k !== 'velocities'));

/** Collect console.warn calls while fn runs. */
function warnsDuring(fn) {
  const seen = [], orig = console.warn;
  console.warn = (...a) => seen.push(a.join(' '));
  try { fn(); } finally { console.warn = orig; }
  return seen;
}

describe('capabilities', () => {
  test('the built-in formats carry the table, in table order and frozen', () => {
    assert.deepEqual(Object.keys(WRITER_CAPABILITIES), ['json', 'extxyz', 'xyz', 'poscar', 'cif', 'pdb']);
    for (const [id, caps] of Object.entries(WRITER_CAPABILITIES)) {
      assert.deepEqual(Object.keys(caps), Object.keys(CAPABILITY_VALUES));
      assert.deepEqual(formats.get(id).capabilities, caps, id);
      assert.ok(Object.isFrozen(caps));
    }
    assert.ok(Object.isFrozen(WRITER_CAPABILITIES));
  });

  test('formats.register validates them: invalid ones are reported and dropped', () => {
    const offs = [];
    try {
      offs.push(formats.register({ id: 'jsfmt', write: () => 'x\n', capabilities: { ...MYFMT } }));
      assert.deepEqual(formats.get('jsfmt').capabilities, MYFMT);
      const warned = warnsDuring(() => offs.push(formats.register({ id: 'jsbad', write: () => 'x\n', capabilities: { ...MYFMT, constraints: 'yes' } })));
      assert.deepEqual(warned, ["Crystallume: writer 'jsbad': capabilities.constraints must be one of lattice, cartesian, none; the export check of this format is off"]);
      assert.equal(formats.get('jsbad').capabilities, null);
      offs.push(formats.register({ id: 'jsnone', write: () => 'x\n' }));
      assert.equal(formats.get('jsnone').capabilities, null);
      const s = trajectory(2);
      assert.deepEqual(exportReport(s, 'jsfmt'), { warnings: ['My format holds one frame: wrote frame 1 of 2'], notes: [] });
      assert.deepEqual(exportReport(s, 'jsbad'), { warnings: [], notes: [] });
      assert.deepEqual(exportReport(s, 'jsnone'), { warnings: [], notes: [] });
    } finally { offs.forEach((off) => off()); }
  });

  test('validateCapabilities: every key, known keys, the right values', () => {
    assert.deepEqual(validateCapabilities('x', WRITER_CAPABILITIES.cif), WRITER_CAPABILITIES.cif);
    const bad = [
      [{ ...MYFMT, overlap: 1 }, "writer 'myfmt': capabilities.overlap must be true or false"],
      [{ ...MYFMT, cell: null }, "writer 'myfmt': capabilities.cell must be one of true, false, required"],
      [{ ...MYFMT, label: '' }, "writer 'myfmt': capabilities.label must be a non-empty string"],
      [{ ...MYFMT, extra: true }, "writer 'myfmt': unknown capability 'extra'"],
      [{ ...MYFMT, velocities: 'yes' }, "writer 'myfmt': capabilities.velocities must be true or false"],
      [{ label: 'x' }, "writer 'myfmt': capabilities.frames must be one of all, one"],
      [null, "writer 'myfmt': capabilities must be an object with the keys label, frames, cell, constraints, occupancy, order, pbc, overlap, handedness (optional: velocities)"],
    ];
    for (const [caps, message] of bad) assert.throws(() => validateCapabilities('myfmt', caps), (e) => e.message.startsWith(message), message);
  });

  test('the nine capabilities of the ledger are enough: velocities is optional and nothing is guessed', () => {
    // velocities (lead decision L-01) may be left out, null or undefined
    const ledger = LEDGER;
    assert.deepEqual(Object.keys(ledger), ['label', 'frames', 'cell', 'constraints', 'occupancy', 'order', 'pbc', 'overlap', 'handedness']);
    assert.deepEqual(OPTIONAL_CAPABILITIES, ['velocities']);
    for (const caps of [ledger, { ...ledger, velocities: null }, { ...ledger, velocities: undefined }]) {
      const out = validateCapabilities('myfmt', caps);
      assert.deepEqual(out, ledger);
      assert.deepEqual(Object.keys(out), Object.keys(ledger));
    }
    const s = trajectory(2);
    s.setProp('velocities', [[0, 0, 0.01], [0, 0, 0]]);
    const offs = [];
    try {
      const warned = warnsDuring(() => offs.push(formats.register({ id: 'jsledger', write: () => 'x\n', capabilities: { ...ledger } })));
      assert.deepEqual(warned, []);
      assert.deepEqual(formats.get('jsledger').capabilities, ledger);
      assert.deepEqual(exportReport(s, 'jsledger'), { warnings: ['My format holds one frame: wrote frame 1 of 2'], notes: [] });
      offs.push(formats.register({ id: 'jsnovel', write: () => 'x\n', capabilities: { ...ledger, velocities: false } }));
      assert.deepEqual(exportReport(s, 'jsnovel').notes, ['the atoms have velocities, but My format cannot store them; use POSCAR, Extended XYZ or Crystallume JSON to keep them']);
      offs.push(formats.register({ id: 'jsvel', write: () => 'x\n', capabilities: { ...ledger, velocities: true } }));
      assert.deepEqual(exportReport(s, 'jsvel').notes, []);
    } finally { offs.forEach((off) => off()); }
  });
});

describe('exportReport rules', () => {
  const RULES = [
    ['W1', () => trajectory(), 'poscar', {}, 'POSCAR holds one frame: wrote frame 1 of 3', T],
    ['W1', () => trajectory(), 'poscar', { frame: 2 }, 'wrote frame 3 of 3', T],
    ['W1', () => trajectory(), 'extxyz', {}, 'holds one frame', F],
    ['W1', () => two(), 'cif', {}, 'holds one frame', F],
    ['W2', () => two(), 'xyz', {}, 'does not store the unit cell', T],
    ['W2', () => two({ cell: null }), 'xyz', {}, 'does not store the unit cell', F],
    ['W3', () => two({ cell: null }), 'poscar', {}, 'needs a unit cell', F],   // Python only (F0-D O-2)
    ['W4', () => fixed([[F, F, F], [T, T, T], [T, T, F]]), 'cif', {}, '2 atom(s) are fixed or partly fixed', T],
    ['W4', () => fixed([[T, T, T], [T, T, T]]), 'cif', {}, 'cannot store constraints', F],
    ['W4', () => fixed([[F, F, F], [T, T, F]]), 'poscar', {}, 'cannot store constraints', F],
    ['W5', () => fixed([[F, T, F], [T, T, T]]), 'extxyz', {}, 'partial constraints of 1 atom(s)', T],
    ['W5', () => fixed([[T, T, F], [T, T, T]]), 'extxyz', {}, 'were tightened', F],
    ['W6', () => fixed([[T, T, F], [F, F, F]]), 'extxyz', {}, 'FixCartesian masks because 1 atom(s)', T],
    ['W6', () => fixed([[F, F, F], [T, T, T]]), 'extxyz', {}, 'FixCartesian', F],
    ['W7', () => two({ props: { occupancy: [0.5, 1] } }), 'poscar', {}, '1 site(s) are partially occupied', T],
    ['W7', () => two({ props: { occupancy: [0.5, 1] } }), 'cif', {}, 'partially occupied', F],
    ['W8', () => two({ props: { site_name: ['a b', 'c'] } }), 'extxyz', {}, "property 'site_name' was not written", T],
    ['W8', () => two({ props: { site_name: ['a', 'c'] } }), 'extxyz', {}, 'was not written', F],
    ['W10', () => two({ cell: LEFT }), 'poscar', {}, 'the cell is left-handed', T],
    ['W10', () => two({ cell: LEFT }), 'cif', {}, 'left-handed', F],
    ['W11', () => new Structure({ symbols: ['Pt', 'Pt', 'Pt', 'Pt'], positions: [[0, 0, 5], [1.5, 1.5, 5], [0, 0, 5], [1.5, 1.5, 5.3]], cell: ORTHO }),
      'poscar', {}, '2 pair(s) of atoms are closer than 0.5 Å (e.g. atoms 1 and 3, 0.00 Å apart)', T],
    ['W11', () => two({ positions: [[0, 0, 0.1], [0, 0, 19.8]], pbc: [T, T, F] }), 'poscar', {}, '1 pair(s) of atoms are closer than 0.5 Å (e.g. atoms 1 and 2, 0.30 Å apart)', T],
    ['W11', () => two({ positions: [[0, 0, 0.1], [0, 0, 19.8]], pbc: [T, T, F] }), 'extxyz', {}, 'closer than', F],
    ['N1', () => new Structure({ symbols: ['O', 'Pt', 'O'], positions: [[0, 0, 1], [0, 0, 3], [0, 0, 5]], cell: ORTHO }), 'poscar', {}, 'POSCAR groups atoms by element', T],
    ['N1', () => new Structure({ symbols: ['Pt', 'O', 'O'], positions: [[0, 0, 1], [0, 0, 3], [0, 0, 5]], cell: ORTHO }), 'poscar', {}, 'groups atoms', F],
    ['N2', () => two({ pbc: [T, T, F] }), 'poscar', {}, 'c was not periodic and is written as a cell vector with a 18.0 Å gap', T],
    ['N2', () => two({ pbc: [T, T, F] }), 'cif', {}, 'always periodic', F],
    ['velocities', () => two({ props: { velocities: [[0, 0, 0], [0, 0.02, 0]] } }), 'cif', {}, 'the atoms have velocities, but CIF cannot store them', T],
    ['velocities', () => two({ props: { velocities: [[0, 0, 0], [0, 0, 0]] } }), 'cif', {}, 'velocities', F],
  ];
  RULES.forEach(([rule, make, fmt, opts, fragment, applies], k) => {
    test(`${rule} ${fmt} ${applies ? 'applies' : 'does not apply'} (${k})`, () => {
      const rep = exportReport(make(), fmt, opts);
      assert.equal(has([...rep.warnings, ...rep.notes], fragment), applies, JSON.stringify(rep));
      if (applies) assert.ok(has(rule.startsWith('N') || rule === 'velocities' ? rep.notes : rep.warnings, fragment), JSON.stringify(rep));
    });
  });

  test('the POSCAR velocity note follows the writer: a note exactly when writePOSCAR drops the velocities', () => {
    // lead decision L-01; the writer drops the whole block when a row is not three finite numbers (velocityRows)
    const NOT_WRITTEN = 'the velocities were not written: POSCAR needs three finite numbers for every atom';
    const cases = [
      [[[0, 0, 0.1], [0, 0.2, 0.1]], true],
      [[Float64Array.of(0, 0, 0.1), Float64Array.of(0, 0.2, 0.1)], true],
      [[[0, 0, 0.1], [0, NaN, 0.1]], false],
      [[[0, 0, 0.1], [0, Infinity, 0.1]], false],
      [[[0, 0, 0.1], [0, 0.2]], false],
      [[[0, 0, 0.1], null], false],
      [[[0, 0, 0.1], [0, true, 0.1]], false],
      [[[0, 0, 0.1], [0, '0.2', 0.1]], false],
      [[[0, 0, 0], [0, NaN, 0]], null],   // nothing but zeros: no velocity is lost
      [[[0, 0, 0], [0, 0, 0]], null],
    ];
    for (const [velocities, written] of cases) {
      const s = two({ props: { velocities } });
      const label = JSON.stringify(velocities);
      assert.equal(writePOSCAR(s).includes('\n\n'), written === true, label);   // the block follows a blank line
      assert.deepEqual(exportReport(s, 'poscar'), { warnings: [], notes: written === false ? [NOT_WRITTEN] : [] }, label);
    }
  });

  test('W9: results of the first frame', () => {
    const s = trajectory(2);
    s.setProp('forces', [[0, 0, 0], [0, 0, 0]]);
    s.info.energy = -1.5;
    assert.deepEqual(exportReport(s, 'extxyz').warnings, ['forces, energy are known only for frame 1 and were written for that frame only']);
    assert.deepEqual(exportReport(s.getFrame(0), 'extxyz').warnings, []);
    s.removeProp('forces');
    assert.deepEqual(exportReport(s, 'extxyz').warnings, ['energy is known only for frame 1 and was written for that frame only']);
  });

  test('the checks look at the frame written: the current one unless told', () => {
    const s = new Structure({ symbols: ['Pt', 'O'], positions: [[0, 0, 1], [1.5, 1.5, 3]], cell: ORTHO, frames: [{ positions: [[0, 0, 1], [1.5, 1.5, 3]], cell: LEFT }] });
    assert.ok(!has(exportReport(s, 'poscar').warnings, 'left-handed'));
    s.setFrame(1);
    assert.deepEqual(exportReport(s, 'poscar').warnings, ['POSCAR holds one frame: wrote frame 2 of 2', 'the cell is left-handed (negative volume); VASP stops on such cells, so swap two cell vectors first']);
    assert.ok(!has(exportReport(s, 'poscar', { frame: 0 }).warnings, 'left-handed'));
    assert.throws(() => exportReport(s, 'poscar', { frame: 2 }), /frame 2 out of range/);
  });

  test('positions that are not finite skip the geometric checks', () => {
    const s = new Structure({ symbols: ['Pt', 'Pt'], positions: [[0, 0, 1], [0, 0, 1]], cell: ORTHO, pbc: [T, T, F] });
    s.positions[5] = NaN;
    assert.deepEqual(exportReport(s, 'poscar'), { warnings: [], notes: [] });   // no W11, no N2 (and no error)
  });

  test('the CONTCAR fixture, unknown formats, and nothing changes', () => {
    const s = parseStructure(CONTCAR, 'contcar_pt111.vasp');
    const before = JSON.stringify(s.toJSON({ precision: 17 }));
    assert.deepEqual(exportReport(s, 'poscar'), { warnings: [], notes: [] });   // acceptance S14-4
    assert.deepEqual(exportReport(s, 'cif').warnings, ['18 atom(s) are fixed or partly fixed (selective dynamics), but CIF cannot store constraints; use POSCAR, Extended XYZ or Crystallume JSON to keep them']);
    for (const id of ['xyz', 'extxyz', 'pdb', 'json']) exportReport(s, id);
    assert.equal(JSON.stringify(s.toJSON({ precision: 17 })), before);
    assert.deepEqual(s.pbc, [true, true, true]);   // reading changes no pbc (design decision U1)
    assert.throws(() => exportReport(s, 'nope'), /No writer for format "nope"/);
  });
});

describe('exportStructure', () => {
  test('local formats: text is a string, warnings and notes are arrays', () => {
    const s = parseStructure(CONTCAR, 'contcar_pt111.vasp');
    const out = exportStructure(s, 'cif');
    assert.deepEqual(Object.keys(out), ['text', 'filename', 'mime', 'warnings', 'notes']);
    assert.equal(typeof out.text, 'string');
    assert.ok(out.text.startsWith('data_'));
    assert.equal(out.warnings.length, 1);
    assert.deepEqual(out.notes, []);
    const clean = exportStructure(s, 'poscar');
    assert.deepEqual([clean.filename, clean.warnings, clean.notes], ['Pt-111-p-3x3-4L-relaxed.vasp', [], []]);
    assert.throws(() => exportStructure(two({ cell: null }), 'poscar'), /POSCAR needs a unit cell/);
  });

  test('server formats (fake store): capabilities from GET /formats, warnings synchronous, text a Promise', async () => {
    const calls = [];
    const caps = { ...MYFMT, label: 'Server format' };
    const frameCaps = { ...LEDGER, label: 'Server frame', overlap: true, handedness: true };
    const app = {
      busy: false, structure: null, emit() {},
      serverStore: {
        info: {
          presets: {}, customAnalyses: [], plugins: [],
          formats: {
            readers: [],
            writers: [
              { name: 'srvfmt', extensions: ['.srv'], description: 'only the server writes it', mimetype: 'text/plain', source: 'plug', capabilities: caps },
              { name: 'srvbad', extensions: ['.bad'], description: 'invalid capabilities', mimetype: 'text/plain', source: 'plug', capabilities: { ...caps, frames: 2 } },
              { name: 'srvnone', extensions: ['.none'], description: 'no capabilities', mimetype: 'text/plain', source: 'plug', capabilities: null },
              { name: 'srvframe', extensions: ['.frm'], description: 'one frame, checked', mimetype: 'text/plain', source: 'plug', capabilities: frameCaps },
            ],
          },
        },
        api: async (path, opts) => { calls.push([path, opts]); return { text: `TEXT ${opts.body.format}`, filename: 'x', mimetype: 'text/plain', warnings: ['from the server'], notes: [] }; },
        url: (u) => u,
      },
    };
    const offs = [];
    const api = { registerFormat: (f) => { const off = formats.register(f); offs.push(off); return off; }, plugins: { load: async () => {} } };
    try {
      const warned = [];
      const orig = console.warn;
      console.warn = (...a) => warned.push(a.join(' '));
      try { await installExtensions(app, api, null); } finally { console.warn = orig; }
      assert.deepEqual(warned, ["Crystallume: writer 'srvbad': capabilities.frames must be one of all, one; the export check of this format is off"]);
      assert.deepEqual(formats.get('srvfmt').capabilities, caps);
      assert.equal(formats.get('srvfmt').server, true);
      const s = trajectory(2);
      s.setProp('selective_dynamics', [[F, F, F], [T, T, T]]);
      const out = exportStructure(s, 'srvfmt');
      assert.ok(out.text instanceof Promise);
      assert.ok(Array.isArray(out.warnings) && Array.isArray(out.notes));
      assert.deepEqual(out.warnings, ['Server format holds one frame: wrote frame 1 of 2',
        '1 atom(s) are fixed or partly fixed (selective dynamics), but Server format cannot store constraints; use POSCAR, Extended XYZ or Crystallume JSON to keep them']);
      assert.equal(await out.text, 'TEXT srvfmt');
      assert.equal(calls.length, 1);
      assert.equal(calls[0][0], '/io/export');
      assert.equal(calls[0][1].body.structure.symbols.length, 2);
      for (const id of ['srvbad', 'srvnone']) {
        const o = exportStructure(s, id);
        assert.deepEqual([o.warnings, o.notes], [[], []], id);
        assert.equal(await o.text, `TEXT ${id}`);
      }
      assert.deepEqual(exportReport(s, 'srvfmt'), { warnings: out.warnings, notes: [] });

      // The server gets the whole structure and, like every Python writer, writes frame 0 (F0-D §3.12.5: the local
      // warnings are the server's): on screen is frame 2, with a left-handed cell and two atoms 0.2 Å apart.
      assert.deepEqual(formats.get('srvframe').capabilities, frameCaps);
      const t = new Structure({ symbols: ['Pt', 'O'], positions: [[0, 0, 1], [1.5, 1.5, 3]], cell: ORTHO, frames: [{ positions: [[0, 0, 1], [0, 0, 1.2]], cell: LEFT }] });
      t.setFrame(1);
      const W10 = 'the cell is left-handed (negative volume); VASP stops on such cells, so swap two cell vectors first';
      const W11 = '1 pair(s) of atoms are closer than 0.5 Å (e.g. atoms 1 and 2, 0.20 Å apart)';
      const srv = exportStructure(t, 'srvframe');
      assert.deepEqual([srv.warnings, srv.notes], [['Server frame holds one frame: wrote frame 1 of 2'], []]);
      assert.equal(await srv.text, 'TEXT srvframe');
      const body = calls.at(-1)[1].body;
      assert.deepEqual([body.format, body.structure.positions, body.structure.cell], ['srvframe', [[0, 0, 1], [1.5, 1.5, 3]], ORTHO]);
      assert.deepEqual(exportReport(t, 'srvframe'), { warnings: srv.warnings, notes: [] });
      assert.deepEqual(exportReport(t, 'srvframe', { frame: 1 }).warnings, ['Server frame holds one frame: wrote frame 2 of 2', W10, W11]);
      assert.deepEqual(exportReport(t, 'poscar').warnings, ['POSCAR holds one frame: wrote frame 2 of 2', W10, W11]);   // a web writer: the frame on screen
      assert.equal(t.frame, 1);
    } finally { offs.forEach((off) => off()); }
  });
});

// ------------------------------------------------------------------------------------------------ closeContacts
/**
 * Every pair within `cutoff` (the reference): for each pair, all translations within `reach` cell vectors of the one
 * that rounds their fractional difference away, on the periodic axes.
 */
function brute(s, cutoff, reach = 2) {
  const n = s.length, pos = s.positions, cell = s.cell;
  const frac = cell ? s.fracPositions() : null;
  const out = [];
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const base = [0, 1, 2].map((k) => (cell && s.pbc[k] ? -Math.round(frac[3 * j + k] - frac[3 * i + k]) : 0));
      const ranges = [0, 1, 2].map((k) => (cell && s.pbc[k] ? Array.from({ length: 2 * reach + 1 }, (_, t) => base[k] + t - reach) : [0]));
      let best = Infinity;
      for (const a of ranges[0]) for (const b of ranges[1]) for (const c of ranges[2]) {
        if (i === j && !a && !b && !c) continue;
        const t = cell ? [0, 1, 2].map((x) => a * cell[0][x] + b * cell[1][x] + c * cell[2][x]) : [0, 0, 0];
        const d = Math.hypot(pos[3 * j] + t[0] - pos[3 * i], pos[3 * j + 1] + t[1] - pos[3 * i + 1], pos[3 * j + 2] + t[2] - pos[3 * i + 2]);
        if (d < best) best = d;
      }
      if (best < cutoff) out.push([i, j, best]);
    }
  }
  return out;
}

/** A small seeded generator (mulberry32), so failures can be reproduced. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('closeContacts', () => {
  test('the grid finds what a brute-force search finds', () => {
    const r = rng(42);
    let tested = 0, found = 0;
    while (tested < 60) {
      const n = 1 + Math.floor(r() * 22);
      const cell = [0, 1, 2].map((i) => [0, 1, 2].map((j) => (r() - 0.5) * 2 + (i === j ? 1.6 + 2.4 * r() : 0)));
      if (tested % 2) [cell[0], cell[1]] = [cell[1], cell[0]];
      const cutoff = 0.3 + 0.7 * r();
      const det = cell[0][0] * (cell[1][1] * cell[2][2] - cell[1][2] * cell[2][1]) - cell[0][1] * (cell[1][0] * cell[2][2] - cell[1][2] * cell[2][0]) + cell[0][2] * (cell[1][0] * cell[2][1] - cell[1][1] * cell[2][0]);
      const height = (k) => { const u = cell[(k + 1) % 3], v = cell[(k + 2) % 3]; return Math.abs(det) / Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]); };
      if (Math.min(height(0), height(1), height(2)) < cutoff) continue;   // the documented range
      const frac = Array.from({ length: n }, () => [0, 1, 2].map(() => -1.3 + 3.6 * r()));
      if (tested % 3 === 0) for (let i = 0; i < n >> 1; i++) frac[i] = frac[i + (n >> 1)].map((v) => v + (r() - 0.5) * 0.06);
      const positions = frac.map((f) => [0, 1, 2].map((x) => f[0] * cell[0][x] + f[1] * cell[1][x] + f[2] * cell[2][x]));
      const s = new Structure({ symbols: frac.map(() => 'H'), positions, cell, pbc: [r() < 0.5, r() < 0.5, r() < 0.5] });
      const got = closeContacts(s, { cutoff }), want = brute(s, cutoff);
      assert.deepEqual(got.map(([i, j]) => [i, j]), want.map(([i, j]) => [i, j]), `structure ${tested}`);
      got.forEach(([, , d], k) => assert.ok(Math.abs(d - want[k][2]) < 1e-12, `structure ${tested}`));
      tested++;
      found += got.length;
    }
    assert.ok(found > 50);
  });

  test('options, the current frame and errors', () => {
    const s = new Structure({ symbols: ['H', 'H', 'H', 'H', 'H'], positions: [[0, 0, 0.1], [0, 0, 19.8], [1.5, 1.5, 10], [1.5, 1.5, 10.4], [1.5, 1.5, 11]], cell: ORTHO });
    const pairs = (o) => closeContacts(s, o).map(([i, j]) => [i, j]);
    assert.deepEqual(pairs(), [[0, 1], [2, 3]]);
    assert.deepEqual(pairs({ pbc: false }), [[2, 3]]);
    assert.deepEqual(pairs({ pbc: [T, T, F] }), [[2, 3]]);
    assert.deepEqual(pairs({ cutoff: 2 }), [[0, 1], [2, 3], [2, 4], [3, 4]]);
    assert.deepEqual(pairs({ cutoff: 2, limit: 2 }), [[0, 1], [2, 3]]);
    assert.deepEqual(closeContacts(new Structure()), []);
    assert.deepEqual(closeContacts(new Structure({ symbols: ['H'], positions: [[0, 0, 0]], cell: [[0.4, 0, 0], [0, 5, 0], [0, 0, 5]] })), [[0, 0, 0.4]]);
    const traj = new Structure({ symbols: ['H', 'H'], positions: [[0, 0, 0], [0, 0, 0.2]], cell: ORTHO, frames: [{ positions: [[0, 0, 0], [0, 0, 2]] }] });
    assert.equal(closeContacts(traj).length, 1);
    traj.setFrame(1);
    assert.equal(closeContacts(traj).length, 0);
    for (const [opts, message] of [
      [{ cutoff: 0 }, 'cutoff must be a positive number (got 0)'],
      [{ cutoff: true }, 'cutoff must be a positive number (got true)'],
      [{ limit: -1 }, 'limit must be a non-negative integer (got -1)'],
      [{ pbc: 'yes' }, 'pbc must be a bool or a list of three bools'],
    ]) assert.throws(() => closeContacts(s, opts), (e) => e.message === message, message);
    const bad = new Structure({ symbols: ['H', 'H'], positions: [[0, 0, 0], [0, 0, 1]] });
    bad.positions[5] = NaN;
    assert.throws(() => closeContacts(bad), /positions must be finite numbers/);
  });
});

after(() => {
  for (const id of ['jsfmt', 'jsbad', 'jsnone', 'srvfmt', 'srvbad', 'srvnone']) assert.equal(formats.get(id), undefined, `${id} was left registered`);
});
