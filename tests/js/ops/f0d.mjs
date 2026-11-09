// F0-D (data and file I/O): JS halves of the ops and recipes in tests/ops/f0d.py (see its docstring), with the
// same argument errors.
import { op, recipe } from '../cases.mjs';
import { exportStructure, parseStructure } from '../../../crystallume/web/js/io/index.js';
import { buildCrystal, prototypes } from '../../../crystallume/web/js/build/crystal.js';

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
