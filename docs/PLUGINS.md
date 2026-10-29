# Extending Crystallume

Crystallume is built from registries: file formats, builders, representations ("drawing styles"),
materials, colour schemes, lighting presets, environment maps, looks, samples, analyses, storage
backends, panels and commands. Plugins add entries to them. There are two kinds, and one plugin
can be both:

| Kind | Runs in | Adds | Loaded from |
|---|---|---|---|
| **Python plugin** | the Crystallume server and the CLI | file readers/writers, structure builders, analyses, REST routes, UI presets, static files | `--plugins DIR`, `CRYSTALLUME_PLUGIN_DIRS`, entry points |
| **JavaScript plugin** | the browser | everything in the web UI (all registries below) | a Python plugin's `add_frontend_module`, `plugins.json`, `?plugin=`, `crystallume.plugins.load()` |

Quick start:

```bash
crystallume plugins new my-plugin --dir ./plugins     # plugin.py + static/my-plugin.js
crystallume plugins --plugins ./plugins               # it loads? (status ok / ERROR)
crystallume serve --plugins ./plugins                 # open http://127.0.0.1:8765
crystallume analyze my-plugin-count POSCAR --plugins ./plugins
```

In the web UI, **Help › Scripting & API** shows a live reference of every registry entry, command,
scene path and event (click to copy a call), plus the status of each plugin. In the browser console,
`crystallume.help()` prints the same as tables.

---

## 1. Python plugins

A plugin is a module with a `register(ctx)` function and an optional `PLUGIN` dict:

```python
# plugins/my_plugin/plugin.py
from crystallume import PluginContext, Structure

PLUGIN = {"name": "my-plugin", "version": "0.1.0", "description": "What it adds."}

def register(ctx: PluginContext) -> None:
    ctx.register_reader("lammps-dump", read_dump, extensions=[".lammpstrj"])
    ctx.register_analysis("my-plugin-count", count_atoms, {"label": "Atom count", "params": [...]})
    ctx.add_preset("look", {"id": "dusk", "name": "Dusk", "scene": {...}})
    ctx.add_frontend_module("my-plugin.js")      # served from plugins/my-plugin/static/
```

### Lifecycle

1. **Discovery.** Every sub-folder of a plugin directory that contains `plugin.py`, and every
   top-level `*.py` file (names starting with `_` or `.` are skipped). Installed packages can
   advertise `[project.entry-points."crystallume.plugins"] name = "package.module"` (a module or a
   `register` function). The former group `atomscope.plugins` is still discovered (an entry point listed
   in both groups by the same package loads once), and `import atomscope` / `from atomscope import ...`
   in older plugins gives the matching `crystallume` module.
2. **Registration.** `register(ctx)` is called once. Readers and writers go into the global
   `crystallume.io` registry; builders, analyses, routes, presets and frontend modules are recorded on
   the plugin.
3. **Failure.** If import or `register` raises, the plugin is listed with `status: "error"` and the
   error message (`crystallume plugins`, `GET /api/v1/plugins`, the web UI shows one notice at start-up);
   its readers/writers are rolled back. A broken plugin never stops the server.
4. **Use.** The server exposes builders at `POST /api/v1/build/custom/{name}`, analyses at
   `POST /api/v1/analysis/custom/{name}`, formats through `/api/v1/io/*`, routers under
   `/api/v1/ext`, static files at `/plugins/<name>/`. `/api/v1/info` lists everything for the UI.
   The CLI loads the same plugins for `convert`, `info`, `formats`, `build` and `analyze`
   (`--plugins DIR`, else `CRYSTALLUME_PLUGIN_DIRS`). In Python: `crystallume.load_plugins(["./plugins"])`.

### `PluginContext`

| Member | Description |
|---|---|
| `ctx.name`, `ctx.root`, `ctx.log` | plugin name, plugin folder, a logger |
| `register_reader(name, func, extensions=(), description="", filenames=())` | `func(text) -> Structure \| list[Structure]` |
| `register_writer(name, func, extensions=(), description="", mimetype="text/plain")` | `func(structure) -> str` |
| `register_builder(name, func, meta=None)` | `func(**params) -> Structure \| dict`; `meta = {label, description, params}` |
| `register_analysis(name, func, meta=None)` | `func(structure, **params) -> JSON`; `meta = {label, description, params}` |
| `add_router(router, prefix="/api/v1/ext")` | include a FastAPI `APIRouter` |
| `add_static(directory)` | serve a folder at `/plugins/<name>/`; returns `plugins/<name>/` |
| `add_frontend_module(path)` | ES module (relative to the static folder) the web UI imports; returns `plugins/<name>/<path>` |
| `add_preset(kind, preset)` | `kind`: `lighting`, `colorScheme` or `look` (`style` is the older name for a look) |

Builder and analysis names match `[A-Za-z0-9][A-Za-z0-9_.-]*`. Frontend URLs are **relative**
(`plugins/<name>/x.js`), so they also work when the app is served under a sub-path (`--root-path`).

### Parameter schema (builders and analyses)

The UI renders a form from `params`; the CLI coerces `--param KEY=VALUE` with it.

| Field | Meaning |
|---|---|
| `name` (**required**) | keyword argument name |
| `type` | `int`, `float`, `string`, `element` (symbol input with completion), `bool` (switch), `select` |
| `default` | initial value (int/float default to `min` or 0, element to `C`, select to the first option) |
| `label`, `description` | field label and tooltip |
| `min`, `max`, `step` | numeric limits (checked before running) |
| `options` | for `select`: `["a", "b"]`, `[["value", "Label"], …]` or `[{value, label}]`; in JavaScript also a function of the structure |

### Preset shapes

Presets are passed to the web UI unchanged (plus `plugin`); `/api/v1/info` lists them under
`presets.lighting`, `presets.colorSchemes` and `presets.styles` (looks).

```python
ctx.add_preset("lighting", {          # any omitted part falls back to the UI defaults
    "id": "sunset", "name": "Sunset",
    "key":  {"intensity": 2.2, "color": "#ff9f68", "azimuth": -40, "elevation": 20},
    "fill": {"intensity": 0.6, "color": "#6c8cff", "azimuth": 50, "elevation": 10},
    "rim":  {"intensity": 1.2, "color": "#ffd1a1", "azimuth": 160, "elevation": 35},
    "hemi": {"intensity": 0.35, "sky": "#ffd6a5", "ground": "#4a3b52"},
    "ambient": {"intensity": 0.05, "color": "#ffffff"},
    "env": {"enabled": True, "intensity": 0.5, "map": "sunset"},
    "extra": [{"intensity": 1, "color": "#ffffff", "azimuth": 90, "elevation": 0}],
})
ctx.add_preset("colorScheme", {"id": "oxides", "name": "Oxides", "colors": {"O": "#ff2244"}, "default": "#b0b6bd"})
ctx.add_preset("look", {"id": "dusk", "name": "Dusk", "swatch": "#2f3a5a",
                        "scene": {"display": {"background": {"mode": "solid", "color1": "#141a2a"}},
                                  "post": {"bloom": {"enabled": True}}}})
```

A **look** (`style` preset) is a partial scene (see §5). Applying it first resets the look-owned
settings (lighting, effects, material, colour scheme, background, cell colour) to the defaults, so a
look always produces the same picture; representation, sizes, bonds and the camera are kept unless
the look sets them.

---

## 2. JavaScript plugins

```js
// my-plugin.js
export default async function activate(api) {      // `activate` may also be a named export
  const off = api.registerLook({ id: 'lab-night', name: 'Lab night', scene: { post: { outline: { enabled: true } } } });
  api.registerCommand({ id: 'my.hello', title: 'Say hello', run: (app) => api.toast(`${app.structure?.length ?? 0} atoms`) });
}
```

### Lifecycle

1. **Loading.** At start-up the app (`installExtensions`) loads, in order:
   the frontend modules of server plugins (`/api/v1/info` → `plugins[].frontend`); every entry of
   `plugins.json` next to `index.html`; and, in static mode only (no server, not embedded as an
   artifact), each same-origin `?plugin=<url>` in the address. Later, any script can call
   `await crystallume.plugins.load(url, { name })`.
2. **Activation.** The module is imported (relative URLs resolve against the page) and its default
   export (or `activate`) is called with the API object (`window.crystallume`). It may be `async`.
   Each URL loads once; loading it again returns the same result.
3. **Registration.** Every `api.register*` call validates the entry (missing required fields throw,
   e.g. `samples.register: missing build()`), warns in the console when it replaces an entry with the
   same id (pass `{ replace: true }` as the second argument to do that on purpose), updates the
   command palette and the panels, emits a `registry` event, and returns a function that removes the
   entry again. Removing an entry that replaced another (for example a built-in look) brings the
   replaced entry back. Entries registered during activation are tagged with `plugin: <name>`.
4. **Failure.** If import or `activate` throws, the registrations it made are undone, the plugin is
   listed with `status: 'error'` in `crystallume.plugins.list()` and Help › Scripting & API › Server,
   and a single notice is shown at start-up.

### `plugins.json`

```json
[
  { "name": "hello", "url": "plugins/hello/hello.js" },
  "plugins/other/other.js"
]
```

Same-origin file next to `index.html` (ship `[]` when unused). URLs resolve against the manifest;
`"enabled": false` skips an entry. `python scripts/build_artifact.py --plugin DIR` copies a plugin's
`static/` folder into the bundle and writes this file for you. Only the JavaScript part of a plugin
runs without the server.

### Command palette

Commands mirror the registries automatically: `rep.<id>`, `look.<id>`, `light.<id>`, `color.<id>`,
`sample.<id>` and `export.<format>` exist for every entry and disappear with it. The first nine
representations get the keys `1`–`9`. A command's `run(app, ...args)` always receives the app first.

---

## 3. Registries and entry shapes

Required fields are **bold**. `api.registry.<name>` exposes each registry (`get(id)`, `list()`,
`register(entry, opts)`; `register` goes through the same validation as the `api.register*` helpers).

| Helper | Registry | Entry |
|---|---|---|
| `registerFormat(f)` | `formats` | **`id`**, `name`, `extensions: ['xyz']`, `filenames: ['POSCAR']`, `mime`, `description`, **`read(text, filename) → Structure`** and/or **`write(structure) → string`** (either may return a Promise; set `server: true` for formats handled by the server) |
| `registerStyle(s)` | `styles` (representations) | **`id`**, `name`, `description`, `icon` (inline SVG), `defaults` (style settings applied with it), `bonds: bool`, `inPlaceRadii`, **`build(ctx) → THREE.Object3D`** |
| `registerMaterial(m)` | `materials` | **`id`**, `name`, `description`, `swatch`, **`create(params, { THREE }) → THREE.Material`**, `update?(material, params)`, `transparent`, `prefersDark`; params = `{roughness, metalness, opacity, envIntensity}` |
| `registerColorScheme(c)` | `colorSchemes` | **`id`**, `name`, `description`, `group: 'Element' \| 'Per atom'`, **`colorFor(symbol, index, ctx) → '#rrggbb'`**, `legend?(ctx) → {colormap, min, max, label}` |
| `registerLightingPreset(p)` | `lighting` | **`id`**, `name`, `description`, `swatch`, `key`/`fill`/`rim` `{intensity, color, azimuth, elevation}`, `hemi {intensity, sky, ground}`, `ambient {intensity, color}`, `env {enabled, intensity, map}`, `extra: [light, …]` (omitted parts get defaults) |
| `registerEnvironmentMap(m)` | `environmentMaps` | **`id`**, `name`, `description`, **`build() → THREE.Scene`** (rendered into a PMREM environment) |
| `registerLook(l)` | `looks` | **`id`**, `name`, `description`, `swatch` (CSS background), `ball` (optional CSS background of a sphere drawn in the middle of the card; `swatch` is then its backdrop), **`scene`** (partial scene, §5), `backgroundDark`, `cellDark`, `hidden` |
| `registerSample(s)` | `samples` | **`id`**, `name`, `category` (default `Plugins`), `tags`, **`build() → Structure`**, `look`, `rep`, `scene` |
| `registerAnalysis(a)` | `analyses` | **`id`**, `name`, `description`, `params` (§1 schema), **`run(structure, params, ctx) → result \| Promise`**, `render?(result, el, ctx)`, `auto: bool \| (structure) => bool`, `dependsOn: ['display.bonds']` |
| `registerCommand(c)` | `commands` | **`id`**, `title`, `category` (default `Plugin`), `keywords`, `key` (`'g'`, `'mod+g'` or an array), `hidden`, **`run(app, ...args)`**, `when?(app)`, `whyNot?(app)` (the sentence shown when `when` is false) |
| `registerStorage(p)` | `storage` | **`id`**, `label`, `icon`, `description`, `where`, `init()`, `available()`, **`list(q?)`**, **`get(id)`**, **`save(project, {force}?)`**, `remove(id)` — `save` rejects with `err.code = 'conflict' \| 'auth' \| 'offline'` |
| `registerPanel(p)` | `panels.left` | **`id`**, `title`, `icon` (icon name), `tip`, **`render(app, el, shell)`**, `headActions?(app, shell) → [Node]`, `refreshOn: ['project', 'structure', 'selection', 'measure', …]`, `signature?(app) → string` (skip re-renders while it is unchanged) |
| `registerInspectorTab(t)` | `panels.inspector` | **`id`**, `title`, `icon`, `tip`, **`render(app, el, shell)`** |

Read-only registries: `prototypes`, `clusters` (crystal and cluster builders).

**Representation `build(ctx)`** receives `ctx = { model, colors (Float32Array, linear RGB),
radii (Float32Array), settings (scene.style), atomMaterial, bondMaterial, segments, showBonds,
resolution, THREE, helpers }`. `model = { n, symbols, positions (Float32Array xyz), src (source atom
index), img (periodic image offsets), bonds: {pairs, lengths, count}, cell, supercell, pbc }`.
`helpers` (also `api.render`) = `buildAtoms`, `buildBonds`, `buildLines`, `buildPolyhedra`,
`atomRadius`, `segmentsFor`, plus `createMaterial`, `COLORMAPS` and `THREE` on `api.render`.

**Analyses.** `ctx = { app, scene, bondOptions: {tolerance, disabledPairs}, ui }`, where
`ui = { h, lineChart, kvTable, renderResult }` helps `render` build DOM. Without `render`, results are
shown automatically: scalars and short vectors as a table, long numeric arrays as a line chart (two
equally long arrays → x/y), anything else as JSON. Results are cached per structure version, params
and the scene values in `dependsOn`, so re-rendering the panel never recomputes them. Server plugin
analyses appear here automatically (they run on the server); built-ins are `coordination` and `rdf`.

---

## 4. The JavaScript API (`window.crystallume`)

`window.atomscope` (the former name) is an alias of the same object.

| Member | Description |
|---|---|
| `version`, `app`, `viewer`, `shell`, `Structure`, `THREE`, `render` | internals for advanced plugins |
| `structure`, `scene`, `project`, `selection` | current state (getters) |
| `load(input, {name, format, look, newProject})`, `loadURL(url)`, `sample(id)`, `openProject(doc)` | show structures (`load` returns a Promise for formats only the server reads; `openProject` opens a project document as a new project with a new id, like opening the file, so saving it never replaces a stored project) |
| `build.crystal(proto, params)`, `build.cluster(kind, params)`, `build.molecule(id)`, `build.prototypes()`, `build.clusters()`, `build.molecules()` | builders |
| `analysis.bonds(s?)`, `analysis.neighbors(s?)`, `analysis.summary(s?)`, `analysis.coordination(s?)`, `analysis.rdf(s?, {rmax, nbins, pair})` | direct analysis functions |
| `analyze(id, params?, s?) → Promise` | run any registered analysis (built-in, JS plugin or server plugin) |
| `set(path, value)`, `get(path)`, `patch(partial)` | scene settings (§5); paths with `__proto__`, `constructor` or `prototype` are refused |
| `applyLook(id)`, `setRepresentation(id)`, `setLighting(id)` | one-click presets |
| `view(axis)`, `resetView()`, `fit()`, `orbit(dAz°, dEl°)`, `pan(dx, dy)`, `zoom(factor)`, `getCamera()`, `setCamera(c)` | camera |
| `atomsInRect(x0, y0, x1, y1)` | source indices of the atoms drawn inside a client-space rectangle |
| `select(indices, {add})`, `clearSelection()`, `selectAll()`, `selectSameElement(symbols?)`, `selectNeighbors(indices?, {add})` | selection |
| `measure(type, displayIndices)`, `frame(i)`, `play(on)` | measurements and trajectories |
| `screenshot({scale, transparent}) → Blob`, `exportText(format) → string \| Promise`, `exportGLB()`, `save(provider)` | output |
| `projects.providers()`, `projects.list(provider)`, `projects.open(provider, id)` | storage |
| `sceneScript()` | the current scene as `crystallume.patch({...})` + `setCamera(...)` (palette: *Copy current scene as script*) |
| `on(event, fn) → off()`, `toast(msg, {type})`, `command(id, ...args)` | events, notices, commands (`command` throws an Error saying why when the command's `when` guard says it cannot run now, e.g. “Load a structure first.”) |
| `registry.*`, `registerFormat`, `registerStyle`, `registerMaterial`, `registerColorScheme`, `registerLightingPreset`, `registerEnvironmentMap`, `registerLook`, `registerSample`, `registerAnalysis`, `registerCommand`, `registerStorage`, `registerPanel`, `registerInspectorTab` | §3 |
| `plugins.load(url, {name})`, `plugins.list()` | plugin loading and status (`active` / `error`, server plugins included) |
| `reference()`, `help(topic?)` | everything above as data / console tables (`help('looks')`, `help('scene')`, `help('events')`) |

### Events (`crystallume.on(name, fn)`)

| Event | Source | Payload | When |
|---|---|---|---|
| `project` | app | — | the open project changed: opened, renamed, structures added or removed |
| `structure` | app | — | the active structure was switched or edited |
| `selection` | app + viewer | viewer: source indices | the selection changed |
| `scene` | app | — | scene settings changed |
| `tool` | app | — | the tool changed (`app.tool`: `select` / `measure`) |
| `measure` | app + viewer | viewer: measurement list | a measurement was added or removed |
| `history` | app | — | undo/redo stacks changed (`app.undoLabel()`, `app.canUndo()`) |
| `saveState` | app | `'idle' \| 'dirty' \| 'saving' \| 'saved' \| 'error'` | save state of the open project |
| `saved` | app | — | the open project was stored |
| `busy` | app | `{busy, label}` | a long task started or ended |
| `providers` | app | — | storage providers or their sign-in state changed |
| `auth` | app | `user \| null` | the server account changed |
| `needAuth` | app | — | a save needs the user to sign in |
| `prefs` | app | — | a user preference changed |
| `plugins` | app | — | a frontend plugin was loaded or failed |
| `registry` | app | `{kind, id, removed}` | an entry was added or removed through the API |
| `hover` | viewer | `{index, x, y}` | pointer over a drawn atom (−1: none) |
| `atomclick` | viewer | `{index, shiftKey, x, y}` | click on a drawn atom (−1: empty space) |
| `atomcontext` | viewer | `{index, x, y, clientX, clientY}` | right-click on a drawn atom |
| `boxselect` | viewer | `{indices, add}` | rectangle selection finished |
| `frame` | viewer | frame index | trajectory frame changed |
| `play` | viewer | boolean | playback started or stopped |
| `camera` | viewer | — | the camera moved |
| `model` | viewer | display model | the drawn model was rebuilt |
| `render` | viewer | — | a frame was rendered |
| `error` | viewer | `Error` | drawing failed or the WebGL context was lost |

`crystallume.registry.storage` (the storage manager) has its own `change` event (`registry.storage.on('change', fn)`),
emitted when a storage provider is added or removed.

Display indices (viewer events, `measure`) refer to drawn atoms, which include periodic images;
`app.viewer.model.src[d]` is the structure atom of drawn atom `d`.

---

## 5. Scene settings

`crystallume.set('post.ao.intensity', 1.4)` changes one value; `crystallume.patch({...})` deep-merges a
partial scene; looks are partial scenes. Ranges are those of the UI controls (values outside are
accepted but may look odd). Colours are `#rrggbb`. Angles are degrees, lengths Å.

| Path | Type | Default | Range / values |
|---|---|---|---|
| `look` | string \| null | `studio` | id of the last applied look (`null` after manual changes) |
| `lookBase` | string | — | the look the scene started from (kept when settings change) |
| `style.rep` | string | `ballstick` | a representation id (`ballstick`, `spacefill`, `spheres`, `licorice`, `wireframe`, `polyhedra`, plugins) |
| `style.radiusSource` | string | `atomic` | `atomic`, `covalent`, `vdw`, `uniform` |
| `style.atomScale` | number | 0.42 | 0.05 – 1.6 |
| `style.bondRadius` | number | 0.13 | 0.02 – 0.5 Å |
| `style.bondColor` | string | `split` | `split`, `uniform` |
| `style.bondUniformColor` | colour | `#9aa1ab` | |
| `style.bondMaterial` | string | `auto` | `auto`, `same`, or a material id |
| `style.colorScheme` | string | `jmol` | a colour scheme id (`modern`, `morandi`, `vivid`, `soft`, `greyscale`, `jmol`, `vesta`, `pastel`, `mono`, `index`, `height`, `coordination`, `property`, plugins) |
| `style.monoColor` | colour | `#c9ced6` | used by `mono` |
| `style.colorOverrides` | object | `{}` | `{ "O": "#ff0000" }` per element |
| `style.radiusOverrides` | object | `{}` | `{ "O": 0.9 }` base radius in Å per element (scaled by `atomScale`) |
| `style.property` | string \| null | null | per-atom property for the `property` scheme |
| `style.material` | string | `standard` | a material id (`standard`, `glossy`, `matte`, `metallic`, `glass`, `crystal`, `pearl`, `clay`, `phong`, `toon`, `poster`, `flat`, `glow`, `xray`, plugins) |
| `style.roughness`, `style.metalness` | number \| null | null | 0 – 1 (`null` = the material's own value) |
| `style.opacity` | number | 1 | 0.1 – 1 |
| `style.polyhedra.centers` | `'auto'` \| string[] | `auto` | element symbols at polyhedron centres |
| `style.polyhedra.opacity` | number | 0.55 | 0.1 – 1 |
| `style.polyhedra.edges` | boolean | true | |
| `style.polyhedra.edgeColor` | colour | `#22262c` | |
| `style.lineWidth` | number | 2.5 | 0.5 – 8 px (wireframe) |
| `style.quality` | string | `auto` | `auto`, `high`, `medium`, `low`, `draft` |
| `lighting.preset` | string | `studio` | a lighting preset id (`studio`, `headlight`, `three-point`, `softbox`, `dramatic`, `sunset`, `cool-lab`, `warm-studio`, `soft-studio`, `window`, `night`, `poster`, `flat`, `neon`, `ibl`, plugins) |
| `lighting.key` / `fill` / `rim` `.intensity` | number | 2.4 / 0.75 / 1.3 | 0 – 6 |
| `lighting.key` / `fill` / `rim` `.color` | colour | `#fff4e6` / `#dbe6ff` / `#ffffff` | |
| `lighting.key` / `fill` / `rim` `.azimuth` | number | −38 / 52 / 155 | −180 – 180 (0 = from the viewer, +90 = from the right) |
| `lighting.key` / `fill` / `rim` `.elevation` | number | 34 / 8 / 38 | −90 – 90 |
| `lighting.extra` | array | `[]` | extra lights `{intensity, color, azimuth, elevation}` |
| `lighting.hemi.intensity` | number | 0.35 | 0 – 3 |
| `lighting.hemi.sky`, `lighting.hemi.ground` | colour | `#ffffff`, `#6b7280` | |
| `lighting.ambient.intensity` | number | 0.05 | 0 – 3 |
| `lighting.ambient.color` | colour | `#ffffff` | |
| `lighting.env.enabled` | boolean | true | image-based lighting |
| `lighting.env.intensity` | number | 0.55 | 0 – 3 |
| `lighting.env.map` | string | `room` | an environment map id (`room`, `studio`, `sky`, `sunset`, `dark`, plugins) |
| `lighting.env.rotation` | number | 0 | −180 – 180 |
| `lighting.follow` | boolean | true | lights turn with the camera |
| `lighting.shadows.enabled` | boolean | false | |
| `lighting.shadows.softness` | number | 3 | 0 – 10 |
| `lighting.shadows.floor` | boolean | false | shadow-catching floor |
| `lighting.exposure` | number | 1 | 0.2 – 2.5 |
| `lighting.toneMapping` | string | `neutral` | `neutral`, `agx`, `aces`, `reinhard`, `cineon`, `linear`, `none` |
| `post.ao.enabled` | boolean | true | ambient occlusion |
| `post.ao.intensity` | number | 1 | 0 – 2.5 |
| `post.ao.radius` | number | 0.6 | 0.1 – 1.6 Å |
| `post.outline.enabled` | boolean | false | ink outlines |
| `post.outline.thickness` | number | 1.5 | 0.5 – 5 px |
| `post.outline.color` | colour | `#16181c` | |
| `post.outline.strength` | number | 1 | 0.1 – 1 |
| `post.outline.sensitivity` | number | 1 | 0.2 – 3 |
| `post.outline.creases` | boolean | true | also draw inner creases |
| `post.bloom.enabled` | boolean | false | |
| `post.bloom.strength` | number | 0.6 | 0 – 3 |
| `post.bloom.radius` | number | 0.4 | 0 – 1 |
| `post.bloom.threshold` | number | 0.8 | 0 – 1 |
| `post.dof.enabled` | boolean | false | depth of field |
| `post.dof.aperture` | number | 2 | 0.1 – 10 |
| `post.dof.maxblur` | number | 0.008 | 0.001 – 0.03 |
| `post.vignette.enabled` | boolean | false | |
| `post.vignette.darkness` | number | 1.1 | 0 – 2 |
| `post.vignette.offset` | number | 1 | 0.2 – 2 |
| `post.fog.enabled` | boolean | false | depth cueing |
| `post.fog.strength` | number | 0.5 | 0 – 1 |
| `display.background.mode` | string | `gradient` | `solid`, `gradient`, `radial`, `transparent` |
| `display.background.color1`, `color2` | colour | `#f7f8fa`, `#dde2e8` | |
| `display.cell.show` | boolean | true | unit cell lines |
| `display.cell.color` | colour | `#3b4048` | |
| `display.cell.width` | number | 1.6 | 0.5 – 5 px |
| `display.cell.which` | string | `unit` | `unit`, `supercell` (outline), `grid` (all cells) |
| `display.cell.labels` | boolean | true | a/b/c/o labels |
| `display.axes` | boolean | true | axis gizmo |
| `display.labels` | string | `none` | `none`, `element`, `index`, `both` |
| `display.labelSize` | number | 12 | 8 – 24 px |
| `display.supercell` | [int, int, int] | `[1, 1, 1]` | displayed repeats (1 – 30 each) |
| `display.wrap` | boolean | true | wrap atoms into the cell for display |
| `display.boundaryAtoms` | boolean | true | show atoms on cell faces/edges/corners |
| `display.completeBonds` | boolean | false | add bonded periodic images |
| `display.bonds.show` | boolean | true | |
| `display.bonds.tolerance` | number | 1.15 | 0.8 – 1.6 (× sum of covalent radii) |
| `display.bonds.smart` | boolean | true | skip unlikely pairs (e.g. cation–cation) |
| `display.bonds.pairOverrides` | object | `{}` | `{ "O-Sr": false, "Ti-O": true }` |
| `display.bonds.maxLength` | number | 4.5 | Å |
| `display.hiddenElements` | string[] | `[]` | element symbols not drawn |
| `display.projection` | string | `perspective` | `perspective`, `orthographic` |
| `display.fov` | number | 30 | 10 – 75 |
| `display.controls` | string | `orbit` | `orbit`, `trackball` |
| `display.turntable` | boolean | false | auto-rotate (not saved as an edit) |
| `display.orthoAxisViews` | boolean | true | axis views use an orthographic camera until the next rotation |
| `display.legend` | string | `auto` | `auto`, `always`, `none` |
| `display.scaleBar` | boolean | false | length scale bar in the view and in exports |
| `camera` | object \| null | null | `{position, up, target, zoom}` (set with `setCamera`) |

`crystallume.help('scene')` prints the current list with defaults and current values.

---

## 6. Embedding (`postMessage`)

```html
<iframe id="viewer" src="https://your-host/crystallume/"></iframe>
<script>
  const viewer = document.getElementById('viewer').contentWindow;
  addEventListener('message', (e) => {
    if (e.data?.type === 'crystallume:ready') viewer.postMessage({ type: 'crystallume:load', text: cif, name: 'NaCl.cif' }, '*');
    if (e.data?.type === 'crystallume:event') console.log(e.data.name, e.data.detail);
  });
</script>
```

The frame accepts messages from its parent window only and replies to the sender's origin with the
same `type` and `id`. To embed on another site, start the server with
`CRYSTALLUME_FRAME_ANCESTORS="'self' https://your-site"`.

| Message | Reply |
|---|---|
| `{type: 'crystallume:load', text \| structure, format?, name?, look?, newProject?}` — opens in a fresh project unless `newProject: false` | `{ok: true}` |
| `{type: 'crystallume:look', id}` / `{type: 'crystallume:set', path, value}` / `{type: 'crystallume:view', axis}` | `{ok: true}` |
| `{type: 'crystallume:screenshot', scale?, transparent?, id}` | `{dataURL}` |
| `{type: 'crystallume:call', method, args: [...], id}` | `{result}` or `{error}` |
| `{type: 'crystallume:get', what: 'scene' \| 'summary' \| 'selection' \| 'camera', id}` | `{result}` |
| `{type: 'crystallume:subscribe', events: ['selection', ...]}` / `'crystallume:unsubscribe'` | `{ok, events}`, then `{type: 'crystallume:event', name, detail}` per event |

`crystallume:call` methods: `setRepresentation`, `setLighting`, `applyLook`, `patch`, `set`, `sample`,
`setCamera`, `getCamera`, `fit`, `resetView`, `select`, `frame`, `command`, `exportText`. Scene paths
or keys containing `__proto__`, `constructor` or `prototype` are refused. Event details are plain
data: `selection` → indices, `structure` → summary, `camera` → camera state (at most every 100 ms),
`scene`/`project`/`model`/`render` → `null` (ask with `crystallume:get`). Once it has started and shows its
first structure, the frame posts `{type: 'crystallume:ready', version}`; a load sent then stays on screen.

Pages written for the former name keep working: `'atomscope:*'` messages are accepted (replies repeat
that `type`), the frame also posts `{type: 'atomscope:ready', version}`, and a parent that subscribed
with `'atomscope:subscribe'` receives its events as `{type: 'atomscope:event', name, detail}`.

---

## 7. Python client and CLI

`crystallume.Client` has a method for every REST endpoint (the test suite checks this):
`health`, `info`, `elements`, `plugins`, project CRUD, `formats`, `upload_structure`, `parse_text`,
`export_structure`, `convert`, `prototypes`, `molecules`, `build_crystal`, `build_cluster`,
`supercell`, `molecule`, `custom_builders`, `build_custom`, `bonds`, `summary`, `coordination`, `rdf`,
`custom_analyses`, `analysis`. The interactive OpenAPI docs are at `/docs` on a running server.

```bash
crystallume convert t.hello out.xyz --plugins ./plugins
crystallume build custom hello-chain --param n=12 --param element=Ag -o chain.xyz --plugins ./plugins
crystallume analyze hello-com chain.xyz --plugins ./plugins       # also: summary, coordination, rdf
crystallume formats --plugins ./plugins
crystallume plugins new my-plugin --dir ./plugins
```

On these commands `--plugins` takes one directory per flag and may stand anywhere on the line; repeat
it (`--plugins ./a --plugins ./b`) or join directories with the path separator (`./a:./b`, `;` on
Windows) to load several. Without it, `CRYSTALLUME_PLUGIN_DIRS` is used.

The example plugin in `examples/plugins/hello_plugin` uses every Python extension point and ships
a frontend module (`static/hello.js`).
