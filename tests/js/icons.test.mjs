// Icons of the surface tools (facet/web/js/ui/icons.js, F0-A T10). An unknown name silently draws the
// "info" icon, so the names the modules rely on are checked here.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { icon } = await import(new URL('../../facet/web/js/ui/icons.js', import.meta.url));

test('the surface-tool icons exist and differ from each other', () => {
  const names = ['surface', 'move', 'target', 'lock', 'unlock', 'normal', 'matrix', 'more'];
  const fallback = icon('no-such-icon');
  const drawn = names.map((n) => icon(n));
  drawn.forEach((svg, i) => {
    assert.notEqual(svg, fallback, `${names[i]} is missing`);
    assert.match(svg, /^<svg class="i " viewBox="0 0 24 24" aria-hidden="true">.+<\/svg>$/);
  });
  assert.equal(new Set(drawn).size, names.length);
});
