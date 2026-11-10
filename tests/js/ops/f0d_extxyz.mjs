// F0-D T5 (extended XYZ): JS halves of the ops in tests/ops/f0d_extxyz.py (see its docstring), with the same
// argument errors. The case file tests/data/surface/f0d/extxyz.json also uses read, write and roundtrip (f0d.mjs).
import { op } from '../cases.mjs';
import { parseStructure } from '../../../facet/web/js/io/index.js';
import { convertValue, extxyzColumns, formatInfoValue, kvTokenize, writeXYZ } from '../../../facet/web/js/io/xyz.js';

function take(args, name, allowed, required = []) {
  const unknown = Object.keys(args).filter((k) => !allowed.includes(k)).sort();
  if (unknown.length) throw new Error(`${name}: unknown args ${unknown.join(', ')}`);
  for (const k of required) if (!(k in args)) throw new Error(`${name}: missing arg ${k}`);
  return args;
}

op('kvTokenize', (inp, args) => {
  take(args, 'kvTokenize', ['line'], ['line']);
  return { value: kvTokenize(args.line) };
});

op('convertValue', (inp, args) => {
  take(args, 'convertValue', ['raw'], ['raw']);
  return { value: convertValue(args.raw) };
});

op('formatInfoValue', (inp, args) => {
  take(args, 'formatInfoValue', ['key', 'value'], ['key', 'value']);
  return { value: formatInfoValue(args.key, args.value) };
});

op('extxyzColumns', (inp, args) => {
  take(args, 'extxyzColumns', []);
  return { value: extxyzColumns(inp.structure) };
});

op('writeExtxyz', (inp, args) => {
  take(args, 'writeExtxyz', ['constraints']);
  const text = writeXYZ(inp.structure, { constraints: args.constraints ?? 'exact' });
  return { text, structure: parseStructure(text, '', 'extxyz') };
});

/** {properties, keys} of each frame of an extended XYZ text written by the writer (no blank lines). */
function headers(text) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length && lines[i].trim();) {
    const n = Number(lines[i]);
    const pairs = kvTokenize(lines[i + 1]);
    out.push({ properties: pairs.find(([key]) => key === 'Properties')[1], keys: pairs.map(([key]) => key) });
    i += 2 + n;
  }
  return out;
}

op('extxyzFrames', (inp, args) => {
  take(args, 'extxyzFrames', ['constraints']);
  return { value: headers(writeXYZ(inp.structure, { constraints: args.constraints ?? 'exact' })) };
});
