"""Builder tests: atom counts, metadata and geometry sanity; the reference tables shared with the web builder."""

from __future__ import annotations

import argparse
import runpy
import subprocess
import sys
import warnings
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from facet import build
from facet.analysis import distance_matrix
from facet.build.crystal import _FALLBACK_PARAMS, _REF_A, _REF_AB, PROTOTYPES, reference_parameters
from facet.cli import build_parser, main
from facet.io import read

REPO = Path(__file__).resolve().parents[1]
GENERATOR = REPO / "scripts" / "gen_reference_data.py"
REFERENCE_JS = REPO / "facet" / "web" / "js" / "build" / "reference.js"


@pytest.mark.parametrize(
    "prototype, elements, natoms",
    [
        ("sc", "Po", 1), ("bcc", "Fe", 2), ("fcc", "Cu", 4), ("hcp", "Mg", 2), ("diamond", "Si", 8),
        ("zincblende", ["Ga", "As"], 8), ("wurtzite", ["Zn", "O"], 4), ("rocksalt", ["Na", "Cl"], 8),
        ("cscl", ["Cs", "Cl"], 2), ("fluorite", ["Ca", "F"], 12), ("perovskite", ["Sr", "Ti", "O"], 5),
        ("rutile", ["Ti", "O"], 6), ("graphene", "C", 2), ("hbn", ["B", "N"], 2), ("mos2", ["Mo", "S"], 3),
        ("graphite", "C", 4),
    ],
)
def test_prototype_atom_counts(prototype, elements, natoms):
    s = build.crystal(prototype, elements)
    assert len(s) == natoms
    assert s.info["prototype"] == prototype
    assert s.info["spacegroup"] == build.PROTOTYPES[prototype]["spacegroup"]
    assert build.PROTOTYPES[prototype]["atomsPerCell"] == natoms
    # no two atoms closer than 1 Å (minimum image)
    d = distance_matrix(s.positions, s.cell, s.pbc)
    np.fill_diagonal(d, np.inf)
    assert d.min() > 1.0


def test_compositions_and_params():
    assert build.crystal("fluorite", ["Ca", "F"]).formula == "Ca4F8"
    assert build.crystal("fluorite", ["Ca", "F"]).get_formula(reduce=True) == "CaF2"
    assert build.crystal("rutile", ["Ti", "O"]).get_formula(reduce=True) == "TiO2"
    assert build.crystal("perovskite", "Ba Ti O", a=4.0).formula == "BaTiO3"
    assert build.crystal("rocksalt", "MgO").get_formula(reduce=True) == "MgO"
    with pytest.warns(DeprecationWarning, match="vacuum on each side"):
        g = build.crystal("graphene", "C", vacuum=10.0)
    assert abs(g.cell[2, 2] - 20.0) < 1e-9 and g.pbc == [True, True, False]
    w = build.crystal("wurtzite", ["Ga", "N"], u=0.377)
    assert w.info["u"] == 0.377
    hcp = build.crystal("hcp", "Cu", a=2.5)
    assert abs(hcp.info["c"] / 2.5 - np.sqrt(8 / 3)) < 1e-6


def test_crystal_defaults_and_errors():
    cu = build.crystal("fcc", "Cu")
    assert cu.info["a"] == 3.615
    au = build.crystal("fcc", "Au")
    assert au.info["a"] == 4.08
    with pytest.raises(ValueError):
        build.crystal("nonsense", "Cu")
    with pytest.raises(ValueError):
        build.crystal("rocksalt", ["Na"])


def test_supercell_and_prototype_repeat():
    s = build.supercell(build.crystal("fcc", "Cu"), 3, 3, 3)
    assert len(s) == 108 and s.formula == "Cu108"
    s2 = build.crystal("diamond", "Si", repeat=(2, 2, 2))
    assert len(s2) == 64


@pytest.mark.parametrize("shells, natoms", [(1, 1), (2, 13), (3, 55), (4, 147), (5, 309)])
def test_icosahedron_shells(shells, natoms):
    assert len(build.cluster("icosahedron", "Au", shells)) == natoms


@pytest.mark.parametrize("shells, natoms", [(2, 13), (3, 55), (4, 147)])
def test_cuboctahedron_shells(shells, natoms):
    assert len(build.cluster("cuboctahedron", "Cu", shells)) == natoms


def test_other_clusters():
    assert [len(build.cluster("octahedron", "Pt", n)) for n in (2, 3, 4)] == [6, 19, 44]
    assert [len(build.cluster("tetrahedron", "Pd", n)) for n in (2, 3, 4)] == [4, 10, 20]
    assert [len(build.cluster("decahedron", "Ag", n)) for n in (2, 3, 4)] == [7, 23, 54]
    assert len(build.cluster("decahedron", "Ag", 4, ino=1)) < 54
    sph = build.cluster("sphere", "Au", 6.0)
    assert np.linalg.norm(sph.positions, axis=1).max() <= 6.0 + 1e-6
    assert len(build.cluster("sphere", "Au", 3.0)) == 13


def test_cluster_geometry_nearest_neighbour():
    ico = build.cluster("icosahedron", "Cu", 3)
    d = distance_matrix(ico.positions)
    np.fill_diagonal(d, np.inf)
    assert abs(d.min() - 3.61 / np.sqrt(2)) < 0.01  # radial nn = a/sqrt(2)
    assert ico.cell is None and ico.pbc == [False, False, False]
    assert np.allclose(ico.positions.mean(axis=0), 0, atol=1e-9)
    x = build.cluster("cuboctahedron", "Xe", 2, a=6.2)
    d = distance_matrix(x.positions)
    np.fill_diagonal(d, np.inf)
    assert abs(d.min() - 6.2 / np.sqrt(2)) < 1e-6


def test_c60():
    c60 = build.cluster("fullerene")
    assert len(c60) == 60 and set(c60.symbols) == {"C"}
    d = distance_matrix(c60.positions)
    np.fill_diagonal(d, np.inf)
    nn = np.sort(d, axis=1)[:, :3]
    assert np.allclose(np.sort(np.unique(np.round(nn, 3))), [1.391, 1.455])
    assert len(build.molecule("C60")) == 60
    assert build.cluster("fullerene", "B").symbols[0] == "B"


def test_molecules():
    for name in build.molecule_names():
        m = build.molecule(name)
        assert len(m) > 0 and m.cell is None
    assert build.molecule("H2O").formula == "H2O"
    assert build.molecule("caffeine").formula == "C8H10N4O2"
    assert build.molecule("benzene").formula == "C6H6"
    with pytest.raises(ValueError):
        build.molecule("unobtainium")


# ------------------------------------------------- the reference tables (F0-D §3.15.2, ledger-F0 L-F0-29)
def test_reference_js_is_generated_from_the_python_tables():
    """web/js/build/reference.js is what scripts/gen_reference_data.py writes for the tables in build/crystal.py."""
    render = runpy.run_path(str(GENERATOR), run_name="gen_reference_data")["render"]
    assert REFERENCE_JS.read_text(encoding="utf-8") == render(), "run: python scripts/gen_reference_data.py"
    check = subprocess.run([sys.executable, str(GENERATOR), "--check"], capture_output=True, text=True, timeout=120)
    assert check.returncode == 0, check.stderr
    assert check.stdout.strip() == "facet/web/js/build/reference.js is up to date"


@pytest.mark.parametrize("prototype", list(PROTOTYPES))
def test_prototype_defaults_are_the_reference_values_of_the_example(prototype):
    """``defaultA``, ``defaultC`` and ``params`` describe the example compound, as the tables give it."""
    meta = PROTOTYPES[prototype]
    expected = {"a": meta["defaultA"], **({"c": meta["defaultC"]} if meta["hasC"] else {}), **meta["params"]}
    assert reference_parameters(prototype) == expected
    assert reference_parameters(prototype, meta["defaultElements"]) == expected
    assert set(meta["params"]) <= set(_FALLBACK_PARAMS.get(prototype, {}))  # untabulated compounds get a value too
    info = build.crystal(prototype).info
    assert {k: info[k] for k in expected} == expected  # the parameters used are recorded, defaults included
    assert info["spacegroupNumber"] == meta["spacegroupNumber"]


def test_aligned_lattice_constants():
    """Room-temperature values for the fcc, bcc and hcp examples, Python's α-Po, bcc Cr 2.884, MoS2 c = 18 Å."""
    assert reference_parameters("fcc", "Cu") == {"a": 3.615}
    assert reference_parameters("bcc", "Fe") == {"a": 2.866}
    assert reference_parameters("hcp", "Mg") == {"a": 3.209, "c": 5.211}
    assert reference_parameters("sc", "Po") == {"a": 3.359}
    assert reference_parameters("bcc", "Cr") == {"a": 2.884}
    assert reference_parameters("mos2", "MoS2") == {"a": 3.16, "c": 18.0, "thickness": 3.17}
    assert build.crystal("mos2").cell[2, 2] == 18.0
    # untabulated elements: estimated from covalent radii, as before
    assert reference_parameters("fcc", "Mn")["a"] == pytest.approx(2 * 1.39 * np.sqrt(2))
    assert reference_parameters("hcp", "Fe") == pytest.approx({"a": 2.64, "c": 2.64 * np.sqrt(8 / 3)})
    # only a given: hcp keeps the reference c/a; graphite and 2D prototypes keep their c
    assert build.crystal("hcp", "Mg", a=3.0).info["c"] == round(5.211 / 3.209 * 3.0, 6)
    assert build.crystal("graphite", "C", a=2.5).info["c"] == 6.711
    with pytest.raises(ValueError, match="unknown prototype 'nope'"):
        reference_parameters("nope")
    assert reference_parameters("NaCl") == {"a": 5.64}  # the aliases of crystal()


@pytest.mark.parametrize("elements, u", [
    ("ZnO", 0.382), ("GaN", 0.377), ("AlN", 0.382), ("InN", 0.377), ("CdS", 0.377), ("ZnS", 0.375), ("BeO", 0.375),
])
def test_wurtzite_u_per_compound(elements, u):
    s = build.crystal("wurtzite", elements)
    assert s.info["u"] == u and reference_parameters("wurtzite", elements)["u"] == u
    np.testing.assert_allclose(s.frac_positions[2:, 2], [u, 0.5 + u], atol=1e-12)
    given = build.crystal("wurtzite", elements, u=0.38)
    assert given.info["u"] == 0.38
    np.testing.assert_allclose(given.frac_positions[2:, 2], [0.38, 0.88], atol=1e-12)


@pytest.mark.parametrize("elements, thickness", [
    (["Mo", "S"], 3.17), (["W", "S"], 3.14), (["Mo", "Se"], 3.34), (["W", "Se"], 3.34), (["Mo", "Te"], 3.60),
    (["Nb", "Se"], 3.17),
])
def test_mx2_thickness_per_compound(elements, thickness):
    s = build.crystal("mos2", elements)
    z = s.positions[:, 2]
    assert s.info["thickness"] == thickness and reference_parameters("mos2", elements)["thickness"] == thickness
    assert z[2] - z[1] == pytest.approx(thickness) and z[0] == pytest.approx(s.cell[2, 2] / 2)
    assert build.crystal("mos2", elements, thickness=3.0).info["thickness"] == 3.0


def test_atom_order_of_fluorite_and_mos2():
    """Both builders use the Python order: fluorite FCC, FCC + ¼, FCC + ¾ (wrapped); MX2 M, X below, X above."""
    f = build.crystal("fluorite", ["Ca", "F"])
    assert f.symbols == ["Ca"] * 4 + ["F"] * 8
    np.testing.assert_allclose(f.frac_positions[4:], [
        [0.25, 0.25, 0.25], [0.25, 0.75, 0.75], [0.75, 0.25, 0.75], [0.75, 0.75, 0.25],
        [0.75, 0.75, 0.75], [0.75, 0.25, 0.25], [0.25, 0.75, 0.25], [0.25, 0.25, 0.75]], atol=1e-12)
    m = build.crystal("mos2", ["Mo", "S"])
    assert m.symbols == ["Mo", "S", "S"]
    assert m.positions[1, 2] < m.positions[0, 2] < m.positions[2, 2]


def test_hbn_prototype():
    """The 2D prototype hbn (in both languages): a = 2.504 Å, B and N on the honeycomb sites, pbc T T F."""
    s = build.crystal("hbn")
    assert s.symbols == ["B", "N"] and s.pbc == [True, True, False]
    assert s.info["a"] == 2.504 and s.info["c"] == 15.0 and s.info["prototype"] == "hbn"
    assert s.info["spacegroup"] == "P-6m2" and s.name == "BN hbn"
    np.testing.assert_allclose(np.linalg.norm(s.cell, axis=1), [2.504, 2.504, 15.0], atol=1e-12)
    d = distance_matrix(s.positions, s.cell, s.pbc)
    assert d[0, 1] == pytest.approx(2.504 / np.sqrt(3))  # the B-N bond
    assert build.crystal("h-BN", "BN").symbols == ["B", "N"]
    assert PROTOTYPES["hbn"]["is2D"] and PROTOTYPES["hbn"]["atomsPerCell"] == 2
    assert build.crystal("hbn", ["Al", "N"], c=20.0).cell[2, 2] == 20.0


def test_crystal_vacuum_is_per_side_and_deprecated():
    """Lead decision L-02: ``vacuum=`` keeps its meaning (on each side: c = thickness + 2·vacuum) and warns."""
    with pytest.warns(DeprecationWarning, match=r"vacuum on each side.*twice.*Structure\.set_vacuum"):
        g = build.crystal("graphene", "C", vacuum=10.0)
    assert g.to_dict() == build.crystal("graphene", "C", c=20.0).to_dict()
    with pytest.warns(DeprecationWarning):
        m = build.crystal("mos2", ["Mo", "S"], vacuum=8.0)
    assert m.to_dict() == build.crystal("mos2", ["Mo", "S"], c=3.17 + 16.0).to_dict()
    z = m.positions[:, 2]
    assert m.cell[2, 2] - (z.max() - z.min()) == pytest.approx(16.0)  # the gap between periodic images
    with pytest.warns(DeprecationWarning):
        cu = build.crystal("fcc", "Cu", vacuum=5.0)  # ignored by 3D prototypes, as before
    assert cu.to_dict() == build.crystal("fcc", "Cu").to_dict()
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        build.crystal("graphene", "C", c=20.0)
        build.crystal("mos2", ["W", "Se"])


def _subparser(parser: argparse.ArgumentParser, *names: str) -> argparse.ArgumentParser:
    for name in names:
        sub = next(a for a in parser._actions if isinstance(a, argparse._SubParsersAction))
        parser = sub.choices[name]
    return parser


def test_cli_build_crystal_help():
    """M7 §6.7 (W0-CR9): the help of ``build crystal --vacuum`` is the text of lead decision L-02; hbn is listed."""
    bc = _subparser(build_parser(), "build", "crystal")
    text = "vacuum on each side (Å); the gap between periodic images is twice this"
    assert next(a for a in bc._actions if a.dest == "vacuum").help == text
    assert text in " ".join(bc.format_help().split())
    assert sorted(next(a for a in bc._actions if a.dest == "prototype").help.split()) == sorted(PROTOTYPES)


def test_cli_build_crystal_vacuum_note(tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    """``--vacuum`` keeps its meaning and prints the note of M7 §6.7 on stderr instead of a DeprecationWarning."""
    out = tmp_path / "g.xyz"
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        assert main(["build", "crystal", "graphene", "C", "--vacuum", "7.5", "-o", str(out)]) == 0
    assert not [w for w in caught if "vacuum" in str(w.message)]
    note = "facet: note: --vacuum adds vacuum on each side; use 'facet edit vacuum IN --vacuum V' for the total gap"
    assert note in capsys.readouterr().err.splitlines()
    assert read(out).cell[2, 2] == pytest.approx(15.0)
    assert main(["build", "crystal", "hbn", "-o", str(out)]) == 0
    assert "note:" not in capsys.readouterr().err
    s = read(out)
    assert s.symbols == ["B", "N"] and s.pbc == [True, True, False]


# ----------------------------------------------------------------- the web builder (same tables, same rules)
#: Every prototype with representative parameters: its example, tabulated and untabulated elements (covalent-radius
#: estimates and generic parameters), and explicit a, c, u and thickness.  JS gets the parameters as given; Python the
#: same as arguments.  Explicit values have few decimals, like the tables: ``to_dict`` (numpy) and ``toJSON``
#: (``toFixed``) round an exact tie at the sixth decimal differently, which an ``a`` such as 4.833918 can produce.
PARITY_CASES: list[tuple[str, dict[str, Any]]] = [
    ("sc", {}), ("sc", {"elements": ["Cu"]}), ("sc", {"elements": ["Po"], "a": 3.4}),
    ("bcc", {}), ("bcc", {"elements": ["Cr"]}), ("bcc", {"elements": ["W"]}), ("bcc", {"elements": ["Ti"]}),
    ("fcc", {}), ("fcc", {"elements": ["Pt"]}), ("fcc", {"elements": ["Au"]}), ("fcc", {"elements": ["Mn"]}),
    ("fcc", {"elements": ["Cu"], "a": 3.6}),
    ("hcp", {}), ("hcp", {"elements": ["Ti"]}), ("hcp", {"elements": ["Fe"]}), ("hcp", {"elements": ["Mg"], "a": 3.0}),
    ("hcp", {"elements": ["Zn"], "a": 2.7, "c": 5.0}),
    ("diamond", {}), ("diamond", {"elements": ["Ge"]}), ("diamond", {"elements": ["Pb"]}),
    ("zincblende", {}), ("zincblende", {"elements": ["Zn", "S"]}), ("zincblende", {"elements": ["Al", "P"]}),
    ("wurtzite", {}), ("wurtzite", {"elements": ["Ga", "N"]}), ("wurtzite", {"elements": ["Al", "N"]}),
    ("wurtzite", {"elements": ["In", "N"]}), ("wurtzite", {"elements": ["Cd", "S"]}),
    ("wurtzite", {"elements": ["Zn", "S"]}), ("wurtzite", {"elements": ["Be", "O"]}),
    ("wurtzite", {"elements": ["Zn", "O"], "a": 3.3, "u": 0.38}),
    ("rocksalt", {}), ("rocksalt", {"elements": ["Mg", "O"]}), ("rocksalt", {"elements": ["Ba", "O"]}),
    ("cscl", {}), ("cscl", {"elements": ["Cu", "Zn"]}), ("cscl", {"elements": ["Tl", "Br"]}),
    ("fluorite", {}), ("fluorite", {"elements": ["Ce", "O"]}), ("fluorite", {"elements": ["Th", "O"]}),
    ("perovskite", {}), ("perovskite", {"elements": ["Ba", "Ti", "O"]}), ("perovskite", {"elements": ["Pb", "Ti", "O"]}),
    ("rutile", {}), ("rutile", {"elements": ["Sn", "O"]}), ("rutile", {"elements": ["Ge", "O"]}),
    ("rutile", {"elements": ["Ti", "O"], "a": 4.6, "u": 0.3}),
    ("graphene", {}), ("graphene", {"elements": ["Si"]}), ("graphene", {"a": 2.47, "c": 12.0}),
    ("hbn", {}), ("hbn", {"elements": ["Al", "N"]}), ("hbn", {"c": 20.0}),
    ("mos2", {}), ("mos2", {"elements": ["W", "S"]}), ("mos2", {"elements": ["Mo", "Se"]}),
    ("mos2", {"elements": ["W", "Se"]}), ("mos2", {"elements": ["Mo", "Te"]}), ("mos2", {"elements": ["Nb", "Se"]}),
    ("mos2", {"elements": ["Mo", "S"], "c": 20.0, "thickness": 3.2}),
    ("graphite", {}), ("graphite", {"elements": ["C"], "a": 2.5}), ("graphite", {"elements": ["B"]}),
]


def _py_crystal(prototype: str, prm: dict[str, Any]):
    kw = {k: prm[k] for k in ("u", "thickness", "repeat") if k in prm}
    return build.crystal(prototype, prm.get("elements"), a=prm.get("a"), c=prm.get("c"), **kw)


def _document(doc: dict[str, Any]) -> dict[str, Any]:
    """A structure document without its name (M7 aligns the names), empty parts present (JS leaves them out)."""
    doc = {k: v for k, v in doc.items() if k != "name"}
    for key, empty in (("frames", []), ("props", {}), ("info", {})):
        doc.setdefault(key, empty)
    return doc


def test_js_builds_the_same_crystals_as_python(js):
    """F0-D §7.2: per prototype and representative parameters, ``toJSON`` equals ``to_dict`` (the name aside),
    and the Float64 coordinates agree within 1e-9 Å."""
    assert {p for p, _ in PARITY_CASES} == set(PROTOTYPES)
    got = js("""
      const { buildCrystal } = await web('build/crystal.js');
      return input.map(([id, prm]) => { const s = buildCrystal(id, prm); return { doc: s.toJSON(), positions: s.positions }; });
    """, PARITY_CASES)
    for (prototype, prm), res in zip(PARITY_CASES, got, strict=True):
        s = _py_crystal(prototype, prm)
        assert _document(res["doc"]) == _document(s.to_dict()), (prototype, prm)
        np.testing.assert_allclose(np.reshape(res["positions"], (-1, 3)), s.positions, rtol=0, atol=1e-9,
                                   err_msg=f"{prototype} {prm}")


def test_js_repeats_in_the_python_order(js):
    """The Build panel builds 2D prototypes 3×3×1 and the others 2×2×2: same atoms, order and cell as Python."""
    cases = [("graphene", {"repeat": [3, 3, 1]}), ("mos2", {"repeat": [3, 3, 1]}), ("hbn", {"repeat": [3, 3, 1]}),
             ("fluorite", {"repeat": [2, 2, 2]}), ("wurtzite", {"elements": ["Ga", "N"], "repeat": [2, 2, 2]})]
    got = js("""
      const { buildCrystal } = await web('build/crystal.js');
      return input.map(([id, prm]) => { const s = buildCrystal(id, prm); return { symbols: s.symbols, positions: s.positions, cell: s.cell, pbc: s.pbc }; });
    """, cases)
    for (prototype, prm), res in zip(cases, got, strict=True):
        s = _py_crystal(prototype, prm)
        assert res["symbols"] == s.symbols and res["pbc"] == s.pbc, prototype
        np.testing.assert_allclose(np.reshape(res["positions"], (-1, 3)), s.positions, rtol=0, atol=1e-9)
        np.testing.assert_allclose(res["cell"], s.cell, rtol=0, atol=1e-12)


def _reference_cases() -> list[tuple[str, list[str]]]:
    """Every tabulated element and compound, each example, and an untabulated compound per prototype."""
    cases = [(p, list(meta["defaultElements"])) for p, meta in PROTOTYPES.items()]
    cases += [(p, [el]) for p, table in _REF_A.items() for el in table]
    cases += [(p, list(els)) for p, table in _REF_AB.items() for els in table]
    cases += [("sc", ["Cu"]), ("bcc", ["Ti"]), ("fcc", ["Mn"]), ("hcp", ["Fe"]), ("diamond", ["Pb"]),
              ("zincblende", ["Al", "P"]), ("wurtzite", ["Be", "O"]), ("rocksalt", ["Ba", "O"]), ("cscl", ["Tl", "Br"]),
              ("fluorite", ["Th", "O"]), ("perovskite", ["Pb", "Ti", "O"]), ("rutile", ["Ge", "O"]), ("graphene", ["Si"]),
              ("hbn", ["Al", "N"]), ("mos2", ["Nb", "Se"]), ("graphite", ["B"])]
    return cases


def test_js_reference_parameters_equal_python(js):
    """``referenceParameters`` (the Build panel fills a, c, u and thickness in with it) gives exactly the Python values."""
    cases = _reference_cases()
    got = js("""
      const { referenceParameters } = await web('build/crystal.js');
      return input.map(([id, els]) => referenceParameters(id, els));
    """, cases)
    assert got == [reference_parameters(p, els) for p, els in cases]


def test_js_prototype_table_matches_python(js):
    """The web registry has the Python prototypes, with their defaults (generated), roles, lattice and periodicity."""
    got = js("""
      const { prototypes } = await web('build/crystal.js');
      return prototypes.list().map(({ id, defaults, roles, lattice, twoD }) => ({ id, defaults, roles, lattice, twoD: !!twoD }));
    """)
    assert [p["id"] for p in got] and {p["id"] for p in got} == set(PROTOTYPES)
    for p in got:
        meta = PROTOTYPES[p["id"]]
        assert p["defaults"] == {"elements": meta["defaultElements"], "a": meta["defaultA"],
                                 **({"c": meta["defaultC"]} if meta["hasC"] else {}), **meta["params"]}, p["id"]
        assert len(p["roles"]) == meta["nElements"] and p["lattice"] == meta["crystalSystem"]
        assert p["twoD"] == meta["is2D"]


def test_js_builder_errors(js):
    """Unknown prototypes and non-physical lattice constants are refused in the web builder."""
    got = js("""
      const { buildCrystal, referenceParameters } = await web('build/crystal.js');
      const msg = (fn) => { try { fn(); return null; } catch (e) { return e.message; } };
      return [msg(() => referenceParameters('nope')), msg(() => buildCrystal('graphene', { c: 0.2 })),
              msg(() => buildCrystal('fcc', { a: 0 })), msg(() => buildCrystal('hcp', { a: 3, c: 5 }))];
    """)
    assert got == ['Unknown prototype "nope"', "Lattice constant c must be larger than 0.5 Å",
                   "Lattice constant a must be larger than 0.5 Å", None]
