// Atom-info lines for the hover card and the selection card (crystallume/web/js/ui/atominfo.js, F0-A T10, ledger L-F0-50).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { registerAtomInfo, atomInfoRows } = await import(new URL('../../crystallume/web/js/ui/atominfo.js', import.meta.url));

const app = { structure: { symbols: ['Pt', 'Pt', 'C', 'O'] } };

test('registerAtomInfo checks its arguments', () => {
  assert.throws(() => registerAtomInfo(null), { name: 'TypeError' });
  assert.throws(() => registerAtomInfo(() => null, { order: 'first' }), { name: 'TypeError', message: 'registerAtomInfo: order must be a number' });
});

test('rows come in order, then registration order; null adds nothing; the remover removes', () => {
  const seen = [];
  const offs = [
    registerAtomInfo((a, i, ctx) => { seen.push([i, ctx.where]); return [{ label: 'adsorbate', value: 2 }]; }, { order: 200 }),
    registerAtomInfo((a, i) => (a.structure.symbols[i] === 'Pt' ? [{ label: 'layer', value: '2/4 · fixed c (z)' }] : null)),
    registerAtomInfo(() => [{ label: 'tag', value: 1 }, { label: '', value: 'dropped' }, null, { label: 'empty' }]),
    registerAtomInfo(() => ({ label: 'single', value: 'object' }), { order: 5 }),
  ];
  assert.deepEqual(atomInfoRows(app, 0, 'hover'), [
    { label: 'single', value: 'object' },
    { label: 'layer', value: '2/4 · fixed c (z)' },
    { label: 'tag', value: '1' },
    { label: 'empty', value: '' },
    { label: 'adsorbate', value: '2' },
  ]);
  assert.deepEqual(atomInfoRows(app, 2, 'card').map((r) => r.label), ['single', 'tag', 'empty', 'adsorbate']);
  assert.deepEqual(seen, [[0, 'hover'], [2, 'card']]);
  offs[1]();
  offs[1]();   // removing twice is harmless
  assert.deepEqual(atomInfoRows(app, 0).map((r) => r.label), ['single', 'tag', 'empty', 'adsorbate']);
  offs.forEach((off) => off());
  assert.deepEqual(atomInfoRows(app, 0), []);
});

test('a provider that throws is skipped and reported once', () => {
  const logged = [], orig = console.error;
  console.error = (...a) => logged.push(a);
  try {
    const offA = registerAtomInfo(() => { throw new Error('broken'); });
    const offB = registerAtomInfo(() => [{ label: 'ok', value: 'yes' }]);
    assert.deepEqual(atomInfoRows(app, 1), [{ label: 'ok', value: 'yes' }]);
    assert.deepEqual(atomInfoRows(app, 1), [{ label: 'ok', value: 'yes' }]);
    assert.equal(logged.length, 1);
    offA(); offB();
  } finally { console.error = orig; }
});
