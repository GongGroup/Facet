// Start-up data tasks (crystallume/web/js/core/boot.js, F0-A T10, ledger L-F0-56).
// The tests share the module's task list (node runs each test file in its own process), so they run in order.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const boot = await import(new URL('../../crystallume/web/js/core/boot.js', import.meta.url));
const { registerBootTask, bootTasks, bootTaskStatus, bootFailureMessage, BOOT_TIMEOUT } = boot;

/** Run fn with console.error captured; returns the captured calls. */
async function quietly(fn) {
  const calls = [], orig = console.error;
  console.error = (...a) => calls.push(a);
  try { await fn(); } finally { console.error = orig; }
  return calls;
}

test('each task gets ten seconds', () => {
  assert.equal(BOOT_TIMEOUT, 10000);
});

test('registerBootTask checks its arguments', () => {
  assert.throws(() => registerBootTask('', () => {}), { name: 'TypeError', message: 'registerBootTask: expected a name' });
  assert.throws(() => registerBootTask('oxidation states'), { name: 'TypeError', message: 'registerBootTask: “oxidation states” needs a function that loads its data' });
  registerBootTask('oxidation states', async () => {});
  assert.throws(() => registerBootTask('oxidation states', async () => {}), { name: 'Error', message: 'registerBootTask: “oxidation states” is already registered' });
  assert.deepEqual(bootTaskStatus('oxidation states'), { name: 'oxidation states', state: 'waiting', error: null });
  assert.equal(bootTaskStatus('nothing'), null);
});

test('bootTasks runs every task once, in registration order, and reports failures without rejecting', async () => {
  let runs = 0;
  registerBootTask('adsorbate library', () => { runs++; return new Promise((r) => setTimeout(r, 5)); });
  registerBootTask('sync value', () => 42);
  registerBootTask('throws', () => { throw new Error('no such file'); });
  registerBootTask('rejects', () => Promise.reject(new Error('HTTP 404')));
  registerBootTask('hangs', () => new Promise(() => {}));
  let results;
  const t0 = Date.now();
  const logged = await quietly(async () => { results = await bootTasks({ timeout: 60 }); });
  assert.ok(Date.now() - t0 < 2000, 'a task that never settles is cut off by its timeout');
  assert.deepEqual(results, [
    { name: 'oxidation states', ok: true, error: null },
    { name: 'adsorbate library', ok: true, error: null },
    { name: 'sync value', ok: true, error: null },
    { name: 'throws', ok: false, error: 'no such file' },
    { name: 'rejects', ok: false, error: 'HTTP 404' },
    { name: 'hangs', ok: false, error: 'timed out after 60 ms' },
  ]);
  assert.equal(logged.length, 3, 'each failure is logged once');
  assert.match(String(logged[0][0]), /Start-up data “throws” failed to load/);
  assert.equal(bootTaskStatus('throws').state, 'failed');
  assert.equal(bootTaskStatus('adsorbate library').state, 'ok');
  // a second call waits for the same runs
  const again = await bootTasks();
  assert.deepEqual(again, results);
  assert.equal(runs, 1);
});

test('a task registered after the start runs at once', async () => {
  let ran = false;
  registerBootTask('plugin data', async () => { ran = true; });
  assert.equal(bootTaskStatus('plugin data').state, 'running');
  const results = await bootTasks();
  assert.equal(ran, true);
  assert.deepEqual(results.at(-1), { name: 'plugin data', ok: true, error: null });
});

test('a task that finishes after its timeout still counts as loaded afterwards', async () => {
  let release;
  await quietly(async () => {
    registerBootTask('slow data', () => new Promise((r) => { release = r; }));
    const r = await bootTasks();   // runs with the first call's 60 ms timeout
    assert.deepEqual(r.at(-1), { name: 'slow data', ok: false, error: 'timed out after 60 ms' });
  });
  release();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(bootTaskStatus('slow data'), { name: 'slow data', state: 'ok', error: null });
});

test('bootFailureMessage names the failed tasks', () => {
  assert.equal(bootFailureMessage([{ name: 'a', ok: true, error: null }]), null);
  assert.equal(bootFailureMessage([]), null);
  assert.equal(bootFailureMessage([{ name: 'oxidation states', ok: false, error: 'x' }]), 'Some data failed to load: oxidation states.');
  assert.equal(bootFailureMessage([{ name: 'a', ok: false }, { name: 'b', ok: true }, { name: 'c', ok: false }]), 'Some data failed to load: a, c.');
});
