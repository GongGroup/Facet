# AtomScope shared data contracts (v1)

Both the Python backend and the browser frontend use these JSON shapes.

## Structure — `atomscope.structure/1`

```json
{
  "schema": "atomscope.structure/1",
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

* positions are Cartesian, Ångström.
* `cell` rows are lattice vectors a, b, c; `null` for molecules/clusters (then `pbc` = [false,false,false]).
* `frames` is optional (trajectories). Frame 0 is the top-level `positions`; `frames` holds frames 1..n-1.
  Each frame may override `cell`.
* `props` holds optional per-atom arrays (same length as symbols); `info` free-form metadata.

## Project — `atomscope.project/1`

```json
{
  "schema": "atomscope.project/1",
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
  "scene": { "look": "publication", "lookBase": "publication", "style": {}, "lighting": {}, "post": {}, "display": {}, "camera": {} }
}
```

`scene` is opaque to the backend (frontend render settings). The backend must round-trip it unchanged.
Project summaries (list endpoints) = the project without `structures` and `scene`, plus
`"nStructures"`, `"nAtoms"` (total atoms in active structure), `"formula"` (of the active structure,
e.g. `"Sr8Ti8O24"`), `"formulas"` (one per structure, in project order), `"nAtomsTotal"` (atoms in all
structures) and `"size"` (bytes of stored JSON). Search matches every structure's formula.

## Additive fields (all optional)

Newer versions add these fields. Readers must accept documents without them, and older readers ignore
them, so every earlier project still opens.

| Field | Meaning |
|---|---|
| `structures[i].measurements` | saved measurements of that structure: `[{ "type": "distance" \| "angle" \| "dihedral", "keys": [...] }]`. A key is `"<atom index>:<ia>,<ib>,<ic>"` — the atom and the periodic image (cell offsets) it was measured on; 2, 3 or 4 keys. Entries of another type or with the wrong number of keys are dropped when the project is opened. |
| `scene.lookBase` | id of the look the scene started from; `scene.look` becomes `null` once a setting the look owns (material, colour scheme, lighting, effects, background, cell colour) is changed by hand, `lookBase` stays. Sizes, bonds and the representation do not change `scene.look`. |
| `scene.style.radiusOverrides` | `{ "O": 0.9 }` base atom radius in Å per element (scaled by `style.atomScale` like table radii). |
| `scene.style.bondMaterial` | `"auto"` (opaque bonds under see-through atoms), `"same"`, or a material id. |
| `scene.display.legend` | `"auto"` (colour bar for per-atom schemes), `"always"` (also element chips), `"none"`. |
| `scene.display.scaleBar` | `true` draws a length scale bar in the view and in image exports. |
| `scene.display.orthoAxisViews` | `true`: views along a/b/c/x/y/z use an orthographic camera until the next free rotation. |
| `scene.lighting.env.map` | environment map id (`room`, `studio`, `sky`, `sunset`, `dark`, or one added by a plugin). |
| `scene.lighting.env.rotation` | rotation of the environment about the vertical axis, degrees. |
| `importedFrom` | id of the project a file was imported from (imports always get a new id). |

Every scene path with its type and range is listed in [PLUGINS.md §5](PLUGINS.md#5-scene-settings).

## Concurrent edits (ETag, If-Match, 409)

Responses that carry a project have `ETag: "<updated>"`. `PUT` and `PATCH` accept
`If-Match: "<updated>"` (or a `baseUpdated` field in the body) and answer **409 Conflict** with
`{"detail": "project was changed elsewhere", "updated": "<current>"}` (and the current `ETag`) when the
stored project changed since that version, instead of overwriting it. Requests without either are
applied unconditionally. The web UI then offers to reload, keep both (save a copy) or overwrite.
