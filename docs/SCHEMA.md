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
  "structures": [ { "id": "s_1", "name": "SrTiO3", "structure": { ...Structure... } } ],
  "scene": { "style": {}, "lighting": {}, "display": {}, "camera": {} }
}
```

`scene` is opaque to the backend (frontend render settings). The backend must round-trip it unchanged.
Project summaries (list endpoints) = the project without `structures` and `scene`, plus
`"nStructures"`, `"nAtoms"` (total atoms in active structure) and `"size"` (bytes of stored JSON).
