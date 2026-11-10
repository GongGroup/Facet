// F0-A T8 (parameter schema): JS halves of the ops in tests/ops/f0a_params.py (see its docstring), for the shared cases
// in tests/data/surface/coerce.json, with the same argument errors. coerceText reads the text the way the input
// controls (ui/inputs.js) do: parseIndices, and text it cannot read goes to coerceParam, which gives the type's message.
import { op } from '../cases.mjs';
import { parseIndices, coerceParam, validateParams, defaultParams } from '../../../facet/web/js/core/params.js';

function take(args, name, allowed, required = []) {
  const unknown = Object.keys(args).filter((k) => !allowed.includes(k)).sort();
  if (unknown.length) throw new Error(`${name}: unknown args ${unknown.join(', ')}`);
  for (const k of required) if (!(k in args)) throw new Error(`${name}: missing arg ${k}`);
  return args;
}

op('parseIndices', (inp, args) => {
  take(args, 'parseIndices', ['text', 'fractions'], ['text']);
  return { value: parseIndices(args.text, { fractions: args.fractions ?? false }) };
});

op('coerceParam', (inp, args) => {
  take(args, 'coerceParam', ['spec', 'value'], ['spec']);
  return { value: coerceParam(args.spec, args.value) };
});

op('coerceText', (inp, args) => {
  take(args, 'coerceText', ['spec', 'text'], ['spec', 'text']);
  const { spec, text } = args;
  if (!['vector', 'miller', 'imatrix'].includes(spec.type)) throw new Error('coerceText: the spec must be a vector, miller or imatrix parameter');
  let value;
  try { value = parseIndices(text, { fractions: spec.type === 'vector' && !spec.integer }); } catch { value = text; }
  return { value: coerceParam(spec, value) };
});

op('validateParams', (inp, args) => {
  take(args, 'validateParams', ['schema', 'values', 'strict', 'title'], ['schema']);
  return validateParams(args.schema, args.values, { strict: args.strict ?? false, title: args.title ?? null });
});

op('defaultParams', (inp, args) => {
  take(args, 'defaultParams', ['schema'], ['schema']);
  return { value: defaultParams(args.schema) };
});
