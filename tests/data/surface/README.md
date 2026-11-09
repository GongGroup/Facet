# Shared test cases and fixtures

Golden data that both implementations are tested against: the Python package (`crystallume/`) and the web
modules (`crystallume/web/js/`). A case that passes in both languages is a parity check: the two sides compared
their results with the same expectation.

```
tests/data/surface/
  README.md               this file
  contcar_pt111.vasp      the shared CONTCAR fixture (the only one; see below)
  gaps.json               F0-A's 89 gap-cut structures, run against the vacuum-gap module (F0-D T7)
  f0d/                    F0-D cases: shell, vacuum, constraints, props, sourcemap, edits (.json) now; poscar, extxyz, export
  <module>/ ...           cases of the other modules (cleave/, layers/, ...)
```

Case files may live anywhere under `tests/data` (for example `tests/data/geometry/mic.json`): the loaders read every
`*.json` file below `tests/data` recursively, in path order, and use the ones whose `schema` is
`crystallume.cases/1`. Other JSON files are left alone; names starting with `.` are skipped.

## Running

```
pytest tests/test_cases.py                 # every case against Python (no Node needed)
pytest tests/test_js_unit.py               # every tests/js/*.test.mjs, cases.test.mjs included, under Node
node --test tests/js/cases.test.mjs        # the JS side directly (pass files, not the directory)
```

Node.js 22 or newer is needed for the JS side. Without it the JS tests are skipped; set
`CRYSTALLUME_REQUIRE_NODE=1` to make that a failure (CI). `CRYSTALLUME_NODE` picks the `node` binary, or turns
the JS tests off with `0`/`off`.

## The case format `crystallume.cases/1`

```json
{
  "schema": "crystallume.cases/1",
  "description": "optional; other top-level keys are ignored",
  "cases": [
    {
      "id": "poscar-read-dot-true",
      "op": "read",
      "args": {"format": "poscar"},
      "input": {"text": "..."},
      "expect": {
        "structure": {"symbols": ["Pt"], "pbc": [true, true, true], "props": {"selective_dynamics": [[true, true, false]]}},
        "warnings": {"equals": []}
      },
      "tol": {"positions": 1e-6, "cell": 1e-6},
      "skip": {"js": "reason"},
      "note": "free text for the reader"
    }
  ]
}
```

| Key | Meaning |
|---|---|
| `id` | Unique across all case files, no spaces. It names the test on both sides. |
| `op` | The operation to run, registered by a module on both sides (see below). |
| `args` | Arguments of the op, camelCase keys as in the JS API. Each Python op maps them to snake_case explicitly (`tests.cases.snake_args` does the mechanical conversion). |
| `input` | Exactly one of `{"structure": <crystallume.structure/1>}`, `{"text": "..."}`, `{"file": "path relative to tests/data"}`, `{"recipe": {"name": "...", "args": {...}}}`. Optional. |
| `expect` | What the op must produce; see the comparators. Required, not empty. |
| `tol` | Tolerances: `positions` and `cell` (Å, default 1e-6), `value` (default 1e-9, used for every other number), `props` and `info` (default: `value`), or the name of an op-specific `expect` key. |
| `skip` | `{"py": "reason"}` and/or `{"js": "reason"}`: do not run on that side. A reason is required. |
| `xfail` | Same shape: a known defect. The case must fail on that side; once it passes, the test fails until the marker is removed (strict). |
| `note` | Free text. |

The loaders reject unknown keys, malformed values, duplicate ids, other `crystallume.cases/<n>` versions and invalid
JSON (NaN and Infinity included) in a case file, with the same message in both languages.

**Inputs.** The op gets the resolved input (`CaseInput`): `inp.kind`, `inp.raw` (the input as written), `inp.text`
(a text input, or the file's content), `inp.path` and `inp.filename` (a file input), and `inp.structure`, built on
first use: `Structure.from_dict` / `Structure.fromJSON` of a structure input, the recipe's result, or the text or
file read with the format detected from the file name or the content. Ops that need an explicit format read
`inp.text` themselves (like the `read` op). A recipe input is built before the op runs; an unknown recipe fails
the case.

**Comparators.** `expect` maps result names to expectations. The op returns a dict (JS: object) of results with the
same names, or a bare structure, which means `{"structure": ...}`.

| `expect` key | Comparison |
|---|---|
| `structure` | Only the keys given: `symbols`, `pbc`, `name`, `nFrames` exactly; `positions`, `cell` within `tol`; `props` and `info` only the listed keys, where `null` means "this key must be absent". |
| `sourceMap` | A list of old-atom indices compared exactly; `null` entries mean -1 (a new atom); `null` alone means no map. |
| `warnings` | `{"equals": [...]}` (the whole list, in order), `{"contains": [...]}` (each string is part of some warning), `{"count": n}`, combinable. Taken from the op's `warnings` result, or else from the structure's `info.warnings`. |
| `text` | `{"contains": [...], "excludes": [...]}`: substrings that must, or must not, occur in the `text` result. |
| `error` | The op must throw an error whose message contains this string. Cannot be combined with other keys. |
| `value` and any other key | A JSON value compared exactly, except numbers: `1 == 1.0`, equal within `tol.value` (or `tol.<key>`). Booleans are not numbers; objects must have the same keys; lists the same length. |

New error messages and warnings are worded identically in both languages (lower case, no final full stop), so
`error` and `warnings.equals` can match them exactly. The existing file readers still word theirs differently until
F0-D S-7: match those with `contains` and `count`.

**Expected values**, in order of preference: analytic results (d-spacings, surface-cell lengths and angles, atoms
per layer, areas), hand calculations, then values cross-checked with ASE or pymatgen during development and frozen
here (say which version in `note`). Tests never import ASE or pymatgen.

## Adding ops and recipes

Each module registers its ops in its own pair of files, imported automatically in file-name order:
`tests/ops/<module>.py` and `tests/js/ops/<module>.mjs` (for example `f0d`, `m1`). `tests/cases.py` and
`tests/js/cases.mjs` stay as they are.

```python
# tests/ops/m3.py
from ..cases import CaseInput, op, recipe

@op("findLayers")
def find_layers_op(inp: CaseInput, args: dict) -> dict:
    return {"value": find_layers(inp.structure, tolerance=args.get("tolerance")).to_dict()}
```

```js
// tests/js/ops/m3.mjs
import { op, recipe } from '../cases.mjs';
op('findLayers', (inp, args) => ({ value: findLayers(inp.structure, { tolerance: args.tolerance }) }));
```

A name can be registered once per language; an op that exists on one side only fails its cases on the other side,
unless they carry a `skip` with a reason. A recipe (`@recipe("name")` / `recipe(name, fn)`) builds an input structure
from `args`, so that large structures need no coordinates in the files. Recipes of the same name must build the same
structure in both languages, which one case per recipe checks by comparing the full atom list.

F0-D registers the ops `load`, `read`, `write`, `roundtrip`, the vacuum-gap ops (`findVacuumGap`, `gapCut`,
`surfaceNormal`, `vacuumReport` and the others listed in `tests/ops/f0d.py`), the constraint ops (`transformMoveFlags`,
`applyBasisChange`, `axisNames` and the others listed there) and the recipe `crystal` (a bulk crystal
from the builders, `{"prototype", "elements", "a", "c", "u", "repeat"}`, with every lattice parameter of the prototype
given explicitly). The data-core ops of `f0d/props.json`, `sourcemap.json` and `edits.json` (`constants`, `defaultFor`,
`remap`, `trackEdit`, `markEdited`, `concat` and the others, with their result keys `frames` and `sourceMap`) are
listed in `tests/ops/f0d_structure.py`.

## The CONTCAR fixture `contcar_pt111.vasp`

The one CONTCAR used by every module (and by the end-to-end tests): Pt(111) p(3×3), 4 layers, 36 atoms, as VASP
writes it after a relaxation.

- VASP 5 layout: comment `Pt(111) p(3x3) 4L relaxed`, scale `1.00000000000000`, species `Pt`, count `36`,
  `Selective dynamics`, `Direct`; coordinates with 16 decimals, no `-0.0000…` tokens.
- Cell: a = (8.3155757467537992, 0, 0), b = (−4.1577878733768996, 7.2014998437825444, 0),
  c = (0, 0, 21.7896391656699997) Å: fcc Pt with a = 3.92 Å, surface cell 3 × 2.7719 Å at 120°, layer spacing
  a/√3 = 2.2632 Å, 15 Å between the top layer and the periodic image of the bottom one.
- Atoms layer by layer from the bottom (stacking A B C A); rows 1–18 (bottom two layers) `F F F`, rows 19–36 `T T T`.
- The bottom layer is at fractional z = 0, except rows 4 and 8, which VASP wrapped to `0.9999900000000000`: the slab
  crosses the cell boundary, so a reader that wraps or a viewer that draws atoms where they are stored splits it.
- A blank line and 36 lines of zero velocities at the end.

The file follows the fixture rule of the surface-modeling acceptance scenario S14 (the unedited round trip of a
CONTCAR); `f0d/shell.json` checks its geometry and flags in both languages. Do not edit it: other modules' cases
depend on its exact numbers.
