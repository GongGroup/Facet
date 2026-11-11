# Data formats

The Python server and the web app share two JSON formats: one for a **structure** and one for a
**project**. Files written under the app's former names say `"schema": "crystallume.structure/1"`,
`"crystallume.project/1"`, `"atomscope.structure/1"` or `"atomscope.project/1"`; they are read the same way, and
new files always use the `facet.*` names.

## Structure — `facet.structure/1`

```json
{
  "schema": "facet.structure/1",
  "name": "Cu fcc 3x3x3",
  "symbols": ["Cu", "Cu"],
  "positions": [[0.0, 0.0, 0.0], [1.805, 1.805, 0.0]],
  "cell": [[3.61, 0, 0], [0, 3.61, 0], [0, 0, 3.61]],
  "pbc": [true, true, true],
  "frames": [ { "positions": [[...]], "cell": [[...]] } ],
  "props": { "charges": [0.1, -0.1] },
  "info": { "source": "builder:fcc", "spacegroup": "Fm-3m" }
}
```

- `positions` are Cartesian coordinates in Å.
- `cell` rows are the lattice vectors a, b and c. Molecules and clusters have `"cell": null` and
  `"pbc": [false, false, false]`.
- `frames` (optional) makes a trajectory. Frame 0 is the top-level `positions`; `frames` holds frames
  1 to n−1, and each frame may have its own `cell`.
- `props` holds optional per-atom arrays (as long as `symbols`); `info` is free-form metadata.

## Project — `facet.project/1`

```json
{
  "schema": "facet.project/1",
  "id": "p_8f3a91c2d4",
  "name": "Perovskite study",
  "description": "",
  "tags": ["oxide"],
  "created": "2026-10-15T08:00:00Z",
  "updated": "2026-10-15T08:30:00Z",
  "thumbnail": "data:image/jpeg;base64,...",
  "activeStructure": "s_1",
  "structures": [
    { "id": "s_1", "name": "SrTiO3", "structure": { ...Structure... },
      "measurements": [ { "type": "distance", "keys": ["0:0,0,0", "4:1,0,0"] } ] }
  ],
  "scene": { "look": "poster", "lookBase": "poster", "style": {}, "lighting": {}, "post": {}, "display": {}, "camera": {} }
}
```

- `scene` holds the web app's drawing settings. The server does not read it and must store it unchanged.
  A project the web app saved opens exactly as saved. A project without a scene (`{}`, as `facet.project`
  and the REST API make them) opens in the default look, Poster; settings given without `look` (such as
  `{"style": {"rep": "spacefill"}}`) are applied on top of it.
- Project lists (summaries) contain the project without `structures` and `scene`, plus:
  - `nStructures`;
  - `nAtoms` and `formula` (such as `"Sr8Ti8O24"`) of the active structure;
  - `formulas`, one per structure in project order;
  - `nAtomsTotal`, the atoms in all structures;
  - `size`, the stored JSON in bytes.

  Searching matches every structure's formula.

## Optional fields

Newer versions add these fields. Readers must accept documents without them, and older readers ignore
them, so every earlier project still opens.

| Field | Meaning |
|---|---|
| `structures[i].measurements` | saved measurements of that structure: `[{ "type": "distance" \| "angle" \| "dihedral", "keys": [...] }]`. A key is `"<atom index>:<ia>,<ib>,<ic>"`: the atom and the periodic image (cell offsets) it was measured on; 2, 3 or 4 keys. Entries of another type or with the wrong number of keys are dropped when the project is opened. |
| `scene.lookBase` | id of the look the scene started from. `scene.look` becomes `null` once a setting the look owns (material, colour scheme, lighting, effects, background, cell colour) is changed by hand; `lookBase` stays. Sizes, bonds and the representation do not change `scene.look`. |
| `scene.style.radiusOverrides` | `{ "O": 0.9 }`: base atom radius in Å per element (scaled by `style.atomScale` like table radii). |
| `scene.style.bondMaterial` | `"auto"` (opaque bonds under see-through atoms), `"same"`, or a material id. |
| `scene.display.legend` | `"auto"` (colour bar for per-atom schemes), `"always"` (also element chips), `"none"`. |
| `scene.display.scaleBar` | `true` draws a length scale bar in the view and in image exports. |
| `scene.display.orthoAxisViews` | `true`: views along a/b/c/x/y/z use an orthographic camera until the next free rotation. |
| `scene.lighting.env.map` | environment map id (`room`, `studio`, `sky`, `sunset`, `dark`, or one added by a plugin). |
| `scene.lighting.env.rotation` | rotation of the environment about the vertical axis, in degrees. |
| `scene.post.dropShadow` | drop shadows between parts: `{ enabled, distance, softness, opacity, angle, color }` (distances in Å, angle in degrees). |
| `scene.post.paper` | paper texture over the picture: `{ enabled, strength }`. |
| `importedFrom` | id of the project a file was imported from (imports always get a new id). |

Every scene setting, with its type and range, is listed in [PLUGINS.md §5](PLUGINS.md#5-scene-settings).

## Concurrent edits (ETag, If-Match, 409)

This keeps two people, or two browser tabs, from silently overwriting each other's changes:

1. Every response that contains a project has the header `ETag: "<updated>"`.
2. `PUT` and `PATCH` accept `If-Match: "<updated>"`, or a `baseUpdated` field in the body.
3. If the stored project has changed since that version, the server does not overwrite it. It answers
   **409 Conflict** with `{"detail": "project was changed elsewhere", "updated": "<current>"}` and the
   current `ETag`.
4. Requests without `If-Match` or `baseUpdated` are applied unconditionally.

After a 409, the web app offers to reload, keep both (save a copy) or overwrite.

## Structure files of other programs

Besides its own JSON, Facet reads and writes `xyz`, `extxyz`, `poscar`, `cif`, `pdb` and `xsd` (Materials Studio).
No file format keeps everything a structure holds, so every writer says what it can store. When you export, the
export check compares that with the structure and lists what the file loses (warnings) and what changes without
affecting a calculation (notes): `facet.io.export_report(s, "xsd")` in Python, `exportReport` in the web app, and the
`capabilities` of each writer in `GET /api/v1/formats`.

| id | frames | cell | constraints | occupancy | atom order | periodicity | velocities |
|---|---|---|---|---|---|---|---|
| `json` | all | yes | along a, b, c | yes | kept | stored | yes |
| `extxyz` | all | yes | along x, y, z | yes | kept | stored | yes |
| `xyz` | all | no | no | no | kept | none | no |
| `poscar` | one | required | along a, b, c | no | grouped by element | always periodic | yes |
| `cif` | one | required | no | yes | kept | always periodic | no |
| `pdb` | all | yes | no | no | kept | always periodic | no |
| `xsd` | one | yes | whole atoms | no | kept | always periodic | no |

A plugin's writer declares the same things with `capabilities={...}` (the values are in
`facet/io/capabilities.py`; `constraints` is one of `lattice`, `cartesian`, `atoms`, `none`).

### Materials Studio XSD

`facet convert CONTCAR slab.xsd`, `facet.write("slab.xsd", s)` or Export › Materials Studio XSD writes a 3D atomistic
document that Materials Studio opens. Opening an `.xsd` file works the same way as any other structure file.

Written:

- a structure with a cell as a 3D periodic system in space group P1, with fractional coordinates; a structure
  without a cell as a molecule, with Cartesian coordinates;
- the cell in Materials Studio's orientation (c along z, b in the yz plane). The structure is turned as a whole,
  so cell lengths, angles and fractional coordinates stay; a note tells you when that happened. A left-handed cell
  is written as it is, with a warning;
- atom names: the labels of the structure (a CIF's `Fe1`), else the element with a number (`Pt1`, `Pt2`, `O1`);
- fixed atoms. The format fixes whole atoms, so an atom fixed along some directions only is written as fixed, with
  a warning.

Not written: bonds (use Calculate Bonds in Materials Studio), symmetry (use Find Symmetry), partial occupancies,
velocities, charges, and all but one frame of a trajectory.

Read: periodic documents and molecules; atom names (as `props.labels`); atoms fixed as a whole (as F F F rows of
`props.selective_dynamics`); image atoms are skipped. Constraints Facet cannot be sure about (anything but a
whole-atom restriction) are left free, and a note in `info.warnings` says so. A document with a space group other
than P1 is expanded with the symmetry operators stored in the file; no such file written by Materials Studio was
available to test against, so check the result (a note reminds you), or choose Build › Symmetry › Make P1 in
Materials Studio before saving.
