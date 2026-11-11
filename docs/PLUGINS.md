# Scripting and extending Facet

Facet is built from **registries**: lists of file formats, builders, representations, materials,
colour schemes, lighting presets, environment maps, looks, samples, analyses, storage backends, panels and
commands. A **plugin** adds entries to them. There are two kinds of plugin, and one plugin can be both:

| Kind | Runs in | Can add | Loaded from |
|---|---|---|---|
| **Python plugin** | the server and the command line | file readers and writers, structure builders, analyses, REST routes, presets for the app, static files | `--plugins DIR`, `FACET_PLUGIN_DIRS`, entry points |
| **JavaScript plugin** | the browser | anything in the app (every registry in §3) | a Python plugin's `add_frontend_module`, `plugins.json`, `?plugin=`, `facet.plugins.load()` |

## Your first plugin

```bash
facet plugins new my-plugin --dir ./plugins      # writes plugin.py and static/my-plugin.js
facet plugins --plugins ./plugins                # check that it loads (status ok or ERROR)
facet serve --plugins ./plugins                  # open http://127.0.0.1:8765
facet analyze my-plugin-count POSCAR --plugins ./plugins
```

The new plugin adds an analysis (shown under Analyses in the Structure panel), a look and a browser module.
Edit `plugins/my-plugin/plugin.py` and restart the server to see your changes.
[`examples/plugins/hello_plugin`](../examples/plugins/hello_plugin) uses every Python extension point.

**Look things up as you go.** In the app, **Help › Scripting & API** lists every registry entry, command,
scene setting and event (click one to copy a call), and shows each plugin's status. In the browser console,
`facet.help()` prints the same lists as tables.

**Contents:** [1. Python plugins](#1-python-plugins) · [2. JavaScript plugins](#2-javascript-plugins) ·
[3. Registries](#3-registries-and-entry-shapes) · [4. JavaScript API](#4-the-javascript-api-windowfacet) ·
[5. Scene settings](#5-scene-settings) · [6. Embedding](#6-embedding-postmessage) ·
[7. Python API, REST client and CLI](#7-python-api-rest-client-and-cli)

---

## 1. Python plugins

A Python plugin is a module with a `register(ctx)` function and, optionally, a `PLUGIN` dict:

```python
# plugins/my_plugin/plugin.py
from facet import PluginContext, Structure

PLUGIN = {"name": "my-plugin", "version": "0.1.0", "description": "What it adds."}

def register(ctx: PluginContext) -> None:
    ctx.register_reader("lammps-dump", read_dump, extensions=[".lammpstrj"])
    ctx.register_analysis("my-plugin-count", count_atoms, {"label": "Atom count", "params": [...]})
    ctx.add_preset("look", {"id": "dusk", "name": "Dusk", "scene": {...}})
    ctx.add_frontend_module("my-plugin.js")      # served from plugins/my-plugin/static/
```

### How plugins are found and loaded

1. **Found.** Facet loads every sub-folder of a plugin folder that contains `plugin.py`, and every
   top-level `*.py` file (except names starting with `_` or `.`). An installed package can declare an
   entry point instead (a module or a `register` function):
   ```toml
   [project.entry-points."facet.plugins"]
   myplugin = "my_package.facet_plugin"
   ```
2. **Registered.** `register(ctx)` runs once. Readers and writers join the global `facet.io`
   registry; builders, analyses, routes, presets and frontend modules are kept with the plugin.
3. **Failed?** If importing the plugin or `register` raises an error, the plugin is listed with
   `status: "error"` and the message (in `facet plugins`, `GET /api/v1/plugins` and one notice in the
   app), and its readers and writers are removed again. A broken plugin never stops the server.
4. **Used.**
   - The server runs builders at `POST /api/v1/build/custom/{name}` and analyses at
     `POST /api/v1/analysis/custom/{name}`.
   - Formats work through `/api/v1/io/*`, routers live under `/api/v1/ext`, and static files are served at
     `/plugins/<name>/`.
   - `/api/v1/info` lists everything for the app, where the plugin's formats, builders and analyses appear
     by themselves.
   - The CLI loads the same plugins for `convert`, `info`, `formats`, `build` and `analyze`.
   - In Python: `facet.load_plugins(["./plugins"])`.

Plugins written for Crystallume or AtomScope keep working: the entry-point groups `crystallume.plugins` and
`atomscope.plugins` are still searched (a package listed in several groups loads once), and `import crystallume`
or `import atomscope` gives the matching `facet` module.

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

Builder and analysis names match `[A-Za-z0-9][A-Za-z0-9_.-]*`. Frontend URLs are relative
(`plugins/<name>/x.js`), so they also work when the app is served under a sub-path (`--root-path`).

### Parameters of builders and analyses

The app draws a form from `params`, and the CLI converts `--param KEY=VALUE` with it.

| Field | Meaning |
|---|---|
| `name` (**required**) | keyword argument name |
| `type` | `int`, `float`, `string`, `element` (symbol input with completion), `bool` (switch), `select` |
| `default` | initial value (int/float default to `min` or 0, element to `C`, select to the first option) |
| `label`, `description` | field label and tooltip |
| `min`, `max`, `step` | numeric limits (checked before running) |
| `options` | for `select`: `["a", "b"]`, `[["value", "Label"], …]` or `[{value, label}]`; in JavaScript also a function of the structure |

### Presets

The app receives presets as they are (plus `plugin`); `/api/v1/info` lists them under
`presets.lighting`, `presets.colorSchemes` and `presets.styles` (looks).

```python
ctx.add_preset("lighting", {          # any omitted part falls back to the app's defaults
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

A **look** is a partial scene (§5). Applying one first resets the settings a look owns (lighting, effects,
material, colour scheme, background, cell colour) to their defaults, so a look always gives the same
picture. The representation, sizes, bonds and camera stay as they are unless the look sets them.

---

## 2. JavaScript plugins

A JavaScript plugin is an ES module whose default export (or `activate` export) receives the API:

```js
// my-plugin.js
export default async function activate(api) {
  const off = api.registerLook({ id: 'lab-night', name: 'Lab night', scene: { post: { outline: { enabled: true } } } });
  api.registerCommand({ id: 'my.hello', title: 'Say hello', run: (app) => api.toast(`${app.structure?.length ?? 0} atoms`) });
}
```

### How plugins are loaded

1. **Loaded.** At start-up the app loads, in this order:
   - the frontend modules of server plugins (`plugins[].frontend` in `/api/v1/info`);
   - every entry of `plugins.json` next to `index.html`;
   - without a server only, each same-origin `?plugin=<url>` in the address.

   Any script can load one later with `await facet.plugins.load(url, { name })`.
2. **Activated.** The module is imported (relative URLs resolve against the page) and its default export,
   or `activate`, is called with the API object (`window.facet`). It may be `async`. Each URL loads
   only once; loading it again returns the same result.
3. **Registered.** Every `api.register*` call checks the entry and throws if a required field is missing
   (for example `samples.register: missing build()`).
   - Replacing an entry with the same id warns in the console; pass `{ replace: true }` as the second
     argument to do it on purpose.
   - The call updates the command palette and panels, emits a `registry` event, and returns a function
     that removes the entry. If the entry replaced another one (such as a built-in look), removing it
     brings the old one back.
   - Entries registered during activation are tagged with `plugin: <name>`.
4. **Failed?** If the import or `activate` throws, its registrations are undone. The plugin is listed with
   `status: 'error'` in `facet.plugins.list()` and in Help › Scripting & API › Server, and the app
   shows one notice at start-up.

### `plugins.json`

```json
[
  { "name": "hello", "url": "plugins/hello/hello.js" },
  "plugins/other/other.js"
]
```

This file sits next to `index.html` on the same site; ship `[]` when it is unused. URLs resolve against the
file, and `"enabled": false` skips an entry. `python scripts/build_artifact.py --plugin DIR` copies a
plugin's `static/` folder into the bundle and writes this file for you. Without a server, only the
JavaScript part of a plugin runs.

### Commands

The command palette follows the registries: `rep.<id>`, `look.<id>`, `light.<id>`, `color.<id>`,
`sample.<id>` and `export.<format>` exist for every entry and disappear with it. The first nine
representations get the keys `1`–`9`. A command's `run(app, ...args)` always receives the app first.

The menu bar (File, Edit, View, Modify, Build, Tools, Window, Help; on phones the ⋯ menu) is built from
the same commands each time a menu opens, so a command you register is in a menu without further work.
Its `category` decides where:

| `category` | Menu |
|---|---|
| `File`, `Export` | File, File › Export |
| `Edit` | Edit |
| `View`, `Trajectory` | View, View › Animation |
| `Cell` | Modify |
| `Surface`, `Build` | Build › Surfaces, Build |
| `Tools`, `Window`, `Help` | the menu of that name |
| anything else (the default `Plugin` too) | Tools › *category* |

Looks, representations, lighting presets and colour schemes are listed under View, samples under
Build › Samples and file formats under File › Export › Structure File, plugins' entries included. A
command that cannot run (`when` is false) is greyed, with `whyNot` as its tooltip; `hidden: true` keeps a
command out of the menus and the palette.

---

## 3. Registries and entry shapes

Required fields are **bold**. `api.registry.<name>` exposes each registry with `get(id)`, `list()` and
`register(entry, opts)`; `register` checks entries just like the `api.register*` helpers.

| Helper | Registry | Entry |
|---|---|---|
| `registerFormat(f)` | `formats` | **`id`**, `name`, `extensions: ['xyz']`, `filenames: ['POSCAR']`, `mime`, `description`, **`read(text, filename) → Structure`** and/or **`write(structure) → string`** (either may return a Promise; set `server: true` for formats handled by the server) |
| `registerStyle(s)` | `styles` (representations) | **`id`**, `name`, `description`, `icon` (inline SVG), `defaults` (style settings applied with it), `bonds: bool`, `inPlaceRadii`, **`build(ctx) → THREE.Object3D`** |
| `registerMaterial(m)` | `materials` | **`id`**, `name`, `description`, `swatch`, **`create(params, { THREE }) → THREE.Material`**, `update?(material, params)`, `transparent`, `prefersDark`; params = `{roughness, metalness, opacity, envIntensity}` |
| `registerColorScheme(c)` | `colorSchemes` | **`id`**, `name`, `description`, `group: 'Element' \| 'Per atom'`, **`colorFor(symbol, index, ctx) → '#rrggbb'`**, `legend?(ctx) → {colormap, min, max, label}` or `{kind: 'categories', label, items: [{label, color}]}`, `dependsOn: ['display.…']` (scene paths whose values recolour the atoms when they change); `ctx` also holds the read-only `structure`, `scene` and `extras` (values the app adds with `app.registerColorExtra(key, app => value)`) |
| `registerLightingPreset(p)` | `lighting` | **`id`**, `name`, `description`, `swatch`, `key`/`fill`/`rim` `{intensity, color, azimuth, elevation}`, `hemi {intensity, sky, ground}`, `ambient {intensity, color}`, `env {enabled, intensity, map}`, `extra: [light, …]` (omitted parts get defaults) |
| `registerEnvironmentMap(m)` | `environmentMaps` | **`id`**, `name`, `description`, **`build() → THREE.Scene`** (rendered into a PMREM environment) |
| `registerLook(l)` | `looks` | **`id`**, `name`, `description`, `swatch` (CSS background), `ball` (optional CSS background of a sphere drawn in the middle of the card; `swatch` is then its backdrop), **`scene`** (partial scene, §5), `backgroundDark`, `cellDark`, `hidden` |
| `registerSample(s)` | `samples` | **`id`**, `name`, `category` (default `Plugins`), `tags`, **`build() → Structure`**, `look`, `rep`, `scene` |
| `registerAnalysis(a)` | `analyses` | **`id`**, `name`, `description`, `params` (§1), **`run(structure, params, ctx) → result \| Promise`**, `render?(result, el, ctx)`, `auto: bool \| (structure) => bool`, `dependsOn: ['display.bonds']` |
| `registerCommand(c)` | `commands` | **`id`**, `title`, `category` (default `Plugin`), `keywords`, `key` (`'g'`, `'mod+g'` or an array), `hidden`, **`run(app, ...args)`**, `when?(app)`, `whyNot?(app)` (the sentence shown when `when` is false) |
| `registerStorage(p)` | `storage` | **`id`**, `label`, `icon`, `description`, `where`, `init()`, `available()`, **`list(q?)`**, **`get(id)`**, **`save(project, {force}?)`**, `remove(id)` — `save` rejects with `err.code = 'conflict' \| 'auth' \| 'offline'` |
| `registerPanel(p)` | `panels.left` | **`id`**, `title`, `icon` (icon name), `tip`, **`render(app, el, shell)`**, `headActions?(app, shell) → [Node]`, `refreshOn: ['project', 'structure', 'selection', 'measure', …]`, `signature?(app) → string` (skip re-renders while it is unchanged) |
| `registerInspectorTab(t)` | `panels.inspector` | **`id`**, `title`, `icon`, `tip`, **`render(app, el, shell)`** |
| `registerPanelSection(panelId, s)` | sections of the Surface panel (`'surface'`) and the Structure panel (`'structure'`) | **`id`**, **`title`**, `order` (100), `slot` (Structure panel: `'cell'` after the summary or `'transform'` after the selection), `defaultOpen` (true), **`render(app, el, shell, ctx)`**, `available?(app) → true \| reason`, `emptyActions?(app) → [Node]`, `signature?(app) → string`, `refreshOn` (`['project', 'structure']`), `badge?(app) → string` |
| `registerSelectionAction(a)` | selection-card buttons and atom-menu items | **`id`**, **`label`**, `short`, `icon`, `tip` (strings or `(app, sel) → string`), `kbd`, `order` (100), `card` (true), `menu` (`true`: atom menu, `'blank'`: menu on empty space, `'both'`, `false`), `when?(app, sel)`, `enabled?(app, sel)`, **`run(app, sel, ctx)`** and/or `items?(app, sel) → [{id, label, …}]`, `rows?(app, sel) → [{label, value}]` |
| `registerAtomInfo(fn, {order})` | lines of the atom hover card and the selection card | `fn(app, index, { where: 'hover' \| 'card' }) → [{label, value}] \| null` |

Two registries are read-only: `prototypes` and `clusters` (the crystal and cluster builders).

**Panel sections** are collapsible (`details.sec`) and each is drawn again on its own when an event in its `refreshOn`
changes its `signature`. While `available(app)` returns a reason, the section shows only that sentence and the
buttons of `emptyActions`; `ui/sections.js` exports `requireCell`, `requireVacuumGap`, `requireNoPreview` and
`requireBootTask` for this. `openSection(panelId, id, { focus, tab })` (or `shell.openLeft(panelId, { section, focus, tab })`)
opens a panel at a section. **Selection actions** show on the selection card in `order` (up to 7 buttons, 5 on touch
and narrow screens, the rest under More) and in the atom menu after *Measure from here*; there `sel` is the whole
selection when the clicked atom is part of it, else that atom, and `ctx = {source, atom, display}`.

**A representation's `build(ctx)`** receives
`ctx = { model, colors, radii, settings, atomMaterial, bondMaterial, segments, showBonds, resolution, THREE, helpers }`:

- `colors` (linear RGB) and `radii` are `Float32Array`s; `settings` is `scene.style`.
- `model = { n, symbols, positions, src, img, bonds: {pairs, lengths, count}, cell, supercell, pbc }`, where
  `positions` is a `Float32Array` of xyz, `src` maps each drawn atom to its structure atom and `img` holds
  periodic image offsets.
- `helpers` (also `api.render`) offers `buildAtoms`, `buildBonds`, `buildLines`, `buildPolyhedra`,
  `atomRadius` and `segmentsFor`; `api.render` adds `createMaterial`, `COLORMAPS` and `THREE`.

**An analysis** receives `ctx = { app, scene, bondOptions: {tolerance, disabledPairs}, ui }`. `ui` offers
`h`, `lineChart`, `kvTable` and `renderResult` for building a `render` function.
- **Without `render`**, results are shown automatically: numbers and short lists as a table, long numeric
  arrays as a line chart (two equally long arrays become x and y), anything else as JSON.
- **Caching:** results are cached per structure version, parameters and the scene values in `dependsOn`, so
  redrawing the panel never recomputes them.
- **Server analyses:** server plugin analyses appear here too and run on the server. The built-in analyses are
  `coordination` and `rdf`.

---

## 4. The JavaScript API (`window.facet`)

`window.crystallume` and `window.atomscope` (the former names) are the same object.

| Member | Description |
|---|---|
| `version`, `app`, `viewer`, `shell`, `Structure`, `THREE`, `render` | internals for advanced plugins |
| `structure`, `scene`, `project`, `selection` | current state (getters) |
| `load(input, {name, format, look, newProject})`, `loadURL(url)`, `sample(id)`, `openProject(doc)` | show structures (`load` returns a Promise for formats only the server reads; `openProject` opens a project document as a new project with a new id, like opening the file, so saving it never replaces a stored project) |
| `build.crystal(proto, params)`, `build.cluster(kind, params)`, `build.molecule(id)`, `build.prototypes()`, `build.clusters()`, `build.molecules()` | builders |
| `build.surface(bulk, {miller, vacuum, layers, termination, supercell, fixBottom, …})` | the slab cleaved from a crystal, as a new structure (nothing is shown); `vacuum` is required: the total gap in Å |
| `surface.analyze({miller, …}, s?)`, `surface.terminations({miller, …}, s?)`, `surface.cleave({miller, vacuum, …})`, `surface.layers({tolerance}, s?)`, `surface.extent(s?)` | the surface cell, layers and terminations of a plane; cleave the active structure and add the slab to the project; the atomic layers and the vacuum gap of a slab |
| `edit.setVacuum(vacuum, {position})`, `edit.centerSlab()`, `edit.flipSlab()`, `edit.fixLayers(n, {where, axes})`, `edit.freeAtoms(indices?)` | slab tools on the active structure, one undo step each |
| `analysis.bonds(s?)`, `analysis.neighbors(s?)`, `analysis.summary(s?)`, `analysis.coordination(s?)`, `analysis.rdf(s?, {rmax, nbins, pair})` | direct analysis functions |
| `analyze(id, params?, s?) → Promise` | run any registered analysis (built-in, JS plugin or server plugin) |
| `set(path, value)`, `get(path)`, `patch(partial)` | scene settings (§5); paths with `__proto__`, `constructor` or `prototype` are refused |
| `applyLook(id)`, `setRepresentation(id)`, `setLighting(id)` | one-click presets |
| `view(axis)`, `resetView()`, `fit()`, `orbit(dAz°, dEl°)`, `rotate(axis, deg°)`, `pan(dx, dy)`, `zoom(factor)`, `getCamera()`, `setCamera(c)` | camera (`rotate` turns the model about a screen axis, `'x'` right, `'y'` up or `'z'` towards the viewer, as the arrow keys do) |
| `atomsInRect(x0, y0, x1, y1)`, `atomsInPolygon([[x, y], …])` | source indices of the atoms drawn inside a client-space rectangle or polygon (box and lasso selection) |
| `select(indices, {mode})`, `clearSelection()`, `selectAll()`, `selectSameElement(symbols?)`, `selectNeighbors(indices?, {add})`, `selectFragment(indices?, {add})` | selection (`mode`: `'replace'` (default), `'add'`, `'toggle'` or `'remove'`; the older `{add: true}` toggles) |
| `highlight(name, indices, {color, grow, opacity, strength, contrast, export})` | a named halo around atoms (structure indices; `null` clears it): `color` is a CSS colour, `{light, dark}` (chosen by the background) or `'var(--token)'`; `export` is `'never'`, `'marker'` (default: in PNG images only with markers) or `'always'`. `app.viewer.overlays.add(layer)` draws other overlays (render/overlays.js) |
| `measure(type, displayIndices)`, `frame(i)`, `play(on)` | measurements and trajectories |
| `screenshot({scale, transparent, selection, markers}) → Blob`, `exportText(format) → string \| Promise`, `exportGLB()`, `save(provider)` | output (`selection`: keep the selection halo, default on; `markers`: add site markers, fixed-atom halos and other marker overlays, default off; the hover halo is never drawn) |
| `projects.providers()`, `projects.list(provider)`, `projects.open(provider, id)` | storage |
| `sceneScript()` | the current scene as `facet.patch({...})` + `setCamera(...)` (palette: *Copy current scene as script*) |
| `on(event, fn) → off()`, `toast(msg, {type})`, `command(id, ...args)` | events, notices, commands (`command` throws an Error saying why when the command's `when` guard says it cannot run now, e.g. “Load a structure first.”) |
| `registry.*`, `registerFormat`, `registerStyle`, `registerMaterial`, `registerColorScheme`, `registerLightingPreset`, `registerEnvironmentMap`, `registerLook`, `registerSample`, `registerAnalysis`, `registerCommand`, `registerStorage`, `registerPanel`, `registerInspectorTab`, `registerPanelSection`, `registerSelectionAction`, `registerAtomInfo` | §3 |
| `plugins.load(url, {name})`, `plugins.list()` | plugin loading and status (`active` / `error`, server plugins included) |
| `reference()`, `help(topic?)` | everything above as data / console tables (`help('looks')`, `help('scene')`, `help('events')`) |

```js
const s = facet.build.crystal('perovskite', { elements: ['Ba', 'Ti', 'O'], a: 4.01, repeat: [3, 3, 3] });
facet.load(s);
facet.applyLook('poster');
facet.set('post.outline.enabled', true);              // any scene setting, by its path
facet.view('c');
const png = await facet.screenshot({ scale: 3, transparent: true });
const g = await facet.analyze('rdf', { rmax: 6 });
```

The palette command **Copy current scene as script** copies the scene as a `facet.patch({...})` call.

### Events (`facet.on(name, fn)`)

| Event | Source | Payload | When |
|---|---|---|---|
| `project` | app | — | the open project changed: opened, renamed, structures added or removed |
| `structure` | app | — | the active structure was switched or edited |
| `selection` | app + viewer | viewer: source indices | the selection changed |
| `scene` | app | — | scene settings changed |
| `tool` | app | — | the tool changed (`app.tool`: `select` / `measure`) |
| `measure` | app + viewer | viewer: measurement list | a measurement was added or removed |
| `history` | app | — | undo/redo steps changed (`app.undoLabel()`, `app.canUndo()`, `app.history`) |
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
| `atomclick` | viewer | `{index, mode, shiftKey, x, y}` | click on a drawn atom (−1: empty space); `mode` `'replace'`, `'add'` (Shift) or `'toggle'` (Ctrl/⌘), `shiftKey` true for the last two |
| `atomdblclick` | viewer | `{index, mode, altKey, x, y}` | double-click on a drawn atom (the app selects its bonded fragment; with Alt, every atom of its element) |
| `atomcontext` | viewer | `{index, x, y, clientX, clientY}` | right-click on a drawn atom |
| `boxselect` | viewer | `{indices, mode, add, shape}` | rectangle (drag) or lasso (Q+drag) selection finished; `shape` `'rect'` or `'lasso'`, `add` = `mode` is not `'replace'` |
| `frame` | viewer | frame index | trajectory frame changed |
| `play` | viewer | boolean | playback started or stopped |
| `camera` | viewer | — | the camera moved |
| `model` | viewer | display model | the drawn model was rebuilt |
| `render` | viewer | — | a frame was rendered |
| `error` | viewer | `Error` | drawing failed or the WebGL context was lost |

Undo steps are kept in `app.history` (`length`, `redoLength`, `bytes`, `top()`, `has(step)`): up to 80 steps within
64 MiB (24 MiB on narrow screens and devices with 4 GB of memory or less). `app.undoStack` and `app.redoStack`
are deprecated read-only copies of its steps.

The storage manager, `facet.registry.storage`, has its own `change` event
(`registry.storage.on('change', fn)`) for providers being added or removed.

Viewer events and `measure` use **display indices**. They count drawn atoms, including periodic images;
`app.viewer.model.src[d]` is the structure atom of drawn atom `d`.

---

## 5. Scene settings

`facet.set('post.ao.intensity', 1.4)` changes one value, and `facet.patch({...})` merges a partial
scene; a look is a partial scene too. The ranges are those of the app's controls (other values are accepted
but may look odd). Colours are `#rrggbb`, angles are in degrees and lengths in Å.

| Path | Type | Default | Range / values |
|---|---|---|---|
| `look` | string \| null | `poster` | id of the last applied look (`null` after manual changes). New projects start in the Poster look; a saved project keeps its own |
| `lookBase` | string | — | the look the scene started from (kept when settings change) |
| `style.rep` | string | `ballstick` | a representation id (`ballstick`, `spacefill`, `spheres`, `licorice`, `wireframe`, `polyhedra`, plugins) |
| `style.radiusSource` | string | `atomic` | `atomic`, `covalent`, `vdw`, `uniform` |
| `style.atomScale` | number | 0.42 | 0.05 – 1.6 |
| `style.bondRadius` | number | 0.13 | 0.02 – 0.5 Å |
| `style.bondColor` | string | `split` | `split`, `uniform` |
| `style.bondUniformColor` | colour | `#9aa1ab` | |
| `style.bondMaterial` | string | `auto` | `auto`, `same`, or a material id |
| `style.colorScheme` | string | `jmol` | a colour scheme id (`modern`, `morandi`, `vivid`, `soft`, `greyscale`, `jmol`, `vesta`, `ms`, `pastel`, `mono`, `index`, `height`, `coordination`, `property`, plugins) |
| `style.monoColor` | colour | `#c9ced6` | used by `mono` |
| `style.colorOverrides` | object | `{}` | `{ "O": "#ff0000" }` per element |
| `style.radiusOverrides` | object | `{}` | `{ "O": 0.9 }` base radius in Å per element (scaled by `atomScale`) |
| `style.property` | string \| null | null | per-atom property for the `property` scheme |
| `style.material` | string | `standard` | a material id (`standard`, `glossy`, `matte`, `metallic`, `glass`, `crystal`, `pearl`, `clay`, `phong`, `ms`, `toon`, `poster`, `flat`, `glow`, `xray`, plugins) |
| `style.roughness`, `style.metalness` | number \| null | null | 0 – 1 (`null` = the material's own value) |
| `style.opacity` | number | 1 | 0.1 – 1 |
| `style.polyhedra.centers` | `'auto'` \| string[] | `auto` | element symbols at polyhedron centres |
| `style.polyhedra.opacity` | number | 0.55 | 0.1 – 1 |
| `style.polyhedra.edges` | boolean | true | |
| `style.polyhedra.edgeColor` | colour | `#22262c` | |
| `style.lineWidth` | number | 2.5 | 0.5 – 8 px (wireframe) |
| `style.quality` | string | `auto` | `auto`, `high`, `medium`, `low`, `draft` |
| `lighting.preset` | string | `studio` | a lighting preset id (`studio`, `ms`, `headlight`, `three-point`, `softbox`, `dramatic`, `sunset`, `cool-lab`, `warm-studio`, `soft-studio`, `window`, `night`, `poster`, `flat`, `neon`, `ibl`, plugins) |
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
| `post.dropShadow.enabled` | boolean | false | every atom and bond casts a soft shadow on the parts and background behind it |
| `post.dropShadow.distance` | number | 0.3 | 0 – 1.5 Å, how far the shadow falls |
| `post.dropShadow.softness` | number | 0.25 | 0 – 1 Å, blur of the shadow edge |
| `post.dropShadow.opacity` | number | 0.35 | 0 – 1 |
| `post.dropShadow.angle` | number | -55 | −180 – 180°, where the shadow falls (0 = right, −90 = down) |
| `post.dropShadow.color` | colour | `#1c1a17` | |
| `post.paper.enabled` | boolean | false | paper grain over the whole picture |
| `post.paper.strength` | number | 0.6 | 0 – 2 |
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

`facet.help('scene')` prints this list with the defaults and current values.

---

## 6. Embedding (`postMessage`)

To show Facet inside another page, put it in an `<iframe>` and talk to it with `postMessage`:

```html
<iframe id="viewer" src="https://your-host/facet/"></iframe>
<script>
  const viewer = document.getElementById('viewer').contentWindow;
  addEventListener('message', (e) => {
    if (e.data?.type === 'facet:ready') viewer.postMessage({ type: 'facet:load', text: cif, name: 'NaCl.cif' }, '*');
    if (e.data?.type === 'facet:event') console.log(e.data.name, e.data.detail);
  });
</script>
```

The frame accepts messages from its parent window only, and replies to the sender's origin with the same
`type` and `id`. To embed it on another site, start the server with
`FACET_FRAME_ANCESTORS="'self' https://your-site"`.

| Message | Reply |
|---|---|
| `{type: 'facet:load', text \| structure, format?, name?, look?, newProject?}` — opens in a fresh project unless `newProject: false` | `{ok: true}` |
| `{type: 'facet:look', id}` / `{type: 'facet:set', path, value}` / `{type: 'facet:view', axis}` | `{ok: true}` |
| `{type: 'facet:screenshot', scale?, transparent?, id}` | `{dataURL}` |
| `{type: 'facet:call', method, args: [...], id}` | `{result}` or `{error}` |
| `{type: 'facet:get', what: 'scene' \| 'summary' \| 'selection' \| 'camera', id}` | `{result}` |
| `{type: 'facet:subscribe', events: ['selection', ...]}` / `'facet:unsubscribe'` | `{ok, events}`, then `{type: 'facet:event', name, detail}` per event |

- **`facet:call`** accepts these methods: `setRepresentation`, `setLighting`, `applyLook`, `patch`,
  `set`, `sample`, `setCamera`, `getCamera`, `fit`, `resetView`, `select`, `frame`, `command`, `exportText`.
  Scene paths or keys containing `__proto__`, `constructor` or `prototype` are refused.
- **Event details** are plain data: `selection` → indices, `structure` → a summary, `camera` → the camera
  state (at most every 100 ms), and `scene`, `project`, `model` and `render` → `null` (ask with
  `facet:get`).
- **Ready message:** once the frame has started and shows its first structure, it posts
  `{type: 'facet:ready', version}`. A `load` sent after that stays on screen.
- **Older pages:** pages written for Crystallume or AtomScope keep working. `'crystallume:*'` and `'atomscope:*'`
  messages are accepted (replies repeat that `type`), the frame also posts `{type: 'crystallume:ready', version}`
  and `{type: 'atomscope:ready', version}`, and a parent that subscribed with `'crystallume:subscribe'` or
  `'atomscope:subscribe'` receives its events as `'crystallume:event'` or `'atomscope:event'`.

---

## 7. Python API, REST client and CLI

### Python API

```python
import facet as cl
from facet import build, analysis

s = cl.read("POSCAR")                       # format detected automatically; multi-frame files fill s.frames
s = cl.read("traj.xyz", index=-1)           # only the last frame
cl.write("out.cif", s)                      # format from the extension
text = cl.to_text(s, "extxyz")

cu = build.crystal("fcc", "Cu", a=3.61).repeat(3, 3, 3)
sto = build.crystal("perovskite", ["Sr", "Ti", "O"])
au55 = build.cluster("icosahedron", "Au", 3)          # Mackay icosahedron: 3 shells, 55 atoms
caf = build.molecule("caffeine")

# surfaces: look at a plane first, then cleave; vacuum is the total gap in Å and has no default
for t in build.terminations(sto, (0, 0, 1)):          # best first: non-polar, fewest broken bonds
    print(t["index"], t["label"], t["brokenBonds"], t["polar"])      # 0 TiO2 5 False / 1 SrO 5 False
slab = build.surface(sto, (0, 0, 1), vacuum=15, layers=7, termination="TiO2", symmetric=True,
                     supercell=(2, 2), fix_middle=3)  # 'SrTiO3(001) p(2×2) TiO2-term 7L'
build.set_vacuum(slab, 20)                            # in place; also center_slab, flip_slab,
build.fix_layers(slab, 2)                             # fix_layers, free_atoms, slab_layers, slab_extent
bulk_ref = build.oriented_cell(sto, (0, 0, 1))        # the same orientation without vacuum

bonds = analysis.neighbors(cu)              # [(i, j, distance, (ox, oy, oz)), ...], periodic-aware
cn = analysis.coordination_numbers(cu)
r, g = analysis.rdf(cu, rmax=6.0, nbins=120)
print(analysis.summary(sto))                # formula, volume, density, cell parameters, …

cl.view(sto)                                # start a local server in the background and open the browser

plugins = cl.load_plugins(["./plugins"])    # read and write now handle the plugins' formats too
chain = plugins.builders["hello-chain"].func(n=12)
```

Useful `Structure` methods: `to_dict`/`from_dict`, `copy`, `formula`, `composition`, `repeat`, `wrap`,
`center(vacuum=)`, `translate`, `frac_positions`, `volume`, `density`, `get_distance(i, j, mic=)`,
`get_angle`, `get_dihedral`, `append`, `extend`, `delete`, `select(elements=)`, `bounding_box`, `get_frame`,
`iter_frames`.

File formats:
- `xyz`/`extxyz`: multiple frames, `Lattice`, `Properties`.
- `poscar`: VASP 4 and 5, Direct or Cartesian, selective dynamics, negative scale factors.
- `cif`: symmetry operators are applied when reading; written as P1.
- `pdb`: `CRYST1`, `MODEL` frames.
- `xsd`: Materials Studio 3D atomistic documents (crystals, slabs, molecules), with atom names and fixed atoms;
  written as P1 in Materials Studio's cell orientation ([SCHEMA.md](SCHEMA.md#structure-files-of-other-programs)).
- `json`: the Facet structure format ([SCHEMA.md](SCHEMA.md)).

Plugins can add more formats.

### REST client

`facet.Client` is a REST client that needs only the standard library. It has a method for every
endpoint (the test suite checks this):

```python
client = cl.Client("http://127.0.0.1:8765")
client.login("alice", "secret")                     # cloud mode
p = client.create_project("Copper", structures=[cu])
client.coordination(cu)["average"]
client.analysis("hello-com", cu)                    # a plugin analysis, run on the server
client.convert("in.cif", "poscar", "out.vasp")      # converted on the server, plugin formats included
```

The methods are `health`, `info`, `elements`, `plugins`, the project methods, `formats`,
`upload_structure`, `parse_text`, `export_structure`, `convert`, `prototypes`, `molecules`,
`build_crystal`, `build_cluster`, `supercell`, `surface`, `set_vacuum`, `molecule`, `custom_builders`,
`build_custom`, `bonds`, `summary`, `coordination`, `rdf`, `terminations`, `custom_analyses` and `analysis`. A running server shows the REST API
at `/docs`; [DEPLOY.md](DEPLOY.md#rest-api) has an overview.

### Command line

```bash
facet serve [--host H] [--port P] [--mode local|cloud] [--data DIR] [--plugins DIR ...] \
                  [--no-registration] [--open] [--cors ORIGIN ...] [--root-path /PREFIX]
facet convert input.cif POSCAR                    # formats from the names; or --from / --to
facet build crystal fcc Cu --a 3.61 --repeat 3 3 3 -o cu.xyz
facet build cluster icosahedron Au --size 3 -o au55.xyz
facet build molecule caffeine -o caffeine.pdb
facet build custom hello-chain --param n=12 --param element=Ag -o chain.xyz --plugins ./plugins
facet terminations bulk.cif --hkl 1 1 0 [--json]  # the terminations of a plane, best first
facet build surface bulk.cif --hkl 1 1 0 --vacuum 15 [--layers N | --periods N | --thickness Å] \
                  [--termination T] [--symmetric] [--supercell N M | --wood 'c(2x2)'] [--fix-bottom N] -o POSCAR
facet edit vacuum slab.vasp --vacuum 20 -o out.vasp   # also: edit center-slab, flip, fix-layers -n N, free
facet analyze rdf structure.cif --param rmax=6    # summary, coordination, rdf or a plugin analysis (JSON)
facet info structure.cif [--bonds] [--json]
facet user create NAME [--password PW] [--data DIR]   # also: user list, passwd, delete
facet plugins [--plugins DIR] [--json]            # plugins and their status
facet plugins new NAME [--dir DIR]                # a plugin skeleton that loads right away
facet formats
python -m facet ...                               # the same
```

`convert`, `info`, `formats`, `build` and `analyze` load plugins first, so plugin formats work on the command
line too (for example `facet convert t.hello out.xyz --plugins examples/plugins`).
- **Choosing plugin folders:** on these commands, `--plugins` takes one folder per flag and may go anywhere on
  the line. To load several, repeat it (`--plugins ./a --plugins ./b`) or join the folders with the path
  separator (`./a:./b`; `;` on Windows).
- **Default:** without `--plugins`, `FACET_PLUGIN_DIRS` is used, plus installed entry-point plugins.
