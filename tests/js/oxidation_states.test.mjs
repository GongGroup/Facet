// Formal oxidation states of the cleave tool (build/surface.js segment M2-T2, M2 §3.9.1, ledger L-M2-06): the shared
// table facet/web/data/oxidation_states.json, loadOxidationStates, estimateOxidationStates and formalCharges,
// and the element data they rest on (core/elements.js METALS, ANIONS, PAULING). tests/test_oxidation_states.py runs
// the same cases on the Python twins; both files hold the same JSON constant PARITY_CASES (between the BEGIN and END
// PARITY_CASES lines): compositions with the charges, their source and the notes, or the error, that both languages
// must give (a case without `charges` expects null, unknown; `given` are charges passed by the caller), and malformed
// tables with their error. The Python test also compares the two languages item by item through the Node bridge.
// Run: node --test tests/js/oxidation_states.test.mjs (or through pytest: tests/test_js_unit.py).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { estimateOxidationStates, formalCharges, loadOxidationStates } from '../../facet/web/js/build/surface.js';
import { setWebData, webData } from '../../facet/web/js/core/webdata.js';
import { ANIONS, METALS, PAULING } from '../../facet/web/js/core/elements.js';
import { repoPath } from './helpers.mjs';

const NOT_LOADED = 'oxidation states are not loaded yet; call await loadOxidationStates() first';
const FILE = 'oxidation_states.json';
const TABLE = JSON.parse(readFileSync(repoPath(`facet/web/data/${FILE}`), 'utf8'));

// BEGIN PARITY_CASES (JSON: the same constant as in tests/test_oxidation_states.py)
const PARITY_CASES = {
  "estimate": [
    {"id": "SrTiO3", "symbols": {"Sr": 1, "Ti": 1, "O": 3}, "charges": {"Sr": 2, "Ti": 4, "O": -2}, "source": "formal"},
    {"id": "SrTiO3 as symbols", "symbols": ["O", "Sr", "O", "Ti", "O"], "charges": {"Sr": 2, "Ti": 4, "O": -2}, "source": "formal"},
    {"id": "TiO2", "symbols": {"Ti": 2, "O": 4}, "charges": {"Ti": 4, "O": -2}, "source": "formal"},
    {"id": "ZnO", "symbols": {"Zn": 2, "O": 2}, "charges": {"Zn": 2, "O": -2}, "source": "formal"},
    {"id": "CeO2", "symbols": {"Ce": 1, "O": 2}, "charges": {"Ce": 4, "O": -2}, "source": "formal"},
    {"id": "Al2O3", "symbols": {"Al": 12, "O": 18}, "charges": {"Al": 3, "O": -2}, "source": "formal"},
    {"id": "NaCl", "symbols": {"Na": 4, "Cl": 4}, "charges": {"Na": 1, "Cl": -1}, "source": "formal"},
    {"id": "GaAs", "symbols": {"Ga": 1, "As": 1}, "charges": {"Ga": 3, "As": -3}, "source": "formal"},
    {"id": "Fe3O4 (W11)", "symbols": {"Fe": 24, "O": 32}, "charges": {"Fe": 2.6666666666666665, "O": -2}, "source": "averaged", "notes": ["formal charges were averaged (Fe +2.67)"]},
    {"id": "Co3O4 (W11)", "symbols": {"Co": 3, "O": 4}, "charges": {"Co": 2.6666666666666665, "O": -2}, "source": "averaged", "notes": ["formal charges were averaged (Co +2.67)"]},
    {"id": "KMnO4 (W11, two cations)", "symbols": {"K": 1, "Mn": 1, "O": 4}, "charges": {"K": 2.6666666666666665, "Mn": 5.333333333333333, "O": -2}, "source": "averaged", "notes": ["formal charges were averaged (K +2.67, Mn +5.33)"]},
    {"id": "NpO2 (W11 with a whole number)", "symbols": {"Np": 1, "O": 2}, "charges": {"Np": 4, "O": -2}, "source": "averaged", "notes": ["formal charges were averaged (Np +4.00)"]},
    {"id": "TaON (O and N anions)", "symbols": {"Ta": 1, "O": 1, "N": 1}, "charges": {"Ta": 5, "N": -3, "O": -2}, "source": "formal"},
    {"id": "BiOCl (O and Cl anions)", "symbols": {"Bi": 1, "O": 1, "Cl": 1}, "charges": {"Bi": 3, "Cl": -1, "O": -2}, "source": "formal"},
    {"id": "CaCO3 (C +4)", "symbols": {"Ca": 1, "C": 1, "O": 3}, "charges": {"Ca": 2, "C": 4, "O": -2}, "source": "formal"},
    {"id": "TiH2 (H -1)", "symbols": {"Ti": 1, "H": 2}, "charges": {"Ti": 2, "H": -1}, "source": "formal"},
    {"id": "Ca(OH)2 (H +1)", "symbols": {"Ca": 1, "O": 2, "H": 2}, "charges": {"Ca": 2, "H": 1, "O": -2}, "source": "formal"},
    {"id": "BaSO4 (S +6)", "symbols": {"Ba": 1, "S": 1, "O": 4}, "charges": {"Ba": 2, "S": 6, "O": -2}, "source": "formal"},
    {"id": "NaIO3 (I +5)", "symbols": {"Na": 1, "I": 1, "O": 3}, "charges": {"Na": 1, "I": 5, "O": -2}, "source": "formal"},
    {"id": "LiFePO4", "symbols": {"Li": 4, "Fe": 4, "P": 4, "O": 16}, "charges": {"Li": 1, "Fe": 2, "P": 5, "O": -2}, "source": "formal"},
    {"id": "FeTiO3 (cations in formula order)", "symbols": {"Fe": 1, "Ti": 1, "O": 3}, "charges": {"Ti": 4, "Fe": 2, "O": -2}, "source": "formal"},
    {"id": "CuFeO2 (cations in formula order)", "symbols": {"Cu": 1, "Fe": 1, "O": 2}, "charges": {"Fe": 3, "Cu": 1, "O": -2}, "source": "formal"},
    {"id": "twenty cations", "symbols": {"Ti": 1, "V": 1, "Mn": 1, "Fe": 1, "Co": 1, "Ni": 1, "Cu": 1, "Mo": 1, "W": 1, "Nb": 1, "Ce": 1, "Sn": 1, "Pb": 1, "Pd": 1, "Pt": 1, "Ir": 1, "Ru": 1, "Tl": 1, "Au": 1, "Bi": 1, "O": 25}, "charges": {"Ce": 4, "Ti": 3, "Mn": 2, "Nb": 4, "Tl": 1, "V": 3, "Fe": 2, "Co": 2, "Cu": 1, "Ni": 2, "Sn": 2, "Bi": 3, "Mo": 4, "Ir": 3, "Pd": 2, "Ru": 3, "Pt": 2, "Pb": 2, "W": 4, "Au": 1, "O": -2}, "source": "formal"},
    {"id": "Pt (metal)", "symbols": {"Pt": 4}, "charges": {"Pt": 0}, "source": "metal"},
    {"id": "PtTi (metals)", "symbols": ["Pt", "Ti"], "charges": {"Ti": 0, "Pt": 0}, "source": "metal"},
    {"id": "Si (one element)", "symbols": {"Si": 8}, "charges": {"Si": 0}, "source": "element"},
    {"id": "Ar (one element without electronegativity)", "symbols": ["Ar"], "charges": {"Ar": 0}, "source": "element"},
    {"id": "zero counts are left out", "symbols": {"Fe": 0, "O": 2}, "charges": {"O": 0}, "source": "element"},
    {"id": "nothing", "symbols": [], "charges": {}, "source": "metal"},
    {"id": "XeF2 (Xe not in the table)", "symbols": {"Xe": 1, "F": 2}, "source": "unknown"},
    {"id": "ClF3 (Cl below the anion window, no cation valence)", "symbols": {"Cl": 1, "F": 3}, "source": "unknown"},
    {"id": "SiGe (Ge has no anion charge)", "symbols": {"Si": 1, "Ge": 1}, "source": "unknown"},
    {"id": "PtSi (Pt has no anion charge)", "symbols": {"Pt": 1, "Si": 1}, "source": "unknown"},
    {"id": "OF2 (only anions)", "symbols": {"O": 1, "F": 2}, "source": "unknown"},
    {"id": "ArO (Ar has no electronegativity)", "symbols": {"Ar": 1, "O": 1}, "source": "unknown"},
    {"id": "XO (a dummy species)", "symbols": {"X": 1, "O": 1}, "source": "unknown"},
    {"id": "FeO1 (symbols are taken as written)", "symbols": {"Fe1": 1, "O": 1}, "source": "unknown"},
    {"id": "SrTiO3 with given charges", "symbols": {"Sr": 1, "Ti": 1, "O": 3}, "given": {"O": -2, "Ti": 4, "Sr": 2, "Pt": 0}, "charges": {"Sr": 2, "Ti": 4, "O": -2}, "source": "user"},
    {"id": "Fe3O4 with given charges", "symbols": {"Fe": 3, "O": 4}, "given": {"Fe": 2.5, "O": -2}, "charges": {"Fe": 2.5, "O": -2}, "source": "user"},
    {"id": "Pt with a given charge", "symbols": {"Pt": 1}, "given": {"Pt": 0.5}, "charges": {"Pt": 0.5}, "source": "user"},
    {"id": "XeF2 with given charges", "symbols": {"Xe": 1, "F": 2}, "given": {"Xe": 2, "F": -1}, "charges": {"Xe": 2, "F": -1}, "source": "user"}
  ],
  "catalysts": [
    {"id": "SnO2", "symbols": {"Sn": 1, "O": 2}, "charges": {"Sn": 4, "O": -2}, "source": "formal"},
    {"id": "PdO", "symbols": {"Pd": 1, "O": 1}, "charges": {"Pd": 2, "O": -2}, "source": "formal"},
    {"id": "IrO2", "symbols": {"Ir": 1, "O": 2}, "charges": {"Ir": 4, "O": -2}, "source": "formal"},
    {"id": "RuO2", "symbols": {"Ru": 1, "O": 2}, "charges": {"Ru": 4, "O": -2}, "source": "formal"},
    {"id": "Nb2O5", "symbols": {"Nb": 2, "O": 5}, "charges": {"Nb": 5, "O": -2}, "source": "formal"},
    {"id": "Ta2O5", "symbols": {"Ta": 2, "O": 5}, "charges": {"Ta": 5, "O": -2}, "source": "formal"},
    {"id": "Bi2O3", "symbols": {"Bi": 2, "O": 3}, "charges": {"Bi": 3, "O": -2}, "source": "formal"},
    {"id": "BiVO4", "symbols": {"Bi": 1, "V": 1, "O": 4}, "charges": {"V": 5, "Bi": 3, "O": -2}, "source": "formal"},
    {"id": "Y2O3", "symbols": {"Y": 2, "O": 3}, "charges": {"Y": 3, "O": -2}, "source": "formal"},
    {"id": "La2O3", "symbols": {"La": 2, "O": 3}, "charges": {"La": 3, "O": -2}, "source": "formal"},
    {"id": "Ga2O3", "symbols": {"Ga": 2, "O": 3}, "charges": {"Ga": 3, "O": -2}, "source": "formal"},
    {"id": "In2O3", "symbols": {"In": 2, "O": 3}, "charges": {"In": 3, "O": -2}, "source": "formal"},
    {"id": "WO3", "symbols": {"W": 1, "O": 3}, "charges": {"W": 6, "O": -2}, "source": "formal"},
    {"id": "MoO3", "symbols": {"Mo": 1, "O": 3}, "charges": {"Mo": 6, "O": -2}, "source": "formal"},
    {"id": "V2O5", "symbols": {"V": 2, "O": 5}, "charges": {"V": 5, "O": -2}, "source": "formal"},
    {"id": "Co3O4", "symbols": {"Co": 3, "O": 4}, "charges": {"Co": 2.6666666666666665, "O": -2}, "source": "averaged", "notes": ["formal charges were averaged (Co +2.67)"]},
    {"id": "Fe3O4", "symbols": {"Fe": 3, "O": 4}, "charges": {"Fe": 2.6666666666666665, "O": -2}, "source": "averaged", "notes": ["formal charges were averaged (Fe +2.67)"]},
    {"id": "Fe2O3", "symbols": {"Fe": 2, "O": 3}, "charges": {"Fe": 3, "O": -2}, "source": "formal"},
    {"id": "NiO", "symbols": {"Ni": 1, "O": 1}, "charges": {"Ni": 2, "O": -2}, "source": "formal"},
    {"id": "CuO", "symbols": {"Cu": 1, "O": 1}, "charges": {"Cu": 2, "O": -2}, "source": "formal"},
    {"id": "Cu2O", "symbols": {"Cu": 2, "O": 1}, "charges": {"Cu": 1, "O": -2}, "source": "formal"},
    {"id": "ZnO", "symbols": {"Zn": 1, "O": 1}, "charges": {"Zn": 2, "O": -2}, "source": "formal"},
    {"id": "MgO", "symbols": {"Mg": 1, "O": 1}, "charges": {"Mg": 2, "O": -2}, "source": "formal"},
    {"id": "CaO", "symbols": {"Ca": 1, "O": 1}, "charges": {"Ca": 2, "O": -2}, "source": "formal"},
    {"id": "SrTiO3", "symbols": {"Sr": 1, "Ti": 1, "O": 3}, "charges": {"Sr": 2, "Ti": 4, "O": -2}, "source": "formal"},
    {"id": "BaTiO3", "symbols": {"Ba": 1, "Ti": 1, "O": 3}, "charges": {"Ba": 2, "Ti": 4, "O": -2}, "source": "formal"},
    {"id": "LaFeO3", "symbols": {"La": 1, "Fe": 1, "O": 3}, "charges": {"La": 3, "Fe": 3, "O": -2}, "source": "formal"},
    {"id": "LaMnO3", "symbols": {"La": 1, "Mn": 1, "O": 3}, "charges": {"La": 3, "Mn": 3, "O": -2}, "source": "formal"},
    {"id": "LaCoO3", "symbols": {"La": 1, "Co": 1, "O": 3}, "charges": {"La": 3, "Co": 3, "O": -2}, "source": "formal"},
    {"id": "CeO2", "symbols": {"Ce": 1, "O": 2}, "charges": {"Ce": 4, "O": -2}, "source": "formal"},
    {"id": "ZrO2", "symbols": {"Zr": 1, "O": 2}, "charges": {"Zr": 4, "O": -2}, "source": "formal"},
    {"id": "HfO2", "symbols": {"Hf": 1, "O": 2}, "charges": {"Hf": 4, "O": -2}, "source": "formal"},
    {"id": "TiO2", "symbols": {"Ti": 1, "O": 2}, "charges": {"Ti": 4, "O": -2}, "source": "formal"},
    {"id": "Al2O3", "symbols": {"Al": 2, "O": 3}, "charges": {"Al": 3, "O": -2}, "source": "formal"},
    {"id": "SiO2", "symbols": {"Si": 1, "O": 2}, "charges": {"Si": 4, "O": -2}, "source": "formal"},
    {"id": "MnO2", "symbols": {"Mn": 1, "O": 2}, "charges": {"Mn": 4, "O": -2}, "source": "formal"},
    {"id": "MoS2", "symbols": {"Mo": 1, "S": 2}, "charges": {"Mo": 4, "S": -2}, "source": "formal"},
    {"id": "WS2", "symbols": {"W": 1, "S": 2}, "charges": {"W": 4, "S": -2}, "source": "formal"},
    {"id": "GaN", "symbols": {"Ga": 1, "N": 1}, "charges": {"Ga": 3, "N": -3}, "source": "formal"},
    {"id": "TiN", "symbols": {"Ti": 1, "N": 1}, "charges": {"Ti": 3, "N": -3}, "source": "formal"}
  ],
  "errors": [
    {"id": "a formula string", "symbols": "SrTiO3", "kind": "type", "error": "symbols must be a list of element symbols or a mapping of counts"},
    {"id": "a number", "symbols": 5, "kind": "type", "error": "symbols must be a list of element symbols or a mapping of counts"},
    {"id": "a fractional count", "symbols": {"Fe": 1.5, "O": 1}, "kind": "value", "error": "the count of Fe must be a whole number"},
    {"id": "a negative count", "symbols": {"Fe": 1, "O": -2}, "kind": "value", "error": "the count of O must be a whole number"},
    {"id": "a count as text", "symbols": {"Fe": "2", "O": 3}, "kind": "value", "error": "the count of Fe must be a whole number"},
    {"id": "given charges without O", "symbols": {"Sr": 1, "Ti": 1, "O": 3}, "given": {"Sr": 2, "Ti": 4}, "kind": "value", "error": "charges must give every element: missing O"},
    {"id": "given charges without Ti and O", "symbols": ["O", "Ti", "Sr", "O", "O"], "given": {"Sr": 2}, "kind": "value", "error": "charges must give every element: missing Ti, O"},
    {"id": "a given charge as text", "symbols": {"Sr": 1, "Ti": 1, "O": 3}, "given": {"Sr": "2", "Ti": 4, "O": -2}, "kind": "value", "error": "the charge given for Sr is not a finite number"},
    {"id": "given charges as a list", "symbols": {"Sr": 1, "Ti": 1, "O": 3}, "given": [2, 4, -2], "kind": "type", "error": "charges must be a mapping of element symbols to charges"}
  ],
  "tables": [
    {"id": "another schema", "table": {"schema": "facet.oxidation-states/2", "anions": {}, "cations": {}}, "error": "oxidation_states.json is not a facet.oxidation-states/1 table"},
    {"id": "a list", "table": [], "error": "oxidation_states.json is not a facet.oxidation-states/1 table"},
    {"id": "no cations", "table": {"schema": "facet.oxidation-states/1", "anions": {"O": -2}}, "error": "oxidation_states.json needs the objects anions and cations"},
    {"id": "cations as a list", "table": {"schema": "facet.oxidation-states/1", "anions": {"O": -2}, "cations": []}, "error": "oxidation_states.json needs the objects anions and cations"},
    {"id": "a positive anion charge", "table": {"schema": "facet.oxidation-states/1", "anions": {"O": 2}, "cations": {}}, "error": "oxidation_states.json: anions.O must be a negative whole number"},
    {"id": "a fractional anion charge", "table": {"schema": "facet.oxidation-states/1", "anions": {"O": -1.5}, "cations": {}}, "error": "oxidation_states.json: anions.O must be a negative whole number"},
    {"id": "no valences", "table": {"schema": "facet.oxidation-states/1", "anions": {"O": -2}, "cations": {"Fe": []}}, "error": "oxidation_states.json: cations.Fe must be a list of distinct positive whole numbers"},
    {"id": "a repeated valence", "table": {"schema": "facet.oxidation-states/1", "anions": {"O": -2}, "cations": {"Fe": [3, 3]}}, "error": "oxidation_states.json: cations.Fe must be a list of distinct positive whole numbers"},
    {"id": "a negative valence", "table": {"schema": "facet.oxidation-states/1", "anions": {"O": -2}, "cations": {"Fe": [3, -2]}}, "error": "oxidation_states.json: cations.Fe must be a list of distinct positive whole numbers"},
    {"id": "a valence that is not a list", "table": {"schema": "facet.oxidation-states/1", "anions": {"O": -2}, "cations": {"Fe": 3}}, "error": "oxidation_states.json: cations.Fe must be a list of distinct positive whole numbers"}
  ]
};
// END PARITY_CASES

const expected = (c) => ({ charges: c.charges ?? null, source: c.source, notes: c.notes ?? [] });

function check(c, got) {
  assert.deepEqual(got, expected(c), c.id);
  if (c.charges) assert.deepEqual(Object.keys(got.charges), Object.keys(c.charges), `${c.id}: elements in formula order`);
}

test('before the table is loaded the estimate throws instead of answering unknown', () => {
  assert.equal(webData(FILE), null);
  assert.throws(() => estimateOxidationStates(['Pt']), { name: 'Error', message: NOT_LOADED });
  assert.throws(() => estimateOxidationStates({ Sr: 1, Ti: 1, O: 3 }), { message: NOT_LOADED });
  assert.throws(() => formalCharges(['Ti', 'O', 'O']), { message: NOT_LOADED });
  // given charges need no table; a malformed composition is still refused first
  assert.deepEqual(estimateOxidationStates({ Sr: 1, Ti: 1, O: 3 }, { charges: { Sr: 2, Ti: 4, O: -2 } }), { Sr: 2, Ti: 4, O: -2 });
  assert.throws(() => estimateOxidationStates('SrTiO3'), { name: 'TypeError' });
});

test('loadOxidationStates reads facet/web/data/oxidation_states.json', async () => {
  const table = await loadOxidationStates();
  assert.deepEqual(table, TABLE);
  assert.equal(webData(FILE), table);
  assert.equal(await loadOxidationStates(), table, 'loaded once');
  assert.equal(table.schema, 'facet.oxidation-states/1');
  for (const e of METALS) assert.ok(Object.hasOwn(table.cations, e), `${e} has cation valences`);
});

test('the estimate (M2 §3.9.1)', () => {
  for (const c of PARITY_CASES.estimate) {
    const got = formalCharges(c.symbols, { charges: c.given ?? null });
    check(c, got);
    assert.deepEqual(estimateOxidationStates(c.symbols, { charges: c.given }), got.charges, c.id);
  }
});

test('the forty catalysts of M2 §3.9.1 are never unknown; Co3O4 and Fe3O4 are averaged (W11)', () => {
  assert.equal(PARITY_CASES.catalysts.length, 40);
  for (const c of PARITY_CASES.catalysts) check(c, formalCharges(c.symbols));
  assert.deepEqual(PARITY_CASES.catalysts.filter((c) => c.source !== 'formal').map((c) => c.id), ['Co3O4', 'Fe3O4']);
});

test('errors: the text of Python, TypeError for the wrong kind of argument', () => {
  for (const c of PARITY_CASES.errors) {
    assert.throws(() => estimateOxidationStates(c.symbols, { charges: c.given }),
      (e) => e instanceof (c.kind === 'type' ? TypeError : Error) && (c.kind === 'type') === (e instanceof TypeError)
        && e.message === c.error, c.id);
  }
  for (const bad of [null, undefined, true, () => ['O']]) {
    assert.throws(() => estimateOxidationStates(bad), { name: 'TypeError', message: 'symbols must be a list of element symbols or a mapping of counts' });
  }
  assert.throws(() => estimateOxidationStates({ Fe: true, O: 1 }), { message: 'the count of Fe must be a whole number' });
  assert.throws(() => estimateOxidationStates(['Fe', 'O'], { charges: { Fe: 2, O: NaN } }), { message: 'the charge given for O is not a finite number' });
  assert.throws(() => estimateOxidationStates(['Fe', 'O'], { charges: { Fe: true, O: -2 } }), { message: 'the charge given for Fe is not a finite number' });
});

test('symbols as an array, a Map of counts or any iterable; given charges as a Map', () => {
  const want = { Sr: 2, Ti: 4, O: -2 };
  assert.deepEqual(estimateOxidationStates(new Map([['O', 3], ['Ti', 1], ['Sr', 1]])), want);
  assert.deepEqual(estimateOxidationStates(['Sr', 'Ti', 'O', 'O', 'O'].values()), want);
  assert.deepEqual(estimateOxidationStates(new Set(['Ti', 'O'])), { Ti: 2, O: -2 });
  assert.deepEqual(estimateOxidationStates(['Fe', 'O'], { charges: new Map([['Fe', 2], ['O', -2]]) }), { Fe: 2, O: -2 });
  assert.throws(() => estimateOxidationStates(['Fe', 'O'], { charges: new Map([['Fe', 2]]) }), { message: 'charges must give every element: missing O' });
  // keys that are not elements (inherited object members included) are just unknown symbols
  assert.equal(estimateOxidationStates({ constructor: 1, O: 1 }), null);
  assert.equal(estimateOxidationStates({ toString: 1, __proto__: null, O: 2 }), null);
});

test('twenty cations take no time (reachable sums instead of 3.5 million combinations)', () => {
  const c = PARITY_CASES.estimate.find((x) => x.id === 'twenty cations');
  let t0 = performance.now();
  check(c, formalCharges(c.symbols));
  assert.ok(performance.now() - t0 < 100);
  const big = Object.fromEntries(Object.keys(c.symbols).filter((e) => e !== 'O').map((e, i) => [e, 50 + i]));
  big.O = 2000;
  t0 = performance.now();
  assert.ok(['formal', 'averaged'].includes(formalCharges(big).source));
  assert.ok(performance.now() - t0 < 500);
});

test('METALS, ANIONS and the Pauling electronegativities of every element (facet/data/elements.json)', () => {
  assert.equal(METALS.size, 72);
  assert.deepEqual([...ANIONS].sort(), ['As', 'Br', 'C', 'Cl', 'F', 'H', 'I', 'N', 'O', 'P', 'S', 'Se', 'Te']);
  const records = JSON.parse(readFileSync(repoPath('facet/data/elements.json'), 'utf8')).elements;
  for (const r of records) assert.equal(Object.hasOwn(PAULING, r.symbol) ? PAULING[r.symbol] : null, r.electronegativity, r.symbol);
  assert.deepEqual(Object.keys(PAULING).filter((s) => !records.some((r) => r.symbol === s)), []);
  assert.deepEqual(records.filter((r) => !Object.hasOwn(PAULING, r.symbol)).map((r) => r.symbol), ['He', 'Ne', 'Ar']);
});

test('a malformed table is refused with the text of Python (loading it, then using it)', async () => {
  try {
    for (const c of PARITY_CASES.tables) {
      setWebData(FILE, c.table);
      await assert.rejects(loadOxidationStates(), { message: c.error }, c.id);
      assert.throws(() => formalCharges({ Fe: 2, O: 3 }), { message: c.error }, c.id);
    }
  } finally {
    setWebData(FILE, TABLE);
  }
  assert.deepEqual(estimateOxidationStates({ Fe: 2, O: 3 }), { Fe: 3, O: -2 });
});
