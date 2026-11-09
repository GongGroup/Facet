# M3 golden cases: layers, adsorbates, bonds, exposed atoms

Shared cases (`crystallume.cases/1`, see `../README.md`) for the layer analysis of the surface-modeling design
(module M3): Python and JS run the same expectations, so a case that passes on both sides is a parity check.

| File | Op | Content |
|---|---|---|
| `pt111.json` | findLayers, findAdsorbates | Pt(111) p(3×3) 4L in four placements, the CONTCAR fixture (acceptance S14-3), CO cases, vacuum along a, bulk, errors, the 216-atom p(6×6) 6L slab |
| `metals.json` | findLayers | spacings of the fcc, bcc and hcp faces of M3 §7.1, vicinal Pt(554) and Pt(332) |
| `oxides.json` | findLayers | TiO2(110) (ideal and displaced), ZnO, SrTiO3, CeO2, NaCl, Al2O3, stoichiometric units, four-index directions |
| `adsorbates.json` | findAdsorbates, markAdsorbates, findLayers | every adsorbate source; 2D materials, oxides, molecules, adatoms, tags |
| `bonds.json` | bondGraph | the bond graph (CSR, periodic images), `all` and `smart` rules, a subgraph |
| `exposure.json` | surfaceAtoms | the closed-form probe: metal series, steps, oxides, both sides, errors |

## How the files are made

`scripts/gen_layer_fixtures.py` writes them (`--check` compares instead); the tests never run it. It builds every
structure analytically: metal faces plane by plane from the primitive cell of the lattice, oxides from the bulk
prototypes of `build.crystal` with every parameter given, turned into the surface frame and cropped. Slabs are built
with pbc T T T (user decision U2), 15 Å of vacuum and c along z; 2D materials keep their T T F cells, and every file
has T T F twins. Coordinates are written with 10 decimals and the expectations are computed from those values.

Expected values come from the construction (spacings, atoms per row, which atoms were added as adsorbates) and from
a plain re-implementation of M3 §3 as amended by the ledgers. The script asserts every analytic value M3 §7.1 states
and refuses values that lie within 1e-6 of a threshold. Cross-checks made while writing the files: rows and heights,
every kappa* and every adsorbate set agree with the independent M3 v2 prototype on the 143 comparable cases, and the
`all`-rule bond graphs (degrees and distances) agree with `crystallume.analysis.neighbors.neighbor_arrays`.

## Op contracts

`args` are camelCase as in JS; Python maps `skipAdsorbates` to `skip_adsorbates` and `metalPairs` to
`metal_pairs`. The op returns a dict (JS: object) with the result keys below; a case compares only the keys in its
`expect`. Tolerances: `heights`, `period`, `vacuum`, `radius` and `exposure` 1e-6 Å, other numbers 1e-9.

**findLayers** — `find_layers(s, direction, tolerance, indices=, skip_adsorbates=, group=)` /
`findLayers(s, {direction, tolerance, indices, skipAdsorbates, group})`. `direction`: null, `"auto"`, `"normal"`,
`"a"`…`"z"`, `[x, y, z]`, `{"hkl": [h, k, l]}` or `{"hkil": [h, k, i, l]}`.

| Result | Value (field of `Layers.to_dict()` / `layersToJSON()`) |
|---|---|
| `count` | number of rows |
| `atomLayer`, `atomFromTop` | per atom: row from the bottom (`index`) and from the top (`fromTop`), both 0-based; -1 for atoms not clustered |
| `offset` | per atom: whole periods removed, `height = r·n - offset·period` |
| `heights` | per row, bottom first: mean height (Å) |
| `compositions` | per row: `{element: count}` |
| `normal`, `direction`, `normalSource`, `axis` | unit normal, label (`a b c x y z vector hkl`), source (`vacuum pbc info` from `surface_normal`, `axis`, `given`, `default`), cell axis or null |
| `tolerance`, `coords`, `period`, `vacuum` | tolerance used; `invariant`, `periodic` or `wrapped`; period (Å) or null; vacuum of the slab-axis cut (Å) or null |
| `straddles`, `spansPeriod` | booleans |
| `excluded`, `adsorbates` | atoms left out with `skipAdsorbates`; `{indices, source}` or null |
| `warnings` | the warnings (compared with `expect.warnings`) |
| `group`, `stoichiometric`, `planeCount` | `group: "units"` only: the grouping, per row whether it is a whole unit, the number of atomic planes |

**findAdsorbates** — `find_adsorbates(s, direction=, tolerance=, details=True)`. Results `indices`, `source`
(`adsorbate_id`, `tags-oc20`, `tags`, `geometry`, `none`), `notes`, `substrateElements` (the elements E of the
geometric guess, sorted; compared in `geometry` cases only).

**markAdsorbates** — on a copy: `promote_adsorbates(s)`, then `mark_adsorbates(s, indices)`. Results `promoted` and
`marked` (the two return values) and `adsorbateId` (`props.adsorbate_id` afterwards).

**bondGraph** — `bond_graph(s, metal_pairs=, indices=)`. Results `degree` (edges per atom, `BondGraph.degree()`),
`indptr`, `neighbors`, `offsets` (one `[o1, o2, o3]` per edge), `distances`, and `components`
(`periodic_components(graph)` as `[{members, periodic}]`). With `indices` every atom keeps its CSR row; only the edges
with both ends in `indices` remain.

**surfaceAtoms** — `surface_atoms(s, side, probe=, direction=, tolerance=, skip_adsorbates=, details=True)`.
Results `atoms` (the plain result), `radius` (R), `top` and `bottom` (side `"both"`), `exposure` (per atom: kappa* on
the requested side; null when no substrate atom is higher, or for an atom left out) and `borderline`.

## Skips

Every case skips both languages until its op exists: `op findLayers is registered by M3-T1`, with extra parts
`skipAdsorbates needs op findAdsorbates (M3-T3a)` and `group "units" comes with M3-T5 (wave 2)`. When a task
registers an op (`tests/ops/m3.py`, `tests/js/ops/m3.mjs`), it deletes the parts that name it, and the whole skip
when nothing is left: `tests/test_layers_golden_shape.py` fails while a skip still names a registered op.

## Decisions behind the expectations

Where M3 and the ledgers leave a detail open, the cases fix it as follows.

1. **Cut along the slab axis**: `surface_normal(s, require_gap=True)["cut"]`, the display's cut (ledger L-M3-01,
   F0 ledger §6 M3 item 2). A CO 6, 7 or 8 Å above Pt(111) stays above the slab; M3 §7.1 expected it below the slab at
   7 and 8 Å under the old widest-gap cut. `vacuum` is the cut's `empty` (the floating CO is not counted).
2. **Warnings**: `{r}` and `{g}` with two decimals, halves up (`format_decimal(x, 2)`), the tolerance in its shortest
   form (`0.3`, `2`); the kinds in the order of the M3 §3.5 table, within a kind from the top row down; more than
   three of a kind give the first three and `… and N more`. With `group: "units"` the warnings describe the atomic
   planes (the tolerance clustering), not the merged units.
3. **Units** (M3 §3.6): ties go to the split points nearest the top. This is the rule's main clause and gives the
   results M3 §0.3 and §3.6 state (TiO2(110) without the top bridging O: the incomplete unit is the top one); its
   parenthesis ("remainder at the bottom") contradicts them. A slab without `info.surface.bulk.reducedFormula` uses
   its own formula, so a vacancy slab needs the bulk formula to form units.
4. **Exposure**: kappa* is the minimum over all higher substrate atoms and all in-plane images, not only those
   within the probe's reach (the M3 §3.9 table lists values such as 2.00 and 3.93).
5. **TiO2(110) displacements**: Ti6c are the Ti under the bridging-O rows (in-plane distance c/2). The M3 §3.5
   example ("0.36 Å apart") came from a prototype that moved every Ti by the Ti5c value; with Ti6c +0.12 the plane
   splits 0.31 Å apart.
6. **CeO2(111)** is built as O–Ce–O trilayers: the top Ce is exposed (kappa* 2), as M3 §0.3 states.
7. **Vicinal slabs**: Pt(554) and Pt(332) have 30 and 12 planes, so that their 1×1 cells have vacuum along c only.
8. `normalSource` is `given` for `x`, `y`, `z`, vectors and Miller directions.
