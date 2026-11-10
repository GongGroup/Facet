// The shared data module core/webdata.js (M5 §4.2, ledger L-M2-06): crystallume/web/data/*.json, one copy that the
// browser fetches next to the app and Node reads with fs. tests/test_webdata.py runs the same checks on the Python
// twin (crystallume/core/webdata.py); both files hold the same JSON constant PARITY_CASES (between the BEGIN and END
// PARITY_CASES lines): the data file names with the error text that both languages must give. The last tests load the
// module under an http: URL (Node module hooks) to exercise the browser path: fetch next to the app, without cache.
// Run: node --test tests/js/webdata.test.mjs (or through pytest: tests/test_js_unit.py).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { loadWebData, setWebData, webData } from '../../crystallume/web/js/core/webdata.js';
import { repoPath } from './helpers.mjs';

// BEGIN PARITY_CASES (JSON: the same constant as in tests/test_webdata.py)
const PARITY_CASES = {
  "valid": ["oxidation_states.json"],
  "invalid": [
    {"name": "../oxidation_states.json", "error": "invalid data file name '../oxidation_states.json'"},
    {"name": "data/oxidation_states.json", "error": "invalid data file name 'data/oxidation_states.json'"},
    {"name": "/etc/passwd", "error": "invalid data file name '/etc/passwd'"},
    {"name": "x.json/../oxidation_states.json", "error": "invalid data file name 'x.json/../oxidation_states.json'"},
    {"name": "Oxidation_states.json", "error": "invalid data file name 'Oxidation_states.json'"},
    {"name": "oxidation-states.json", "error": "invalid data file name 'oxidation-states.json'"},
    {"name": "oxidation_states.JSON", "error": "invalid data file name 'oxidation_states.JSON'"},
    {"name": "oxidation_states", "error": "invalid data file name 'oxidation_states'"},
    {"name": "oxidation_states.json.json", "error": "invalid data file name 'oxidation_states.json.json'"},
    {"name": ".json", "error": "invalid data file name '.json'"},
    {"name": "", "error": "invalid data file name ''"},
    {"name": " oxidation_states.json", "error": "invalid data file name ' oxidation_states.json'"},
    {"name": "oxidation_states.json\n", "error": "invalid data file name 'oxidation_states.json\n'"}
  ],
  "missing": "no_such_table.json"
};
// END PARITY_CASES

const fileJSON = (name) => JSON.parse(readFileSync(repoPath(`crystallume/web/data/${name}`), 'utf8'));

test('webData is null until a file is loaded', () => {
  for (const name of PARITY_CASES.valid) assert.equal(webData(name), null);
  assert.equal(webData(PARITY_CASES.missing), null);
});

test('loadWebData reads crystallume/web/data/<name> with fs under Node, once', async () => {
  for (const name of PARITY_CASES.valid) {
    const first = loadWebData(name);
    assert.equal(loadWebData(name), first, 'one promise while it loads');
    const value = await first;
    assert.deepEqual(value, fileJSON(name));
    assert.equal(webData(name), value, 'then webData returns the same value synchronously');
    assert.equal(await loadWebData(name), value);
  }
});

test('invalid names are refused with the text of Python', async () => {
  for (const { name, error } of PARITY_CASES.invalid) {
    await assert.rejects(loadWebData(name), { name: 'Error', message: error });
    assert.throws(() => setWebData(name, {}), { name: 'Error', message: error });
    assert.equal(webData(name), null);
  }
  for (const name of [undefined, null, 5, ['oxidation_states.json']]) {
    await assert.rejects(loadWebData(name), { message: /^invalid data file name / });
  }
});

test('a file that cannot be read rejects, and a later call tries again', async () => {
  const name = PARITY_CASES.missing;
  const first = loadWebData(name);
  await assert.rejects(first, (e) => e instanceof Error && e.message.startsWith(`could not load ${name}: `) && /ENOENT/.test(e.message));
  const again = loadWebData(name);
  assert.notEqual(again, first, 'a failed load is not cached');
  await assert.rejects(again, { message: new RegExp(`^could not load ${name}: `) });
  assert.equal(webData(name), null);
});

test('setWebData puts a value in place of a file (tests, plugins)', async () => {
  const value = { schema: 'example/1', items: [1, 2] };
  setWebData('example_table.json', value);
  assert.equal(webData('example_table.json'), value);
  assert.equal(await loadWebData('example_table.json'), value);
  const real = await loadWebData(PARITY_CASES.valid[0]);
  const stand = { stand: 'in' };
  setWebData(PARITY_CASES.valid[0], stand);
  assert.equal(webData(PARITY_CASES.valid[0]), stand);
  assert.equal(await loadWebData(PARITY_CASES.valid[0]), stand);
  setWebData(PARITY_CASES.valid[0], real);
});

// ---------------------------------------------------------------------------------------------- the browser path
// Serve crystallume/web as http://app.test/ to the module loader, so that webdata.js runs with an http: import.meta.url
// as in the browser, and stand in for fetch.
const ORIGIN = 'http://app.test/';
const WEB = `${pathToFileURL(repoPath('crystallume/web')).href}/`;
register(`data:text/javascript,${encodeURIComponent(`
const ORIGIN = ${JSON.stringify(ORIGIN)}, WEB = ${JSON.stringify(WEB)};
export async function resolve(specifier, context, next) {
  if (specifier.startsWith(ORIGIN)) return { url: specifier, shortCircuit: true };
  if (context.parentURL?.startsWith(ORIGIN) && /^\\.\\.?\\//.test(specifier)) {
    return { url: new URL(specifier, context.parentURL).href, shortCircuit: true };
  }
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (!url.startsWith(ORIGIN)) return next(url, context);
  const { readFile } = await import('node:fs/promises');
  return { format: 'module', source: await readFile(new URL(url.slice(ORIGIN.length), WEB), 'utf8'), shortCircuit: true };
}`)}`);

async function withFetch(respond, fn) {
  const calls = [], original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { calls.push({ url: String(url), opts }); return respond(String(url)); };
  try { await fn(calls); } finally { globalThis.fetch = original; }
}

test('in the browser the data is fetched next to the app, without the HTTP cache', async () => {
  const browser = await import(`${ORIGIN}js/core/webdata.js`);
  const name = PARITY_CASES.valid[0];
  const text = readFileSync(repoPath(`crystallume/web/data/${name}`), 'utf8');
  await withFetch(() => new Response(text, { status: 200 }), async (calls) => {
    assert.equal(browser.webData(name), null);
    const value = await browser.loadWebData(name);
    assert.deepEqual(value, JSON.parse(text));
    assert.equal(browser.webData(name), value);
    await browser.loadWebData(name);
    assert.deepEqual(calls, [{ url: `${ORIGIN}data/${name}`, opts: { cache: 'no-cache' } }], 'fetched once');
  });
});

test('in the browser an HTTP error or a broken file rejects, and a later call tries again', async () => {
  const browser = await import(`${ORIGIN}js/core/webdata.js`);
  await withFetch(() => new Response('not found', { status: 404 }), async (calls) => {
    await assert.rejects(browser.loadWebData('missing_table.json'), { message: 'could not load missing_table.json: HTTP 404' });
    await assert.rejects(browser.loadWebData('missing_table.json'), { message: 'could not load missing_table.json: HTTP 404' });
    assert.equal(calls.length, 2);
  });
  await withFetch(() => new Response('{"cut": ', { status: 200 }), async () => {
    await assert.rejects(browser.loadWebData('broken_table.json'), (e) => e.message.startsWith('could not load broken_table.json: '));
    assert.equal(browser.webData('broken_table.json'), null);
  });
  await withFetch(() => new Response('{"fixed": true}', { status: 200 }), async () => {
    assert.deepEqual(await browser.loadWebData('broken_table.json'), { fixed: true });
  });
});
