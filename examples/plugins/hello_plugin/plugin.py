"""Hello plugin — a minimal, complete AtomScope plugin example.

It demonstrates every extension point:

* a reader **and** writer for a toy ``.hello`` file format;
* a structure builder ``hello-chain`` (``POST /api/v1/build/custom/hello-chain``);
* an analysis ``hello-com`` (``POST /api/v1/analysis/custom/hello-com``);
* a lighting preset shown by the web UI;
* an API route ``GET /api/v1/ext/hello``;
* static files + a frontend ES module (``static/hello.js``) loaded by the UI.

Run it with::

    atomscope serve --plugins examples/plugins

The ``.hello`` format is deliberately trivial::

    HELLO <name>
    CELL ax ay az bx by bz cx cy cz        (optional)
    Cu 0.0 0.0 0.0
    Cu 1.8 1.8 0.0
"""

from __future__ import annotations

from fastapi import APIRouter

from atomscope import PluginContext, Structure

PLUGIN = {
    "name": "hello",
    "version": "1.0.0",
    "description": "Example plugin: .hello format, chain builder, preset, API route and UI module.",
}


# --------------------------------------------------------------- file format
def read_hello(text: str) -> Structure:
    """Parse the toy ``.hello`` format."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip() and not ln.lstrip().startswith("#")]
    if not lines or not lines[0].upper().startswith("HELLO"):
        raise ValueError("a .hello file must start with a 'HELLO' line")
    name = lines[0][5:].strip()
    cell = None
    symbols, positions = [], []
    for ln in lines[1:]:
        parts = ln.split()
        if parts[0].upper() == "CELL":
            vals = [float(v) for v in parts[1:10]]
            cell = [vals[0:3], vals[3:6], vals[6:9]]
            continue
        symbols.append(parts[0])
        positions.append([float(v) for v in parts[1:4]])
    return Structure(symbols, positions, cell=cell, name=name or "hello", info={"source": "hello-plugin"})


def write_hello(structure: Structure) -> str:
    """Write the toy ``.hello`` format (frame 0)."""
    out = [f"HELLO {structure.name}".rstrip()]
    if structure.cell is not None:
        out.append("CELL " + " ".join(f"{v:.6f}" for v in structure.cell.reshape(-1)))
    for s, p in zip(structure.symbols, structure.positions):
        out.append(f"{s} {p[0]:.6f} {p[1]:.6f} {p[2]:.6f}")
    return "\n".join(out) + "\n"


# ------------------------------------------------------------------- builder
def build_chain(element: str = "Au", n: int = 8, spacing: float = 2.6, periodic: bool = False) -> Structure:
    """A linear atomic chain along x (optionally periodic along x)."""
    n = int(n)
    if not 1 <= n <= 10000:
        raise ValueError("n must be between 1 and 10000")
    spacing = float(spacing)
    positions = [[i * spacing, 0.0, 0.0] for i in range(n)]
    if not periodic:
        return Structure([element] * n, positions, name=f"{element}{n} chain")
    # Periodic along x; 10 Å box across the chain so it can be displayed in a cell.
    s = Structure([element] * n, positions, cell=[n * spacing, 10.0, 10.0], pbc=[True, False, False],
                  name=f"{element}{n} periodic chain")
    return s.translate([0.0, 5.0, 5.0])


CHAIN_META = {
    "label": "Atomic chain",
    "description": "Linear chain of identical atoms along x.",
    "params": [
        {"name": "element", "type": "element", "default": "Au", "label": "Element"},
        {"name": "n", "type": "int", "default": 8, "min": 1, "max": 10000, "label": "Atoms"},
        {"name": "spacing", "type": "float", "default": 2.6, "min": 0.5, "max": 10, "label": "Spacing (Å)"},
        {"name": "periodic", "type": "bool", "default": False, "label": "Periodic along x"},
    ],
}


# ------------------------------------------------------------------ analysis
def center_of_mass(structure: Structure) -> dict:
    """Mass-weighted centre of the structure (Å)."""
    m = structure.masses
    com = (structure.positions * m[:, None]).sum(axis=0) / max(m.sum(), 1e-12)
    return {"centerOfMass": [round(float(v), 6) for v in com], "totalMass": round(float(m.sum()), 6)}


# -------------------------------------------------------------------- router
router = APIRouter()


@router.get("/hello", summary="Hello from the example plugin")
def hello() -> dict:
    """Returns a greeting; mounted at ``/api/v1/ext/hello``."""
    return {"message": "Hello from the AtomScope hello plugin!", "plugin": PLUGIN["name"], "version": PLUGIN["version"]}


# ------------------------------------------------------------------ register
def register(ctx: PluginContext) -> None:
    """Entry point called by AtomScope's plugin manager."""
    ctx.register_reader("hello", read_hello, extensions=[".hello"], description="Toy .hello format (example plugin)")
    ctx.register_writer("hello", write_hello, extensions=[".hello"], description="Toy .hello format (example plugin)")
    ctx.register_builder("hello-chain", build_chain, CHAIN_META)
    ctx.register_analysis("hello-com", center_of_mass, {"label": "Centre of mass"})
    # Presets are passed to the web UI unchanged. The bundled UI's light rig uses
    # key/fill/rim lights (azimuth/elevation in degrees) plus hemisphere and ambient light;
    # omitted parts fall back to the UI defaults.
    ctx.add_preset("lighting", {
        "id": "hello-sunset",
        "name": "Sunset (hello plugin)",
        "hemi": {"intensity": 0.35, "sky": "#ffd6a5", "ground": "#4a3b52"},
        "ambient": {"intensity": 0.05, "color": "#ffffff"},
        "key": {"intensity": 2.2, "color": "#ff9f68", "azimuth": -40, "elevation": 20},
        "fill": {"intensity": 0.6, "color": "#6c8cff", "azimuth": 50, "elevation": 10},
        "rim": {"intensity": 1.2, "color": "#ffd1a1", "azimuth": 160, "elevation": 35},
    })
    ctx.add_router(router, prefix="/api/v1/ext")
    ctx.add_static("static")
    ctx.add_frontend_module("hello.js")
