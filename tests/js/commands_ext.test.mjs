// Commands of the surface tools (facet/web/js/core/commands.js; F0-A §3.16, §5.8, ledger L-F0-52, defect E-50,
// M7 §5.2 KC-06): parameter schemas checked in the wrapper that register makes, whatever the caller; the atom
// limits and the large-structure confirmation; `edits` guards; keys commands must not take; MS aliases; and the
// fallbacks that open the panel section of each M1–M6 command until its module registers it.
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const web = (rel) => new URL(`../../facet/web/js/${rel}`, import.meta.url);
const C = await import(web('core/commands.js'));
const { commands, LIMITS, MAX_ATOMS_LIMIT, CommandError, commandTitle, atomLimit, checkAtoms, confirmAtoms, canEdit, editWhyNot,
  previewSession, keyProblem, SECTION_COMMANDS, sectionFallbacks, CANCEL_PREVIEW } = C;
const { Structure } = await import(web('core/structure.js'));
const vacuum = await import(web('core/vacuum.js'));
const sections = await import(web('ui/sections.js'));
await import(web('ui/panels/surface.js'));   // reserves the Surface panel's sections, as in the app
const { rankCommands } = await import(web('ui/rank.js'));
const { createAPI } = await import(web('api/public.js'));

const CUBIC = [[3.92, 0, 0], [0, 3.92, 0], [0, 0, 3.92]];
const bulk = () => new Structure({ name: 'Pt', symbols: ['Pt'], positions: [[0, 0, 0]], cell: CUBIC, pbc: [true, true, true] });
/** Three Pt layers 2 Å apart in a 20 Å cell: 16 Å of vacuum along c. */
const slab = () => new Structure({ name: 'Pt slab', symbols: ['Pt', 'Pt', 'Pt'], positions: [[0, 0, 1], [1.96, 1.96, 3], [0, 0, 5]], cell: [[3.92, 0, 0], [0, 3.92, 0], [0, 0, 20]], pbc: [true, true, true] });
/** A 2D sheet with pbc T T F and no vacuum along its non-periodic c (D5: such structures pass the gap guard). */
const sheet = () => new Structure({ name: 'sheet', symbols: ['C', 'C'], positions: [[0, 0, 0], [1.23, 0.71, 0]], cell: [[2.46, 0, 0], [-1.23, 2.13, 0], [0, 0, 3]], pbc: [true, true, false] });
const molecule = () => new Structure({ name: 'CO', symbols: ['C', 'O'], positions: [[0, 0, 0], [0, 0, 1.13]] });

/** The parts of the App the commands read: the structure, the project, the selection, busy, prefs and the session. */
function fakeApp({ structure = bulk(), selection = [], prefs = {}, session = null, busy = false, project } = {}) {
  return { structure, selection, prefs, session, busy, project: project ?? { structures: structure ? [{ id: 's1', name: structure.name, structure }] : [] } };
}

const offs = [];
afterEach(() => {
  while (offs.length) offs.pop()?.();
  commands.setContext(null);
  commands.setConfirm(null);
});
/** Register a command for this test (removed afterwards); returns the stored entry and the calls of its run(). */
function reg(def) {
  const calls = [];
  offs.push(commands.register({ id: 'test.cmd', title: 'Test command…', category: 'Edit', run: (...a) => { calls.push(a); return 'ran'; }, ...def }));
  return { entry: commands.get(def.id ?? 'test.cmd'), calls };
}
const quiet = (fn) => { const orig = console.warn, logged = []; console.warn = (...a) => logged.push(a.join(' ')); try { return [fn(), logged]; } finally { console.warn = orig; } };
const VACUUM = { name: 'vacuum', type: 'float', label: 'Vacuum', unit: 'Å', min: 0, required: true };

// ------------------------------------------------------------------ parameters (E-50: checked in the wrapper)
describe('parameters are checked by the wrapper that register makes', () => {
  const CLEAVE = { id: 'test.cleave', title: 'Cleave surface…', params: [{ name: 'miller', type: 'miller', label: 'Plane' }, { name: 'layers', type: 'int', label: 'Layers', min: 1, default: 4 }, VACUUM] };

  test('a missing required parameter throws invalid-params and does not run, by every way of calling', () => {
    const app = fakeApp();
    commands.setContext(app);
    const before = JSON.stringify(app.structure.toJSON());
    const { calls } = reg(CLEAVE);
    const api = createAPI({ ...app, viewer: {}, storage: { list: () => [], get: () => null }, get: () => undefined }, null);
    const ways = [
      ['commands.run', () => commands.run('test.cleave', {})],
      ['commands.get(id).run', () => commands.get('test.cleave').run({})],
      ['facet.command (embedding pages call it)', () => api.command('test.cleave', { miller: [1, 1, 1] })],
    ];
    for (const [how, call] of ways) {
      assert.throws(call, (e) => e instanceof CommandError && e.code === 'invalid-params' && e.message === 'Cleave surface: Vacuum: enter a value.', how);
    }
    assert.equal(calls.length, 0, 'run() was never called');
    assert.equal(JSON.stringify(app.structure.toJSON()), before, 'the structure is unchanged');
  });

  test('without parameters the command runs as before: run(app) and nothing else', () => {
    const app = fakeApp();
    commands.setContext(app);
    const { calls } = reg(CLEAVE);
    commands.run('test.cleave');
    commands.get('test.cleave').run();
    commands.get('test.cleave').run(undefined, { interactive: true });
    assert.deepEqual(calls, [[app], [app], [app]]);
  });

  test('normalized values reach run(app, values, ctx)', () => {
    const app = fakeApp();
    commands.setContext(app);
    const { calls } = reg(CLEAVE);
    assert.equal(commands.run('test.cleave', { miller: [1, 0, -1, 0], vacuum: 15 }), 'ran');
    assert.equal(calls.length, 1);
    const [a, values, ctx] = calls[0];
    assert.equal(a, app);
    assert.deepEqual(values, { miller: [1, 0, 0], layers: 4, vacuum: 15 }, 'four indices become three; the default fills layers');
    assert.deepEqual(ctx, { interactive: false, atoms: null, warnings: [] });
    commands.run('test.cleave', { miller: [13, 1, 1], vacuum: 0 });
    assert.deepEqual(calls[1][2].warnings, ['High-index plane; the surface cell may be large.']);
  });

  test('parameters that are not a plain object', () => {
    commands.setContext(fakeApp());
    const { calls } = reg(CLEAVE);
    class Params { constructor() { this.vacuum = 15; } }
    for (const bad of [null, [], [15], 'vacuum=15', 15, true, new Map([['vacuum', 15]]), new Params(), new Date(0), new Float64Array(3)]) {
      assert.throws(() => commands.run('test.cleave', bad), { code: 'invalid-params', message: 'Cleave surface: pass the parameters as an object.' }, String(bad));
    }
    assert.equal(calls.length, 0);
    // objects without a prototype and objects of another realm (a parent page's) are plain objects
    const bare = Object.assign(Object.create(null), { miller: [1, 1, 1], vacuum: 10 });
    commands.run('test.cleave', bare);
    commands.run('test.cleave', vm.runInNewContext('({ miller: [1, 1, 0], vacuum: 12 })'));
    assert.deepEqual(calls.map((c) => c[1]), [{ miller: [1, 1, 1], layers: 4, vacuum: 10 }, { miller: [1, 1, 0], layers: 4, vacuum: 12 }]);
  });

  test('unknown parameters are refused (strict); each message has the title once; all problems are in errors', () => {
    commands.setContext(fakeApp());
    reg(CLEAVE);
    // the embedding-page call of F0-A US8, with the old name hkl and a string for layers
    assert.throws(() => commands.run('test.cleave', { hkl: [1, 1, 1], layers: '4' }), (e) => {
      assert.equal(e.code, 'invalid-params');
      assert.equal(e.message, 'Cleave surface: unknown parameter “hkl” (use miller, layers, vacuum).');
      assert.deepEqual(e.errors, ['Cleave surface: unknown parameter “hkl” (use miller, layers, vacuum).', 'Cleave surface: Layers: enter a number.', 'Cleave surface: Vacuum: enter a value.']);
      return true;
    });
    assert.throws(() => commands.run('test.cleave', { miller: [1, 0, 0, 0], vacuum: 5 }), { message: 'Cleave surface: Plane: in (h k i l), i must be −(h + k) = -1.' });
    assert.throws(() => commands.run('test.cleave', { miller: [1, 1, 1], vacuum: -1 }), { message: 'Cleave surface: Vacuum: use a value from 0 to ∞.' });
    // undefined values count as not given (JSON never has them); a command with an empty schema takes {} only
    reg({ id: 'test.flip', title: 'Flip slab', params: [] });
    assert.equal(commands.run('test.flip', {}), 'ran');
    assert.equal(commands.run('test.flip', { side: undefined }), 'ran');
    assert.throws(() => commands.run('test.flip', { side: 'top' }), { message: 'Flip slab: unknown parameter “side” (it takes no parameters).' });
  });

  test('the title in messages drops a trailing ellipsis, also three dots', () => {
    assert.equal(commandTitle({ title: 'Cleave surface…' }), 'Cleave surface');
    assert.equal(commandTitle({ title: 'Look along a direction or plane...' }), 'Look along a direction or plane');
    assert.equal(commandTitle({ id: 'x.y' }), 'x.y');
    assert.equal(commandTitle('Build layers… '), 'Build layers');
    commands.setContext(fakeApp());
    reg({ id: 'test.dots', title: 'Do it...', params: [VACUUM] });
    assert.throws(() => commands.run('test.dots', {}), { message: 'Do it: Vacuum: enter a value.' });
    assert.throws(() => commands.run('test.dots', 'x'), { message: 'Do it: pass the parameters as an object.' });
  });

  test('commands without a schema get their arguments unchanged (plugins: run(app, ...args))', () => {
    const app = fakeApp();
    commands.setContext(app);
    const { calls } = reg({ id: 'test.plain', title: 'Plain' });
    commands.run('test.plain', 'a', 2, { b: 3 });
    commands.get('test.plain').run(null);
    assert.deepEqual(calls, [[app, 'a', 2, { b: 3 }], [app, null]]);
  });

  test('register checks the new fields', () => {
    const run = () => {};
    assert.throws(() => commands.register({ id: 'test.bad', run, params: { vacuum: VACUUM } }), { name: 'TypeError', message: 'commands.register: params of “test.bad” must be a list (a parameter schema)' });
    assert.throws(() => commands.register({ id: 'test.bad', run, estimate: 12 }), { name: 'TypeError', message: 'commands.register: estimate of “test.bad” must be a function (app, params) → atoms' });
    assert.throws(() => commands.register({ id: 'test.bad', run, aliases: ['A', 2] }), { name: 'TypeError', message: 'commands.register: aliases of “test.bad” must be a name or a list of names' });
    assert.equal(commands.get('test.bad'), undefined);
    const { entry } = reg({ id: 'test.alias', title: 'Supercell…', aliases: ' Create Supercell ', ms: 'Build › Symmetry › Supercell' });
    assert.deepEqual([entry.aliases, entry.ms], [['Create Supercell'], 'Build › Symmetry › Supercell']);
    assert.deepEqual(reg({ id: 'test.none', title: 'None' }).entry.aliases, []);
  });
});

// ------------------------------------------------------------------ atom limits and the large-structure confirmation
describe('estimate, LIMITS and the confirmation', () => {
  const BIG = (atoms) => ({ id: 'test.big', title: 'Make supercell…', params: [{ name: 'n', type: 'int', min: 1 }], estimate: (app, p) => atoms(p) });

  test('the limits and the preference that raises them', () => {
    assert.deepEqual(LIMITS, { maxAtoms: 200_000, confirmAtoms: 30_000 });
    assert.ok(Object.isFrozen(LIMITS));
    assert.equal(MAX_ATOMS_LIMIT, 2_000_000);
    assert.equal(atomLimit(fakeApp()), 200_000);
    assert.equal(atomLimit(fakeApp({ prefs: { maxAtoms: 500_000 } })), 500_000);
    assert.equal(atomLimit(fakeApp({ prefs: { maxAtoms: 5e6 } })), 2_000_000, 'at most 2 000 000');
    assert.equal(atomLimit(fakeApp({ prefs: { maxAtoms: 1000.7 } })), 1000);
    for (const v of ['many', 0, -5, NaN, null, Infinity]) assert.equal(atomLimit(fakeApp({ prefs: { maxAtoms: v } })), 200_000, String(v));
    assert.equal(atomLimit(null), 200_000);
  });

  test('more atoms than the limit: too-large, and run() is not called', () => {
    commands.setContext(fakeApp());
    const { calls } = reg(BIG((p) => p.n * 1000));
    assert.throws(() => commands.run('test.big', { n: 250 }), (e) => {
      assert.ok(e instanceof CommandError);
      assert.equal(e.code, 'too-large');
      assert.equal(e.message, 'Make supercell: this would make 250,000 atoms; the limit is 200,000.');
      assert.deepEqual([e.atoms, e.limit], [250_000, 200_000]);
      return true;
    });
    assert.equal(calls.length, 0);
    assert.equal(commands.run('test.big', { n: 200 }), 'ran', 'exactly the limit is fine');
    commands.setContext(fakeApp({ prefs: { maxAtoms: 300_000 } }));
    assert.equal(commands.run('test.big', { n: 250 }), 'ran');
    commands.setContext(fakeApp({ prefs: { maxAtoms: 9e9 } }));
    assert.throws(() => commands.run('test.big', { n: 2001 }), { message: 'Make supercell: this would make 2,001,000 atoms; the limit is 2,000,000.' });
    assert.equal(calls[0][2].atoms, 200_000, 'run() learns the estimate');
  });

  test('an estimate of null (or anything but a finite number) checks nothing', () => {
    commands.setContext(fakeApp());
    for (const v of [null, undefined, NaN, Infinity, '9999999']) {
      offs.push(commands.register({ ...BIG(() => v), run: () => 'ran' }));
      assert.equal(commands.run('test.big', { n: 1 }), 'ran', String(v));
    }
    // the estimate sees the app and the normalized values; an error in it is the caller's
    const seen = [];
    offs.push(commands.register({ ...BIG((p) => { seen.push(p); return 1; }), run: () => 'ran' }));
    commands.run('test.big', { n: 3 });
    assert.deepEqual(seen, [{ n: 3 }]);
    offs.push(commands.register({ ...BIG(() => { throw new RangeError('estimate failed'); }), run: () => 'ran' }));
    assert.throws(() => commands.run('test.big', { n: 3 }), { name: 'RangeError', message: 'estimate failed' });
  });

  test('an interactive call asks before making more than 30 000 atoms; scripts are not asked', async () => {
    const app = fakeApp();
    commands.setContext(app);
    const asked = [];
    let answer = false;
    commands.setConfirm(async (o) => { asked.push(o); return answer; });
    const { calls } = reg(BIG((p) => p.n));
    // a script (facet.command, embedding pages, plugins): no question, the command runs at once
    assert.equal(commands.run('test.big', { n: 40_000 }), 'ran');
    assert.equal(asked.length, 0);
    // a panel asks for it with { interactive: true }: declined → run() is not called, the Promise gives undefined
    const declined = commands.run('test.big', { n: 40_000 }, { interactive: true });
    assert.ok(declined instanceof Promise);
    assert.equal(await declined, undefined);
    assert.equal(calls.length, 1);
    assert.deepEqual(asked, [{
      title: 'Make a large structure?', confirm: 'Continue', atoms: 40_000, command: 'Make supercell',
      message: 'Make supercell would make 40,000 atoms. The view may turn slow, and undo keeps fewer steps for a structure this large.',
    }]);
    answer = true;
    assert.equal(await commands.get('test.big').run({ n: 40_000 }, { interactive: true }), 'ran');
    assert.deepEqual(calls.at(-1), [app, { n: 40_000 }, { interactive: true, atoms: 40_000, warnings: [] }]);
    // up to 30 000 atoms nobody is asked, and the result is not a Promise
    assert.equal(commands.run('test.big', { n: 30_000 }, { interactive: true }), 'ran');
    assert.equal(asked.length, 2);
    // above the limit the call is refused before anybody is asked
    assert.throws(() => commands.run('test.big', { n: 300_000 }, { interactive: true }), { code: 'too-large' });
    assert.equal(asked.length, 2);
    // with no confirmation set (node, or a page without one) the answer is yes
    commands.setConfirm(null);
    assert.equal(await commands.run('test.big', { n: 50_000 }, { interactive: true }), 'ran');
  });

  test('checkAtoms and confirmAtoms for panels that build through a preview', async () => {
    const app = fakeApp();
    assert.doesNotThrow(() => checkAtoms(200_000, { title: 'Cleave surface…', app }));
    assert.throws(() => checkAtoms(200_001, { title: 'Cleave surface…', app }), { code: 'too-large', message: 'Cleave surface: this would make 200,001 atoms; the limit is 200,000.' });
    assert.equal(await confirmAtoms(30_000, { title: 'Cleave surface…' }), true);
    const asked = [];
    commands.setConfirm((o) => { asked.push(o.message); return Promise.resolve(false); });
    assert.equal(await confirmAtoms(30_001, { title: 'Cleave surface…' }), false);
    assert.deepEqual(asked, ['Cleave surface would make 30,001 atoms. The view may turn slow, and undo keeps fewer steps for a structure this large.']);
  });
});

// ------------------------------------------------------------------ edits: canEdit and editWhyNot
describe('edits combines canEdit with the command’s own guard', () => {
  const session = (active = true) => ({ active, kind: 'structure', cancel() {} });

  test('canEdit, editWhyNot and the preview session', () => {
    assert.equal(canEdit(fakeApp()), true);
    assert.equal(canEdit(fakeApp({ structure: null })), false);
    assert.equal(canEdit(fakeApp({ busy: true })), false);
    assert.equal(canEdit(fakeApp({ session: session() })), false);
    assert.equal(canEdit(fakeApp({ session: session(false) })), true, 'an ended session does not count');
    assert.equal(editWhyNot(fakeApp({ session: session() })), 'Apply or cancel the preview first.');
    assert.equal(editWhyNot(fakeApp()), null);
    assert.equal(previewSession(fakeApp({ session: session(false) })), null);
  });

  test('the palette hides an editing command during a preview, and says why', () => {
    const ownWhen = (app) => !!app.structure?.cell;
    const ownWhyNot = () => 'Needs a unit cell.';
    const { entry } = reg({ id: 'test.edit', title: 'Edit cell…', edits: true, when: ownWhen, whyNot: ownWhyNot });
    const cases = [
      [fakeApp(), true, null],
      [fakeApp({ structure: molecule() }), false, 'Needs a unit cell.'],
      [fakeApp({ session: session() }), false, 'Apply or cancel the preview first.'],
      [fakeApp({ structure: molecule(), session: session() }), false, 'Apply or cancel the preview first.'],
      [fakeApp({ busy: true }), false, 'Wait for the current task to finish.'],
      [fakeApp({ structure: null }), false, 'Load a structure first.'],
    ];
    for (const [app, ok, why] of cases) {
      commands.setContext(app);
      assert.equal(commands.available('test.edit'), ok);
      if (!ok) {
        assert.equal(commands.unavailableReason('test.edit'), why);
        assert.throws(() => commands.run('test.edit'), (e) => e instanceof CommandError && e.code === 'unavailable' && e.message === why);
      }
    }
    // registering the stored entry again (a plugin's replacement removed) wraps the command's own guard once only
    let n = 0;
    offs.push(commands.register({ id: 'test.counted', title: 'Counted', edits: true, when: () => { n++; return true; }, run: () => {} }));
    offs.push(commands.register(commands.get('test.counted')));
    offs.push(commands.register(commands.get('test.counted')));
    commands.setContext(fakeApp());
    assert.equal(commands.available('test.counted'), true);
    assert.equal(n, 1);
    // a copy with edits turned off keeps only the command's own guard
    offs.push(commands.register({ ...entry, id: 'test.plainCopy', edits: false }));
    commands.setContext(fakeApp({ session: session() }));
    assert.equal(commands.available('test.plainCopy'), true);
  });

  test('Cancel preview (F0-A) cancels the open session', () => {
    const cancelled = [];
    const app = fakeApp({ session: { active: true, cancel: (r) => cancelled.push(r) } });
    commands.setContext(app);
    assert.equal(commands.registerFallback(CANCEL_PREVIEW) !== null, true);
    offs.push(() => commands.unregister('edit.cancelPreview'));
    assert.deepEqual([commands.get('edit.cancelPreview').title, commands.get('edit.cancelPreview').category], ['Cancel preview', 'Edit']);
    assert.equal(commands.available('edit.cancelPreview'), true);
    commands.run('edit.cancelPreview');
    assert.deepEqual(cancelled, ['cancel']);
    commands.setContext(fakeApp());
    assert.equal(commands.available('edit.cancelPreview'), false);
    assert.equal(commands.unavailableReason('edit.cancelPreview'), 'There is no preview to cancel.');
  });
});

// ------------------------------------------------------------------ keys commands must not take (M7 KC-06)
describe('keys commands must not take', () => {
  test('keyProblem names the forbidden keys', () => {
    for (const k of ['mod+c', 'mod+v', 'mod+x', 'Mod+V', 'ctrl+c', 'meta+x', 'cmd+v', 'mod+shift+v', 'e', 'q', 'E', 'shift+x', 'shift+y', 'shift+z', 'shift+r', 'shift+q', 'shift+e', 'alt+k', 'alt+shift+a', 'mod+alt+x']) {
      assert.ok(keyProblem(k), k);
    }
    // the keys of this release (M7 §5.2) and the app's own keys are fine
    for (const k of ['n', 'shift+n', 'shift+5', 'mod+enter', 'g', 'shift+l', 'shift+u', 'shift+a', 'shift+s', 'x', 'y', 'z', 'r', 'Home', 'f', '+', '=', '-', 'a', 'b', 'c',
      'p', 't', 'u', 'l', 'shift+f', 'm', 'v', 'Escape', 'mod+a', 'Delete', 'Backspace', ' ', ',', 'ArrowLeft', '.', 'ArrowRight', '[', ']', '?', 'F1', 'shift+1', '1', '9',
      'mod+o', 'mod+s', 'mod+e', 'mod+k', 'mod+z', 'alt+1', 'shift++']) {
      assert.equal(keyProblem(k), null, k);
    }
  });

  test('register leaves such a key out, with a warning; kbd may still show it', () => {
    const [, warned] = quiet(() => {
      reg({ id: 'test.copy', title: 'Copy atoms', key: 'mod+c', kbd: 'mod+c' });
      reg({ id: 'test.mixed', title: 'Mixed', key: ['shift+x', 'k', 'alt+j'] });
      reg({ id: 'test.one', title: 'One', key: ['q', 'j'] });
    });
    assert.equal(commands.get('test.copy').key, undefined);
    assert.equal(commands.get('test.copy').kbd, 'mod+c');
    assert.deepEqual(commands.get('test.mixed').key, ['k']);
    assert.deepEqual(commands.get('test.one').key, ['j']);
    assert.equal(warned.length, 4);
    assert.match(warned[0], /^commands\.register: “test\.copy” cannot use the key “mod\+c”: Ctrl\/⌘ C, V and X belong to copy, paste and cut; the key is left out$/);
  });

  test('no key that main.js binds is forbidden', () => {
    const src = readFileSync(new URL('../../facet/web/js/main.js', import.meta.url), 'utf8');
    const keys = [...src.matchAll(/\bkey: (\[[^\]]*\]|'[^']*'|`[^`]*`)/g)].flatMap(([, v]) => [...v.matchAll(/'([^']*)'|`([^`]*)`/g)].map((m) => m[1] ?? m[2]));
    assert.ok(keys.length > 20, keys.join(' '));
    for (const k of keys) assert.equal(keyProblem(k.replace('${i + 1}', '5')), null, k);
  });
});

// ------------------------------------------------------------------ fallbacks of the M1–M6 commands (F0-A §5.8)
describe('fallbacks open the section of each surface command until its module registers it', () => {
  /** The ids, titles, categories and Materials Studio names of the contract (ledger L-F0-52; M2 v2: flip, center). */
  const CONTRACT = [
    ['surface.cleave', 'Cleave surface…', 'Surface', ['Cleave Surface'], ['surface', 'cleave']],
    ['surface.vacuum', 'Build vacuum slab…', 'Surface', ['Build Vacuum Slab'], ['surface', 'slab']],
    ['surface.setVacuum', 'Set vacuum…', 'Surface', ['Vacuum'], ['surface', 'slab']],
    ['surface.flip', 'Flip slab', 'Surface', [], ['surface', 'slab']],
    ['surface.center', 'Centre slab', 'Surface', [], ['surface', 'slab']],
    ['cell.supercell', 'Supercell…', 'Cell', ['Supercell', 'Create Supercell'], ['structure', 'cell']],
    ['cell.redefine', 'Redefine lattice…', 'Cell', ['Redefine Lattice'], ['structure', 'cell']],
    ['cell.parameters', 'Lattice parameters…', 'Cell', ['Lattice Parameters'], ['structure', 'cell']],
    ['cell.reorient', 'Re-orient to standard', 'Cell', ['Re-orient to standard'], ['structure', 'cell']],
    ['constraints.edit', 'Modify constraints…', 'Edit', ['Modify Constraints', 'Edit Constraints'], ['structure', 'constraints']],
    ['sel.fix', 'Fix selected atoms', 'Edit', ['Fix fractional position'], ['structure', 'constraints']],
    ['sel.free', 'Free selected atoms', 'Edit', [], ['structure', 'constraints']],
    ['sel.query', 'Atom selection…', 'Edit', ['Atom Selection'], ['structure', null]],
    ['tool.move', 'Move tool', 'Tools', ['Translate', 'Rotate'], ['structure', 'transform']],
    ['adsorbate.add', 'Add adsorbate…', 'Surface', ['Add Adsorbate'], ['surface', 'adsorbates']],
    ['sites.find', 'Find adsorption sites', 'Surface', ['Find Adsorption Sites'], ['surface', 'adsorbates']],
    ['tool.sitePick', 'Pick adsorption site', 'Tools', [], ['surface', 'adsorbates']],
    ['build.layers', 'Build layers…', 'Surface', ['Build Layers'], ['surface', 'interface']],
  ];
  const EDITS = ['surface.cleave', 'surface.vacuum', 'surface.setVacuum', 'surface.flip', 'surface.center', 'cell.supercell', 'cell.redefine', 'cell.parameters', 'cell.reorient', 'constraints.edit', 'sel.fix', 'sel.free', 'adsorbate.add'];
  const guards = { cell: sections.requireCell, gap: (a) => sections.requireVacuumGap(a, vacuum) };
  /** Register every fallback with a recording open(); returns the opened sections and the notices. */
  function install({ known = () => true } = {}) {
    const opened = [], notes = [];
    const open = (panel, section) => { opened.push([panel, section]); return known(panel, section); };
    for (const c of sectionFallbacks({ open, notify: (m) => notes.push(m), guards })) offs.push(commands.registerFallback(c));
    return { opened, notes };
  }

  test('the table is the contract: ids, titles, categories, MS names, sections and edits', () => {
    assert.deepEqual(SECTION_COMMANDS.map((r) => [r.id, r.title, r.category, [...r.aliases], [...r.open]]), CONTRACT);
    assert.deepEqual(SECTION_COMMANDS.filter((r) => r.edits).map((r) => r.id), EDITS);
    assert.deepEqual(Object.fromEntries(SECTION_COMMANDS.filter((r) => r.ms).map((r) => [r.id, r.ms])), {
      'surface.cleave': 'Build › Surfaces › Cleave Surface', 'surface.vacuum': 'Build › Crystals › Build Vacuum Slab', 'constraints.edit': 'Modify › Constraints',
      'sel.query': 'Edit › Atom Selection', 'build.layers': 'Build › Build Layers',
    });
    assert.ok(!SECTION_COMMANDS.some((r) => r.id === 'surface.supercell'), 'no surface.supercell (M2 v2: cell.supercell)');
    // the cleave command's parameter is miller (not hkl); vacuum is required with no default (U4) on all three
    const names = (id) => SECTION_COMMANDS.find((r) => r.id === id).params?.map((p) => p.name) ?? null;
    assert.deepEqual(names('surface.cleave'), ['miller', 'layers', 'vacuum']);
    for (const id of ['surface.cleave', 'surface.vacuum', 'surface.setVacuum']) {
      const v = SECTION_COMMANDS.find((r) => r.id === id).params.find((p) => p.name === 'vacuum');
      assert.deepEqual([v.type, v.required, v.min, v.unit, 'default' in v], ['float', true, 0, 'Å', false], id);
    }
    assert.equal(names('surface.flip'), null);
  });

  test('run without parameters opens the section; a section that is not there says so', () => {
    commands.setContext(fakeApp({ structure: slab(), selection: [0] }));
    const { opened, notes } = install({ known: (panel, section) => panel === 'surface' && section !== null });
    for (const [id, , , , where] of CONTRACT) commands.get(id).run();
    assert.deepEqual(opened, CONTRACT.map((c) => c[4]));
    assert.deepEqual(notes, ['Supercell is not available in this build yet.', 'Redefine lattice is not available in this build yet.',
      'Lattice parameters is not available in this build yet.', 'Re-orient to standard is not available in this build yet.',
      'Modify constraints is not available in this build yet.', 'Fix selected atoms is not available in this build yet.', 'Free selected atoms is not available in this build yet.',
      'Atom selection is not available in this build yet.', 'Move tool is not available in this build yet.']);
  });

  test('with the real openSection: the Surface sections are there (placeholders until the modules come), the Structure slots not yet', () => {
    const app = fakeApp({ structure: slab() });
    app.setPref = (k, v) => { app.prefs[k] = v; };
    const shown = [];
    sections.attachSections({ app, openLeft: (id) => shown.push(id), refreshPanel() {} });
    const notes = [];
    const open = (panel, section) => (section ? sections.openSection(panel, section) : false);
    for (const c of sectionFallbacks({ open, notify: (m) => notes.push(m), guards })) offs.push(commands.registerFallback(c));
    commands.setContext(app);
    commands.run('surface.cleave');
    commands.run('build.layers');
    commands.run('cell.supercell');
    assert.deepEqual(shown, ['surface', 'surface', 'structure']);
    assert.deepEqual(notes, ['Supercell is not available in this build yet.']);
    assert.equal(app.prefs.sections['surface.cleave'], true, 'the section is opened');
  });

  test('called with parameters a fallback refuses: invalid-params first where it has a schema, else unavailable', () => {
    const app = fakeApp({ structure: slab() });
    commands.setContext(app);
    const before = JSON.stringify(app.structure.toJSON());
    const { opened } = install();
    // the U4 check of the brief: no vacuum → invalid-params, and nothing happens
    assert.throws(() => commands.run('surface.cleave', {}), { code: 'invalid-params', message: 'Cleave surface: Vacuum: enter a value.' });
    assert.throws(() => commands.run('surface.vacuum', { axis: 'c' }), { code: 'invalid-params', message: 'Build vacuum slab: unknown parameter “axis” (use vacuum).' });
    assert.throws(() => commands.run('surface.setVacuum', { vacuum: null }), { code: 'invalid-params', message: 'Set vacuum: Vacuum: enter a value.' });
    assert.throws(() => commands.run('surface.cleave', { miller: [0, 0, 0], vacuum: 10 }), { message: 'Cleave surface: Plane: (0 0 0) is not a plane.' });
    // valid parameters: the command itself is not in this build yet
    assert.throws(() => commands.run('surface.cleave', { miller: [1, 1, 1], layers: 4, vacuum: 15 }), { code: 'unavailable', message: 'Cleave surface: not available in this build yet.' });
    assert.throws(() => commands.run('surface.flip', {}), { code: 'unavailable', message: 'Flip slab: not available in this build yet.' });
    assert.throws(() => commands.run('cell.supercell', { matrix: [[2, 0, 0], [0, 2, 0], [0, 0, 1]] }), { code: 'unavailable', message: 'Supercell: not available in this build yet.' });
    assert.deepEqual(opened, []);
    assert.equal(JSON.stringify(app.structure.toJSON()), before);
  });

  test('a fallback never replaces a command, and the module’s command replaces the fallback', () => {
    commands.setContext(fakeApp());
    const mine = () => 'M2';
    offs.push(commands.register({ id: 'surface.cleave', title: 'Cleave surface…', category: 'Surface', run: mine, aliases: ['Cleave Surface', 'slab from bulk'] }));
    const [first] = sectionFallbacks({ open: () => true });
    assert.equal(commands.registerFallback(first), null, 'already registered (module code imported before main.js)');
    assert.equal(commands.run('surface.cleave'), 'M2');
    install();
    assert.equal(commands.run('surface.cleave'), 'M2', 'still the module’s');
    assert.equal(commands.get('surface.flip').fallback, true);
    offs.push(commands.register({ id: 'surface.flip', title: 'Flip slab', category: 'Surface', run: () => 'flipped', params: [] }));
    assert.equal(commands.run('surface.flip', {}), 'flipped', 'a module registered later wins');
    assert.equal(commands.get('surface.flip').fallback, undefined);
    assert.throws(() => commands.registerFallback({ title: 'x', run() {} }), { message: 'commands.registerFallback: missing id' });
    assert.throws(() => sectionFallbacks({}), { name: 'TypeError' });
  });

  test('guards: a unit cell, a vacuum gap (pbc T T F passes), a selection, a cell in the project; edits during a preview', () => {
    install();
    const state = (app) => {
      commands.setContext(app);
      return Object.fromEntries(CONTRACT.map(([id]) => [id, commands.available(id) ? true : commands.unavailableReason(id)]));
    };
    const noGap = 'No vacuum gap of 5 Å or more along a cell vector (the widest is 3.9 Å along c); add vacuum first.';
    const noCell = 'This structure has no unit cell. Surface tools work on crystals and slabs with a unit cell.';
    // a bulk crystal: the tools that need a gap say what is missing (U1: never "not a slab")
    const onBulk = state(fakeApp());
    for (const id of ['surface.setVacuum', 'surface.flip', 'surface.center', 'sites.find', 'tool.sitePick']) assert.equal(onBulk[id], noGap, id);
    for (const id of ['surface.cleave', 'surface.vacuum', 'cell.supercell', 'adsorbate.add', 'build.layers', 'constraints.edit', 'sel.query', 'tool.move']) assert.equal(onBulk[id], true, id);
    assert.equal(onBulk['sel.fix'], 'Select atoms first.');
    assert.ok(!Object.values(onBulk).some((v) => typeof v === 'string' && /\bslab\b/i.test(v)), 'no reason calls the structure a slab or not');
    // a slab with 16 Å of vacuum, atoms selected: everything
    assert.ok(Object.values(state(fakeApp({ structure: slab(), selection: [0] }))).every((v) => v === true));
    // a sheet with pbc T T F and no vacuum along c: the gap tools work too
    const onSheet = state(fakeApp({ structure: sheet() }));
    for (const id of ['surface.setVacuum', 'surface.flip', 'surface.center', 'sites.find', 'tool.sitePick']) assert.equal(onSheet[id], true, id);
    // a molecule without a cell; a project that has a crystal elsewhere still allows Build layers
    const onMolecule = state(fakeApp({ structure: molecule(), project: { structures: [{ structure: molecule() }, { structure: bulk() }] } }));
    for (const id of ['surface.cleave', 'surface.vacuum', 'surface.setVacuum', 'cell.supercell', 'adsorbate.add', 'sites.find']) assert.equal(onMolecule[id], noCell, id);
    assert.equal(onMolecule['build.layers'], true);
    assert.equal(state(fakeApp({ structure: molecule() }))['build.layers'], 'Load a structure with a unit cell first.');
    // no structure at all
    const empty = state(fakeApp({ structure: null }));
    for (const id of ['surface.cleave', 'sel.query', 'tool.move', 'sel.fix', 'constraints.edit']) assert.equal(empty[id], 'Load a structure first.', id);
    // during a preview the editing commands are unavailable, the others are not
    const preview = state(fakeApp({ structure: slab(), selection: [0], session: { active: true } }));
    for (const [id] of CONTRACT) assert.equal(preview[id], EDITS.includes(id) ? 'Apply or cancel the preview first.' : true, id);
  });

  test('the palette finds them by their Materials Studio names', () => {
    commands.setContext(fakeApp({ structure: slab(), selection: [0] }));
    install();
    const list = commands.list().filter((c) => commands.available(c));
    const top = (q) => { const [r] = rankCommands(list, q); return r && [r.cmd.id, r.alias]; };
    // acceptance MD-7 and F0-A US7: each MS name finds its command first
    assert.deepEqual(['Cleave Surface', 'Build Vacuum Slab', 'Supercell', 'Redefine Lattice', 'Modify Constraints', 'Atom Selection', 'Add Adsorbate', 'Find Adsorption Sites', 'Build Layers']
      .map((q) => top(q)[0]), ['surface.cleave', 'surface.vacuum', 'cell.supercell', 'cell.redefine', 'constraints.edit', 'sel.query', 'adsorbate.add', 'sites.find', 'build.layers']);
    // names that are not the title show the alias that matched
    assert.deepEqual(top('Create Supercell'), ['cell.supercell', 'Create Supercell']);
    assert.deepEqual(top('Fix fractional position'), ['sel.fix', 'Fix fractional position']);
    assert.deepEqual(top('Edit Constraints'), ['constraints.edit', 'Edit Constraints']);
    assert.deepEqual(top('Translate'), ['tool.move', 'Translate']);
    assert.deepEqual(top('vacuum'), ['surface.setVacuum', 'Vacuum']);
  });

  test('reference() lists aliases, the MS path and the parameter schema as data', () => {
    const app = { ...fakeApp(), viewer: {}, storage: { list: () => [], get: () => null }, get: () => undefined };
    commands.setContext(app);
    install();
    offs.push(commands.register({ id: 'test.opts', title: 'Options', run() {}, params: [{ name: 'mode', type: 'select', options: () => ['a', 'b'], label: 'Mode' }, { name: 'm', type: 'imatrix', presets: [{ label: 'p(2×2)', value: [[2, 0, 0], [0, 2, 0], [0, 0, 1]] }] }] }));
    const ref = createAPI(app, null).reference();
    const by = Object.fromEntries(ref.commands.map((c) => [c.id, c]));
    assert.deepEqual(by['surface.cleave'], {
      id: 'surface.cleave', title: 'Cleave surface…', category: 'Surface', key: '', aliases: ['Cleave Surface'], ms: 'Build › Surfaces › Cleave Surface',
      params: [
        { name: 'miller', type: 'miller', label: 'Plane' },
        { name: 'layers', type: 'int', label: 'Layers', min: 1, max: 1000 },
        { name: 'vacuum', type: 'float', label: 'Vacuum', unit: 'Å', min: 0, max: 1000, required: true, description: 'Total gap between the slab and its periodic image (Å); 0 for none.' },
      ],
    });
    assert.deepEqual([by['surface.flip'].aliases, by['surface.flip'].ms, by['surface.flip'].params], [[], null, null]);
    assert.deepEqual(by['test.opts'].params, [{ name: 'mode', type: 'select', label: 'Mode' }, { name: 'm', type: 'imatrix', presets: [{ label: 'p(2×2)', value: [[2, 0, 0], [0, 2, 0], [0, 0, 1]] }] }], 'functions are left out');
    assert.doesNotThrow(() => JSON.stringify(ref.commands));
  });
});
