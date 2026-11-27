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

The window is laid out as Materials Studio is:

- a **menu bar** (File, Edit, View, Modify, Build, Tools, Statistics, Window, Help) with every command where
  Materials Studio has it (*File › Import…*, *Edit › Atom Selection…*, *View › Display Style…*,
  *Modify › Lattice Parameters…*, *Build › Surfaces › Cleave Surface…*, *Window › Tile Horizontally* …);
- **toolbars** under it (Standard, 3D Viewer with Select / Rotate / Zoom / Translate, Display, Build, Modify, and
  Animation while a trajectory is open), shown or hidden in *View › Toolbars* (also Measure); drag a toolbar by its
  dotted grip along its row, into another row or a new one, or off the strip to float it (double-click its title to
  dock it again; *View › Toolbars › Reset Toolbars* puts them all back);
- the **Project explorer** (the project's documents as a tree: open, rename, duplicate, export, delete) and the
  **Properties explorer** below it (a Filter — Atom, Lattice 3D, Physical System, Reciprocal Lattice 3D, Symmetry
  System, Display, Project — over a Name | Value grid; the values that are not grey can be changed in place: an
  atom's element, position, name or constraint, a lattice parameter, the display style);
- **document windows** in the workspace: maximized with tabs, or tiled (they stay tiled as the workspace changes
  size), cascaded and minimized (*Window* menu), each with its own view;
- **tool windows**, one of their own for each of *Display Style*, *Display Options*, *Lighting*, *Effects* and the
  Library, Build, Structure, Surface and Projects panels, floating over the workspace as Materials Studio's dialogs
  do: open as many as you need, move them by the title bar, resize them by the corner; they open where you left
  them. `]` hides the display windows that are open and brings them back, `[` the panel windows;
- a right-click menu in the view (Cut, Copy, Paste, Delete · Display Style, Display Options, Lighting, Label ·
  Lattice Parameters …) and a **status bar** (hints, selection, atoms and bonds, lattice, frame).

The mouse works as in Materials Studio too. Press `F10` to reach the menus from the keyboard, `Ctrl/⌘ K` to
search every command (also by its Materials Studio name) and `?` to see the shortcuts. On a phone the menus are
under ⋯ and the explorers and panels open as sheets.

## Script it

```python
import facet
from facet import build

cu = build.crystal("fcc", "Cu", a=3.61).repeat(3, 3, 3)
facet.write("cu.cif", cu)
s = facet.read("cu.cif")

pt = build.crystal("fcc", "Pt", a=3.92)
slab = build.surface(pt, (1, 1, 1), vacuum=15, layers=4, supercell=(3, 3), fix_bottom=2)
facet.write("POSCAR", slab)          # 'Pt(111) p(3×3) 4L', the two bottom layers fixed
facet.write("slab.xsd", slab)        # the same slab for Materials Studio
```

```bash
facet convert cu.cif POSCAR
facet terminations tio2.cif --hkl 1 1 0
facet build surface tio2.cif --hkl 1 1 0 --vacuum 15 --periods 3 --fix-bottom 3 -o POSCAR
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
