# Data formats

The Python server and the web app share two JSON formats: one for a **structure** and one for a
**project**. Files from before the rename from AtomScope say `"schema": "atomscope.structure/1"` or
`"atomscope.project/1"`; they are read the same way, and new files always use the `crystallume.*` names.

## Structure — `crystallume.structure/1`

```json
{
  "schema": "crystallume.structure/1",
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

## Project — `crystallume.project/1`

```json
{
  "schema": "crystallume.project/1",
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
  "scene": { "look": "studio", "lookBase": "studio", "style": {}, "lighting": {}, "post": {}, "display": {}, "camera": {} }
}
```

- `scene` holds the web app's drawing settings. The server does not read it and must store it unchanged.
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
