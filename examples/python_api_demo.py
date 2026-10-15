"""AtomScope Python API tour.

Run from the repository root::

    python examples/python_api_demo.py            # offline part only
    python examples/python_api_demo.py --server   # also talk to a running server
    python examples/python_api_demo.py --view     # open the result in the browser viewer

Everything here works without a server except the ``Client`` section.
"""

from __future__ import annotations

import argparse
import tempfile
from pathlib import Path

import atomscope as ats
from atomscope import analysis, build


def offline_tour(outdir: Path) -> ats.Structure:
    # 1. Build structures -------------------------------------------------
    sto = build.crystal("perovskite", ["Sr", "Ti", "O"], a=3.905)
    print("perovskite:", sto, "spacegroup", sto.info["spacegroup"])

    cu = build.crystal("fcc", "Cu").repeat(3, 3, 3)
    print("Cu supercell:", cu.formula, f"{cu.density:.3f} g/cm^3")

    au55 = build.cluster("icosahedron", "Au", 3)
    print("Au cluster:", au55.name, len(au55), "atoms")

    caffeine = build.molecule("caffeine")
    print("caffeine:", caffeine.formula)

    # 2. Write and read files ---------------------------------------------
    for fmt, name in [("cif", "sto.cif"), ("poscar", "POSCAR"), ("extxyz", "cu.xyz"), ("pdb", "caffeine.pdb")]:
        target = outdir / name
        obj = {"cif": sto, "poscar": sto, "extxyz": cu, "pdb": caffeine}[fmt]
        ats.write(target, obj, format=fmt)
        back = ats.read(target)
        print(f"  {name:<12s} -> {back.formula:<10s} ({back.info['format']})")

    # 3. Analysis ------------------------------------------------------------
    bonds = analysis.neighbors(build.crystal("diamond", "Si"))
    print("Si diamond bonds in the conventional cell:", len(bonds))
    print("first bond:", bonds[0])
    cn = analysis.coordination_numbers(cu)
    print("Cu coordination numbers:", set(cn.tolist()))
    r, g = analysis.rdf(cu, rmax=6.0, nbins=60)
    print(f"Cu g(r) first peak at {r[g.argmax()]:.2f} Å")
    print("summary:", analysis.summary(sto)["formula"], analysis.summary(sto)["cellpar"])

    # 4. Geometry -------------------------------------------------------------
    water = build.molecule("water")
    print(f"H-O-H angle: {water.get_angle(1, 0, 2):.1f}°, O-H {water.get_distance(0, 1):.3f} Å")

    # 5. Projects -------------------------------------------------------------
    doc = ats.new_project("Demo project", [sto, au55], tags=["demo"])
    ats.save_project(outdir / "demo.atomscope.json", doc)
    print("project saved:", doc["id"], [s["name"] for s in doc["structures"]])
    return sto


def server_tour(base_url: str) -> None:
    client = ats.Client(base_url)
    print("server:", client.health())
    info = client.info()
    print("mode:", info["mode"], "| plugins:", [p["name"] for p in info["plugins"]])
    si = client.build_crystal("diamond", ["Si"], supercell=[2, 2, 2])
    print("server-built:", si.formula, "bonds:", len(client.bonds(si)))
    p = client.create_project("From the Python client", structures=[si])
    print("created project", p["id"])
    print("projects:", [s["name"] for s in client.projects()][:5])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--server", nargs="?", const="http://127.0.0.1:8765", help="server URL")
    ap.add_argument("--view", action="store_true", help="open the perovskite in the browser viewer")
    args = ap.parse_args()
    with tempfile.TemporaryDirectory() as tmp:
        sto = offline_tour(Path(tmp))
    if args.server:
        server_tour(args.server)
    if args.view:
        print("viewer:", ats.view(sto))
        input("Press Enter to stop the background server...")


if __name__ == "__main__":
    main()
