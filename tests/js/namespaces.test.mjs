// The facet.* namespaces (ledger L-F0-53, M7 §6.3 and W0-CR4): defineApi's paths, its errors for a name used
// twice and for something that is not a function, members defined before and after createAPI, dispose, replace, the
// app's own facet.edit (run, begin, touch, session) and the members in facet.reference().
// Run: node --test tests/js/namespaces.test.mjs (or through pytest: tests/test_js_unit.py).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const web = (rel) => new URL(`../../facet/web/js/${rel}`, import.meta.url);
const { API_NAMESPACES, defineApi, apiMembers } = await import(web('api/namespaces.js'));

// defined before any API object exists, as a module does when it is imported
const early = () => 'early';
const offEarly = defineApi('surface.early', early, { owner: 'M2', sig: '() → a string' });

const { createAPI } = await import(web('api/public.js'));

/** What createAPI and reference() read of the app; editActive and friends record their calls. */
function fakeApp() {
  const calls = [];
  return {
    calls, viewer: {}, storage: { list: () => [] }, on: () => () => {}, get: () => undefined,
    editActive(label, fn, opts) { calls.push(['editActive', label, opts]); return { entry: { id: 7, label, snap: {}, bytes: 99 }, value: fn('s'), map: new Int32Array(0) }; },
    beginStructureEdit(label, opts) { calls.push(['beginStructureEdit', label, opts]); return { label }; },
    notifyStructureChanged() { calls.push(['notifyStructureChanged']); return 'appearance'; },
  };
}

describe('defineApi', () => {
  test('the namespaces', () => {
    assert.deepEqual(API_NAMESPACES, ['edit', 'build', 'analysis', 'surface', 'lattice', 'params', 'tools']);
    assert.ok(Object.isFrozen(API_NAMESPACES));
  });

  test('a path used twice: the error names the owner of the first; replace: true takes its place', () => {
    const fix = () => 'fix';
    const off = defineApi('edit.fixTest', fix, { owner: 'M3' });
    assert.throws(() => defineApi('edit.fixTest', () => {}, { owner: 'M4' }), { name: 'Error', message: 'defineApi: facet.edit.fixTest is already defined (by M3)' });
    const offAnon = defineApi('analysis.anon', () => {});
    assert.throws(() => defineApi('analysis.anon', () => {}), { name: 'Error', message: 'defineApi: facet.analysis.anon is already defined' });
    const better = () => 'better';
    const offBetter = defineApi('edit.fixTest', better, { owner: 'M4', replace: true });
    const api = createAPI(fakeApp(), null);
    assert.equal(api.edit.fixTest, better);
    offBetter();
    assert.equal(api.edit.fixTest, fix, 'removing it brings back the member it replaced');
    off(); offAnon();
    assert.equal('fixTest' in api.edit, false);
    off();   // twice: nothing happens
  });

  test('wrong arguments: not a function, a bad path, an unknown namespace, a namespace, a sig of several lines', () => {
    assert.throws(() => defineApi('edit.fix2', 'fix'), { name: 'TypeError', message: 'defineApi: expected a function for facet.edit.fix2' });
    assert.throws(() => defineApi('edit.fix2', null), { name: 'TypeError', message: 'defineApi: expected a function for facet.edit.fix2' });
    assert.throws(() => defineApi(42, () => {}), { name: 'TypeError', message: "defineApi: expected a path such as 'edit.fix' (got number)" });
    for (const bad of ['', 'edit.', 'edit.fix.more', 'edit.__proto__', 'my-tool', '__proto__']) {
      assert.throws(() => defineApi(bad, () => {}), { name: 'Error', message: `defineApi: “${bad}” is not a member path (use '<namespace>.<name>', e.g. 'edit.fix', or one top-level name)` });
    }
    assert.throws(() => defineApi('magic.wand', () => {}), { name: 'Error', message: 'defineApi: unknown namespace “magic” (use edit, build, analysis, surface, lattice, params or tools)' });
    assert.throws(() => defineApi('build', () => {}), { name: 'Error', message: "defineApi: facet.build is a namespace (define a member, e.g. 'build.myTool')" });
    assert.throws(() => defineApi('build.thing', () => {}, { sig: 'a\nb' }), { name: 'TypeError', message: 'defineApi: the sig of facet.build.thing must be one line of text' });
    assert.equal(apiMembers().some((m) => m.path === 'edit.fix2' || m.path === 'build.thing'), false, 'nothing was defined');
  });

  test('members defined before createAPI are there when it is made; later ones appear on the live object', () => {
    const api = createAPI(fakeApp(), null);
    assert.equal(api.surface.early, early);
    for (const ns of API_NAMESPACES) assert.equal(typeof api[ns], 'object', `facet.${ns} exists`);
    const later = () => 'later';
    const offLater = defineApi('lattice.later', later, { owner: 'M1' });
    const offTop = defineApi('exportReportTest', () => 'report', { owner: 'F0-D' });
    assert.equal(api.lattice.later, later);
    assert.equal(api.exportReportTest(), 'report');
    const second = createAPI(fakeApp(), null);
    assert.equal(second.lattice.later, later, 'every API object gets them');
    offLater(); offTop();
    assert.equal(api.lattice.later, undefined);
    assert.equal('exportReportTest' in second, false);
  });

  test('the app’s own members are not taken without replace: true; removing a replacement brings the app’s member back', () => {
    const api = createAPI(fakeApp(), null);
    assert.throws(() => defineApi('build.crystal', () => {}, { owner: 'M9' }), { message: 'defineApi: facet.build.crystal is already defined (by the app)' });
    assert.throws(() => defineApi('edit.run', () => {}), { message: 'defineApi: facet.edit.run is already defined (by the app)' });
    assert.throws(() => defineApi('load', () => {}), { message: 'defineApi: facet.load is already defined (by the app)' });
    assert.throws(() => defineApi('edit.session', () => {}), { message: 'defineApi: facet.edit.session is already defined (by the app)' });
    const crystal = api.build.crystal;
    const mine = () => 'mine';
    const off = defineApi('build.crystal', mine, { replace: true });
    assert.equal(api.build.crystal, mine);
    off();
    assert.equal(api.build.crystal, crystal, 'the app’s member is back');
  });

  test('a module that took an app member’s name before the API was made is left out, with a console error', async (t) => {
    // a fresh copy of the module: no API object exists yet, as when modules are imported at start-up
    const fresh = await import(`${web('api/namespaces.js').href}?before-createAPI`);
    const clash = () => 'clash', wanted = () => 'wanted', own = () => 'the app’s';
    fresh.defineApi('analysis.rdf', clash, { owner: 'M9' });
    fresh.defineApi('build.crystal', wanted, { owner: 'M9', replace: true });
    fresh.defineApi('surface.fine', wanted);
    const err = t.mock.method(console, 'error', () => {});
    const api = fresh.attachApi({ analysis: { rdf: own }, build: { crystal: own }, load: own });
    assert.equal(api.analysis.rdf, own, 'kept');
    assert.deepEqual(err.mock.calls.map((c) => c.arguments[0]), ['defineApi: facet.analysis.rdf is already defined (by the app)']);
    assert.equal(api.build.crystal, wanted, 'replace: true takes its place');
    assert.equal(api.surface.fine, wanted);
    assert.equal(fresh.attachApi(api), api, 'attaching twice changes nothing');
    assert.equal(err.mock.callCount(), 1);
  });
});

describe('facet.edit and the reference', () => {
  test('run = app.editActive, returning {entry: {id, label}, value}; begin, touch and the session getter', () => {
    const app = fakeApp();
    const api = createAPI(app, null);
    const r = api.edit.run('Fix 2 atoms', (s) => `edited ${s}`, { rebuild: 'appearance' });
    assert.deepEqual(r, { entry: { id: 7, label: 'Fix 2 atoms' }, value: 'edited s' }, 'the entry as plain data');
    assert.deepEqual(app.calls[0], ['editActive', 'Fix 2 atoms', { rebuild: 'appearance' }]);
    app.editActive = (label, fn) => ({ entry: null, value: fn('s'), map: new Int32Array(0) });
    assert.deepEqual(api.edit.run('Nested', () => 1), { entry: null, value: 1 });
    assert.deepEqual(api.edit.begin('Preview', { kind: 'structure' }), { label: 'Preview' });
    assert.equal(api.edit.touch(), 'appearance');
    assert.equal(api.edit.session, null);
    app.session = { label: 'open' };
    assert.equal(api.edit.session, app.session);
  });

  test('reference().api lists the app’s edit members and the defined ones, with owner, sig and a call to copy', () => {
    const off = defineApi('edit.zeroTest', () => {}, { owner: 'M3', sig: '  (indices?) → EditResult  ' });
    const ref = createAPI(fakeApp(), null).reference();
    const paths = ref.api.map((m) => m.path);
    assert.deepEqual(paths.slice(0, 4), ['edit.run', 'edit.begin', 'edit.touch', 'edit.session']);
    assert.ok(paths.includes('surface.early'));
    assert.deepEqual(ref.api.find((m) => m.path === 'edit.zeroTest'), { path: 'edit.zeroTest', owner: 'M3', sig: '(indices?) → EditResult', call: 'facet.edit.zeroTest()' });
    assert.deepEqual(ref.api.find((m) => m.path === 'surface.early'), { path: 'surface.early', owner: 'M2', sig: '() → a string', call: 'facet.surface.early()' });
    assert.equal(ref.api.find((m) => m.path === 'edit.session').call, 'facet.edit.session');
    ref.api[0].sig = 'changed';
    assert.notEqual(createAPI(fakeApp(), null).reference().api[0].sig, 'changed', 'copies');
    assert.deepEqual(apiMembers().map((m) => m.path), [...apiMembers().map((m) => m.path)].sort());
    off();
    offEarly();
    assert.equal(createAPI(fakeApp(), null).reference().api.some((m) => m.path === 'surface.early'), false);
  });
});
