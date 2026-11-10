// F0-D data core: JS halves of the ops in tests/ops/f0d_structure.py (see its docstring), for the shared cases
// tests/data/surface/f0d/props.json, sourcemap.json and edits.json, with the same arguments, results and argument
// errors. They test web/js/core/structure.js and core/naming.js. Ops that edit work on a copy of the input and
// return it as `structure`, with `frames` (the extra frames: [{positions: rows, cell: 3×3 | null}]) and
// `sourceMap` (a list, or null). Python names map to the web ones: append → addAtom, delete → deleteAtoms,
// copy → clone, _adopt → _adopt, _set_source → setSource.
import { op } from '../cases.mjs';
import * as core from '../../../facet/web/js/core/structure.js';
import { Structure } from '../../../facet/web/js/core/structure.js';
import * as naming from '../../../facet/web/js/core/naming.js';

const TABLES = ['PROP_DEFAULTS', 'PROP_SYMBOL_DEFAULT', 'PROP_SHAPED_ZERO', 'RESULT_PROPS', 'RESULT_INFO', 'SYMMETRY_INFO_KEYS',
  'BUILD_INFO_KEYS', 'CARTESIAN_VECTOR_PROPS', 'EDIT_KINDS'];

function take(args, name, allowed, required = []) {
  const unknown = Object.keys(args).filter((k) => !allowed.includes(k)).sort();
  if (unknown.length) throw new Error(`${name}: unknown args ${unknown.join(', ')}`);
  for (const k of required) if (!(k in args)) throw new Error(`${name}: missing arg ${k}`);
  return args;
}

const json = (x) => JSON.parse(JSON.stringify(x));
const map = (m) => (m == null ? null : Array.from(m));
const rows = (p) => Array.from({ length: p.length / 3 }, (_, i) => [p[3 * i], p[3 * i + 1], p[3 * i + 2]]);
const framesOf = (s) => s.frames.map((f) => ({ positions: rows(f.positions), cell: f.cell ? json(f.cell) : null }));
const result = (s) => ({ structure: s, frames: framesOf(s), sourceMap: map(s.sourceMap) });

function doc(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name}: expected a structure document`);
  return Structure.fromJSON(value);
}

// ------------------------------------------------------------------------------------------- pure functions
op('constants', (inp, args) => {
  take(args, 'constants', ['name'], ['name']);
  const { name } = args;
  if (name === 'TIMES') return { value: naming.TIMES };
  if (!TABLES.includes(name)) throw new Error(`constants: unknown table ${name}`);
  return { value: json(core[name]) };
});

op('defaultFor', (inp, args) => {
  take(args, 'defaultFor', ['key', 'symbol', 'column'], ['key', 'symbol']);
  return { value: core.defaultFor(args.key, args.symbol, args.column ?? null) };
});

op('poscarOrder', (inp, args) => {
  take(args, 'poscarOrder', ['symbols', 'order', 'blocks'], ['symbols']);
  return { value: core.poscarOrder(args.symbols, args.order ?? null, args.blocks ?? null) };
});

op('canonicalOrder', (inp, args) => {
  take(args, 'canonicalOrder', ['symbols', 'layers', 'blocks'], ['symbols']);
  return { value: core.canonicalOrder(args.symbols, args.layers ?? null, args.blocks ?? null) };
});

op('invertSourceMap', (inp, args) => {
  take(args, 'invertSourceMap', ['src', 'nOld'], ['src', 'nOld']);
  return { value: map(core.invertSourceMap(args.src, args.nOld)) };
});

op('composeSourceMaps', (inp, args) => {
  take(args, 'composeSourceMaps', ['first', 'second'], ['first', 'second']);
  return { value: map(core.composeSourceMaps(args.first, args.second)) };
});

op('addWarning', (inp, args) => {
  take(args, 'addWarning', ['info', 'msg'], ['info', 'msg']);
  return { value: core.addWarning(args.info, args.msg) };
});

op('getWarnings', (inp, args) => {
  take(args, 'getWarnings', ['info'], ['info']);
  return { value: core.getWarnings(args.info) };
});

op('newWarnings', (inp, args) => {
  take(args, 'newWarnings', ['before', 'after'], ['before', 'after']);
  return { value: core.newWarnings(args.before, args.after) };
});

op('normalizeWarnings', (inp, args) => {
  take(args, 'normalizeWarnings', ['info'], ['info']);
  return { value: core.normalizeWarnings(args.info) };
});

op('formatRepeat', (inp, args) => {
  take(args, 'formatRepeat', ['reps'], ['reps']);
  return { value: naming.formatRepeat(args.reps) };
});

op('addRepeatSuffix', (inp, args) => {
  take(args, 'addRepeatSuffix', ['name', 'reps'], ['name', 'reps']);
  return { value: naming.addRepeatSuffix(args.name, args.reps) };
});

op('concat', (inp, args) => {
  take(args, 'concat', ['parts', 'cell', 'pbc', 'defaults', 'renumberAdsorbates'], ['parts']);
  const parts = args.parts.map((d) => doc(d, 'concat'));
  return result(core.concatStructures(parts, {
    cell: args.cell ?? null, pbc: args.pbc ?? null, defaults: args.defaults ?? null, renumberAdsorbates: args.renumberAdsorbates ?? true,
  }));
});

// ----------------------------------------------------------------------------------------- edits of the input
op('fromJSON', (inp, args) => {
  take(args, 'fromJSON', []);
  if (inp.kind !== 'structure') throw new Error('fromJSON: needs a structure input');
  return result(Structure.fromJSON(inp.raw.structure));
});

op('setProp', (inp, args) => {
  take(args, 'setProp', ['key', 'values'], ['key', 'values']);
  return result(inp.structure.clone().setProp(args.key, args.values));
});

op('removeProp', (inp, args) => {
  take(args, 'removeProp', ['key'], ['key']);
  return result(inp.structure.clone().removeProp(args.key));
});

op('remap', (inp, args) => {
  take(args, 'remap', ['src', 'symbols', 'newSymbols', 'positions', 'newPositions', 'frames', 'addedProps', 'defaults'], ['src']);
  const s = inp.structure.clone();
  s.remap(args.src, {
    symbols: args.symbols ?? null, newSymbols: args.newSymbols ?? null, positions: args.positions ?? null,
    newPositions: args.newPositions ?? null, frames: 'frames' in args ? args.frames : 'keep', addedProps: args.addedProps ?? {},
    defaults: args.defaults ?? null,
  });
  return result(s);
});

op('append', (inp, args) => {
  take(args, 'append', ['symbol', 'position', 'props'], ['symbol', 'position']);
  const s = inp.structure.clone();
  s.addAtom(args.symbol, args.position, args.props ?? {});
  return result(s);
});

op('extend', (inp, args) => {
  take(args, 'extend', ['other', 'renumberAdsorbates'], ['other']);
  const s = inp.structure.clone();
  s.extend(doc(args.other, 'extend'), { renumberAdsorbates: args.renumberAdsorbates ?? true });
  return result(s);
});

op('delete', (inp, args) => {
  take(args, 'delete', ['indices'], ['indices']);
  return result(inp.structure.clone().deleteAtoms(args.indices));
});

op('select', (inp, args) => {
  take(args, 'select', ['elements', 'indices', 'mask']);
  return result(inp.structure.select({ elements: args.elements ?? null, indices: args.indices ?? null, mask: args.mask ?? null }));
});

op('repeat', (inp, args) => {
  take(args, 'repeat', ['reps'], ['reps']);
  return result(inp.structure.repeat(...args.reps));
});

op('sortBySpecies', (inp, args) => {
  take(args, 'sortBySpecies', ['order']);
  return result(inp.structure.clone().sortBySpecies(args.order ?? null));
});

op('setSymbols', (inp, args) => {
  take(args, 'setSymbols', ['indices', 'symbol'], ['indices', 'symbol']);
  return result(inp.structure.clone().setSymbols(args.indices, args.symbol));
});

op('setPbc', (inp, args) => {
  take(args, 'setPbc', ['pbc'], ['pbc']);
  return result(inp.structure.clone().setPbc(args.pbc));
});

op('wrap', (inp, args) => {
  take(args, 'wrap', []);
  return result(inp.structure.clone().wrap());
});

op('getFrame', (inp, args) => {
  take(args, 'getFrame', ['index'], ['index']);
  return result(inp.structure.getFrame(args.index));
});

op('keepFrame', (inp, args) => {
  take(args, 'keepFrame', ['index']);
  return result(inp.structure.clone().keepFrame(args.index ?? 0));   // frame 0 unless given, as in Python
});

op('setPositions', (inp, args) => {
  take(args, 'setPositions', ['positions', 'indices', 'frame', 'mark'], ['positions']);
  const s = inp.structure.clone();
  const positions = args.indices == null ? args.positions : { indices: args.indices, positions: args.positions };
  s.setPositions(positions, { frame: 'frame' in args ? args.frame : 0, mark: 'mark' in args ? args.mark : 'positions' });
  return result(s);
});

op('writeFrame', (inp, args) => {
  take(args, 'writeFrame', ['frame', 'positions', 'cell'], ['frame']);
  const s = inp.structure.clone();
  const opts = { positions: args.positions ?? undefined };
  if ('cell' in args) opts.cell = args.cell;
  return result(s.writeFrame(args.frame, opts));
});

op('markEdited', (inp, args) => {
  take(args, 'markEdited', ['kind', 'rotation'], ['kind']);
  return result(core.markEdited(inp.structure.clone(), args.kind, { rotation: args.rotation ?? null }));
});

// ------------------------------------------------------------------------------------------ tracking sessions
const STEP_ARGS = {
  delete: ['indices'], append: ['symbol', 'position'], sortBySpecies: ['order'],
  remap: ['src', 'newSymbols', 'newPositions'], extend: ['other'], keepFrame: ['index'],
  adopt: ['from', 'src'], setSource: ['parent', 'src'],
  copy: [], repeat: ['reps'], select: ['elements', 'indices', 'mask'], getFrame: ['index'],
  concat: ['parts'], new: ['structure'],
};
const DERIVED = ['copy', 'repeat', 'select', 'getFrame', 'concat', 'new'];

function step(named, st) {
  if (!st || typeof st !== 'object' || !Object.prototype.hasOwnProperty.call(STEP_ARGS, st.do)) {
    throw new Error(`trackEdit: unknown step ${JSON.stringify(st)}`);
  }
  const how = st.do;
  take(st, `trackEdit step ${how}`, ['do', 'on', 'as', ...STEP_ARGS[how]]);
  if (DERIVED.includes(how) && !('as' in st)) throw new Error(`trackEdit step ${how}: give the result a name with as`);
  const get = (name) => {
    if (!named.has(name)) throw new Error(`trackEdit: no structure named ${name}`);
    return named.get(name);
  };
  const s = how === 'new' ? null : get(st.on ?? 'work');
  switch (how) {
    case 'delete': s.deleteAtoms(st.indices); break;
    case 'append': s.addAtom(st.symbol, st.position); break;
    case 'sortBySpecies': s.sortBySpecies(st.order ?? null); break;
    case 'remap': s.remap(st.src, { newSymbols: st.newSymbols ?? null, newPositions: st.newPositions ?? null }); break;
    case 'extend': s.extend(get(st.other)); break;
    case 'keepFrame': s.keepFrame(st.index ?? 0); break;
    case 'adopt': s._adopt(get(st.from), { src: st.src ?? null }); break;
    case 'setSource': s.setSource(get(st.parent), st.src); break;
    case 'copy': named.set(st.as, s.clone()); break;
    case 'repeat': named.set(st.as, s.repeat(...st.reps)); break;
    case 'select': named.set(st.as, s.select({ elements: st.elements ?? null, indices: st.indices ?? null, mask: st.mask ?? null })); break;
    case 'getFrame': named.set(st.as, s.getFrame(st.index)); break;
    case 'concat': named.set(st.as, core.concatStructures(st.parts.map(get))); break;
    default: named.set(st.as, doc(st.structure, 'trackEdit step new'));   // new
  }
}

op('trackEdit', (inp, args) => {
  take(args, 'trackEdit', ['steps', 'result'], ['steps']);
  const work = inp.structure.clone();
  const named = new Map([['work', work]]);
  const t = work.trackChanges();
  for (const st of args.steps) step(named, st);
  const name = args.result ?? 'work';
  if (!named.has(name)) throw new Error(`trackEdit: no structure named ${name}`);
  const res = named.get(name);
  const src = t.stop(res);
  return { sourceMap: map(src), maps: Object.fromEntries([...named].map(([k, v]) => [k, map(v.sourceMap)])), structure: res };
});
