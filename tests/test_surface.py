"""Cleaving and the slab tools (``facet.build.surface``): what the shared golden cases do not cover.

The golden cases (``tests/data/surface/cleave``, run by ``tests/test_cases.py`` in both languages) check the analysis
and the slabs.  Here: the primitive-cell search on conventional cells and supercells, the conventional-cell hint,
surface supercells and their names, the tools for existing slabs (vacuum, centre, flip, layers, constraints) with
their invariants, the command line, the REST API and client, and that Python and the web modules agree on the tools.
"""

from __future__ import annotations

import json
import math

import numpy as np
import pytest

import facet
from facet import build
from facet.build.surface import conventional_cell_hint
from facet.cli import main
from facet.client import Client

from .conftest import DATA

PT = dict(a=3.92)


def pt() -> facet.Structure:
    return build.crystal("fcc", "Pt", **PT)


def min_distance(s: facet.Structure) -> float:
    pos, cell = np.asarray(s.positions, float), np.asarray(s.cell, float)
    best = math.inf
    for i in (-1, 0, 1):
        for j in (-1, 0, 1):
            for k in (-1, 0, 1):
                d = pos[None, :, :] + (i * cell[0] + j * cell[1] + k * cell[2]) - pos[:, None, :]
                r = np.sqrt((d * d).sum(axis=2))
                if (i, j, k) == (0, 0, 0):
                    np.fill_diagonal(r, math.inf)
                best = min(best, float(r.min()))
    return best


# --------------------------------------------------------------------------------------------- primitive cell
@pytest.mark.parametrize("n", [1, 2, 3])
def test_a_supercell_gives_the_slab_of_its_primitive_cell(n):
    slab = build.surface(pt().repeat(n, n, n), (1, 1, 1), vacuum=15)
    assert slab.name == "Pt(111) 4L" and len(slab) == 4
    a, b, c = (float(np.linalg.norm(v)) for v in slab.cell)
    assert a == pytest.approx(3.92 / math.sqrt(2)) and b == pytest.approx(a) and c == pytest.approx(15 + 3 * 3.92 / math.sqrt(3))
    assert slab.info["surface"]["bulk"]["natoms"] == 4 * n ** 3


def test_the_indices_of_a_stretched_supercell_are_its_own():
    """(1 1 1) of a 3×1×2 supercell cuts its axes at 3a, a and 2a: the (2 6 3) plane of the cubic cell."""
    wide = build.surface_analysis(pt().repeat(3, 1, 2), (1, 1, 1))
    cubic = build.surface_analysis(pt(), (2, 6, 3))
    assert len(wide.symbols) == 1 and wide.points == 24
    assert wide.mesh["area"] == pytest.approx(cubic.mesh["area"]) and wide.period == pytest.approx(cubic.period)
    assert np.allclose(wide.normal, cubic.normal)


def test_without_the_primitive_step_the_mesh_of_the_input_cell_is_kept():
    an = build.surface_analysis(pt(), (1, 1, 1), primitive=False)
    assert an.mesh["a"] == pytest.approx(3.92 * math.sqrt(2)) and an.mesh["type"] == "hexagonal"
    assert len(an.symbols) == 4 and not an.notes
    small = build.surface_analysis(pt(), (1, 1, 1))
    assert small.mesh["area"] * 4 == pytest.approx(an.mesh["area"])
    assert small.notes[0].startswith("the 4-atom input cell was reduced to its 1-atom primitive cell")


def test_a_distorted_supercell_is_not_reduced():
    s = pt().repeat(2, 1, 1)
    s.positions[0] += [0.3, 0.0, 0.0]            # no longer a translation of the 4-atom cell
    an = build.surface_analysis(s, (1, 0, 0))
    assert len(an.symbols) == 8 and an.points == 1


def test_indices_always_refer_to_the_input_cell():
    """(1 0 0) of the rotated 2-atom cell of bcc Fe along [110] is not the cubic (100)."""
    fe = build.crystal("bcc", "Fe", a=2.866)
    conv = build.surface_analysis(fe, (1, 1, 0))
    assert conv.mesh["area"] == pytest.approx(2.866 ** 2 / math.sqrt(2), abs=1e-6)
    prim = facet.read(DATA / "surface" / "cleave" / "inputs" / "fe_mp_primitive.vasp")
    assert conventional_cell_hint(prim.cell)["kind"] == "cI"
    assert conventional_cell_hint(fe.cell) is None
    same = build.surface_analysis(prim, (1, 1, 0), miller_basis="conventional")
    assert same.mesh["area"] == pytest.approx(conv.mesh["area"]) and same.miller == [0, 0, 1]
    with pytest.raises(ValueError, match="conventional indices need a standard primitive cell"):
        build.surface_analysis(fe, (1, 1, 0), miller_basis="conventional")


def test_the_bulk_is_checked_before_anything_else():
    with pytest.raises(ValueError, match="cleaving needs a periodic crystal with a unit cell"):
        build.surface(build.molecule("water"), (1, 1, 1), vacuum=15)
    with pytest.raises(ValueError, match=r"periodic along a, b and c \(this one is periodic along a and b only\)"):
        build.surface(build.crystal("graphene", "C", a=2.46, c=15.0), (0, 0, 1), vacuum=15)
    with pytest.raises(ValueError, match="vacuum is required"):
        build.surface(pt(), (1, 1, 1), vacuum=None)
    with pytest.raises(TypeError):
        build.surface(pt(), (1, 1, 1))                                    # no default (user decision U4)


# --------------------------------------------------------------------------------------------- supercells
@pytest.mark.parametrize("spec, mesh, expect", [
    (None, None, [[1, 0], [0, 1]]),
    ((3, 2), None, [[3, 0], [0, 2]]),
    ([[2, 1], [-1, 1]], None, [[2, 1], [-1, 1]]),
    ("p(2×2)", "square", [[2, 0], [0, 2]]),
    ("3x2", "hexagonal", [[3, 0], [0, 2]]),
    ("c(2×2)", "square", [[1, 1], [-1, 1]]),
    ("(√3×√3)R30°", "hexagonal", [[2, 1], [-1, 1]]),
    ("sqrt3xsqrt3R30", "hexagonal", [[2, 1], [-1, 1]]),
    ("(√7×√7)R19.1°", "hexagonal", [[3, 1], [-1, 2]]),
])
def test_surface_supercells(spec, mesh, expect):
    assert build.parse_surface_supercell(spec, mesh) == expect


@pytest.mark.parametrize("spec, mesh, message", [
    ("(√3×√3)R30°", "square", "does not fit this surface cell (square)"),
    ("c(2×2)", "hexagonal", "does not fit this surface cell (hexagonal)"),
    ("nonsense", "square", "unknown surface supercell 'nonsense'"),
    ([[1, 1], [1, 1]], None, "determinant 0"),
    ([[0, 1], [1, 0]], None, "determinant -1; swap the two rows"),
    ([[60, 0], [0, 1]], None, "entries must be between -50 and 50"),
    ([1.5, 2], None, "must be a 2×2 matrix of whole numbers"),
])
def test_surface_supercell_errors(spec, mesh, message):
    with pytest.raises(ValueError) as err:
        build.parse_surface_supercell(spec, mesh)
    assert message in str(err.value)


def test_supercell_names_and_atom_counts():
    cu = build.crystal("fcc", "Cu", a=3.615)
    for spec, name, n in [((2, 2), "Cu(100) p(2×2) 4L", 16), ("c(2×2)", "Cu(100) (√2×√2)R45° 4L", 8),
                          ([[2, 1], [0, 1]], "Cu(100) [2 1 0, 0 1 0, 0 0 1] 4L", 8)]:
        slab = build.surface(cu, (1, 0, 0), vacuum=12, supercell=spec)
        assert (slab.name, len(slab)) == (name, n)
        assert slab.cell[0][1] == 0 and slab.cell[0][2] == 0 and slab.cell[1][2] == 0, "a along x, b in the xy plane"
        assert min_distance(slab) == pytest.approx(3.615 / math.sqrt(2), abs=1e-9)
    ag = build.surface(build.crystal("fcc", "Ag", a=4.09), (1, 1, 1), vacuum=12, supercell="(√3×√3)R30°")
    assert ag.name == "Ag(111) (√3×√3)R30° 4L" and len(ag) == 12
    assert facet.core.lattice.cell_to_cellpar(ag.cell)[5] == pytest.approx(120.0)


# --------------------------------------------------------------------------------------------- slab tools
def tio2_slab() -> facet.Structure:
    return build.surface(build.crystal("rutile", ["Ti", "O"], a=4.594, c=2.959), (1, 1, 0), vacuum=15, periods=3,
                         supercell=(2, 1), fix_bottom=3)


def test_set_vacuum_changes_only_the_gap():
    s = tio2_slab()
    d0, t0 = min_distance(s), build.slab_extent(s)["thickness"]
    flags = s.move_flags()
    assert build.set_vacuum(s, 22.5) is s
    ext = build.slab_extent(s)
    assert ext["gap"] == pytest.approx(22.5) and ext["thickness"] == pytest.approx(t0) and ext["vacuum"]
    assert ext["bottom"] == pytest.approx(11.25), "centred"
    assert min_distance(s) == pytest.approx(d0) and s.move_flags() == flags and s.pbc == [True, True, True]
    assert s.info["surface"]["vacuum"] == 22.5 and s.info["surface"]["kind"] == "cleave"
    build.set_vacuum(s, 10, position="bottom", offset=1.5)
    assert build.slab_extent(s)["bottom"] == pytest.approx(1.5) and s.cell[2][2] == pytest.approx(t0 + 10)


def test_set_vacuum_puts_a_slab_that_crosses_the_cell_edge_in_one_piece():
    s = facet.read(DATA / "surface" / "contcar_pt111.vasp")          # the bottom layer sits at z = 0 and just below
    assert s.positions[:, 2].max() - s.positions[:, 2].min() > 20
    d0 = min_distance(s)
    build.set_vacuum(s, 12)
    z = s.positions[:, 2]
    assert z.max() - z.min() == pytest.approx(6.79, abs=0.01) and z.min() == pytest.approx(6.0, abs=1e-6)
    assert min_distance(s) == pytest.approx(d0, abs=1e-9)
    assert s.info["surface"]["kind"] == "vacuum" and s.constraint_summary()["fixed"] == 18


def test_set_vacuum_on_a_bulk_opens_its_widest_gap_and_says_so():
    s = build.crystal("perovskite", ["Sr", "Ti", "O"], a=3.905)
    build.set_vacuum(s, 10)
    assert build.slab_extent(s)["gap"] == pytest.approx(10)
    assert any("no vacuum gap of at least 5 Å was found" in w for w in s.info["warnings"])


@pytest.mark.parametrize("vacuum, message", [
    (None, "vacuum is required"), (0, "a vacuum of 0 Å is only possible when cleaving"),
    (-1, "vacuum must be between 0 and 1000 Å"), (2000, "vacuum must be between 0 and 1000 Å"),
])
def test_set_vacuum_refuses(vacuum, message):
    with pytest.raises(ValueError, match=message):
        build.set_vacuum(tio2_slab(), vacuum)
    with pytest.raises(ValueError, match="setting the vacuum needs a unit cell"):
        build.set_vacuum(build.molecule("water"), 10)


def test_center_slab_keeps_the_cell():
    s = build.surface(pt(), (1, 1, 1), vacuum=15, position="bottom", offset=1.0)
    cell = s.cell.copy()
    build.center_slab(s)
    assert np.allclose(s.cell, cell) and build.slab_extent(s)["bottom"] == pytest.approx(7.5)


def test_flip_turns_the_slab_over_and_twice_gives_it_back():
    s = tio2_slab()
    before = s.copy()
    assert s.info["surface"]["termination"]["top"] == "O·Ti2O2"
    build.flip_slab(s)
    rec = s.info["surface"]
    assert rec["miller"] == [-1, -1, 0] and rec["flipped"] is True
    assert s.name == "TiO2(-1-10) p(2×1) O·Ti2O2-term 9L" and rec["autoName"] == s.name
    assert sorted(s.props["tags"]) == sorted(before.props["tags"])
    # the atoms that were at the bottom (fixed, tag 9) are now on top (tag 1), still fixed
    z = s.positions[:, 2]
    top = [i for i, t in enumerate(s.props["tags"]) if t == 1]
    assert all(z[i] > z.mean() for i in top) and all(not any(s.move_flags()[i]) for i in top)
    assert [before.props["tags"][i] for i in top] == [9] * len(top)
    assert min_distance(s) == pytest.approx(min_distance(before)) and np.linalg.det(s.cell) > 0
    assert build.slab_extent(s)["bottom"] == pytest.approx(build.slab_extent(before)["bottom"])
    build.flip_slab(s)
    assert s.name == before.name and s.props["tags"] == before.props["tags"] and s.info["surface"]["miller"] == [1, 1, 0]
    assert np.allclose(s.cell, before.cell, atol=1e-9)
    f1 = (s.positions @ np.linalg.inv(s.cell)) % 1.0
    f0 = (before.positions @ np.linalg.inv(before.cell)) % 1.0
    d = (f1 - f0 + 0.5) % 1.0 - 0.5
    shift = d[0]
    assert np.allclose(d, shift, atol=1e-8), "the same slab, up to one in-plane translation"


def test_flip_needs_a_slab():
    with pytest.raises(ValueError, match="flipping needs a slab"):
        build.flip_slab(pt())


def test_layers_and_constraints():
    s = build.surface(pt(), (1, 1, 1), vacuum=15, supercell=(2, 2), layers=5)
    lay = build.slab_layers(s)
    assert lay["count"] == 5 and lay["sizes"] == [4] * 5 and lay["heights"][1] == pytest.approx(3.92 / math.sqrt(3))
    assert [5 - t for t in s.props["tags"]] == lay["layer"]
    assert build.fix_layers(s, 2) == 8 and s.constraint_summary()["fixed"] == 8
    assert all((not any(f)) == (ell < 2) for f, ell in zip(s.move_flags(), lay["layer"]))
    assert build.fix_layers(s, 1, where="top", axes="c") == 4
    assert s.constraint_summary()["partial"] == 4 and s.move_flags()[-1] == [True, True, False]
    with pytest.raises(ValueError, match=r"from 0 to the number of layers \(5\)"):
        build.fix_layers(s, 6)
    assert build.free_atoms(s, [0, 1]) == 2 and s.constraint_summary()["fixed"] == 6
    assert build.free_atoms(s) == 10 and "selective_dynamics" not in s.props


def test_oriented_cell_is_the_bulk_turned():
    bulk = build.crystal("perovskite", ["Sr", "Ti", "O"], a=3.905)
    cell = build.oriented_cell(bulk, (1, 1, 0), periods=2)
    assert abs(np.linalg.det(cell.cell)) == pytest.approx(2 * 3.905 ** 3) and len(cell) == 10
    assert min_distance(cell) == pytest.approx(min_distance(bulk), abs=1e-9)
    assert cell.info["surface"]["stacking"] == "bulk"


# --------------------------------------------------------------------------------------------- both languages
def test_the_slab_tools_agree_with_the_web_modules(js):
    """setVacuum, centerSlab, flipSlab, fixLayers and slabLayers give the same structures as Python."""
    s = tio2_slab()
    doc = s.to_dict(decimals=12)
    got = js("""
        const { Structure } = await web('core/structure.js');
        const { loadOxidationStates, setVacuum, centerSlab, flipSlab, fixLayers, slabLayers, slabExtent } = await web('build/surface.js');
        await loadOxidationStates();
        const out = {};
        const pack = (s) => ({ positions: Array.from(s.positions), cell: s.cell, name: s.name, tags: s.props.tags,
          flags: s.props.selective_dynamics ?? null, miller: s.info.surface.miller, vacuum: s.info.surface.vacuum });
        let s = Structure.fromJSON(input); setVacuum(s, 22.5); out.vacuum = pack(s);
        s = Structure.fromJSON(input); setVacuum(s, 9, { position: 'bottom', offset: 2 }); centerSlab(s); out.center = pack(s);
        s = Structure.fromJSON(input); flipSlab(s); out.flip = pack(s);
        s = Structure.fromJSON(input); out.fixed = fixLayers(s, 2, { where: 'top', axes: 'c' }); out.fix = pack(s);
        s = Structure.fromJSON(input); out.layers = slabLayers(s); out.extent = slabExtent(s);
        return out;
    """, doc)

    def same(py: facet.Structure, web: dict) -> None:
        assert np.allclose(np.asarray(py.positions).ravel(), web["positions"], atol=1e-9)
        assert np.allclose(py.cell, web["cell"], atol=1e-9)
        assert (py.name, py.props["tags"]) == (web["name"], web["tags"])
        assert py.props.get("selective_dynamics") == web["flags"]
        assert py.info["surface"]["miller"] == web["miller"] and py.info["surface"]["vacuum"] == web["vacuum"]

    a = facet.Structure.from_dict(doc); build.set_vacuum(a, 22.5); same(a, got["vacuum"])
    b = facet.Structure.from_dict(doc); build.set_vacuum(b, 9, position="bottom", offset=2); build.center_slab(b)
    same(b, got["center"])
    c = facet.Structure.from_dict(doc); build.flip_slab(c); same(c, got["flip"])
    d = facet.Structure.from_dict(doc); n = build.fix_layers(d, 2, where="top", axes="c"); same(d, got["fix"])
    assert n == got["fixed"]
    lay, ext = build.slab_layers(s), build.slab_extent(s)
    assert (lay["count"], lay["layer"], lay["sizes"]) == (got["layers"]["count"], got["layers"]["layer"], got["layers"]["sizes"])
    assert lay["heights"] == pytest.approx(got["layers"]["heights"], abs=1e-9)
    assert ext["gap"] == pytest.approx(got["extent"]["gap"]) and ext["thickness"] == pytest.approx(got["extent"]["thickness"])


def test_supercell_names_agree_with_the_web_modules(js):
    specs = [None, [3, 2], "c(2×2)", "(√3×√3)R30°", "(2√3×2√3)R30°", [[2, 1], [-1, 3]], "(√5×√5)R26.6°"]
    hexa = [[2.77, 0, 0], [-1.385, 2.3989, 0]]
    square = [[2.556, 0, 0], [0, 2.556, 0]]
    cases = [(spec, "hexagonal" if isinstance(spec, str) and ("3" in spec and "√" in spec) else "square") for spec in specs]
    got = js("""
        const { parseSurfaceSupercell, surfaceMeshLabel } = await web('build/surface.js');
        return input.cases.map(([spec, mesh]) => {
          const S = parseSurfaceSupercell(spec, mesh);
          const [a, b] = mesh === 'hexagonal' ? input.hexa : input.square;
          return [S, surfaceMeshLabel(S, [...a], [...b])];
        });
    """, {"cases": cases, "hexa": hexa, "square": square})
    for (spec, mesh), (S, label) in zip(cases, got):
        a, b = hexa if mesh == "hexagonal" else square
        mine = build.parse_surface_supercell(spec, mesh)
        assert mine == S and build.surface_mesh_label(mine, a, b) == label, spec


# --------------------------------------------------------------------------------------------- command line
def test_cli_cleaves_and_edits(tmp_path, capsys):
    bulk, slab = tmp_path / "pt.cif", tmp_path / "POSCAR"
    assert main(["build", "crystal", "fcc", "Pt", "--a", "3.92", "-o", str(bulk)]) == 0
    capsys.readouterr()
    assert main(["terminations", str(bulk), "--hkl", "1", "1", "1"]) == 0
    out = capsys.readouterr().out
    assert "surface cell 2.7719 x 2.7719 A, gamma 120.00 deg" in out and " 0  Pt" in out
    assert main(["terminations", str(bulk), "--hkl", "1", "1", "1", "--json"]) == 0
    assert json.loads(capsys.readouterr().out)["mesh"]["type"] == "hexagonal"
    assert main(["build", "surface", str(bulk), "--hkl", "1", "1", "1", "--vacuum", "15", "--layers", "4",
                 "--supercell", "3", "3", "--fix-bottom", "2", "-o", str(slab)]) == 0
    s = facet.read(slab)
    assert len(s) == 36 and s.name == "Pt(111) p(3×3) 4L" and s.constraint_summary()["fixed"] == 18
    wide, flipped = tmp_path / "wide.vasp", tmp_path / "flipped.vasp"
    assert main(["edit", "vacuum", str(slab), "--vacuum", "20", "-o", str(wide)]) == 0
    assert facet.read(wide).cell[2][2] == pytest.approx(20 + 3 * 3.92 / math.sqrt(3))
    assert main(["edit", "flip", str(wide), "-o", str(flipped)]) == 0
    f = facet.read(flipped)
    assert f.positions[[i for i, row in enumerate(f.move_flags()) if not any(row)], 2].min() > f.positions[:, 2].mean()
    assert main(["edit", "free", str(flipped), "-o", str(flipped)]) == 0
    assert facet.read(flipped).constraint_summary()["present"] is False
    assert main(["edit", "fix-layers", str(flipped), "-n", "1", "--where", "top", "-o", str(flipped)]) == 0
    assert facet.read(flipped).constraint_summary()["fixed"] == 9
    assert main(["edit", "center-slab", str(flipped), "-o", str(flipped)]) == 0


def test_cli_errors(tmp_path, capsys):
    bulk = tmp_path / "pt.cif"
    assert main(["build", "crystal", "fcc", "Pt", "--a", "3.92", "-o", str(bulk)]) == 0
    capsys.readouterr()
    assert main(["build", "surface", str(bulk), "--hkl", "1", "1", "1", "--vacuum", "2"]) != 0
    assert "the vacuum (2 Å) is too small" in capsys.readouterr().err
    assert main(["build", "surface", str(bulk), "--hkl", "0", "0", "0", "--vacuum", "15"]) != 0
    assert "(0 0 0) is not a plane" in capsys.readouterr().err
    with pytest.raises(SystemExit):                       # --vacuum has no default
        main(["build", "surface", str(bulk), "--hkl", "1", "1", "1"])


# --------------------------------------------------------------------------------------------- REST and client
def test_rest_endpoints(local_client):
    bulk = build.crystal("rutile", ["Ti", "O"], a=4.594, c=2.959).to_dict()
    r = local_client.post("/api/v1/analysis/terminations", json={"structure": bulk, "miller": [1, 1, 0]})
    assert r.status_code == 200 and [t["label"] for t in r.json()["terminations"]] == ["O·Ti2O2", "Ti2O2", "O·O"]
    r = local_client.post("/api/v1/build/surface", json={"structure": bulk, "miller": [1, 1, 0], "vacuum": 15, "periods": 2,
                                                         "termination": "O·Ti2O2", "supercell": "p(2×1)", "fixBottom": 3})
    assert r.status_code == 200
    slab = facet.Structure.from_dict(r.json()["structure"])
    assert slab.name == "TiO2(110) p(2×1) O·Ti2O2-term 6L" and len(slab) == 24 and slab.constraint_summary()["fixed"] == 12
    r = local_client.post("/api/v1/build/vacuum", json={"structure": slab.to_dict(), "vacuum": 20})
    assert r.status_code == 200 and build.slab_extent(facet.Structure.from_dict(r.json()["structure"]))["gap"] == pytest.approx(20)
    assert local_client.post("/api/v1/build/surface", json={"structure": bulk, "miller": [1, 1, 0]}).status_code == 422
    r = local_client.post("/api/v1/build/surface", json={"structure": bulk, "miller": [1, 1, 0], "vacuum": 1, "periods": 3})
    assert r.status_code == 400 and "is too small" in r.json()["detail"]
    r = local_client.post("/api/v1/build/vacuum", json={"structure": build.molecule("water").to_dict(), "vacuum": 10})
    assert r.status_code == 400 and r.json()["detail"] == "setting the vacuum needs a unit cell"


def test_client_methods(local_client):
    class Through(Client):
        """A client whose requests go to the test app."""

        def request(self, method, path, body=None, **kw):    # noqa: ANN001
            r = local_client.request(method, "/api/v1" + path, json=body)
            assert r.status_code < 400, r.text
            return r.json()

    c = Through()
    bulk = pt()
    assert [t["label"] for t in c.terminations(bulk, (1, 0, 0))["terminations"]] == ["Pt"]
    slab = c.surface(bulk, (1, 0, 0), vacuum=12, layers=6, supercell=[2, 2])
    assert slab.name == "Pt(100) p(2×2) 6L" and len(slab) == 24
    assert build.slab_extent(c.set_vacuum(slab, 18))["gap"] == pytest.approx(18)
