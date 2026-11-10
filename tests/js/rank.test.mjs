// Command palette ranking (crystallume/web/js/ui/rank.js; F0-A §3.16, ledger L-F0-52): without aliases it orders
// exactly like the rankCommands that ui/shell.js had before (copied below as the reference); aliases (Materials
// Studio names) score 5 points below the same kind of title match, and the result names the alias that matched.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const web = (rel) => new URL(`../../crystallume/web/js/${rel}`, import.meta.url);
const { rankCommands, CATEGORY_ORDER, ALIAS_PENALTY, byCategory, categoryRank, aliasesOf } = await import(web('ui/rank.js'));
const shell = await import(web('ui/shell.js'));

/** ui/shell.js rankCommands as it was before ui/rank.js (commit af735ea), unchanged: the reference order. */
function oldRankCommands(list, query) {
  const q = String(query ?? '').toLowerCase().trim();
  if (!q) return list.slice();
  const words = q.split(/\s+/);
  const split = (s) => String(s ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const prefixes = (ws, pool) => ws.every((w) => pool.some((t) => t.startsWith(w)));
  const scored = [];
  list.forEach((c, order) => {
    const title = c.title.toLowerCase(), tw = split(c.title), cw = split(c.category), kw = split(c.keywords);
    let s = 0;
    if (title.startsWith(q)) s = 1000;
    else if (tw.some((_, i) => tw.slice(i).join(' ').startsWith(q))) s = 900;
    else if (title.includes(q)) s = 800;
    else if (prefixes(words, tw)) s = 700;
    else if (prefixes(words, [...tw, ...cw])) s = 600;
    else if (words.every((w) => w.length >= 3) && prefixes(words, [...tw, ...cw, ...kw])) s = 400;
    if (s) scored.push([s, c.title.length, order, c]);
  });
  if (!scored.length) {
    list.forEach((c, order) => {
      const t = `${c.category ?? ''} ${c.title}`.toLowerCase();
      let i = 0, gaps = 0;
      for (const ch of q.replace(/\s+/g, '')) { const j = t.indexOf(ch, i); if (j < 0) { i = -1; break; } gaps += j - i; i = j + 1; }
      if (i >= 0) scored.push([100 - Math.min(99, gaps), c.title.length, order, c]);
    });
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]).map((x) => x[3]);
}

// the palette's commands as main.js and the registries make them (titles, categories, keywords), plus odd ones
const C = (id, title, category, keywords) => ({ id, title, category, ...(keywords === undefined ? {} : { keywords }) });
const COMMANDS = [
  C('file.open', 'Open files…', 'File', 'import load cif poscar xyz pdb'), C('file.paste', 'Paste structure text…', 'File', 'clipboard import text cif poscar xyz pdb'),
  C('project.save', 'Save project', 'File'), C('project.new', 'New project', 'File'), C('project.download', 'Download project file', 'File'),
  C('export.png1', 'Export PNG (screen size)', 'Export', 'image picture screenshot'), C('export.png2', 'Export PNG 2×', 'Export', 'image picture screenshot'),
  C('export.png4', 'Export PNG 4× (poster)', 'Export', 'image picture high resolution'), C('export.pngT', 'Export PNG with transparent background', 'Export', 'image alpha'),
  C('export.glb', 'Export 3D model (.glb)', 'Export', 'gltf blender'), C('export.poscar', 'Export POSCAR', 'Export', 'vasp contcar'), C('export.cif', 'Export CIF', 'Export', 'cif crystallographic'),
  C('view.reset', 'Reset view', 'View'), C('view.fit', 'Fit to screen', 'View'), C('view.zoomIn', 'Zoom in', 'View'), C('view.zoomOut', 'Zoom out', 'View'),
  C('view.a', 'Look along a', 'View'), C('view.b', 'Look along b', 'View'), C('view.c', 'Look along c', 'View'),
  C('view.x', 'Look along x', 'View'), C('view.y', 'Look along y', 'View'), C('view.z', 'Look along z', 'View'),
  C('view.projection', 'Toggle perspective / orthographic', 'View'), C('view.turntable', 'Toggle turntable', 'View', 'spin rotate animate'),
  C('view.cell', 'Toggle unit cell', 'View'), C('view.labels', 'Cycle atom labels', 'View'), C('view.fullscreen', 'Full screen', 'View'),
  C('tool.measure', 'Measure distance', 'Tools'), C('tool.angle', 'Measure angle', 'Tools'), C('tool.dihedral', 'Measure dihedral', 'Tools'),
  C('tool.clearMeasurements', 'Clear measurements', 'Tools'), C('tool.select', 'Select tool', 'Tools'),
  C('sel.clear', 'Clear selection', 'Edit', 'deselect exit tool'), C('sel.all', 'Select all atoms', 'Edit'), C('sel.sameElement', 'Select same element', 'Edit', 'species all atoms of element'),
  C('sel.grow', 'Select bonded neighbours', 'Edit', 'grow expand neighbors shell'), C('sel.fragment', 'Select bonded fragment', 'Edit', 'molecule connected double-click'),
  C('sel.delete', 'Delete selected atoms', 'Edit'), C('sel.invert', 'Invert selection', 'Edit'), C('view.showAll', 'Show all atoms', 'View', 'unhide hidden atoms visibility'),
  C('edit.undo', 'Undo', 'Edit'), C('edit.redo', 'Redo', 'Edit'), C('traj.play', 'Play / pause trajectory', 'Trajectory'),
  C('traj.prev', 'Previous frame', 'Trajectory'), C('traj.next', 'Next frame', 'Trajectory'), C('ui.left', 'Toggle side panel', 'Window'), C('ui.right', 'Toggle appearance panel', 'Window'),
  C('ui.shortcuts', 'Keyboard shortcuts', 'Help'), C('ui.tour', 'Take the tour', 'Help', 'help guide onboarding'), C('ui.theme', 'Switch interface theme', 'Window', 'dark light mode'),
  C('ui.api', 'Scripting & API', 'Help'), C('panel.projects', 'Show Projects panel', 'Window'), C('panel.library', 'Show Library panel', 'Window'),
  C('panel.build', 'Show Build panel', 'Window'), C('panel.structure', 'Show Structure panel', 'Window'), C('panel.surface', 'Show Surface panel', 'Window'),
  C('rep.ball-stick', 'Ball and stick', 'Representation', 'Atoms as spheres joined by bonds'), C('rep.spacefill', 'Space filling', 'Representation', 'Atoms at van der Waals radii'),
  C('rep.wireframe', 'Wireframe', 'Representation', 'Bonds as lines'), C('look.studio', 'Studio', 'Look', 'Soft light, white background'), C('look.journal', 'Journal figure', 'Look', 'Flat colours for print'),
  C('light.soft', 'Soft box', 'Lighting'), C('color.element', 'Element (CPK)', 'Colours', 'By element'), C('color.property', 'Property', 'Colours'),
  C('sample.perovskite', 'SrTiO3 perovskite', 'Sample', 'Oxides perovskite cubic'), C('sample.graphene', 'Graphene', 'Sample', ['2D', 'carbon', 'honeycomb']),
  C('toggle.post.ao.enabled', 'Toggle ambient occlusion', 'Effects'), C('toggle.post.outline.enabled', 'Toggle ink outlines', 'Effects'),
  C('toggle.lighting.shadows.enabled', 'Toggle shadows', 'Effects'), C('plugin.hello', 'Say hello', 'Plugin'), C('plugin.bare', 'No category command', undefined),
  C('edit.sortBySpecies', 'Sort atoms by species', 'Edit'), C('cell.supercell', 'Supercell…', 'Cell'), C('surface.cleave', 'Cleave surface…', 'Surface'),
  C('dup.a', 'Select all atoms', 'Edit'), C('unicode', 'Ångström ruler – Δz', 'Tools', 'délta über'),
];

/** Queries: every prefix of every title and keyword word, the words, substrings, multi-word queries and letters. */
function queries() {
  const out = new Set(['', '   ', 'a', 'e', 'x', 'zz', 'qqq', '2×', '3d', '(', '/', '…', 'png 2', 'look a', 'sel all', 'all sel', 'exp pos', 'tog sh', 'sh tog',
    'select bonded', 'bonded', 'spin', 'gltf', 'unhide', 'atoms', 'ATOMS', '  Look  along  ', 'expng', 'tglshd', 'sc', 'ång', 'δz', 'über', 'del ',
    'perov cub', 'oxides', 'honey', '2d', 'Say', 'categ', 'no cat', 'Window panel', 'help guide', 'cell', 'surface', 'super', '…x']);
  for (const c of COMMANDS) {
    const t = c.title.toLowerCase();
    for (let i = 1; i <= Math.min(t.length, 12); i++) out.add(t.slice(0, i));
    for (let i = 1; i + 3 <= t.length; i += 3) out.add(t.slice(i, i + 3));
    for (const w of t.split(/\s+/)) out.add(w);
    for (const w of String(c.keywords ?? '').split(/[\s,]+/)) if (w) { out.add(w); out.add(w.slice(0, 3)); }
  }
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const letters = 'abcdefghijklmnopqrstuvwxyz ';
  for (let k = 0; k < 400; k++) out.add(Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => letters[Math.floor(rnd() * letters.length)]).join(''));
  return [...out];
}

test('without aliases the order is that of the former rankCommands, for every query', () => {
  const qs = queries();
  assert.ok(qs.length > 900, `${qs.length} queries`);
  for (const q of qs) {
    const now = rankCommands(COMMANDS, q);
    assert.deepEqual(now.map((r) => r.cmd.id), oldRankCommands(COMMANDS, q).map((c) => c.id), `query ${JSON.stringify(q)}`);
    assert.ok(now.every((r) => r.alias === null), `no alias for ${JSON.stringify(q)}`);
  }
  // also in another list order (the order breaks ties) and with commands that have empty alias lists
  const reversed = [...COMMANDS].reverse().map((c, i) => (i % 3 ? c : { ...c, aliases: [] }));
  for (const q of qs) assert.deepEqual(rankCommands(reversed, q).map((r) => r.cmd), oldRankCommands(reversed, q), `reversed, ${JSON.stringify(q)}`);
});

test('an empty query keeps the list and its order', () => {
  assert.deepEqual(rankCommands(COMMANDS, '').map((r) => r.cmd), COMMANDS);
  assert.deepEqual(rankCommands(COMMANDS, null).map((r) => r.cmd), COMMANDS);
  assert.ok(rankCommands(COMMANDS, ' ').every((r) => r.alias === null));
  assert.deepEqual(rankCommands([], 'x'), []);
});

// the surface commands with their Materials Studio names (F0-A §5.8)
const SUPERCELL = { id: 'cell.supercell', title: 'Supercell…', category: 'Cell', aliases: ['Supercell', 'Create Supercell'] };
const SET_VACUUM = { id: 'surface.setVacuum', title: 'Set vacuum…', category: 'Surface', aliases: ['Vacuum'] };
const BUILD_SLAB = { id: 'surface.vacuum', title: 'Build vacuum slab…', category: 'Surface', aliases: ['Build Vacuum Slab'] };
const MOVE = { id: 'tool.move', title: 'Move tool', category: 'Tools', aliases: ['Translate', 'Rotate'] };
const FIX = { id: 'sel.fix', title: 'Fix selected atoms', category: 'Edit', aliases: ['Fix fractional position'] };
const SHOW_ALL = { id: 'view.showAll', title: 'Show all atoms', category: 'View', aliases: 'Unhide', keywords: 'unhide hidden atoms visibility' };
const TRANSLATE_ATOMS = { id: 'edit.translate', title: 'Translate selected atoms…', category: 'Edit', aliases: ['Translate'] };
const SURFACE = [SUPERCELL, SET_VACUUM, BUILD_SLAB, MOVE, FIX, SHOW_ALL, TRANSLATE_ATOMS];
const rank = (list, q) => rankCommands(list, q).map((r) => [r.cmd.id, r.alias]);

test('an alias that matches better than the title finds the command and is reported', () => {
  assert.deepEqual(rank(SURFACE, 'Create Supercell'), [['cell.supercell', 'Create Supercell']]);
  assert.deepEqual(rank(SURFACE, 'fix fractional'), [['sel.fix', 'Fix fractional position']]);
  assert.deepEqual(rank(SURFACE, 'unhide'), [['view.showAll', 'Unhide']], 'an alias given as one string');
  // the best alias of several: Rotate
  assert.deepEqual(rank([MOVE], 'rot'), [['tool.move', 'Rotate']]);
  assert.deepEqual(rank([MOVE], 'nsla'), [['tool.move', 'Translate']], 'contains (795)');
  assert.deepEqual(rank([MOVE], 'tate'), [['tool.move', 'Rotate']], 'contains (795)');
});

test('aliases score 5 points below the same kind of title match', () => {
  assert.equal(ALIAS_PENALTY, 5);
  // the title wins a tie of kinds: 'Supercell…' starts with "supercell" (1000) and so does the alias (995)
  assert.deepEqual(rank([SUPERCELL], 'supercell'), [['cell.supercell', null]]);
  // an alias prefix (995) beats a title word (900): "vacuum" starts the alias Vacuum, and a word of Build vacuum slab…
  assert.deepEqual(rank([BUILD_SLAB, SET_VACUUM], 'vacuum'), [['surface.setVacuum', 'Vacuum'], ['surface.vacuum', null]]);
  // a title prefix (1000) beats an alias prefix (995), whatever the list order
  for (const list of [[MOVE, TRANSLATE_ATOMS], [TRANSLATE_ATOMS, MOVE]]) {
    assert.deepEqual(rank(list, 'translate'), [['edit.translate', null], ['tool.move', 'Translate']]);
  }
  // a title word (900) beats an alias word (895), and a title substring (800) an alias substring (795)
  const A = { id: 'a', title: 'Make a slab', aliases: [] }, B = { id: 'b', title: 'Zzz', aliases: ['Make slab'] };
  assert.deepEqual(rank([B, A], 'slab'), [['a', null], ['b', 'Make slab']]);
  const D = { id: 'd', title: 'Xslabx', aliases: [] }, E = { id: 'e', title: 'Q', aliases: ['Yslaby'] };
  assert.deepEqual(rank([E, D], 'slab'), [['d', null], ['e', 'Yslaby']]);
  // an alias contained (795) still beats title word prefixes (700)
  const F = { id: 'f', title: 'Grow slab bonds', aliases: [] }, G = { id: 'g', title: 'Q', aliases: ['A glow sla'] };
  assert.deepEqual(rank([F, G], 'low sla'), [['g', 'A glow sla']], 'title word prefixes need every word to start a word');
  assert.deepEqual(rank([F, G], 'gr sl'), [['f', null]]);
});

test('aliases use only the phrase rules, and never the letters-in-order fallback', () => {
  // every word of the query starts a word of the alias, but the alias neither starts with nor contains the query
  assert.deepEqual(rank([SUPERCELL], 'super create'), []);
  // letters in order of an alias do not match; those of the category and title do
  assert.deepEqual(rank([{ id: 'h', title: 'Q', category: 'Z', aliases: ['Heterostructure'] }], 'htrs'), []);
  assert.deepEqual(rank([{ id: 'h', title: 'Heterostructure', category: 'Z', aliases: ['Q'] }], 'htrs'), [['h', null]]);
});

test('ties go to the shorter matched text, the alias length for an alias match', () => {
  const long = { id: 'long', title: 'Q', aliases: ['Cleave Surface along a long path'] };
  const short = { id: 'short', title: 'R', aliases: ['Cleave Surface'] };
  assert.deepEqual(rank([long, short], 'cleave'), [['short', 'Cleave Surface'], ['long', 'Cleave Surface along a long path']]);
  assert.deepEqual(aliasesOf(SHOW_ALL), ['Unhide']);
  assert.deepEqual(aliasesOf({ aliases: ['A', '', '  ', 3, 'B'] }), ['A', 'B']);
  assert.deepEqual(aliasesOf({}), []);
});

test('Cell and Surface come right after Edit; other categories after the known ones, alphabetically', () => {
  assert.deepEqual(CATEGORY_ORDER.slice(0, 5), ['File', 'Edit', 'Cell', 'Surface', 'View']);
  assert.deepEqual(CATEGORY_ORDER, ['File', 'Edit', 'Cell', 'Surface', 'View', 'Tools', 'Window', 'Export', 'Look', 'Representation', 'Lighting', 'Colours', 'Effects', 'Sample', 'Trajectory', 'Help']);
  assert.ok(Object.isFrozen(CATEGORY_ORDER));
  assert.deepEqual(['Help', 'Zeta', 'Surface', 'Plugin', 'View', 'Cell', 'Edit', 'File', 'Alpha'].sort(byCategory),
    ['File', 'Edit', 'Cell', 'Surface', 'View', 'Help', 'Alpha', 'Plugin', 'Zeta']);
  assert.equal(categoryRank('Surface'), 3);
  assert.equal(categoryRank('Plugin'), 100);
});

test('ui/shell.js re-exports the same ranking', () => {
  assert.equal(shell.rankCommands, rankCommands);
  assert.equal(shell.CATEGORY_ORDER, CATEGORY_ORDER);
});
