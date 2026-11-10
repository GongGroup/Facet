// Facet was called Crystallume, and before that AtomScope: files written under either name still open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Structure } from '../../facet/web/js/core/structure.js';
import { readJSON } from '../../facet/web/js/io/jsonfmt.js';
import { repoPath } from './helpers.mjs';

for (const old of ['crystallume', 'atomscope']) {
  test(`${old}: a structure file still opens and is saved under the new schema`, () => {
    const s = Structure.fromJSON({ schema: `${old}.structure/1`, symbols: ['H'], positions: [[0, 0, 0]] });
    assert.equal(s.length, 1);
    assert.equal(s.toJSON().schema, 'facet.structure/1');
    assert.equal(readJSON(JSON.stringify({ schema: `${old}.structure/1`, symbols: ['H'], positions: [[0, 0, 0]] })).length, 1);
  });

  test(`${old}: a project file is recognised as a project`, () => {
    const doc = { schema: `${old}.project/1`, name: 'old', structures: [] };
    assert.throws(() => readJSON(JSON.stringify(doc)), (e) => e.message === 'This is a project file' && e.project.name === 'old');
  });

  test(`${old}: the page keeps the former global, message prefix and project file extension`, () => {
    const read = (f) => readFileSync(repoPath(`facet/web/js/${f}`), 'utf8');
    assert.match(read('main.js'), new RegExp(`window\\.${old} = api;`));
    assert.match(read('api/embed.js'), new RegExp(`type: '${old}:ready'`));
    assert.match(read('api/embed.js'), /\^\(facet\|crystallume\|atomscope\):/);
    assert.match(read('storage/folder.js'), new RegExp(`'\\.${old}\\.json'`));
    assert.match(read('app.js'), /"\(facet\|crystallume\|atomscope\)\\\.project/);
  });
}
