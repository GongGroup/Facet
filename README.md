# Crystallume · 晶影

See atoms, clusters and crystals in your browser, styled and lit for papers and slides.
Run it as an app on your own computer, or as a server for your whole group.

## Quick start

```bash
pip install .                  # in this folder; needs Python 3.10 or newer
crystallume serve --open       # opens http://127.0.0.1:8765
```

Drop a CIF, POSCAR, XYZ or PDB file on the window (or paste its text), or pick a sample from the Library.
Then choose a look on the right and export a picture with `Ctrl/⌘ E`.

## What you can do

- **Open** CIF, POSCAR/CONTCAR/XDATCAR, XYZ/extended XYZ, PDB and Crystallume JSON files, including trajectories.
  Or build crystals, nanoclusters and molecules from the Build panel.
- **Style** a structure in one click with a look: Studio, Illustration, Poster, Line art, Morandi, Crystal,
  Midnight, Glass, Paper cut or MS (Materials Studio's default). Then fine-tune the representation, colours,
  materials, lighting and effects such as ambient occlusion, ink outlines and drop shadows.
- **Inspect** the formula, cell, density and space group; measure distances, angles and dihedrals;
  see coordination numbers and the radial distribution g(r).
- **Export** PNG images (up to 4×, optionally transparent), glTF models for Blender or PowerPoint, and
  structure files.
- **Save** projects in the browser, in a folder on your computer or on a server, with autosave and undo.

## Mouse and keys

The controls follow Materials Studio.

| Do this | To |
|---|---|
| Right-drag | Rotate. Hold X, Y or Z to turn about that screen axis. |
| Middle-drag, or Alt + drag | Pan |
| Scroll, or drag with the left and right buttons together | Zoom |
| Click · Shift-click · Ctrl-click | Select an atom · add one · add or remove one |
| Drag · Q + drag | Box select · lasso select |
| Double-click · Alt + double-click | Select the bonded fragment · every atom of that element |
| R + drag | Zoom into a box |
| Right-click | Atom menu |
| Arrow keys · `Home` | Turn the model 45° · reset the view |

**On a Mac:** ⌃ Control + drag rotates, ⌃-click opens the atom menu, ⌥ Option + drag pans and ⌘-click adds or
removes an atom. Scroll with two fingers to zoom.

Press `Ctrl/⌘ K` to search every command, and `?` or `F1` to see all shortcuts.
**Help › Take the tour** gives a one-minute walkthrough.

## Ways to run it

| Mode | Start it with | Projects are saved |
|---|---|---|
| Local app, just for you | `crystallume serve --open` | as folders in `~/.crystallume/projects/` |
| Server for a group, with accounts | `crystallume serve --mode cloud --host 0.0.0.0` | per user, on the server |
| Docker | `docker compose up -d` | in a Docker volume |
| Static website, no server needed | `python scripts/build_artifact.py --out dist/web` | in the browser or a local folder |

[docs/DEPLOY.md](docs/DEPLOY.md) covers accounts, security, Docker, reverse proxies, all settings and the REST API.

## Python and the command line

```python
import crystallume as cl
from crystallume import build, analysis

s = cl.read("POSCAR")                                 # any supported format
cu = build.crystal("fcc", "Cu", a=3.61).repeat(3, 3, 3)
print(analysis.summary(cu))                           # formula, volume, density, cell, …
cl.write("cu.cif", cu)
cl.view(cu)                                           # show it in the browser
```

```bash
crystallume convert input.cif POSCAR
crystallume build crystal fcc Cu --a 3.61 --repeat 3 3 3 -o cu.xyz
crystallume info structure.cif
crystallume --help                                    # every command
```

More of the Python API, the REST client and the CLI:
[docs/PLUGINS.md §7](docs/PLUGINS.md#7-python-api-rest-client-and-cli).

## Extend it

Plugins can add file formats, builders, analyses, looks, colour schemes, lighting, panels and commands:

```bash
crystallume plugins new my-plugin --dir ./plugins     # a working plugin to start from
crystallume serve --plugins ./plugins
```

The whole app is also scriptable from the browser console through `window.crystallume`. Try `crystallume.help()`.

- [docs/PLUGINS.md](docs/PLUGINS.md) shows how to write plugins and documents the JavaScript and Python APIs.
- [docs/SCHEMA.md](docs/SCHEMA.md) describes the structure and project file formats.
- [examples/plugins/hello_plugin](examples/plugins/hello_plugin) is a complete example plugin.

## Development

```bash
pip install -e ".[test]"
pytest -q
```

The web app in `crystallume/web` has no build step; its one dependency, three.js r170, is included.

## Formerly AtomScope

Crystallume used to be called AtomScope. Everything from that version still works: project files,
`ATOMSCOPE_*` settings, the `~/.atomscope` data folder, `import atomscope`, `window.atomscope` and the
`atomscope:*` embedding messages. Docker users should read
[Upgrading from AtomScope](docs/DEPLOY.md#upgrading-from-atomscope).
