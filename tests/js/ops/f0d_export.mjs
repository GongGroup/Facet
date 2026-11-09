// F0-D export check: JS halves of the ops in tests/ops/f0d_export.py (see its docstring), for the shared cases
// tests/data/surface/f0d/export.json, with the same arguments, results and argument errors. They test
// web/js/io/capabilities.js, exportReport in web/js/io/index.js and web/js/core/contacts.js.
import { op } from '../cases.mjs';
import { closeContacts } from '../../../crystallume/web/js/core/contacts.js';
import { exportReport } from '../../../crystallume/web/js/io/index.js';
import {
  CAPABILITY_VALUES, OCCUPANCY_TOLERANCE, OVERLAP_CHECK_MAX_ATOMS, WRITER_CAPABILITIES, validateCapabilities,
} from '../../../crystallume/web/js/io/capabilities.js';

function take(args, name, allowed, required = []) {
  const unknown = Object.keys(args).filter((k) => !allowed.includes(k)).sort();
  if (unknown.length) throw new Error(`${name}: unknown args ${unknown.join(', ')}`);
  for (const k of required) if (!(k in args)) throw new Error(`${name}: missing arg ${k}`);
  return args;
}

op('writerCapabilities', (inp, args) => {
  take(args, 'writerCapabilities', []);
  const table = Object.fromEntries(Object.entries(WRITER_CAPABILITIES).map(([k, v]) => [k, { ...v }]));
  return { value: { table, keys: Object.keys(CAPABILITY_VALUES), overlapCheckMaxAtoms: OVERLAP_CHECK_MAX_ATOMS, occupancyTolerance: OCCUPANCY_TOLERANCE } };
});

op('validateCapabilities', (inp, args) => {
  take(args, 'validateCapabilities', ['name', 'caps'], ['name', 'caps']);
  return { value: { ...validateCapabilities(args.name, args.caps) } };
});

op('exportReport', (inp, args) => {
  take(args, 'exportReport', ['format', 'frame'], ['format']);
  const { warnings, notes } = exportReport(inp.structure, args.format, { frame: args.frame });
  return { warnings, notes };
});

op('closeContacts', (inp, args) => {
  take(args, 'closeContacts', ['cutoff', 'pbc', 'limit']);
  return { value: closeContacts(inp.structure, { cutoff: args.cutoff, pbc: args.pbc, limit: args.limit }) };
});
