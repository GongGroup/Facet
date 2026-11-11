// Materials Studio XSD on the web side (facet/web/js/io/xsd.js; docs/design/xsd-export): the golden files of
// tests/data/xsd byte for byte, the export check, our own files read back, the reader on files modelled on what
// Materials Studio writes (tests/data/xsd/read) and the registry. The Python side, and the comparison of the two
// languages through the bridge, is tests/test_xsd.py.
// Run: node --test tests/js/io_xsd.test.mjs (or through pytest: tests/test_js_unit.py).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Structure } from '../../facet/web/js/core/structure.js';
import { constraintSummary } from '../../facet/web/js/core/constraints.js';
import { detectFormat, exportReport, exportStructure, formats, parseStructure } from '../../facet/web/js/io/index.js';
import { WRITER_CAPABILITIES } from '../../facet/web/js/io/capabilities.js';
import { cellOrientation, nonElements, readXSD, writeXSD } from '../../facet/web/js/io/xsd.js';
import { repoPath } from './helpers.mjs';

const file = (rel) => readFileSync(repoPath(rel), 'utf8');
const CASES = JSON.parse(file('tests/data/xsd/cases.json')).cases;
const READ = JSON.parse(file('tests/data/xsd/read/expected.json')).cases;
const golden = (c) => file(`tests/data/xsd/${c.file}`);
const byId = (id) => CASES.find((c) => c.id === id);
const structure = (c) => Structure.fromJSON(c.structure);
const close = (a, b, tol) => Math.abs(a - b) <= tol;

const TURNED = "the cell is written in Materials Studio's orientation (c along z, b in the yz plane): the structure is turned as a whole and the fractional coordinates are unchanged";
const LEFT_HANDED = 'the cell is left-handed (negative volume) and is written as it is; Materials Studio may show its mirror image';
const partlyFixed = (n) => `${n} atom(s) are fixed along some directions only; Materials Studio XSD fixes whole atoms, so they are written as fixed`;

describe('writer', () => {
  for (const c of CASES) {
    test(`golden file: ${c.id}`, () => {
      const s = structure(c);
      const text = writeXSD(s);
      assert.equal(text, golden(c));
      assert.ok(/^[\t\n\x20-\x7e]*$/.test(text), 'plain ASCII');
      assert.deepEqual(exportReport(s, 'xsd'), { warnings: c.warnings, notes: c.notes });
    });
  }

  test('the samples of the design are among the golden files', () => {
    const samples = CASES.filter((c) => c.sample);
    assert.equal(samples.length, 4);
    for (const c of samples) assert.equal(golden(c), file(`docs/design/xsd-export/samples/${c.sample}`), c.sample);
  });

  test('exportStructure: file name, type and the messages of the design', () => {
    const r = exportStructure(structure(byId('partial-constraints')), 'xsd');
    assert.equal(r.filename, 'partly-fixed.xsd');
    assert.equal(r.mime, 'application/xml');
    assert.equal(r.text, golden(byId('partial-constraints')));
    assert.deepEqual([r.warnings, r.notes], [[partlyFixed(2)], []]);
    const report = (id) => exportReport(structure(byId(id)), 'xsd');
    assert.deepEqual(report('nacl-bulk'), { warnings: [], notes: [] });
    assert.deepEqual(report('pt111-slab-fixed'), { warnings: [], notes: [TURNED] });   // whole atoms fixed: no warning
    assert.deepEqual(report('left-handed'), { warnings: [LEFT_HANDED], notes: [] });
    assert.deepEqual(report('molecule-fixed'), { warnings: [partlyFixed(1)], notes: [] });
    assert.deepEqual(report('dummy-atoms').warnings, ['2 atom(s) have a symbol that is not a chemical element (X); Materials Studio may not recognise them']);
    // the other formats say nothing new
    for (const id of ['poscar', 'extxyz', 'cif', 'json']) assert.ok(!exportReport(structure(byId('partial-constraints')), id).warnings.some((m) => m.includes('whole atoms')), id);
  });

  test('the current frame of a trajectory is written, and the report names it', () => {
    const s = structure(byId('trajectory'));
    assert.equal(writeXSD(s), golden(byId('trajectory')));
    s.setFrame(2);
    const text = writeXSD(s);
    assert.notEqual(text, golden(byId('trajectory')));
    assert.ok(text.includes('XYZ="0.000000000000,0.000000000000,0.100000000000"'));   // z = 1.2 Å of c = 12 Å
    assert.deepEqual(exportReport(s, 'xsd').warnings, ['Materials Studio XSD holds one frame: wrote frame 3 of 3']);
  });

  test('orientation, names and what cannot be written', () => {
    const hex = [[2.77, 0, 0], [-1.385, 2.39889, 0], [0, 0, 20]];
    assert.equal(cellOrientation([[4, 0, 0], [0, 4, 0], [0, 0, 4]]), 'same');
    assert.equal(cellOrientation(hex), 'rotated');
    assert.equal(cellOrientation([hex[1], hex[0], hex[2]]), 'left-handed');
    assert.throws(() => cellOrientation([[1, 0, 0], [2, 0, 0], [0, 0, 1]]), /^Error: Materials Studio XSD: the unit cell has no volume$/);
    assert.deepEqual(nonElements(['Pt', 'X', 'X', 'O']), ['X']);
    const s = new Structure({ name: '  ', symbols: ['O', 'H', 'H'], positions: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], props: { labels: ['Ow', '', '  '] } });
    const text = writeXSD(s);
    assert.ok(text.includes('Name="Ow"') && text.includes('Name="H1"') && text.includes('Name="H2"'));
    assert.ok(text.includes('<Molecule ID="2" NumChildren="3" Name="Untitled">'));
    s.positions[4] = Infinity;
    assert.throws(() => writeXSD(s), /^Error: Materials Studio XSD: atom 2 has a value that is not a finite number or is too large$/);
  });
});

describe('reader', () => {
  for (const c of CASES.filter((x) => x.structure.symbols.length)) {
    test(`our file read back: ${c.id}`, () => {
      const text = golden(c);
      const src = structure(c);
      const back = readXSD(text, c.file);
      assert.deepEqual(back.symbols, src.symbols);
      const flags = c.structure.props?.selective_dynamics;
      const fixed = flags ? flags.map((r) => !r.every(Boolean)) : src.symbols.map(() => false);
      assert.deepEqual((back.props.selective_dynamics ?? src.symbols.map(() => [true])).map((r) => !r[0]), fixed);
      assert.equal(back.props.labels.length, src.length);
      if (!src.cell) {
        assert.equal(back.cell, null);
        assert.deepEqual(back.pbc, [false, false, false]);
        for (let i = 0; i < src.positions.length; i++) assert.ok(close(back.positions[i], src.positions[i], 1e-10));
      } else {
        assert.deepEqual(back.pbc, [true, true, true]);
        const f0 = src.fracPositions(), f1 = back.fracPositions();
        for (let i = 0; i < f0.length; i++) assert.ok(close(f1[i], f0[i], 1e-11), `fractional coordinate ${i}`);
      }
      assert.equal(writeXSD(back), text);   // a second write is the file
    });
  }

  for (const want of READ) {
    test(`fixture: ${want.file}`, () => {
      const text = file(`tests/data/xsd/read/${want.file}`);
      for (const variant of [text, text.replace(/\n/g, '\r\n'), `﻿${text}`]) {
        const s = readXSD(variant, want.file);
        assert.deepEqual(s.symbols, want.symbols);
        assert.equal(s.name, want.name ?? want.file.replace(/\.xsd$/, ''));
        const expected = want.cell ? want.frac.map((f) => [0, 1, 2].map((k) => f[0] * want.cell[0][k] + f[1] * want.cell[1][k] + f[2] * want.cell[2][k])) : want.positions;
        expected.flat().forEach((v, i) => assert.ok(close(s.positions[i], v, 1e-12), `coordinate ${i}`));
        assert.deepEqual(s.cell, want.cell);
        assert.deepEqual(s.pbc, want.cell ? [true, true, true] : [false, false, false]);
        assert.deepEqual(s.props.labels ?? null, want.labels);
        const rows = s.props.selective_dynamics;
        assert.deepEqual(rows ? rows.flatMap((r, i) => (r[0] ? [] : [i])) : null, want.fixed);
        assert.deepEqual(s.info.spacegroup ?? null, want.spacegroup);
        assert.deepEqual(s.info.warnings ?? [], want.warnings);
      }
    });
  }

  test('parseStructure finds the format by name and by content', () => {
    const text = golden(byId('pt111-slab-fixed'));
    assert.equal(detectFormat('slab.xsd'), 'xsd');
    assert.equal(detectFormat('SLAB.XSD'), 'xsd');
    assert.equal(detectFormat('', text), 'xsd');
    assert.equal(detectFormat('', '<html><body>XSD</body></html>'), null);
    const s = parseStructure(text, 'Pt slab.xsd');
    assert.equal(s.info.source, 'xsd');
    assert.equal(s.name, 'Pt slab');
    const c = constraintSummary(s);
    assert.deepEqual([s.length, c.fixed, c.partial], [36, 18, 0]);
    assert.equal(parseStructure(text, 'pasted').length, 36);
  });

  test('what is not a Materials Studio document is refused with a reason', () => {
    const bad = [
      ['<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema"/>', 'XSD: this is not a Materials Studio document (no <XSD> element); XML Schema files have the same extension'],
      ['<XSD><AtomisticTreeRoot/></XSD>', 'XSD: the document has no atoms (Atom3d)'],
      ['<XSD><Atom3d XYZ="0,0,0', 'XSD: the file ends in the middle of a tag'],
      ['<XSD><Atom3d XYZ="1,2" Components="C"/></XSD>', 'XSD: atom 1: XYZ="1,2" is not three numbers'],
      ['<XSD><PlaneGroup AVector="1,0,0" BVector="0,1,0"/><Atom3d XYZ="0,0,0"/></XSD>', 'XSD: this is a 2D periodic document (PlaneGroup); only 3D periodic documents and molecules can be read'],
    ];
    for (const [text, message] of bad) assert.throws(() => readXSD(text), { message });
    assert.throws(() => parseStructure('<XSD><AtomisticTreeRoot/></XSD>', 'empty.xsd'), { message: 'XSD: the document has no atoms (Atom3d)' });
  });

  test('entities of a DOCTYPE are never expanded and attribute names cannot reach the prototype', () => {
    const s = readXSD(file('tests/data/xsd/read/components_and_entities.xsd'));
    assert.ok(s.props.labels.includes('&xxe;') && s.props.labels.every((l) => l.length < 40));
    const odd = readXSD('<XSD><Atom3d __proto__="x" constructor="y" toString="z" XYZ="1,2,3" Components="C"/></XSD>');
    assert.deepEqual([odd.symbols, Array.from(odd.positions)], [['C'], [1, 2, 3]]);
    assert.equal({}.x, undefined);
  });
});

describe('registry', () => {
  test('the format is registered after PDB with its capabilities', () => {
    const f = formats.get('xsd');
    assert.deepEqual([f.name, f.extensions, f.mime, f.description], ['Materials Studio XSD', ['xsd'], 'application/xml', 'Materials Studio XSD (3D atomistic document; save as .xsd)']);
    assert.deepEqual(f.capabilities, WRITER_CAPABILITIES.xsd);
    assert.equal(WRITER_CAPABILITIES.xsd.constraints, 'atoms');
    const writers = formats.writers().map((w) => w.id), readers = formats.readers().map((r) => r.id);
    assert.equal(writers.indexOf('xsd'), writers.indexOf('pdb') + 1);
    assert.ok(readers.includes('xsd'));
  });
});
