# Facet

See, build and export atoms, clusters and crystals in your browser, styled and lit for papers and slides.
Run it on your own computer, or as a server for your group.

## Install

With Docker, for yourself (no login, reachable from this computer only):

```bash
docker run -d --name facet -p 127.0.0.1:8765:8765 -v facet-data:/data -e FACET_MODE=local ghcr.io/mastreina/facet
```

Then open <http://127.0.0.1:8765>. For a group, with accounts:

```bash
docker run -d --name facet -p 8765:8765 -v facet-data:/data ghcr.io/mastreina/facet
docker exec facet facet user create alice
```

Without Docker, from this folder (Python 3.10 or newer):

```bash
pip install .
facet serve --open
```

## Use

- **Open** CIF, POSCAR/CONTCAR/XDATCAR, XYZ, extended XYZ, PDB and Facet JSON files, including trajectories:
  drop a file on the window. Or build crystals, clusters and molecules in the Build panel.
- **Style** it with one click on a look, then adjust the representation, colours, lighting and effects.
- **Inspect** the formula, cell and space group, and measure distances and angles.
- **Export** PNG images up to 4×, glTF models and structure files.
- **Save** projects in the browser, in a folder on your computer or on the server.

The mouse works as in Materials Studio. Press `Ctrl/⌘ K` to search every command and `?` to see the shortcuts.

## Script it

```python
import facet
from facet import build

cu = build.crystal("fcc", "Cu", a=3.61).repeat(3, 3, 3)
facet.write("cu.cif", cu)
s = facet.read("cu.cif")
```

```bash
facet convert cu.cif POSCAR
facet --help
```

In the browser console, the whole app is under `window.facet`; try `facet.help()`.

## More

- [docs/DEPLOY.md](docs/DEPLOY.md): local and cloud mode, Docker, reverse proxies, settings, the REST API.
- [docs/PLUGINS.md](docs/PLUGINS.md): plugins, and the Python and JavaScript APIs.
- [docs/SCHEMA.md](docs/SCHEMA.md): the structure and project file formats.

To work on Facet: `pip install -e ".[test]"`, then `pytest`. The web app in `facet/web` has no build step.

Facet used to be called Crystallume, and before that AtomScope. Files, settings, data folders and scripts from
those versions still work: see [Upgrading](docs/DEPLOY.md#upgrading-from-crystallume-or-atomscope).
