"""The shell of the M2 golden cases (``tests/data/surface/cleave``) and the analytic values they must keep.

The cases run in ``tests/test_cases.py`` and ``tests/js/cases.test.mjs``; until M2-T3, T4, T5, T6a and T6b register
their ops they carry skips.  This file checks, without the generator (``cleave/make_cleave_cases.py``), that every case
follows the op contract of ``cleave/README.md``, that a language skips a case while its op is not registered there and
the reason names the tasks that register it, that the shared recipe ``bulk`` is documented and fails the same way in
both languages, that U2 and U4 hold (pbc T T T for every slab the cleave builds, the vacuum always given), that the
expectations agree with their inputs, and that they still state the analytic results of M2 §0.3 and of the acceptance
scenarios (and the names of ledger L-X-07, verbatim).

It covers the files of :data:`FILES` (the ones the generator writes); files that later tasks add in their own
subdirectories of ``cleave/`` (M2-T7b-lite's ``full/``) bring their own checks (README.md, "Files of later tasks").
"""

from __future__ import annotations

import math
import re
from collections import Counter
from fractions import Fraction
from typing import Any

import numpy as np
import pytest

from facet import Structure
from facet.analysis.vacuum import surface_normal
from facet.io import read

from . import ops  # noqa: F401  (registers every op and recipe)
from .cases import DATA, OPS, RECIPES, load_cases

CLEAVE = DATA / "surface" / "cleave"
#: The files the generator writes (README.md); only these are checked here.
FILES = ("analysis/errors.json", "analysis/inputs.json", "analysis/metals.json", "analysis/oxides.json", "inputs.json",
         "recipes.json", "slab/errors.json", "slab/metals.json", "slab/oxides.json", "slab/vacuum.json",
         "tools/flip.json", "tools/set_vacuum.json", "tools/standardize.json")
#: The subdirectories the generator writes; later tasks put their files in others (M2-T7b-lite: ``full/``).
OWN_DIRS = ("analysis", "inputs", "slab", "tools")
ALL_CLEAVE: list[dict[str, Any]] = [c for c in load_cases() if c["_file"].startswith("surface/cleave/")]
CASES: list[dict[str, Any]] = [c for c in ALL_CLEAVE if c["_file"] in {f"surface/cleave/{f}" for f in FILES}]
BY_ID = {c["id"]: c for c in CASES}
README = (CLEAVE / "README.md").read_text(encoding="utf-8")

#: op -> (id families, the reason of its skips (None: runs now), args).  README.md documents the same.
TERMS_ARGS = {"miller", "millerBasis", "primitive", "translationTolerance", "layerTolerance", "charges",
              "keepMolecules"}
SURFACE_ARGS = {"miller", "vacuum", "layers", "periods", "thickness", "termination", "cut", "symmetric", "position",
                "offset", "supercell", "primitive", "millerBasis", "translationTolerance", "fixBottom", "fixMiddle",
                "fixAxes", "layerTolerance", "charges", "keepMolecules", "name"}
CONTRACT: dict[str, tuple[tuple[str, ...], str | None, set[str]]] = {
    "terminations": (("terms",), "op terminations is registered by M2-T3 (Python) and M2-T6a (JS)", TERMS_ARGS),
    "surface": (("slab",), "op surface is registered by M2-T4 (Python) and M2-T6b (JS)", SURFACE_ARGS),
    "setVacuum": (("vacuum",), "op setVacuum is registered by M2-T5 (Python and JS)",
                  {"vacuum", "position", "offset", "orthogonal", "reorient", "axis"}),
    "flipSlab": (("flip",), "op flipSlab is registered by M2-T5 (Python and JS)", set()),
    "standardizeSlab": (("standardize",), "op standardizeSlab is registered by M2-T5 (Python and JS)", set()),
    "load": (("recipe", "input"), None, set()),
}
#: The fields of SurfaceAnalysis.to_dict() (M2 §6.3 TerminationsResponse): roots of the flattened results.
TERMS_ROOTS = {"miller", "millerInput", "millerBasis", "hkil", "millerConventional", "conventional", "millerPrimitive",
               "primitive", "translationTolerance", "normal", "period", "layersPerPeriod", "mesh", "layerTolerance",
               "layerGrouping", "tasker", "charges", "chargesSource", "defaultLayers", "suggestedLayers", "layers",
               "cuts", "terminations", "notes", "warnings"}
TERMS_DERIVED = {"terminationCount", "labels", "brokenBonds", "polar", "stack", "gapsBelow", "topIndices"}
SLAB_RESULTS = {"structure", "warnings", "surface", "zRange", "volume", "minDistance"}
BULK_ARGS = ("prototype", "elements", "a", "c", "u", "thickness", "repeat", "name")
SQ3 = math.sqrt(3.0)


def of(*ops_: str, errors: bool = False) -> list[dict[str, Any]]:
    return [c for c in CASES if c["op"] in ops_ and (("error" in c["expect"]) == errors)]


def ids(cases: list[dict[str, Any]]) -> list[str]:
    return [c["id"] for c in cases]


def bulk_of(case: dict[str, Any]) -> Structure:
    """The input of a case as a Structure (the recipe as registered, a file read with the format of its name)."""
    inp = case["input"]
    if "recipe" in inp:
        return RECIPES[inp["recipe"]["name"]](dict(inp["recipe"].get("args", {})))
    if "file" in inp:
        return read(DATA / inp["file"])
    return Structure.from_dict(inp["structure"])


def close(a: float, b: float, tol: float = 1e-6) -> bool:
    return abs(a - b) <= tol


def relabelling(s: Structure) -> list[int]:
    """M2 §3.14 steps 1-3 (also the first steps of flip_slab and standardize_slab): new axis i is the input's axis
    ``perm[i]``: the vacuum axis k of F0-D ``surface_normal`` moves to c by ``(a, b, c) <- (a_k+1, a_k+2, a_k)``, then
    a left-handed cell swaps a and b.  pbc, the flag columns and the supercell record follow the axes."""
    k = surface_normal(s)["axis"]
    perm = [0, 1, 2] if k == 2 else [(k + 1) % 3, (k + 2) % 3, k]
    if np.linalg.det(s.cell[perm]) < 0:
        perm = [perm[1], perm[0], perm[2]]
    return perm


def reduced_gram(a: Any, b: Any) -> tuple[float, float, float]:
    """``(|u|², |v|², |u·v|)`` of the Lagrange-reduced basis of the lattice spanned by a and b: the same numbers for
    the same lattice in any basis and any orientation."""
    u, v = np.array(a, float), np.array(b, float)
    for _ in range(1000):
        if u @ u > v @ v:
            u, v = v, u
        mu = round((u @ v) / (u @ u))
        if mu == 0:
            break
        v = v - mu * u
    return float(u @ u), float(v @ v), abs(float(u @ v))


# ------------------------------------------------------------------------------------------------ the shell
def test_files_load_with_the_shared_loader():
    assert sorted({c["_file"] for c in CASES}) == [f"surface/cleave/{f}" for f in FILES]
    later = sorted({c["_file"] for c in ALL_CLEAVE} - {c["_file"] for c in CASES})
    assert all(f.count("/") >= 3 and f.split("/")[2] not in OWN_DIRS for f in later), \
        f"files of later tasks go to their own subdirectories of cleave/ (README.md): {later}"
    assert len(CASES) >= 150
    assert {c["op"] for c in CASES} == set(CONTRACT)
    for name in FILES:
        assert (CLEAVE / name).read_text(encoding="utf-8").startswith('{\n  "schema": "facet.cases/1"'), name
    inputs = sorted(p.name for p in (CLEAVE / "inputs").iterdir())
    assert inputs and all(n.endswith(".vasp") for n in inputs)
    used = {c["input"]["file"].rsplit("/", 1)[1] for c in CASES if "file" in c.get("input", {})}
    assert set(inputs) <= used | {"al2o3_noise_0.02.vasp"}, "every input file is used (or documented as M2-T3's)"
    assert all(c.get("note") for c in CASES), "every case says where its expectation comes from"


@pytest.mark.parametrize("case", CASES, ids=ids(CASES))
def test_case_follows_the_op_contract(case: dict[str, Any]):
    families, _, args = CONTRACT[case["op"]]
    assert any(case["id"].startswith(f"m2-{f}-") for f in families), "ids are m2-<family>-<name> (M7 §4.3)"
    assert "input" in case, "every case has an input"
    assert set(case.get("args", {})) <= args, f"unknown args {set(case.get('args', {})) - args}"
    expect = case["expect"]
    if "error" in expect:
        text = expect["error"]
        assert text == text.strip() and not text.endswith(".") and not text[0].isupper(), \
            "API errors are lower case without a final full stop (M2 §3.20)"
        assert "tol" not in case
        return
    for key in expect:
        root = key.split(".", 1)[0]
        if case["op"] == "terminations":
            assert key in TERMS_DERIVED or root in TERMS_ROOTS, f"unknown result {key!r}"
        elif case["op"] == "load":
            assert key == "structure"
        else:
            assert key in SLAB_RESULTS or key.startswith("surface."), f"unknown result {key!r}"
    if case["op"] != "load":
        assert case.get("tol") == {"value": 1e-6}


@pytest.mark.parametrize("case", CASES, ids=ids(CASES))
def test_skips_name_the_op_and_the_tasks_that_register_it(case: dict[str, Any]):
    reason = CONTRACT[case["op"]][1]
    if reason is None:
        assert "skip" not in case and "xfail" not in case, "the recipe and input checks run now"
        return
    skip = case.get("skip", {})
    assert set(skip) <= {"py", "js"} and all(v == reason for v in skip.values()), skip
    assert "xfail" not in case


@pytest.mark.parametrize("case", CASES, ids=ids(CASES))
def test_python_skips_while_its_op_is_not_registered(case: dict[str, Any]):
    """A language that has not registered the op must skip with the documented reason; registering the op does not
    remove the skips (M2-T7c and M2-T7b-lite do that once both languages pass, README.md "Skips")."""
    if case["op"] not in OPS:
        assert case.get("skip", {}).get("py") == CONTRACT[case["op"]][1]


def test_js_skips_while_its_op_is_not_registered(js):
    registered = set(js("const { OPS, loadOps } = await repo('tests/js/cases.mjs'); await loadOps(); "
                        "return [...OPS.keys()];"))
    assert "load" in registered
    wrong = [c["id"] for c in CASES if c["op"] not in registered
             and c.get("skip", {}).get("js") != CONTRACT[c["op"]][1]]
    assert not wrong, f"cases without the JS skip of an op tests/js/ops does not register: {wrong[:10]}"


# ------------------------------------------------------------------------------------------------ the recipe
def test_the_recipe_is_documented():
    names = {c["input"]["recipe"]["name"] for c in CASES if "recipe" in c.get("input", {})}
    assert names == {"bulk"}
    assert "## The recipe `bulk`" in README
    for arg in BULK_ARGS:
        assert f"| `{arg}` |" in README or f"`{arg}`," in README or f"| `{arg}`" in README, arg
    assert "bulk" in RECIPES
    every = [c for c in load_cases() if c.get("input", {}).get("recipe", {}).get("name") == "bulk"]
    for c in every:      # other modules reuse bulk: only the documented arguments
        assert set(c["input"]["recipe"].get("args", {})) <= set(BULK_ARGS), c["id"]


BAD_BULK = [
    {"prototype": "nacl", "elements": ["Na", "Cl"], "a": 5.64},
    {"prototype": "fcc", "elements": ["Pt"]},
    {"prototype": "fcc", "elements": ["Pt"], "a": 3.92, "c": 3.92},
    {"prototype": "hcp", "elements": ["Ru"], "a": 2.71},
    {"prototype": "fcc", "elements": ["Pt", "Pd"], "a": 3.9},
    {"prototype": "rocksalt", "elements": ["Na"], "a": 5.64},
    {"prototype": "fcc", "elements": "Pt", "a": 3.92},
    {"prototype": "fcc", "elements": ["Pt"], "a": 0.3},
    {"prototype": "fcc", "elements": ["Pt"], "a": 3.92, "u": 0.3},
    {"prototype": "wurtzite", "elements": ["Zn", "O"], "a": 3.25, "c": 5.2, "thickness": 3.0},
    {"prototype": "rutile", "elements": ["Ti", "O"], "a": 4.6, "c": 2.96, "u": -1},
    {"prototype": "fcc", "elements": ["Pt"], "a": 3.92, "repeat": [2, 2]},
    {"prototype": "fcc", "elements": ["Pt"], "a": 3.92, "name": ""},
    {"prototype": "fcc", "elements": ["Pt"], "a": 3.92, "vacuum": 10},
]


def test_bulk_fails_the_same_way_in_both_languages(js):
    py = []
    for args in BAD_BULK:
        with pytest.raises(ValueError) as exc:
            RECIPES["bulk"](dict(args))
        py.append(str(exc.value))
    assert all(m.startswith("recipe bulk: ") for m in py)
    got = js("const { RECIPES, loadOps } = await repo('tests/js/cases.mjs'); await loadOps();"
             "const out = []; for (const a of input) { try { RECIPES.get('bulk')(a); out.push(null); }"
             " catch (e) { out.push(e.message); } } return out;", BAD_BULK)
    assert got == py


def test_bulk_builds_what_acceptance_0_4_says():
    """Acceptance §0.4: the bulks with explicit lattice constants (the recipe passes them through)."""
    pt = RECIPES["bulk"]({"prototype": "fcc", "elements": ["Pt"], "a": 3.92})
    assert len(pt) == 4 and np.allclose(pt.cell, np.eye(3) * 3.92)
    zno = RECIPES["bulk"]({"prototype": "wurtzite", "elements": ["Zn", "O"], "a": 3.25, "c": 5.207, "u": 0.382})
    assert zno.symbols == ["Zn", "Zn", "O", "O"] and math.isclose(zno.positions[2][2], 0.382 * 5.207)
    g = RECIPES["bulk"]({"prototype": "graphene", "elements": ["C"], "a": 2.46, "c": 15.0, "name": "graphene"})
    assert g.name == "graphene" and list(g.pbc) == [True, True, False] and math.isclose(g.cell[2][2], 15.0)


# ------------------------------------------------------------------------------------------------ U2 and U4
def test_every_cleaved_slab_is_periodic_in_three_dimensions():
    for c in of("surface"):
        assert c["expect"]["structure"]["pbc"] == [True, True, True], c["id"]
    for c in of("setVacuum", "flipSlab", "standardizeSlab"):    # the tools keep the input's pbc, relabelled
        s = bulk_of(c)
        assert c["expect"]["structure"]["pbc"] == [bool(s.pbc[i]) for i in relabelling(s)], c["id"]
    kept = {c["id"] for c in of("setVacuum", "standardizeSlab")
            if c["expect"]["structure"]["pbc"] == [True, True, False]}
    assert kept == {"m2-vacuum-graphene-20", "m2-vacuum-mos2-20", "m2-standardize-graphene", "m2-vacuum-along-a-pbc"}
    assert list(bulk_of(BY_ID["m2-vacuum-along-a-pbc"]).pbc) == [False, True, True], "pbc F T T becomes T T F"


def test_the_vacuum_is_always_given():
    for c in CASES:
        if c["op"] in ("surface", "setVacuum"):
            assert "vacuum" in c["args"], c["id"]
    assert BY_ID["m2-slab-vacuum-null"]["args"]["vacuum"] is None
    assert BY_ID["m2-slab-vacuum-null"]["expect"]["error"].startswith("vacuum is required: the total gap")
    zero = [c for c in of("surface") if c["args"]["vacuum"] == 0]
    assert len(zero) >= 8
    assert all(c["expect"]["surface.stacking"] == "bulk" for c in zero if "surface.stacking" in c["expect"])
    zero_error = BY_ID["m2-vacuum-contcar-zero"]["expect"]["error"]
    assert zero_error.startswith("a vacuum of 0 Å is only possible when cleaving")


# ------------------------------------------------------------------------------------------------ consistency
def _lattice_points(case: dict[str, Any], bulk: Structure) -> int:
    """Lattice points per input cell, from the composition of one period (the stack) and the input's."""
    e = case["expect"]
    if "stack" not in e:            # the noisy inputs: primitive lattices, or primitive=False
        return 1
    per_cell: Counter = Counter()
    for comp in e["stack"]:
        per_cell.update(comp)
    have = Counter(bulk.symbols)
    ratio = {Fraction(have[el], n) for el, n in per_cell.items()}
    assert len(ratio) == 1 and set(per_cell) == set(have), (dict(per_cell), dict(have))
    n = ratio.pop()
    assert n.denominator == 1
    return int(n)


@pytest.mark.parametrize("case", of("terminations"), ids=ids(of("terminations")))
def test_terminations_agree_with_their_input(case: dict[str, Any]):
    e = case["expect"]
    m, n = e["layersPerPeriod"], e["terminationCount"]
    if "stack" in e:
        assert len(e["stack"]) == m and len(e["gapsBelow"]) == m and all(g > 0 for g in e["gapsBelow"])
    else:
        assert "noise" in case["id"], "only the noisy inputs leave out the noise-dependent layer view"
    for key in ("labels", "brokenBonds", "polar"):
        if key in e:
            assert len(e[key]) == n, key
    if "labels" in e:
        assert len(set(e["labels"])) == n
    if "topIndices" in e:
        assert sorted(i for t in e["topIndices"] for i in t) == list(range(m)), "every cut belongs to one termination"
    if "brokenBonds" in e and "polar" in e:    # K7: non-polar first, then fewer broken bonds
        keys = [(int(p), b) for p, b in zip(e["polar"], e["brokenBonds"])]
        assert keys == sorted(keys)
    if {"mesh.a", "mesh.b", "mesh.gamma"} <= set(e):
        assert close(e["mesh.area"], e["mesh.a"] * e["mesh.b"] * math.sin(math.radians(e["mesh.gamma"])))
        assert 90.0 - 1e-6 <= e["mesh.gamma"] <= 120.0 + 1e-6, "the obtuse convention (M2 K4)"
    bulk = bulk_of(case)
    lp = _lattice_points(case, bulk) if e["primitive"] else 1
    assert close(e["period"] * e["mesh.area"] * lp, abs(np.linalg.det(bulk.cell)), 1e-5), \
        "area x period is the primitive cell volume"
    if e["layerGrouping"] == "planes" and "gapsBelow" in e:
        assert close(sum(e["gapsBelow"]), e["period"]), "flat planes: the gaps fill the period"
    if e["layerGrouping"] == "merged":
        assert sum(e["gapsBelow"]) < e["period"] and e["layerTolerance"] < min(e["gapsBelow"])
    if e["hkil"] is not None:
        h, k, i, l = e["hkil"]
        assert i == -(h + k)
        if e.get("conventional") is None:
            assert [h, k, l] == e["miller"]
    else:
        assert len(case["args"]["miller"]) == 3


@pytest.mark.parametrize("case", of("surface"), ids=ids(of("surface")))
def test_slabs_agree_with_their_input(case: dict[str, Any]):
    e, a = case["expect"], case["args"]
    st = e["structure"]
    v = a["vacuum"]
    if "props" in st:
        tags, sym = st["props"]["tags"], st["symbols"]
        L = max(tags)
        assert len(tags) == len(sym) and sorted(set(tags)) == list(range(1, L + 1))
        blocks = list(dict.fromkeys(sym))
        assert sym == sorted(sym, key=blocks.index), "atoms in element blocks (M2 K12)"
        for el in blocks:     # within a block bottom to top: tags never increase
            t = [tg for s, tg in zip(sym, tags) if s == el]
            assert t == sorted(t, reverse=True), el
        assert blocks == list(dict.fromkeys(bulk_of(case).symbols)), "the bulk's element order"
        flags = st["props"]["selective_dynamics"]
        if flags is None:
            assert "fixBottom" not in a and "fixMiddle" not in a
        else:
            fixed = {tg for tg, f in zip(tags, flags) if f != [True, True, True]}
            n_fix = a.get("fixBottom") or a.get("fixMiddle")
            assert len(fixed) == n_fix
            if "fixBottom" in a:
                assert fixed == set(range(L - n_fix + 1, L + 1)), "the bottom layers have the largest tags"
            axes = a.get("fixAxes", "abc")
            assert all(f == [ax not in axes for ax in "abc"] for tg, f in zip(tags, flags) if tg in fixed)
        if "surface.layers" in e:
            assert e["surface.layers"] == L and st["name"].endswith(f" {L}L")
        if "surface.asBuilt.composition" in e:
            assert e["surface.asBuilt.composition"] == dict(Counter(sym))
    if "surface.thickness" in e:
        t = e["surface.thickness"]
        assert close(e["zRange"][1] - e["zRange"][0], t), "the z range spans the thickness"
        assert e["surface.vacuum"] == v
        if v > 0:
            assert close(st["cell"][2][2], t + v) and st["cell"][2][:2] == [0, 0], "U4-d: c = thickness + V along z"
            assert close(e["zRange"][0], v / 2), "centred: the lowest atom at V/2"
            assert st["cell"][0][1:] == [0, 0] and st["cell"][1][2] == 0, "a along x, b in the xy plane (U2-a)"
        else:
            assert close(e["zRange"][0], 0.0) and e["surface.stacking"] == "bulk"
    if "volume" in e:
        assert v == 0 and e["minDistance"] > 1.0
    if "supercellMatrix" in st.get("info", {}) and st["info"]["supercellMatrix"] is not None:
        S = np.array(st["info"]["supercellMatrix"])
        det = round(np.linalg.det(S))
        assert det > 0 and S[2].tolist() == [0, 0, 1] and S[:, 2].tolist() == [0, 0, 1]
        assert e["surface.asBuilt.supercell"] == S[:2, :2].tolist()
        assert len(st["symbols"]) % det == 0
    if "surface.autoName" in e:
        assert e["surface.autoName"] == (None if "name" in a else st["name"])


@pytest.mark.parametrize("case", of("setVacuum", "flipSlab", "standardizeSlab"),
                         ids=ids(of("setVacuum", "flipSlab", "standardizeSlab")))
def test_tool_results_agree_with_their_input(case: dict[str, Any]):
    e = case["expect"]
    st = e["structure"]
    s = bulk_of(case)
    if "positions" in st:
        z = np.array(st["positions"])[:, 2]
        assert len(st["positions"]) == len(st["symbols"]) == len(s)
        assert close(z.min(), e["zRange"][0]) and close(z.max(), e["zRange"][1])
        assert Counter(st["symbols"]) == Counter(s.symbols) and st["symbols"] == list(s.symbols), "no atom is reordered"
    cell = np.array(st["cell"])
    assert np.linalg.det(cell) > 0, "right-handed afterwards"
    perm = relabelling(s)
    sd = s.props.get("selective_dynamics")
    if "selective_dynamics" in st.get("props", {}):      # M2 §3.14 steps 2-3: the flag columns follow the axes
        assert sd is not None and st["props"]["selective_dynamics"] == [[bool(f[i]) for i in perm] for f in sd]
    record = s.info.get("supercellMatrix")
    if record is not None and case["op"] != "flipSlab":   # rows and columns of the supercell record too
        assert st["info"]["supercellMatrix"] == [[record[i][j] for j in perm] for i in perm]
    thick = e["zRange"][1] - e["zRange"][0]
    if case["op"] == "setVacuum":
        v = case["args"]["vacuum"]
        assert close(cell[2] @ np.cross(cell[0], cell[1]) / np.linalg.norm(np.cross(cell[0], cell[1])), thick + v)
        assert np.allclose(cell[2][:2], 0), "an orthogonal c (M2 §3.14 step 7)"
        block = e["surface"]
        assert block["kind"] == "vacuum" and block["vacuum"] == v and close(block["thickness"], thick)
        assert list(block) == ["version", "kind", "autoName", "axis", "normal", "thickness", "vacuum", "position",
                               "offset", "stacking"] and block["autoName"] == s.name == st["name"]
        low = v / 2 if case["args"].get("position", "center") == "center" else case["args"]["offset"]
        assert close(e["zRange"][0], low)
    if case["op"] == "standardizeSlab":
        assert close(e["zRange"][0], 0.0) and np.allclose(cell[2][:2], 0)
        assert close(abs(np.linalg.det(cell)), abs(np.linalg.det(s.cell)), 1e-6), "the gap is kept"
        assert e["surface"] is None
    if case["op"] == "flipSlab":
        tags_in = list(s.props["tags"])
        assert st["props"]["tags"] == [max(tags_in) + 1 - t for t in tags_in], "tags reversed"
        z_in = s.positions[:, 2]
        assert np.allclose(np.sort(z_in.min() + z_in.max() - z_in), np.sort(np.array(st["positions"])[:, 2]), atol=1e-6)
        _check_flip(s, st, cell)


def _check_flip(s: Structure, st: dict[str, Any], cell: np.ndarray) -> None:
    """M2 §3.15 and ledger L-M2-04 for these inputs (c along z, a no longer than b, the flipped pair a and -(R b) a
    60° tie or obtuse, so that M1's reduction keeps a first): turned 180° about â (R = 2ââᵀ - I) and back into the
    standard frame, i.e. R_total = Rz(-α)·R with α the angle of a; the same lattice; heights reflected."""
    a, b, c = s.cell
    assert np.allclose(c[:2], 0) and np.cross(a, b)[2] > 0 and np.linalg.norm(a) <= np.linalg.norm(b) + 1e-9
    ah = a / np.linalg.norm(a)
    R = 2.0 * np.outer(ah, ah) - np.eye(3)
    x = (a @ -(R @ b)) / (a @ a)
    assert -0.5 <= x <= 1e-9 or close(x, 0.5, 1e-9), "M1 §3.11.1 keeps a first (obtuse, or the 60° tie)"
    assert np.allclose(cell[0][1:], 0, atol=1e-9) and cell[0][0] > 0 and abs(cell[1][2]) < 1e-9 and cell[1][1] > 0, \
        "a along x, b in the xy plane (the standard frame)"
    assert close(cell[0][0], float(np.linalg.norm(a))) and np.allclose(cell[2], c, atol=1e-6), "a and c kept"
    assert np.allclose(reduced_gram(cell[0], cell[1]), reduced_gram(a, b), atol=1e-6), "the same lattice"
    Rz = np.array([ah, np.cross([0.0, 0.0, 1.0], ah), [0.0, 0.0, 1.0]])
    z = s.positions[:, 2]
    want = s.positions @ (Rz @ R).T + [0.0, 0.0, z.min() + z.max()]
    d = (np.array(st["positions"]) - want) @ np.linalg.inv(cell)
    assert np.abs(d[:, 2]).max() < 1e-6 and np.abs(d[:, :2] - np.round(d[:, :2])).max() < 1e-6, \
        "the positions are the input turned 180° about â (modulo the in-plane lattice)"
    f = (np.array(st["positions"]) @ np.linalg.inv(cell))[:, :2]
    assert f.min() > 1e-3 and f.max() < 1 - 1e-3, "wrapped in-plane, no atom on a cell face (README decision 8)"
    if "info" in st and st["info"].get("supercellMatrix") is not None:   # the record refers to a 120° 1×1 mesh
        one = np.linalg.inv(np.array(st["info"]["supercellMatrix"], float))[:2, :2] @ cell[:2, :2]
        lengths = np.linalg.norm(one, axis=1)
        old = np.linalg.inv(np.array(s.info["supercellMatrix"], float))[:2, :2] @ s.cell[:2, :2]
        assert np.allclose(lengths, np.linalg.norm(old, axis=1), atol=1e-6)
        assert close(math.degrees(math.acos(one[0] @ one[1] / (lengths[0] * lengths[1]))), 120.0, 1e-6)


# ------------------------------------------------------------------------------------------------ analytic values
def _fcc(case: dict[str, Any]) -> tuple[float, tuple[int, int, int]] | None:
    rec = case["input"].get("recipe", {}).get("args", {})
    if rec.get("prototype") != "fcc" or not case["expect"].get("primitive", True):
        return None
    return rec["a"], tuple(case["expect"]["miller"])


FCC_CASES = [c for c in of("terminations") if _fcc(c)]


@pytest.mark.parametrize("case", FCC_CASES, ids=ids(FCC_CASES))
def test_fcc_faces_have_the_textbook_spacing_and_bond_count(case: dict[str, Any]):
    """fcc (hkl): d = a/√N with h, k, l all odd, else a/(2√N); the broken nearest-neighbour bonds per surface cell are
    (|h±k| + |h±l| + |k±l|)/2 for all odd, else |h±k| + |h±l| + |k±l| (the bonds crossing each lattice plane)."""
    a, (h, k, l) = _fcc(case)
    N = h * h + k * k + l * l
    odd = all(x % 2 for x in (h, k, l))
    s = abs(h + k) + abs(h - k) + abs(h + l) + abs(h - l) + abs(k + l) + abs(k - l)
    e = case["expect"]
    assert close(e["period"], a / math.sqrt(N) if odd else a / (2 * math.sqrt(N)))
    assert e["brokenBonds"] == [s // 2 if odd else s]
    assert e["labels"] == [case["input"]["recipe"]["args"]["elements"][0]]
    assert close(e["mesh.area"], (a ** 3 / 4) / e["period"]), "the 1×1 cell holds one atom per plane"


def test_other_lattices_have_their_textbook_values():
    fe = BY_ID["m2-terms-fe110"]["expect"]
    assert close(fe["period"], 2.866 / math.sqrt(2)) and close(fe["mesh.a"], 2.866 * SQ3 / 2)
    assert close(fe["mesh.gamma"], math.degrees(math.acos(-1 / 3))) and fe["mesh.type"] == "centred-rectangular"
    ru = BY_ID["m2-terms-ru0001"]["expect"]
    assert close(ru["period"], 4.28) and ru["gapsBelow"] == [2.14, 2.14] and ru["hkil"] == [0, 0, 0, 1]
    sto = BY_ID["m2-terms-srtio3-001"]["expect"]
    assert sto["gapsBelow"] == [1.9525, 1.9525] and sto["stack"] == [{"O": 2, "Ti": 1}, {"O": 1, "Sr": 1}]
    tio2 = BY_ID["m2-terms-tio2-110"]["expect"]      # rutile u = 0.305: (1 - 2u) and (4u - 1) of a/√2
    d = 4.594 / math.sqrt(2)
    assert np.allclose(tio2["gapsBelow"], [0.39 * d, 0.39 * d, 0.22 * d])
    ceo2 = BY_ID["m2-terms-ceo2-111"]["expect"]       # O-Ce-O 0.781 apart, a/(4√3); trilayers a/(2√3) apart
    assert np.allclose(ceo2["gapsBelow"], [5.411 / (4 * SQ3)] * 2 + [5.411 / (2 * SQ3)])
    zno = BY_ID["m2-terms-zno-10-10"]["expect"]       # independent of u: a/(2√3), a/√3
    assert np.allclose(sorted(zno["gapsBelow"]), [3.25 / (2 * SQ3), 3.25 / SQ3])
    assert close(zno["period"], 3.25 * SQ3 / 2)
    lafeo3 = BY_ID["m2-terms-lafeo3-001"]["expect"]   # K5: the merged gap 0.0392 c plus the 0.01 Å margin
    assert close(lafeo3["layerTolerance"], 0.0392 * 7.862 + 0.01) and lafeo3["layerGrouping"] == "merged"
    # centred rectangular nets (2|u·v| = |u|²): M1's reduction keeps the short vector first (M1 §3.11.1 tie rule)
    for cid, u, v in (("m2-terms-anatase-101", 3.785, math.hypot(3.785 / math.sqrt(2), 9.514 / 2)),   # [010], ½[11-1]
                      ("m2-terms-zno-20-21", 3.25, math.hypot(3.25, 2 * 5.207))):                   # [010], [10-2]
        e = BY_ID[cid]["expect"]
        assert close(e["mesh.a"], u) and close(e["mesh.b"], v) and e["mesh.type"] == "centred-rectangular", cid
        assert close(e["mesh.gamma"], math.degrees(math.acos(-u / (2 * v)))), cid
    rut = BY_ID["m2-terms-tio2-111"]["expect"]        # rutile (111): [10-1] and [01-1], both √(a² + c²)
    side = math.hypot(4.594, 2.959)
    assert close(rut["mesh.a"], side) and close(rut["mesh.b"], side) and rut["mesh.type"] == "centred-rectangular"
    assert close(rut["mesh.gamma"], math.degrees(math.acos(-2.959 ** 2 / side ** 2)))
    for cid, period in (("m2-terms-sic-2h-0001", 2 * 2.513), ("m2-terms-sic-3c-0001", 2.513)):  # 3C: one bilayer
        assert close(BY_ID[cid]["expect"]["period"], period), cid


#: Values acceptance S1-S12 and M2 §0.3 quote (to their digits; A4: 1e-4 Å, 0.01°, 1e-3 Å²).
QUOTES: dict[str, dict[str, float]] = {
    "m2-terms-pt111": {"mesh.a": 2.7719, "mesh.gamma": 120.0, "mesh.area": 6.6538, "period": 2.2632},
    "m2-terms-pt111-input-cell": {"mesh.a": 5.5437, "mesh.area": 26.615},
    "m2-terms-cu100": {"mesh.a": 2.5562, "mesh.area": 6.5341, "period": 1.8075},
    "m2-terms-ag111": {"mesh.a": 2.8921, "period": 2.3614},
    "m2-terms-fe110": {"mesh.a": 2.4820, "mesh.gamma": 109.47, "mesh.area": 5.8082, "period": 2.0266},
    "m2-terms-ru0001": {"mesh.a": 2.7100, "mesh.area": 6.3603, "period": 4.2800},
    "m2-terms-ru10-10": {"mesh.a": 2.706, "mesh.b": 4.282, "period": 2.3435},
    "m2-terms-pt110": {"mesh.a": 2.7719, "mesh.b": 3.9200, "mesh.area": 10.8657, "period": 1.3859},
    "m2-terms-pt211": {"mesh.a": 2.7719, "mesh.b": 6.7896, "mesh.area": 18.820, "period": 0.8002},
    "m2-terms-pt543": {"period": 0.277, "layerTolerance": 0.267},
    "m2-terms-pt1-1-12": {"period": 0.162, "layerTolerance": 0.152},
    "m2-terms-tio2-110": {"mesh.a": 2.9590, "mesh.b": 6.4969, "mesh.area": 19.224, "period": 3.2484},
    "m2-terms-srtio3-001": {"mesh.a": 3.9050, "mesh.area": 15.249, "period": 3.9050},
    "m2-terms-ceo2-111": {"mesh.a": 3.8262, "mesh.area": 12.678, "period": 3.1240},
    "m2-terms-zno-10-10": {"mesh.a": 3.2500, "mesh.b": 5.2070, "mesh.area": 16.923, "period": 2.8146},
    "m2-terms-nacl-100": {"mesh.a": 3.9881, "mesh.area": 15.905, "period": 2.8200},
    "m2-terms-al2o3-0001": {"mesh.a": 4.759, "period": 4.3303},
    "m2-terms-lafeo3-001": {"mesh.a": 5.556, "mesh.b": 5.565, "period": 7.862, "layerTolerance": 0.318},
    "m2-terms-anatase-001": {"period": 4.757, "layerTolerance": 0.409},
    "m2-terms-anatase-101": {"period": 3.517},
}
#: Terminations as the spec lists them: labels in order, broken bonds, polar, Tasker type (M2 §0.3, S8-S11).
TERMINATIONS: dict[str, tuple[list[str], list[int], list[bool], int]] = {
    "m2-terms-tio2-110": (["O·Ti2O2", "Ti2O2", "O·O"], [2, 3, 3], [False, True, True], 2),
    "m2-terms-srtio3-001": (["TiO2", "SrO"], [5, 5], [False, False], 1),
    "m2-terms-ceo2-111": (["O·Ce", "Ce", "O·O"], [2, 4, 4], [False, True, True], 2),
    "m2-terms-zno-10-10": (["ZnO-A", "ZnO-B"], [2, 4], [False, False], 1),
    "m2-terms-ru10-10": (["Ru-A", "Ru-B"], [6, 8], [False, False], 1),
    "m2-terms-nacl-111": (["Na", "Cl"], [3, 3], [True, True], 3),
    "m2-terms-gaas-111": (["Ga", "As"], [1, 3], [True, True], 3),
    "m2-terms-gaas-m1m1m1": (["As", "Ga"], [1, 3], [True, True], 3),
}
#: M2 §0.3 counts: (terminations, layers per period, Tasker type, first label and its bonds).
COUNTS = {"m2-terms-zno-0001": (2, 4, 3, "Zn", 1), "m2-terms-al2o3-0001": (3, 6, 2, "Al·O3", 6),
          "m2-terms-lafeo3-001": (2, 4, 3, "Fe2O4", 8), "m2-terms-anatase-001": (1, 2, 1, "TiO2", 2),
          "m2-terms-anatase-101": (4, 4, 2, "O·TiO", 2), "m2-terms-sic-4h-0001": (4, 8, 3, "Si-A", 1),
          "m2-terms-sic-6h-0001": (6, 12, 3, "Si-A", 1), "m2-terms-la-dhcp-0001": (2, 4, 1, "La-A", 3),
          "m2-terms-sic-2h-0001": (2, 4, 3, "Si", 1), "m2-terms-sic-3c-0001": (2, 2, 3, "Si", 1),
          "m2-terms-tio2-111": (2, 2, 3, "TiO4", 5), "m2-terms-tio2-120": (2, 2, 3, "TiO4", 5),
          "m2-terms-tio2-102": (3, 6, 2, "O·Ti", 10)}
#: The K5 rows of M2 §0.3 as quoted: layers per period, τ_eff (as written: to its digits), grouping, the layers of
#: one period (cyclic, from a top layer down), terminations, Tasker type.
K5_ROWS = {"m2-terms-tio2-111": (2, "0.30", "merged", ["TiO4", "Ti"], 2, 3),
           "m2-terms-tio2-120": (2, "0.30", "merged", ["TiO4", "Ti"], 2, 3),
           "m2-terms-tio2-102": (6, "0.145", "planes", None, 3, 2),
           "m2-terms-zno-20-21": (4, "0.216", "planes", ["Zn", "Zn", "O", "O"], 4, 3),
           "m2-terms-lafeo3-001": (4, "0.318", "merged", ["La2O2", "Fe2O4", "La2O2", "Fe2O4"], 2, 3),
           "m2-terms-anatase-001": (2, "0.409", "merged", ["TiO2", "TiO2"], 1, 1),
           "m2-terms-pt543": (1, "0.267", "planes", ["Pt"], 1, 1),
           "m2-terms-pt1-1-12": (1, "0.152", "planes", ["Pt"], 1, 1)}
#: Slab values of acceptance S1-S12 and M2 §0.3 (Å; natoms exact).
SLABS = {
    "m2-slab-pt111-p3x3-4l-fix2": {"natoms": 36, "a": 8.3156, "c": 21.7896, "thickness": 6.7896, "z0": 7.5,
                                   "z1": 14.2896},
    "m2-slab-cu100-4l-fix2": {"natoms": 4, "c": 20.4225}, "m2-slab-cu100-c2x2": {"natoms": 8, "a": 3.6150},
    "m2-slab-ag111-4l-fix2-c": {"natoms": 4, "thickness": 7.0841, "c": 22.0841},
    "m2-slab-ag111-sqrt3": {"natoms": 12, "a": 5.0092},
    "m2-slab-ru0001-p2x2-4l-fix2": {"natoms": 16, "a": 5.4200, "thickness": 6.4200, "c": 21.4200},
    "m2-slab-pt110-p2x2-6l-fix3": {"natoms": 24, "a": 5.5437, "b": 7.8400, "thickness": 6.9296, "c": 21.9296},
    "m2-slab-pt211-12l": {"natoms": 12, "thickness": 8.8018, "c": 23.8018},
    "m2-slab-fe110-p2x2-4l": {"natoms": 16, "a": 4.9641, "thickness": 6.0797, "c": 21.0797},
    "m2-slab-tio2-110-p2x1-3periods": {"natoms": 36, "a": 5.9180, "b": 6.4969, "thickness": 9.0307, "c": 24.0307},
    "m2-slab-tio2-110-4l": {"natoms": 7, "thickness": 3.25},
    "m2-slab-srtio3-001-tio2-sym7": {"natoms": 18, "thickness": 11.7150, "c": 26.7150},
    "m2-slab-srtio3-001-sro-sym7": {"natoms": 17}, "m2-slab-srtio3-001-8l": {"natoms": 20, "thickness": 13.6675},
    "m2-slab-ceo2-111-3periods": {"natoms": 9, "thickness": 7.8101, "c": 22.8101},
    "m2-slab-zno-10-10-6l": {"natoms": 12, "thickness": 6.5674, "c": 21.5674},
    "m2-slab-zno-10-10-4l": {"natoms": 8, "thickness": 3.7528},
    "m2-slab-zno-10-10-8l": {"natoms": 16, "thickness": 9.3819},
    "m2-slab-zno-0001-4periods": {"natoms": 16, "thickness": 18.839},
    "m2-slab-nacl-100-4l": {"natoms": 8, "thickness": 8.4600, "c": 23.4600},
    "m2-slab-nacl-111-na-sym5": {"natoms": 5},
    "m2-slab-lafeo3-001-4l": {"natoms": 20, "thickness": 6.20},
    "m2-slab-nacl-100-v0": {"natoms": 8, "volume": 179.41, "minDistance": 2.8200},
}
#: The names of ledger L-X-07 and the acceptance scenarios, verbatim.
NAMES = {"m2-slab-pt111-p3x3-4l-fix2": "Pt(111) p(3×3) 4L", "m2-slab-cu100-c2x2": "Cu(100) (√2×√2)R45° 4L",
         "m2-slab-cu100-c2x2-text": "Cu(100) (√2×√2)R45° 4L", "m2-slab-ag111-sqrt3": "Ag(111) (√3×√3)R30° 4L",
         "m2-slab-ru0001-p2x2-4l-fix2": "Ru(0001) p(2×2) 4L", "m2-slab-pt110-p2x2-6l-fix3": "Pt(110) p(2×2) 6L",
         "m2-slab-pt211-12l": "Pt(211) 12L", "m2-slab-fe110-p2x2-4l": "Fe(110) p(2×2) 4L",
         "m2-slab-tio2-110-p2x1-3periods": "TiO2(110) p(2×1) O·Ti2O2-term 9L",
         "m2-slab-srtio3-001-tio2-sym7": "SrTiO3(001) TiO2-term 7L",
         "m2-slab-srtio3-001-sro-sym7": "SrTiO3(001) SrO-term 7L",
         "m2-slab-srtio3-001-8l": "SrTiO3(001) TiO2/SrO-term 8L", "m2-slab-ceo2-111-3periods": "CeO2(111) O·Ce-term 9L",
         "m2-slab-zno-10-10-6l": "ZnO(10-10) ZnO-A-term 6L", "m2-slab-zno-10-10-8l": "ZnO(10-10) ZnO-A-term 8L",
         "m2-slab-nacl-100-4l": "NaCl(100) 4L", "m2-slab-pt-mp-primitive-100": "Pt(-111) 4L",
         "m2-slab-zno-0001-4periods": "ZnO(0001) Zn/O-term 16L", "m2-flip-zno-0001-16l": "ZnO(000-1) O/Zn-term 16L"}


def _digits(x: float) -> int:
    s = repr(float(x))
    return len(s.split(".")[1]) if "." in s and not s.endswith(".0") else 0


def _quoted(name: str, got: float, quoted: float, kind: str = "length") -> None:
    tol = {"length": 1e-4, "angle": 0.01, "area": 1e-3}[kind]
    assert abs(got - quoted) <= max(0.5 * 10.0 ** -_digits(quoted), tol) + 1e-12, f"{name}: {got} vs quoted {quoted}"


@pytest.mark.parametrize("cid", sorted(QUOTES))
def test_surface_cells_are_as_quoted(cid: str):
    e = BY_ID[cid]["expect"]
    for key, quoted in QUOTES[cid].items():
        _quoted(f"{cid} {key}", e[key], quoted,
                "angle" if key.endswith("gamma") else "area" if key.endswith("area") else "length")


def test_terminations_are_as_the_spec_lists_them():
    for cid, (labels, bonds, polar, tasker) in TERMINATIONS.items():
        e = BY_ID[cid]["expect"]
        assert (e["labels"], e["brokenBonds"], e["polar"], e["tasker"]) == (labels, bonds, polar, tasker), cid
    for cid, (count, m, tasker, first, bonds) in COUNTS.items():
        e = BY_ID[cid]["expect"]
        assert (e["terminationCount"], e["layersPerPeriod"], e["tasker"], e["labels"][0], e["brokenBonds"][0]) == \
            (count, m, tasker, first, bonds), cid
    sic = BY_ID["m2-terms-sic-4h-0001"]["expect"]
    assert sic["labels"] == ["Si-A", "Si-B", "C-A", "C-B"] and "topIndices" not in sic, "K7 ties: no cut identities"
    cr = BY_ID["m2-terms-cr2o3-0001"]["expect"]     # M2 §0.3: six planes, the 0.385 Å Cr-Cr gap is not merged
    assert (cr["terminationCount"], cr["layersPerPeriod"], cr["tasker"], cr["layerGrouping"]) == (3, 6, 2, "planes")
    _quoted("Cr2O3 Cr-Cr gap", min(cr["gapsBelow"]), 0.385)
    _quoted("Cr2O3 mesh", cr["mesh.a"], 4.959)
    _quoted("Cr2O3 layer tolerance", cr["layerTolerance"], 0.30)


def _composition(formula: str) -> dict[str, int]:
    return {el: int(n or 1) for el, n in re.findall(r"([A-Z][a-z]?)(\d*)", formula)}


def _same_cycle(a: list[Any], b: list[Any]) -> bool:
    """*a* and *b* are the same cyclic sequence, read either way (the layers of one period)."""
    return len(a) == len(b) and any(a[i:] + a[:i] in (b, b[::-1]) for i in range(len(a)))


def test_the_k5_rows_are_as_quoted():
    """M2 §0.3 and §7.1 (layers and merging, K5): the merged or kept planes, τ_eff, the terminations and the Tasker
    type of the rows v1 got wrong (E7 at 0.3 Å for Pt(543), Pt(1 1 12) and rutile (102), one ZnO (2 0 -2 1)
    termination instead of four) and of the merged LaFeO3 and anatase layers."""
    for cid, (m, tau, grouping, layers, count, tasker) in K5_ROWS.items():
        e = BY_ID[cid]["expect"]
        assert (e["layersPerPeriod"], e["layerGrouping"], e["terminationCount"], e["tasker"]) == \
            (m, grouping, count, tasker), cid
        assert abs(e["layerTolerance"] - float(tau)) <= 0.5 * 10.0 ** -len(tau.split(".")[1]) + 1e-12, cid
        if layers:
            assert _same_cycle([dict(c) for c in e["stack"]], [_composition(f) for f in layers]), cid
    zno = BY_ID["m2-terms-zno-20-21"]["expect"]
    assert "labels" not in zno and "topIndices" not in zno, "Zn·O and Zn·Zn tie in the K7 key: no order between them"
    assert (zno["terminations.0.label"], zno["terminations.3.label"]) == ("O·O", "O·Zn")
    assert zno["brokenBonds"] == [5, 7, 7, 7] and zno["polar"] == [True] * 4 and zno["hkil"] == [2, 0, -2, 1]


@pytest.mark.parametrize("cid", sorted(SLABS))
def test_slabs_are_as_quoted(cid: str):
    e = BY_ID[cid]["expect"]
    st = e["structure"]
    got = {"natoms": len(st["symbols"]), "thickness": e["zRange"][1] - e["zRange"][0], "z0": e["zRange"][0],
           "z1": e["zRange"][1], "volume": e.get("volume"), "minDistance": e.get("minDistance")}
    if "cell" in st:
        cell = np.array(st["cell"])
        got.update(a=float(np.linalg.norm(cell[0])), b=float(np.linalg.norm(cell[1])), c=float(cell[2][2]))
    for key, quoted in SLABS[cid].items():
        if key == "natoms":
            assert got[key] == quoted, cid
        else:
            _quoted(f"{cid} {key}", got[key], quoted, "area" if key == "volume" else "length")


@pytest.mark.parametrize("cid", sorted(NAMES))
def test_names_are_verbatim(cid: str):
    e = BY_ID[cid]["expect"]
    assert e["structure"]["name"] == NAMES[cid]
    assert e["surface.autoName"] == NAMES[cid], "the automatic name and its sentinel (lead decision L-12)"
    assert not re.search(r"\d+x\d", NAMES[cid]), "the multiplication sign is × (C9)"


def test_cleave_info_follows_the_ledger():
    """C-7 and L-X-01: the record of a cleaved slab (the keys acceptance C-7 lists) and S1-4's values."""
    e = BY_ID["m2-slab-pt111-p3x3-4l-fix2"]["expect"]
    want = {"surface.version": 2, "surface.kind": "cleave", "surface.layers": 4, "surface.vacuum": 15.0,
            "surface.stacking": "vacuum", "surface.thickness": 6.789639, "surface.period": 2.263213,
            "surface.layersPerPeriod": 1, "surface.layerTolerance": 0.3, "surface.tasker": 1,
            "surface.termination.count": 1, "surface.termination.brokenBonds": 3, "surface.normal": [0, 0, 1],
            "surface.axis": 2, "surface.asBuilt.supercell": [[3, 0], [0, 3]],
            "surface.asBuilt.fixed": {"layers": 2, "from": "bottom", "axes": "abc"},
            "surface.asBuilt.stoichiometric": True}
    for key, value in want.items():
        assert e[key] == value, key
    info = e["structure"]["info"]
    assert info["source"] == "builder:surface" and info["spacegroup"] is None
    assert info["supercellMatrix"] == [[3, 0, 0], [0, 3, 0], [0, 0, 1]]
    assert e["structure"]["props"]["selective_dynamics"].count([False, False, False]) == 18
    assert all(not k.startswith("surface.bulk.name") for c in of("surface") for k in c["expect"]), "L-11"


def test_warnings_quote_the_spec():
    w9 = "the slab is polar: dipole 9.83 e·Å per cell (1.07 e/Å), from formal charges Zn +2, O -2"
    assert BY_ID["m2-slab-zno-0001-4periods"]["expect"]["warnings"] == {"equals": [w9]}
    assert BY_ID["m2-slab-tio2-110-3periods-v1.5"]["expect"]["warnings"]["equals"] == [
        "the vacuum (1.5 Å) leaves atoms 1.50 Å apart across the cell edge, closer than in the bulk (1.95 Å)"]
    assert BY_ID["m2-slab-tio2-110-v1"]["expect"]["error"] == (
        "the vacuum (1 Å) is too small: atoms would be 1.00 Å apart across the cell edge (shortest distance in the "
        "bulk 1.95 Å); use at least 1.5 Å, or 0 for a bulk-like stacking")
    assert "the slab has a net formal charge of +4 per cell" in \
        BY_ID["m2-slab-tio2-110-ti2o2-symmetric"]["expect"]["warnings"]["contains"]
    assert BY_ID["m2-slab-srtio3-001-tio2-sym7"]["expect"]["warnings"]["equals"] == [
        "the slab is not stoichiometric: Sr3Ti4O11 per cell (bulk SrTiO3), excess TiO2"]


def test_slab_polarity_is_as_quoted():
    """M2 §3.9.2 and §0.3: the dipole about the middle of the slab per cell and per area, the polar flag at 1e-3 e/Å;
    the ZnO(0001) 16L dipole, and the charges and zero dipoles of the symmetric slabs."""
    zno = BY_ID["m2-slab-zno-0001-4periods"]["expect"]
    _quoted("ZnO(0001) 16L dipole density", zno["surface.asBuilt.polarity.dipoleDensity"], 1.075)
    _quoted("ZnO(0001) 16L dipole", zno["surface.asBuilt.polarity.dipole"], 9.83)
    for cid, charge in (("m2-slab-srtio3-001-tio2-sym7", 0.0), ("m2-slab-nacl-111-na-sym5", 1.0),
                        ("m2-slab-tio2-110-ti2o2-symmetric", 4.0)):
        e = BY_ID[cid]["expect"]
        assert e["surface.symmetric"] and e["surface.asBuilt.polarity.netCharge"] == charge, cid
        assert e["surface.asBuilt.polarity.dipole"] == 0.0 and not e["surface.asBuilt.polarity.polar"], cid
    for c in of("surface"):
        e = c["expect"]
        if "surface.asBuilt.polarity.dipole" not in e:
            continue
        S = e.get("surface.asBuilt.supercell", [[1, 0], [0, 1]])
        area = e["surface.meshParams"]["area"] * (S[0][0] * S[1][1] - S[0][1] * S[1][0])
        density = e["surface.asBuilt.polarity.dipoleDensity"]
        assert close(density, e["surface.asBuilt.polarity.dipole"] / area, 1e-5), c["id"]
        assert e["surface.asBuilt.polarity.polar"] == (abs(density) > 1e-3), c["id"]


# ------------------------------------------------------------------------------------------------ the inputs
def test_the_contcar_results_follow_from_the_fixture():
    """M2 §3.14 on the shared fixture: join the two atoms at f = 0.99999 below the slab, centre, c = thickness + V."""
    s = read(DATA / "surface" / "contcar_pt111.vasp")
    f = s.frac_positions.copy()
    f[f[:, 2] > 0.5, 2] -= 1.0
    cart = f @ s.cell
    t = cart[:, 2].max() - cart[:, 2].min()
    assert round(s.cell[2][2] - t, 4) == 14.9998, "acceptance S14-3"
    for v in (15, 20):
        e = BY_ID[f"m2-vacuum-contcar-{v}"]["expect"]
        want = cart + [0.0, 0.0, v / 2 - cart[:, 2].min()]
        assert np.allclose(e["structure"]["positions"], want, atol=1e-8)
        assert close(e["structure"]["cell"][2][2], t + v, 1e-8) and np.allclose(e["structure"]["cell"][:2], s.cell[:2])
        flags = [[bool(x) for x in row] for row in s.props["selective_dynamics"]]
        assert e["structure"]["props"]["selective_dynamics"] == flags
    std = BY_ID["m2-standardize-contcar"]["expect"]["structure"]
    assert np.allclose(std["positions"], cart - [0.0, 0.0, cart[:, 2].min()], atol=1e-8)
    for cid in ("m2-vacuum-along-a", "m2-vacuum-along-a-pbc"):
        assert BY_ID[cid]["expect"]["structure"]["positions"] == \
            BY_ID["m2-vacuum-contcar-15"]["expect"]["structure"]["positions"], cid
    pbc_input = bulk_of(BY_ID["m2-vacuum-along-a-pbc"])        # the along-a file moved 0.1 along a, a declared
    along_a = read(CLEAVE / "inputs" / "contcar_pt111_vacuum_along_a.vasp")
    shift = np.mod(pbc_input.frac_positions - along_a.frac_positions + 0.5, 1.0) - 0.5
    assert np.allclose(shift, [0.1, 0.0, 0.0], atol=1e-12) and np.allclose(pbc_input.cell, along_a.cell)
    assert pbc_input.props["selective_dynamics"] == along_a.props["selective_dynamics"]


def test_the_input_files_are_what_the_readme_says():
    inp = CLEAVE / "inputs"
    QF = np.array([[-1, 1, 1], [1, -1, 1], [1, 1, -1]])
    QI = np.array([[0, 1, 1], [1, 0, 1], [1, 1, 0]])
    QR = np.array([[1, -1, 0], [0, 1, -1], [1, 1, 1]])
    pt = read(inp / "pt_mp_primitive.vasp")
    conv = QF @ pt.cell
    assert np.allclose(conv @ conv.T, np.eye(3) * 3.92 ** 2), "M2 §3.1.1: QF gives the 3.92 Å cube"
    fe = read(inp / "fe_mp_primitive.vasp")
    conv = QI @ fe.cell
    assert np.allclose(conv @ conv.T, np.eye(3) * 2.866 ** 2)
    rh = read(inp / "al2o3_mp_rhombohedral.vasp")
    hexa = QR @ rh.cell
    assert len(rh) == 10 and np.allclose(np.linalg.norm(hexa, axis=1), [4.759, 4.759, 12.991])
    assert math.isclose(hexa[0] @ hexa[1] / 4.759 ** 2, -0.5, abs_tol=1e-9)
    left = read(inp / "contcar_pt111_lefthanded_h.vasp")
    assert np.linalg.det(left.cell) < 0 and left.symbols[int(np.argmax(left.positions[:, 2]))] == "H"
    by_height = {round(float(z), 3): [] for z in left.positions[:12, 2]}      # Pt layers: bottom, middle, top
    for z, f in zip(left.positions[:12, 2], left.props["selective_dynamics"]):
        by_height[round(float(z), 3)].append([bool(x) for x in f])
    assert [rows[0] for _, rows in sorted(by_height.items())] == [[False] * 3, [True, False, True], [True] * 3], \
        "the middle layer is fixed along the file's b (the right-handed a): the expected flags pin the swap"
    h2 = read(inp / "contcar_pt111_h2_floating.vasp")
    z = h2.positions[:, 2]
    zh = z[[i for i, e in enumerate(h2.symbols) if e == "H"]]
    zpt = z[[i for i, e in enumerate(h2.symbols) if e == "Pt"]]
    assert np.allclose(zh, zh[0]) and close(zh[0] - zpt.max(), 7.0)
    assert close(h2.cell[2][2] - (zh[0] - zpt.min()), 13.0), "13 Å of vacuum above the molecule"
    a = read(inp / "contcar_pt111_vacuum_along_a.vasp")
    fix = read(DATA / "surface" / "contcar_pt111.vasp")
    assert np.allclose(a.cell, fix.cell[[2, 0, 1]]) and np.allclose(a.positions, fix.positions, atol=1e-9)
    f_c = fix.frac_positions[:, 2]          # the fixture's flags, but T T F on top and F T T on the third layer
    want = [[True, True, False] if 0.3 < z < 0.5 else [False, True, True] if 0.2 < z < 0.3 else [bool(x) for x in row]
            for z, row in zip(f_c, fix.props["selective_dynamics"])]
    assert a.props["selective_dynamics"] == [[f[2], f[0], f[1]] for f in want], "flag columns as (c, a, b)"
    for name, n, stacking in (("sic_2h.vasp", 4, "AB"), ("sic_3c.vasp", 6, "ACB")):
        sic = read(inp / name)
        assert len(sic) == n and math.isclose(sic.cell[2][2], 2.513 * len(stacking)), name
        sites = sorted({(round(f[0] % 1, 6), round(f[1] % 1, 6)) for f in sic.frac_positions})
        assert len(sites) == len(set(stacking)), name
    rh = read(inp / "sic_3c.vasp")              # 3C in the hexagonal cell of its rhombohedral lattice (obverse)
    f = rh.frac_positions
    for t in ([2 / 3, 1 / 3, 1 / 3], [1 / 3, 2 / 3, 2 / 3]):
        for fi, el in zip(f + t, rh.symbols):
            off = np.abs(np.mod(f - fi + 0.5, 1.0) - 0.5).max(axis=1)
            assert any(d < 1e-6 and e == el for d, e in zip(off, rh.symbols)), "R centring (2/3, 1/3, 1/3)"


@pytest.mark.parametrize("name,ideal,sigma", [
    ("tio2_rutile_noise_0.01", {"prototype": "rutile", "elements": ["Ti", "O"], "a": 4.594, "c": 2.959, "u": 0.305},
     0.01),
    ("tio2_rutile_noise_0.02", {"prototype": "rutile", "elements": ["Ti", "O"], "a": 4.594, "c": 2.959, "u": 0.305},
     0.02),
    ("srtio3_noise_0.02", {"prototype": "perovskite", "elements": ["Sr", "Ti", "O"], "a": 3.905}, 0.02),
    ("zno_noise_0.02", {"prototype": "wurtzite", "elements": ["Zn", "O"], "a": 3.25, "c": 5.207, "u": 0.382}, 0.02),
    ("ru_hcp_noise_0.02", {"prototype": "hcp", "elements": ["Ru"], "a": 2.706, "c": 4.282}, 0.02),
    ("pt_fcc_noise_0.02", {"prototype": "fcc", "elements": ["Pt"], "a": 3.92}, 0.02),
])
def test_noisy_bulks_are_the_ideal_ones_plus_noise_of_sigma(name: str, ideal: dict, sigma: float):
    s = read(CLEAVE / "inputs" / f"{name}.vasp")
    b = RECIPES["bulk"](dict(ideal))
    assert s.symbols == b.symbols and np.allclose(s.cell, b.cell)
    d = (s.frac_positions - b.frac_positions + 0.5) % 1.0 - 0.5
    dev = d @ b.cell
    assert np.abs(dev).max() < 5 * sigma and np.abs(dev).max() > 0.2 * sigma
