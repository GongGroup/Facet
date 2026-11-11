# Facet

See, build and export atoms, clusters and crystals in your browser, styled and lit for papers and slides.
Run it on your own computer, or as a server for your group.

## Install

With Docker, for yourself (no login, reachable from this computer only):

```bash
docker run -d --name facet -p 127.0.0.1:8765:8765 -v facet-data:/data -e FACET_MODE=local ghcr.io/gonggroup/facet
```

Then open <http://127.0.0.1:8765>. For a group, with accounts:

```bash
docker run -d --name facet -p 8765:8765 -v facet-data:/data ghcr.io/gonggroup/facet
docker exec facet facet user create alice
```

Without Docker, from this folder (Python 3.10 or newer):

```bash
pip install .
facet serve --open
```

## Use

- **Open** CIF, POSCAR/CONTCAR/XDATCAR, XYZ, extended XYZ, PDB, Materials Studio XSD and Facet JSON files,
  including trajectories: drop a file on the window. Or build crystals, clusters and molecules in the Build panel.
- **Style** it with one click on a look (new structures open in *Poster*), then adjust the representation,
  colours, lighting and effects.
- **Cleave** a surface from a crystal (*Build › Surfaces › Cleave Surface*, or the Surface panel): pick the plane
  and the termination, the number of layers and the vacuum, fix the bottom layers, then set the vacuum, centre or
  flip the slab later.
- **Inspect** the formula, cell and space group, and measure distances and angles.
- **Export** PNG images up to 4×, glTF models and structure files (CIF, POSCAR, XYZ, PDB, and XSD to go on in
  Materials Studio, fixed atoms included).
- **Save** projects in the browser, in a folder on your computer or on the server.

The window is laid out as Materials Studio is. A menu bar (**File, Edit, View, Modify, Build, Tools, Window,
Help**) holds every command where Materials Studio has it, with submenus such as *Build › Surfaces*,
*Build › Symmetry* and *File › Export › Structure File*; a toolbar under it has the everyday buttons; the
explorers (Projects, Library, Build, Structure, Surface) are on the left and the display settings on the right.
The mouse works as in Materials Studio too. Press `F10` to reach the menus from the keyboard, `Ctrl/⌘ K` to
search every command (also by its Materials Studio name) and `?` to see the shortcuts. On a phone the menus are
under ⋯.

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
