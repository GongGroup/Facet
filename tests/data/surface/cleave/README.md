# M2 golden cases: cleaving, slabs and the vacuum tools

Shared cases (`crystallume.cases/1`, see `../README.md`) for the cleave-and-slab module of the surface-modeling design
(M2): Python and JS run the same expectations, so a case that passes on both sides is a parity check. They were written
before the code (M2-T7a) so that the Python and JS implementations can each be checked against them.

| File | Op | Content |
|---|---|---|
| `recipes.json` | load | the shared recipe `bulk` (below) gives the same crystal in both languages: one case per prototype the M2 cases use |
| `inputs.json` | load | both readers give the atoms of each file in `inputs/` |
| `analysis/metals.json` | terminations | Pt, Cu, Ag, Fe, Ru, Co faces: acceptance S1-1 … S7-1 and M2 §0.3 (vicinal Pt(543), Pt(1 1 12)) |
| `analysis/oxides.json` | terminations | SrTiO3, TiO2, CeO2, ZnO, NaCl, GaAs: acceptance S8 … S12 and M2 §0.3 (Tasker types, the K7 order, K8 labels) |
| `analysis/inputs.json` | terminations | the real inputs of M2 §7.2: Materials Project primitive cells, corundum (Al2O3, the Cr2O3 type), LaFeO3, anatase, SiC 4H/6H, dhcp La, noisy bulks |
| `analysis/errors.json` | terminations | E2, E4, E4b and the miller texts of F0-A |
| `slab/metals.json`, `slab/oxides.json` | surface | acceptance S1-2 … S12-2 slabs, symmetric slabs, stoichiometry and polarity warnings, names (C9, L-X-07, L-19) |
| `slab/vacuum.json` | surface | V = 0 (bulk stacking, U4) and small vacua (the K11 contact check, W12) |
| `slab/errors.json` | surface | E2, E4, E8, E9, E10, E12, E12a, E12b, E14, E16 |
| `tools/set_vacuum.json` | setVacuum | the CONTCAR fixture at 15 and 20 Å, bottom/offset, graphene and MoS2 (pbc T T F kept), vacuum along a, a left-handed cell, a floating H2, a bulk (W14), a tilted c, `set_vacuum(0)` (L-13) |
| `tools/flip.json` | flipSlab | flipped slabs, their records and names (M2 §3.15) |
| `tools/standardize.json` | standardizeSlab | the slab normalisation M6 uses (ledger L-M2-05) |
| `inputs/*.vasp` | — | the input files (below) |
| `make_cleave_cases.py` | — | the generator (below) |

## How the files are made

`make_cleave_cases.py` writes every file here (`--check` compares instead); the tests never run it. It needs numpy
and this checkout's `crystallume` (to check the `bulk` recipe against the builders and the radii against
`core/elements.py`).

Expected values come from three sources (plan.md M2-T7a: only analytic formulas, or numbers that acceptance or the
specs have already checked):

1. **Analytic geometry**, computed from the crystal structures and independent of the M2 code: surface cells, periods
   (d of the primitive lattice), plane heights and gaps, layer compositions per 1×1 cell, slab cells, thicknesses,
   z ranges, atom counts and order, tags, constraint flags, volumes, shortest distances and the positions the tools
   produce. Every number that acceptance S1–S14 or M2 §0.3 quotes is asserted against the quote; two quotes are off in
   their last digit but inside the acceptance's own A4 tolerance (±1e-3 Å²): the Fe(110) area 5.8082 Å² (a²/√2 =
   5.80814) and the Ru(0001) area 6.3603 Å² (√3a²/2 = 6.36018). The cases hold the exact values.
2. **Terminations** (count, labels, order, broken bonds, polarity, Tasker type) as M2 §0.3 and the acceptance
   scenarios state them. The generator re-derives them with a plain re-implementation of M2 §3.6–3.9 (planes at
   0.1 Å, the rumpled-layer merge, the M3 bond criterion with the smart rule, two-level fingerprints at 0.10 Å, formal
   charges, K7, K8) and refuses to write a case whose quoted value it does not reproduce. Where the spec quotes only
   part of a list (corundum, anatase (101), LaFeO3, SiC), the rest comes from that re-implementation.
3. **Names, warnings and errors**: the texts of M2 §3.13 and §3.20 and of the ledgers (L-X-07, L-M2-02 … L-M2-05),
   verbatim. Where §3.20 gives the example for exactly the slab of a case (W9 for ZnO(0001) 16L, W12 and E16 for
   TiO2(110), W10 for the Ti2O2-terminated slab) the case compares the whole text; otherwise it compares the parts
   whose wording the spec fixes (`contains`).

## The recipe `bulk`

Registered in `tests/ops/m2_recipes.py` and `tests/js/ops/m2_recipes.mjs` for the whole repository: other modules use
it and do not register their own (registering a name twice raises). It calls `build.crystal` in Python and
`buildCrystal` (`crystallume/web/js/build/crystal.js`) in JS with every lattice constant given (acceptance §0.4):

```json
"input": {"recipe": {"name": "bulk", "args": {"prototype": "rutile", "elements": ["Ti", "O"], "a": 4.594, "c": 2.959, "u": 0.305}}}
```

| Argument | Meaning |
|---|---|
| `prototype` | required: a prototype id of `crystallume.build.crystal.PROTOTYPES` (`fcc`, `bcc`, `hcp`, `diamond`, `zincblende`, `wurtzite`, `rocksalt`, `cscl`, `fluorite`, `perovskite`, `rutile`, `graphene`, `hbn`, `mos2`, `graphite`, `sc`); aliases such as `nacl` are refused |
| `elements` | required: one element symbol per role of the prototype, in role order |
| `a` | required, Å, above 0.5 |
| `c` | Å, above 0.5: required for the prototypes with a c axis (hexagonal, tetragonal, 2D: the cell height), refused for the others |
| `u`, `thickness` | optional, only for the prototypes that have them (`u`: wurtzite, rutile; `thickness`: mos2, the X–X height in Å); default: the shared reference table (the same in both languages since F0-D T10) |
| `repeat` | optional `[nx, ny, nz]`, positive integers (`Structure.repeat` order) |
| `name` | optional: the structure's name. Without it the builders name the crystal differently in the two languages (`Pt fcc`, `Pt (Face-centred cubic)`) until M7 unifies the bulk names (lead decisions L-11, L-22), so cases that depend on the name (the tool records' `autoName`) give one |

Argument errors read `recipe bulk: <reason>` in both languages (`unknown args x`, `missing arg a`, `unknown prototype
nacl`, `give c for hcp (lattice constants are always explicit)`, `fcc has no c axis`, `fcc needs 1 element, got 2`, …).
The F0-D recipe `crystal` remains; `bulk` differs in accepting `thickness` and `name`, in requiring c only where there
is one, and in checking the number of elements.

## Op contracts

`args` are camelCase as in JS; the Python ops map them to snake_case keywords (`tests.cases.snake_args`). In the
cases of these ops every number is compared within 1e-6 (`tol.value`; Å for lengths, degrees for angles):
`info.surface` stores values rounded to 6 decimals (ledger L-X-01), and the cases hold either the exact values or
those rounded ones.

**Flattened results.** Besides the results named below, the ops return every node of a JSON tree under its dotted
path, so that a case compares only the parts it knows: for a dict `d`, the key `p` maps to `d`, and `p.k` to `d[k]`,
recursively through objects and arrays (`mesh.a`, `terminations.0.label`, `surface.termination.top`,
`surface.asBuilt.polarity.netCharge`). A case's key absent from the results is a failure, so a case never names a
path the spec makes optional.

### terminations

`terminations(bulk, miller, **kw)` / `terminations(bulk, { miller, ...kw })`; args `miller` (required, 3 or 4
integers), `millerBasis`, `primitive`, `translationTolerance`, `layerTolerance`, `charges`, `keepMolecules`. The op
returns the result (`SurfaceAnalysis.to_dict()` / `toJSON()`, the REST `TerminationsResponse` of M2 §6.3) flattened
from the top (`miller`, `millerInput`, `millerBasis`, `hkil`, `millerConventional`, `conventional`, `primitive`,
`translationTolerance`, `normal`, `period`, `layersPerPeriod`, `mesh.a`, `mesh.b`, `mesh.gamma`, `mesh.area`,
`mesh.type`, `layerTolerance`, `layerGrouping`, `tasker`, `charges`, `notes`, `warnings`, …), plus:

| Result | Value |
|---|---|
| `terminationCount` | the number of inequivalent terminations |
| `labels`, `brokenBonds`, `polar` | per termination, in the result's order (K7): its label, broken bonds per 1×1 cell, polar flag |
| `stack` | the composition `{element: count}` per 1×1 cell of each layer of one period, starting with the outermost layer of termination 0 (the top layer of a slab with that termination) and going down |
| `gapsBelow` | per entry of `stack`: the gap (Å) between that layer's lowest atom and the highest atom of the layer below it |
| `topIndices` | per termination: the positions in `stack` of the top layers of all its cuts, ascending |

`stack`, `gapsBelow` and `topIndices` describe the layers without the result's own numbering of `layers[]` and
`cuts[]`, which depends on where the ring of one period starts (decision 1). With `cuts[k].layer` the layer just below
cut k, `p0` the one of termination 0's representative cut and `m` the layers per period:
`stack[j] = layers[(p0 - j) mod m].composition`, `gapsBelow[j] = layers[(p0 - j - 1) mod m].gapAbove` and
`topIndices[t] = sorted((p0 - cuts[c].layer) mod m for c in terminations[t].cuts)`.

### surface, setVacuum, flipSlab, standardizeSlab

- **surface**: `surface(bulk, miller, vacuum=..., **kw)` / `buildSurface(bulk, { miller, vacuum, ...kw })`; args
  `miller`, `vacuum` (both in every case; `null` is the E12a case), `layers`, `periods`, `thickness`, `termination`,
  `cut`, `symmetric`, `position`, `offset`, `supercell`, `primitive`, `millerBasis`, `translationTolerance`,
  `fixBottom`, `fixMiddle`, `fixAxes`, `layerTolerance`, `charges`, `keepMolecules`, `name`.
- **setVacuum**: on a copy, `s.set_vacuum(vacuum, **kw)` / `s.setVacuum(vacuum, kw)`; args `vacuum` (required),
  `position`, `offset`, `orthogonal`, `reorient`, `axis`.
- **flipSlab**: on a copy, `s.flip_slab()` / `s.flipSlab()`; no args.
- **standardizeSlab**: `standardize_slab(s)` / `standardizeSlab(s)`; no args.

All four return:

| Result | Value |
|---|---|
| `structure` | the slab (the `structure` comparator: only the keys given; `null` in `props`/`info` = the key is absent) |
| `warnings` | `structure.info.warnings` (the comparator reads them from the structure) |
| `surface` | `info.surface`, or `null` when the structure has none; flattened (`surface.layers`, `surface.termination.count`) |
| `zRange` | `[min z, max z]` of the Cartesian positions (Å) |
| `volume` | `abs(det(cell))` (Å³) |
| `minDistance` | the shortest distance between two atoms of the periodic structure (images along the periodic axes only) |

## Skips

Every case of an M2 op skips both languages until its op is registered there, with the reason that names the op and
the tasks that register it (plan.md P-03):

| Op | Reason (`skip.py` and `skip.js`) | Registered in | Skips removed by |
|---|---|---|---|
| terminations | `op terminations is registered by M2-T3 (Python) and M2-T6a (JS)` | `tests/ops/m2_analysis.py`, `tests/js/ops/m2_analysis.mjs` | M2-T7c (W1.5) |
| surface | `op surface is registered by M2-T4 (Python) and M2-T6b (JS)` | `tests/ops/m2_slab.py`, `tests/js/ops/m2_slab.mjs` | M2-T7b-lite (W1.6) |
| setVacuum, flipSlab, standardizeSlab | `op setVacuum is registered by M2-T5 (Python and JS)` (and the same for the others) | `tests/ops/m2_tools.py`, `tests/js/ops/m2_tools.mjs` | M2-T5 / M2-T7c (W1.5) |

`tests/test_cleave_golden_shape.py` fails while a language that has not registered an op lacks the skip (or gives
another reason). Registering an op does not remove the skips: until the task named in the last column does, the
implementing tasks run these files from their own tests (M2-T3, M2-T4, M2-T6a, M2-T6b read them directly). The cases of
`recipes.json` and `inputs.json` use the F0-D op `load` and run now.

## Inputs

| File | What it is | Used by |
|---|---|---|
| `pt_mp_primitive.vasp`, `fe_mp_primitive.vasp` | the standard primitive cells of fcc Pt (a0 3.92) and bcc Fe (a0 2.866) as Materials Project writes them (cell from lengths and angles: a along x) | conventional-cell hints (cF, cI), both index bases, the name `Pt(-111) 4L` |
| `al2o3_mp_rhombohedral.vasp`, `al2o3_hexagonal.vasp` | corundum (R-3c, a 4.759, c 12.991, Al z 0.35216, O x 0.30624): the 10-atom rhombohedral cell and the 30-atom hexagonal cell | (0001) three ways (hR hint) |
| `cr2o3_hexagonal.vasp` | Cr2O3, corundum type (a 4.959, c 13.594, Cr z 0.3475, O x 0.3058), hexagonal cell | a 0.385 Å Cr–Cr gap crossed by bonds tilted about 41°: six planes, no merge |
| `lafeo3_pbnm.vasp` | LaFeO3 Pbnm (a 5.556, b 5.565, c 7.862; O2 0.308 Å off the Fe plane) | the rumpled-layer merge (K5) |
| `anatase.vasp` | anatase I41/amd (a 3.785, c 9.514, O z 0.2081) | merge in (001), four terminations in (101) |
| `sic_4h.vasp`, `sic_6h.vasp`, `la_dhcp.vasp` | ideal polytypes | the second fingerprint level |
| `*_noise_*.vasp` | builder bulks with Gaussian noise of σ Å on each Cartesian component (numpy `default_rng(seed)`, seeds in the generator; the two corundum files share one seed, so σ = 0.02 is twice the σ = 0.01 noise) | M2 §7.1 noisy bulks; `al2o3_noise_0.02.vasp` is the input of M2-T3's W2b test and has no case here |
| `contcar_pt111_lefthanded_h.vasp` | Pt(111) p(2×2) 3L with an H atom 1.55 Å above a top Pt, the cell rows a and b swapped (left-handed); Selective dynamics | W18, the H stays on top |
| `contcar_pt111_h2_floating.vasp` | Pt(111) p(2×2) 3L with an H2 molecule parallel to the surface 7.0 Å above it, 13 Å of vacuum above the molecule | W19 |
| `contcar_pt111_vacuum_along_a.vasp` | the shared fixture `../contcar_pt111.vasp` with its cell vectors relabelled (c, a, b) and its flags permuted the same way | W16, the axis relabelling |

## Decisions behind the expectations

Where M2 and the ledgers leave a detail open, the cases fix it as follows.

1. **Layers without their numbering.** The result's `layers[]` start where the ring of one period is cut, which M2
   §3.6 ties to the M3 ring rule ("after the widest gap; ties to the cell boundary"); for rutile (110), whose two
   widest gaps tie, that rule starts with Ti2O2 while the CLI example of M2 §6.5 starts with O. The cases compare the
   invariant `stack`, `gapsBelow` and `topIndices` instead, and no case depends on cut numbers or layer indices.
   `topIndices` is left out where two terminations tie in the K7 key (SiC, dhcp La): the tie goes to the cut number,
   so which stacking site gets "-A" is the implementation's; the labels, bond counts and polar flags in sort order are
   the same either way.
2. **Notes** are compared only where none of N3–N5 can occur (one termination, layer tolerance 0.3 Å): N1 and N2 on
   the metals and NaCl(100). With several terminations N5 may apply (SrTiO3, TiO2, CeO2), and merged or small-period
   faces have an N3 whose API wording §3.20 does not give.
3. **Noisy bulks** keep the cell exactly, so the mesh and the period are exact. Where every layer is neutral (SrTiO3,
   ZnO(10-10), the metals) the classification is compared in full; elsewhere only the number of terminations: the
   dipole of a repeat unit follows the noisy layer heights, and with σ = 0.02 Å the non-polar rutile cut is already
   above the 1e-3 e/Å threshold, which reorders the terminations and changes the Tasker type.
4. **Names** follow L-X-07 exactly; besides the spec's own examples the cases contain names that only apply its rules:
   the bottom label (K8: the bottom face takes the label of the top class it matches, else the bottom faces are
   named among themselves) in `TiO2(110) O·Ti2O2/O·O-term 4L`, `TiO2(110) Ti2O2-term 10L`,
   `LaFeO3(001) Fe2O4/La2O2-term 4L`, `Al2O3(0001) Al·O3-term 12L` and `NaCl(111) Na-term 5L`, and the negated
   indices of a flipped slab (§3.15) in `Pt(-1-1-1) (√3×√3)R30° 4L` and `Pt(-1-1-1) p(3×3) 4L`.
5. **Warning texts.** `W8` has its example's wording with the case's numbers; `W9` is compared in full only for
   ZnO(0001) (§3.20 quotes that slab); its numbers' format for other slabs (sign, digits) is not fixed, so other cases
   compare `the slab is polar: dipole ` and the count. The W16 example is for b; the vacuum-along-a case compares the
   part that does not depend on how the relabelling is written.
6. **The vacuum record.** `set_vacuum` on a structure without `info.surface` writes exactly the ten keys of L-X-01 and
   M2 §3.14 step 12 (`version, kind, autoName, axis, normal, thickness, vacuum, position, offset, stacking`), so the
   cases compare the whole block.
7. **W14 on a bulk.** F0-D's `find_vacuum_gap(s, 2, min_width=0)` returns the gap [0, 0.5) of SrTiO3 (the first of two
   equal gaps); with L-M2-03 step 1 the window starts at 0.25, so TiO2 is the bottom layer of the resulting slab.
8. **The flip records** are the records M2 writes (L-X-01) without `directions` and `orientation`, which readers must
   tolerate; the expectations check what §3.15 changes (indices, normals, top and bottom, `flipped`, the supercell
   record, the name) and the flipped positions (180° about a, re-centred, wrapped in-plane; the cells are their own
   reduced flips).
9. **Not compared**: `suggestedLayers` (for TiO2(110) the rule of M2 §3.10 gives 9 layers, its table and acceptance S8
   give 6), `directions`, `orientation`, `millerPrimitive`, `cut`/`cuts` numbers, `bulk.name` (lead decision L-11),
   `bulk.entryId` (web only), `generator`, exposed-layer coordination (M2-T3b), and the oblique meshes' side lengths
   (Pt(543), anatase (101): the obtuse convention may put the longer side first; their areas are compared).
10. **Slab polarity.** `asBuilt.polarity.dipole` is the μ of M2 §3.9.2 (Σ q_i (z_i − z_mid), z_mid halfway between
    the lowest and the highest atom) for the slab's whole cell, like `netCharge` (a supercell holds det S times the
    1×1 value; W9 says "per cell"), and `dipoleDensity` is that dipole over the cell's area (e/Å), so `polar` is
    `|dipoleDensity| > 1e-3`. The charges themselves (`charges`, `chargesSource`) are not compared. The record and
    W8–W10 do not depend on V: the ZnO(0001) slab at V = 0 has the W9 of the slab at 15 Å (§3.9.2 covers every
    slab; nothing exempts the bulk stacking).
