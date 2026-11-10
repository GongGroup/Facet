// M1 (cell and lattice tools): JS halves of the ops and recipes in tests/ops/m1.py (see its docstring), with the same
// argument errors. The recipes fcc111, fcc100, fcc110, hcp0001, bcc110 and graphene are built by ../m1_recipes.mjs
// (documented in tests/m1_recipes.py) bit for bit like the Python ones; the ops xorshift32, buildRecipe and
// structureDigest serve the recipe check tests/data/surface/m1_recipes_check.json. The ops of the M1 golden cases
// (tests/data/surface/m1_cases.json) follow, added by M1-T5b.
import { op, recipe, RECIPES } from '../cases.mjs';
import { RECIPE_NAMES, XorShift32, noiseValues, slab, structureDigest } from '../m1_recipes.mjs';

/** The most numbers one xorshift32 case asks for (same as MAX_COUNT in Python). */
const MAX_COUNT = 100000;

function take(args, name, allowed, required = []) {
  const unknown = Object.keys(args).filter((k) => !allowed.includes(k)).sort();
  if (unknown.length) throw new Error(`${name}: unknown args ${unknown.join(', ')}`);
  for (const k of required) if (!(k in args)) throw new Error(`${name}: missing arg ${k}`);
  return args;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

for (const name of RECIPE_NAMES) recipe(name, (args) => slab(name, args));

op('xorshift32', (inp, args) => {
  take(args, 'xorshift32', ['seed', 'state', 'count', 'sigma'], ['count']);
  if (('seed' in args) === ('state' in args)) throw new Error('xorshift32: give seed or state');
  const { count } = args;
  if (!(Number.isInteger(count) && count >= 0 && count <= MAX_COUNT)) {
    throw new Error(`xorshift32: count must be an integer from 0 to ${MAX_COUNT}`);
  }
  const rng = 'seed' in args ? new XorShift32(args.seed) : new XorShift32(null, { state: args.state });
  const value = rng.take(count);
  const out = { value, uniform: value.map((v) => v / 4294967296) };
  if ('sigma' in args) {
    const { sigma } = args;
    if (!(typeof sigma === 'number' && Number.isFinite(sigma) && sigma >= 0 && sigma <= 1)) {
      throw new Error('xorshift32: sigma must be a number from 0 to 1 (Å)');
    }
    out.noise = Array.from(noiseValues(sigma, value));
  }
  return out;
});

op('buildRecipe', async (inp, args) => {
  take(args, 'buildRecipe', ['name', 'args'], ['name']);
  const { name } = args;
  if (typeof name !== 'string') throw new Error('buildRecipe: name must be a recipe name');
  const fn = RECIPES.get(name);
  if (!fn) throw new Error(`buildRecipe: no recipe ${JSON.stringify(name)}`);
  const given = 'args' in args ? args.args : {};
  if (!isObject(given)) throw new Error('buildRecipe: args must be an object');
  return { structure: await fn({ ...given }) };
});

op('structureDigest', (inp, args) => {
  take(args, 'structureDigest', []);
  const s = inp.structure;
  return { structure: s, atoms: s.length, digest: structureDigest(s) };
});
