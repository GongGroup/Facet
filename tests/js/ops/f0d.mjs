// F0-D (data and file I/O): JS halves of the ops and recipes in tests/ops/f0d.py (see its docstring), with the
// same argument errors.
import { op, recipe } from '../cases.mjs';
import { exportStructure, parseStructure } from '../../../facet/web/js/io/index.js';
import { buildCrystal, prototypes } from '../../../facet/web/js/build/crystal.js';
import * as vacuum from '../../../facet/web/js/core/vacuum.js';
import { wrapFractional } from '../../../facet/web/js/core/lattice.js';
import * as constraints from '../../../facet/web/js/core/constraints.js';

function take(args, name, allowed, required = []) {
  const unknown = Object.keys(args).filter((k) => !allowed.includes(k)).sort();
  if (unknown.length) throw new Error(`${name}: unknown args ${unknown.join(', ')}`);
  for (const k of required) if (!(k in args)) throw new Error(`${name}: missing arg ${k}`);
  return args;
}

const writeText = async (s, format) => exportStructure(s, format).text;   // awaited: server formats give a Promise

op('load', (inp, args) => {
  take(args, 'load', []);
  return { structure: inp.structure };
});

op('read', async (inp, args) => {
  take(args, 'read', ['format']);
  if (inp.kind !== 'text' && inp.kind !== 'file') throw new Error('read: needs a text or file input');
  return { structure: await parseStructure(inp.text, inp.filename ?? '', args.format ?? null) };
});

op('write', async (inp, args) => {
  take(args, 'write', ['format'], ['format']);
  return { text: await writeText(inp.structure, args.format) };
});

op('roundtrip', async (inp, args) => {
  take(args, 'roundtrip', ['format'], ['format']);
  const text = await writeText(inp.structure, args.format);
  return { structure: await parseStructure(text, '', args.format), text };
});

recipe('crystal', (args) => {
  const name = 'recipe crystal';
  take(args, name, ['prototype', 'elements', 'a', 'c', 'u', 'repeat'], ['prototype', 'elements', 'a']);
  const proto = args.prototype;
  const p = typeof proto === 'string' ? prototypes.get(proto) : null;
  if (!p) throw new Error(`${name}: unknown prototype ${proto}`);
  for (const k of ['c', 'u']) {
    if (k in p.defaults && !(k in args)) throw new Error(`${name}: give ${k} for ${proto} (the default tables of the two languages differ)`);
  }
  const { elements } = args;
  if (!Array.isArray(elements) || !elements.length || !elements.every((e) => typeof e === 'string')) {
    throw new Error(`${name}: elements must be a list of element symbols`);
  }
  const rep = args.repeat ?? [1, 1, 1];
  if (!Array.isArray(rep) || rep.length !== 3 || !rep.every((n) => Number.isInteger(n) && n >= 1)) {
    throw new Error(`${name}: repeat must be three positive integers`);
  }
  const prm = { elements, a: args.a };
  for (const k of ['c', 'u', 'repeat']) if (k in args) prm[k] = args[k];
  return buildCrystal(proto, prm);
});

// ------------------------------------------------------------------------------ vacuum gaps (F0-D T7)
const typed = (x) => JSON.parse(JSON.stringify(x, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v)));

function vacuumOp(name, fn, allowed, required = []) {
  op(name, (inp, args) => {
    take(args, name, allowed, required);
    const { axis, ...opts } = args;
    if (required.includes('axis')) return { value: typed(fn(inp.structure, axis, opts)) };
    if (allowed.includes('axis')) return { value: typed(fn(inp.structure, axis ?? null, opts)) };
    return { value: typed(fn(inp.structure, args)) };
  });
}

vacuumOp('axisGaps', vacuum.axisGaps, ['axis', 'frame', 'exclude'], ['axis']);
vacuumOp('findVacuumGaps', vacuum.findVacuumGaps, ['frame', 'periodicOnly']);
vacuumOp('findVacuumGap', vacuum.findVacuumGap, ['axis', 'minWidth', 'frame', 'periodicOnly']);
vacuumOp('gapCut', vacuum.gapCut, ['axis', 'frame', 'hint', 'exclude'], ['axis']);
vacuumOp('displayCuts', vacuum.displayCuts, ['frame']);
vacuumOp('surfaceNormal', vacuum.surfaceNormal, ['frame', 'requireGap', 'exclude']);
vacuumOp('findSurfaceGap', vacuum.findSurfaceGap, ['frame', 'exclude']);
vacuumOp('requireGap', vacuum.requireGap, ['frame', 'exclude']);
vacuumOp('vacuumAxis', vacuum.vacuumAxis, ['frame', 'exclude']);
vacuumOp('vacuumGapHint', vacuum.vacuumGapHint, ['frame', 'exclude']);
vacuumOp('contiguousShifts', vacuum.contiguousShifts, ['axis', 'cut', 'frame'], ['axis']);

op('makeContiguous', (inp, args) => {
  take(args, 'makeContiguous', ['axis', 'cut', 'frame'], ['axis']);
  const { axis, ...opts } = args;
  const s = inp.structure.clone();
  return { value: vacuum.makeContiguous(s, axis, opts), structure: s };
});

op('unwrapAlongGap', (inp, args) => {
  take(args, 'unwrapAlongGap', ['frac', 'cut'], ['frac', 'cut']);
  return { value: typed(vacuum.unwrapAlongGap(args.frac, args.cut)) };
});

op('unwrapAtoms', (inp, args) => {
  take(args, 'unwrapAtoms', ['axis', 'cut'], ['axis', 'cut']);
  const s = inp.structure, k = args.axis;
  let cut = args.cut;
  if (cut === 'display') cut = vacuum.displayCuts(s)[k];
  else if (cut === 'surface') cut = vacuum.findSurfaceGap(s);
  const f = s.fracPositions();
  return { value: typed(vacuum.unwrapAlongGap(Array.from({ length: s.length }, (_, i) => f[3 * i + k]), cut)) };
});

op('wrapFractional', (inp, args) => {
  take(args, 'wrapFractional', ['frac', 'pbc', 'eps'], ['frac']);
  return { value: typed(wrapFractional(args.frac, args.pbc, args.eps)) };
});

op('vacuumReport', (inp, args) => {
  take(args, 'vacuumReport', ['frame', 'exclude']);
  const s = inp.structure, { frame, exclude } = args;
  const a = s.info?.surface?.axis, hint = a === 0 || a === 1 || a === 2 ? a : null;
  const axis = vacuum.vacuumAxis(s, { frame, exclude });
  return typed({
    gaps: vacuum.findVacuumGaps(s, { frame }),
    allGaps: vacuum.findVacuumGaps(s, { frame, periodicOnly: false }),
    gap: vacuum.findVacuumGap(s, null, { frame }),
    widest: vacuum.findVacuumGap(s, null, { minWidth: 0, frame }),
    cuts: [0, 1, 2].map((k) => vacuum.gapCut(s, k, { frame, hint: k === hint, exclude })),
    displayCuts: vacuum.displayCuts(s, { frame }),
    normal: vacuum.surfaceNormal(s, { frame, exclude }),
    surfaceGap: vacuum.findSurfaceGap(s, { frame, exclude }),
    vacuumAxis: axis,
    hint: vacuum.vacuumGapHint(s, { frame, exclude }),
    shifts: axis === null || !s.pbc[axis] ? null : vacuum.contiguousShifts(s, axis, { frame }),
  });
});

// ------------------------------------------------------------------------- constraint flags (F0-D T3)
/** P · old (null: the identity), summed in the same order as the Python op. */
function times(p, old) {
  const a = old ?? [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  return [0, 1, 2].map((i) => [0, 1, 2].map((k) => p[i][0] * a[0][k] + p[i][1] * a[1][k] + p[i][2] * a[2][k]));
}

function newVectors(args, name, old) {
  if (('newVectors' in args) === ('matrix' in args)) throw new Error(`${name}: give exactly one of newVectors or matrix`);
  return 'newVectors' in args ? args.newVectors : times(args.matrix, old);
}

op('transformMoveFlags', (inp, args) => {
  const name = 'transformMoveFlags';
  take(args, name, ['flags', 'oldVectors', 'newVectors', 'matrix', 'tol'], ['flags', 'oldVectors']);
  return { value: constraints.transformMoveFlags(args.flags, args.oldVectors, newVectors(args, name, args.oldVectors), args.tol) };
});

op('latticeToCartesianMask', (inp, args) => {
  take(args, 'latticeToCartesianMask', ['flags', 'cell', 'tol'], ['flags', 'cell']);
  return { value: constraints.latticeToCartesianMask(args.flags, args.cell, args.tol) };
});

op('cartesianToLatticeFlags', (inp, args) => {
  take(args, 'cartesianToLatticeFlags', ['mask', 'cell', 'tol'], ['mask', 'cell']);
  return { value: constraints.cartesianToLatticeFlags(args.mask, args.cell, args.tol) };
});

op('axisLabels', (inp, args) => {
  take(args, 'axisLabels', ['cell'], ['cell']);
  return { value: constraints.axisLabels(args.cell) };
});

op('cartesianName', (inp, args) => {
  take(args, 'cartesianName', ['cell', 'flags'], ['cell', 'flags']);
  return { value: constraints.cartesianName(args.cell, args.flags) };
});

op('axisNames', (inp, args) => {
  take(args, 'axisNames', ['cell', 'patterns'], ['cell', 'patterns']);
  return { value: { labels: constraints.axisLabels(args.cell), names: args.patterns.map((f) => constraints.cartesianName(args.cell, f)) } };
});

op('moveFlags', (inp, args) => {
  take(args, 'moveFlags', []);
  return { value: constraints.moveFlags(inp.structure) };
});

op('constraintSummary', (inp, args) => {
  take(args, 'constraintSummary', []);
  return { value: constraints.constraintSummary(inp.structure) };
});

op('nextAdsorbateId', (inp, args) => {
  take(args, 'nextAdsorbateId', []);
  return { value: constraints.nextAdsorbateId(inp.structure) };
});

op('setMoveFlags', (inp, args) => {
  take(args, 'setMoveFlags', ['flags'], ['flags']);
  return { structure: constraints.setMoveFlags(inp.structure.clone(), args.flags) };
});

op('clearConstraints', (inp, args) => {
  take(args, 'clearConstraints', []);
  return { structure: constraints.clearConstraints(inp.structure.clone()) };
});

op('applyBasisChange', (inp, args) => {
  const name = 'applyBasisChange';
  take(args, name, ['oldVectors', 'newVectors', 'matrix']);
  const src = inp.structure;
  const old = 'oldVectors' in args ? args.oldVectors : (src.cell ?? null);   // the input's cell at full precision
  const nv = newVectors(args, name, old);
  const s = src.clone();
  return { value: constraints.applyBasisChange(s, old, nv), structure: s };
});
