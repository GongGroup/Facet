// M2 (cleave and slab): JS half of the shared recipe `bulk` in tests/ops/m2_recipes.py (see its docstring and
// tests/data/surface/cleave/README.md), with the same argument errors. A bulk crystal of a built-in prototype of
// web/js/build/crystal.js with the lattice constants given explicitly:
//
//   "input": {"recipe": {"name": "bulk", "args": {"prototype": "fcc", "elements": ["Pt"], "a": 3.92}}}
//
// Other modules reuse `bulk` and do not register their own (registering a name twice throws).
import { recipe } from '../cases.mjs';
import { buildCrystal, prototypes } from '../../../facet/web/js/build/crystal.js';
import * as REF from '../../../facet/web/js/build/reference.js';

const NAME = 'recipe bulk';
const ALLOWED = ['prototype', 'elements', 'a', 'c', 'u', 'thickness', 'repeat', 'name'];
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

recipe('bulk', (args) => {
  const unknown = Object.keys(args).filter((k) => !ALLOWED.includes(k)).sort();
  if (unknown.length) throw new Error(`${NAME}: unknown args ${unknown.join(', ')}`);
  for (const key of ['prototype', 'elements', 'a']) if (!(key in args)) throw new Error(`${NAME}: missing arg ${key}`);
  const proto = args.prototype;
  // The built-in prototypes only (the table both builders share), never one registered at run time.
  const table = typeof proto === 'string' && Object.prototype.hasOwnProperty.call(REF.PROTOTYPES, proto) ? REF.PROTOTYPES[proto] : null;
  const p = table ? prototypes.get(proto) : null;
  if (!p) throw new Error(`${NAME}: unknown prototype ${proto}`);
  const { elements } = args;
  const roles = p.roles.length;
  if (!Array.isArray(elements) || !elements.every((e) => typeof e === 'string' && e)) {
    throw new Error(`${NAME}: elements must be a list of element symbols`);
  }
  if (elements.length !== roles) throw new Error(`${NAME}: ${proto} needs ${roles} element${roles > 1 ? 's' : ''}, got ${elements.length}`);
  const hasC = table.defaultC != null;
  if (hasC && !('c' in args)) throw new Error(`${NAME}: give c for ${proto} (lattice constants are always explicit)`);
  if (!hasC && 'c' in args) throw new Error(`${NAME}: ${proto} has no c axis`);
  for (const key of ['a', 'c']) {
    if (key in args && !(isNumber(args[key]) && args[key] > 0.5)) throw new Error(`${NAME}: ${key} must be a number larger than 0.5 (Å)`);
  }
  const prm = { elements: [...elements], a: args.a };
  if (hasC) prm.c = args.c;
  for (const key of ['u', 'thickness']) {
    if (!(key in args)) continue;
    if (!Object.prototype.hasOwnProperty.call(table.params, key)) throw new Error(`${NAME}: ${proto} has no parameter ${key}`);
    if (!(isNumber(args[key]) && args[key] > 0)) throw new Error(`${NAME}: ${key} must be a positive number`);
    prm[key] = args[key];
  }
  if ('repeat' in args) {
    const rep = args.repeat;
    if (!Array.isArray(rep) || rep.length !== 3 || !rep.every((n) => Number.isInteger(n) && n >= 1)) {
      throw new Error(`${NAME}: repeat must be three positive integers`);
    }
    prm.repeat = [...rep];
  }
  if ('name' in args && !(typeof args.name === 'string' && args.name)) throw new Error(`${NAME}: name must be a non-empty string`);
  const s = buildCrystal(proto, prm);
  if ('name' in args) s.name = args.name;
  return s;
});
