"""The shell of the M3 golden cases (``tests/data/surface/layers/*.json``) and the analytic values they must keep.

The cases run in ``tests/test_cases.py`` and ``tests/js/cases.test.mjs``; until M3-T1/T3a/T3b/T5 register their ops
they carry skips.  This file checks, without the generator (``scripts/gen_layer_fixtures.py``), that every case has
the documented op contract (``tests/data/surface/layers/README.md``), that skips name the task that registers the
op and are removed once it does, that pbc T T T is the rule with T T F twins (U2), that the expectations are
consistent with their inputs, and that they still state the analytic results of M3 §7.1: spacings, kappa*
thresholds, the CONTCAR of acceptance S14-3 and the cut of the display (U1).
"""

from __future__ import annotations

import math
import re
from collections import defaultdict
from typing import Any

import numpy as np
import pytest

from crystallume import Structure
from crystallume.analysis.vacuum import display_cuts, unwrap_along_gap
from crystallume.io import read

from . import ops  # noqa: F401  (registers every op and recipe)
from .cases import DATA, OPS, load_cases

LAYERS = DATA / "surface" / "layers"
FILES = ("adsorbates.json", "bonds.json", "exposure.json", "metals.json", "oxides.json", "pt111.json")
CASES: list[dict[str, Any]] = [c for c in load_cases() if c["_file"].startswith("surface/layers/")]
BY_ID = {c["id"]: c for c in CASES}

#: op -> (id family, task that registers it, args, result keys); README.md documents the same.
CONTRACT: dict[str, tuple[str, str, set[str], set[str]]] = {
    "findLayers": ("layers", "M3-T1", {"direction", "tolerance", "indices", "skipAdsorbates", "group"},
                   {"count", "atomLayer", "atomFromTop", "offset", "heights", "compositions", "normal", "direction",
                    "normalSource", "axis", "tolerance", "coords", "period", "vacuum", "straddles", "spansPeriod",
                    "excluded", "adsorbates", "warnings", "group", "stoichiometric", "planeCount"}),
    "findAdsorbates": ("ads", "M3-T3a", {"direction", "tolerance"},
                       {"indices", "source", "notes", "substrateElements"}),
    "markAdsorbates": ("mark", "M3-T3a", {"indices"}, {"promoted", "marked", "adsorbateId"}),
    "bondGraph": ("bonds", "M3-T3a", {"metalPairs", "indices"},
                  {"degree", "indptr", "neighbors", "offsets", "distances", "components"}),
    "surfaceAtoms": ("exposure", "M3-T3b (wave 2)", {"side", "probe", "direction", "tolerance", "skipAdsorbates"},
                     {"atoms", "radius", "top", "bottom", "exposure", "borderline"}),
}
SOURCES = {"adsorbate_id", "tags-oc20", "tags", "geometry", "none"}
#: The parts a skip reason may have (README.md, "Skips"), joined by "; ".
SKIP_PARTS = (re.compile(r"op (\w+) is registered by (M3-T\w+(?: \(wave \d\))?)"),
              re.compile(r"skipAdsorbates needs op (findAdsorbates) \(M3-T3a\)"),
              re.compile(r'group "units" comes with M3-T5 \(wave 2\)'))


def structure(case: dict[str, Any]) -> Structure:
    inp = case["input"]
    return read(DATA / inp["file"]) if "file" in inp else Structure.from_dict(inp["structure"])


def of(op: str) -> list[dict[str, Any]]:
    return [c for c in CASES if c["op"] == op and "error" not in c["expect"]]


# ------------------------------------------------------------------------------------------------ the shell
def test_files_load_with_the_shared_loader():
    assert sorted({c["_file"] for c in CASES}) == [f"surface/layers/{f}" for f in FILES]
    assert len(CASES) >= 200
    for name in FILES:
        assert (LAYERS / name).read_text(encoding="utf-8").lstrip().startswith("{"), name
    assert all(c.get("note") is None or isinstance(c["note"], str) for c in CASES)
    assert {c["op"] for c in CASES} == set(CONTRACT)


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_case_follows_the_op_contract(case: dict[str, Any]):
    family, _, args, results = CONTRACT[case["op"]]
    assert case["id"].startswith(f"m3-{family}-"), "ids are m3-<family>-<name> (M7 §4.3: module prefix)"
    assert set(case.get("args", {})) <= args, f"unknown args {set(case['args']) - args}"
    expect = case["expect"]
    if "error" in expect:
        assert isinstance(expect["error"], str) and expect["error"] == expect["error"].strip()
        assert expect["error"][0].islower() and not expect["error"].endswith("."), "M3 §3.16: lower case, no full stop"
        return
    assert set(expect) <= results, f"unknown results {set(expect) - results}"
    assert set(case.get("tol", {})) <= set(expect)


def _skip_parts(reason: str) -> list[re.Match]:
    out = []
    for part in reason.split("; "):
        m = next((p.fullmatch(part) for p in SKIP_PARTS if p.fullmatch(part)), None)
        assert m is not None, f"unexpected skip reason part {part!r}"
        out.append(m)
    return out


def _stale(reason: str, registered: set[str]) -> list[str]:
    """The parts of *reason* that name an op already registered (they must be deleted)."""
    return [m.group(0) for m in _skip_parts(reason) if m.groups() and m.group(1) in registered]


@pytest.mark.parametrize("case", CASES, ids=[c["id"] for c in CASES])
def test_skip_names_the_task_that_registers_the_op(case: dict[str, Any]):
    skip = case.get("skip", {})
    op = case["op"]
    if op not in OPS:
        assert set(skip) == {"py", "js"} and skip["py"] == skip["js"], "an unregistered op skips both languages"
        first = _skip_parts(skip["py"])[0]
        assert first.groups() == (op, CONTRACT[op][1]), f"the first part names {op} and {CONTRACT[op][1]}"
    if "py" in skip:
        stale = _stale(skip["py"], set(OPS))
        assert not stale, f"{case['id']}: these ops are registered now, delete from skip.py: {stale}"


def test_js_skips_are_not_stale(js):
    registered = set(js("const { OPS, loadOps } = await repo('tests/js/cases.mjs'); await loadOps(); "
                        "return [...OPS.keys()];"))
    stale = {c["id"]: _stale(c["skip"]["js"], registered) for c in CASES if "js" in c.get("skip", {})}
    stale = {k: v for k, v in stale.items() if v}
    assert not stale, f"ops registered in tests/js/ops now, delete from skip.js: {stale}"


def test_pbc_ttt_is_the_rule_and_every_file_has_ttf_twins():
    counts: dict[str, dict[tuple[bool, ...], int]] = defaultdict(lambda: defaultdict(int))
    for c in CASES:
        counts[c["_file"]][tuple(structure(c).pbc)] += 1
    for name, by_pbc in counts.items():
        ttt, ttf = by_pbc.get((True, True, True), 0), by_pbc.get((True, True, False), 0)
        assert ttf >= 1 and ttt > ttf, f"{name}: {dict(by_pbc)} (U2: T T T first, T T F twins)"


# ------------------------------------------------------------------------------------------------ consistency
@pytest.mark.parametrize("case", of("findLayers"), ids=[c["id"] for c in of("findLayers")])
def test_layer_expectations_match_their_input(case: dict[str, Any]):
    s, e = structure(case), case["expect"]
    n, L = len(s), e["count"]
    assert len(e["atomLayer"]) == len(e["atomFromTop"]) == len(e["offset"]) == n
    assert len(e["heights"]) == len(e["compositions"]) == L
    assert all(b > a for a, b in zip(e["heights"], e["heights"][1:])), "rows bottom first"
    rows: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for i, (k, t) in enumerate(zip(e["atomLayer"], e["atomFromTop"])):
        assert (k, t) == (-1, -1) or (0 <= k < L and t == L - 1 - k)
        if k >= 0:
            rows[k][s.symbols[i]] += 1
    assert [dict(rows[k]) for k in range(L)] == e["compositions"]
    for i in e["excluded"]:
        assert e["atomLayer"][i] == -1
    if "skipAdsorbates" in case.get("args", {}):
        assert e["adsorbates"]["indices"] == e["excluded"] and e["adsorbates"]["source"] in SOURCES
    else:
        assert e["adsorbates"] is None and e["excluded"] == []
    assert math.isclose(float(np.linalg.norm(e["normal"])), 1.0, abs_tol=1e-12)
    assert e["coords"] in ("invariant", "periodic", "wrapped")
    assert (e["period"] is None) == (e["coords"] != "periodic")
    assert e["vacuum"] is None or e["coords"] == "periodic"
    if e["coords"] != "periodic":
        assert e["offset"] == [0] * n
    assert e["straddles"] == (len({e["offset"][i] for i in range(n) if e["atomLayer"][i] >= 0}) > 1)
    if case.get("args", {}).get("group") == "units":
        assert e["stoichiometric"] is None or len(e["stoichiometric"]) == L


@pytest.mark.parametrize("case", [c for c in of("findLayers") if c["expect"]["vacuum"] is not None],
                         ids=[c["id"] for c in of("findLayers") if c["expect"]["vacuum"] is not None])
def test_the_slab_axis_is_cut_where_the_display_cuts(case: dict[str, Any]):
    """U1: along the slab axis the rows unroll the atoms with the display's cut (F0 ledger L-F0-16)."""
    s, e = structure(case), case["expect"]
    axis = e["axis"]
    f = s.frac_positions[:, axis]
    cut = display_cuts(s)[axis]
    assert cut is not None
    assert e["offset"] == np.rint(f - unwrap_along_gap(f, cut)).astype(int).tolist()
    assert math.isclose(e["period"], float(abs(np.linalg.det(s.cell)) / np.linalg.norm(
        np.cross(s.cell[(axis + 1) % 3], s.cell[(axis + 2) % 3]))), abs_tol=1e-6)


def test_other_expectations_match_their_inputs():
    for c in of("findAdsorbates"):
        s, e = structure(c), c["expect"]
        assert e["source"] in SOURCES and e["indices"] == sorted(set(e["indices"]))
        assert all(0 <= i < len(s) for i in e["indices"]) and (e["source"] == "none") == (not e["indices"])
        ids = s.props.get("adsorbate_id")
        if ids is not None and any(v > 0 for v in ids):
            assert e["source"] == "adsorbate_id" and e["indices"] == [i for i, v in enumerate(ids) if v > 0], c["id"]
    for c in of("markAdsorbates"):
        assert len(c["expect"]["adsorbateId"]) == len(structure(c))
    for c in of("bondGraph"):
        n, e = len(structure(c)), c["expect"]
        assert len(e["degree"]) == n
        assert sorted(i for comp in e["components"] for i in comp["members"]) == list(range(n))
        if "indptr" in e:
            assert len(e["indptr"]) == n + 1 and np.diff(e["indptr"]).tolist() == e["degree"]
            m = e["indptr"][-1]
            assert len(e["neighbors"]) == len(e["offsets"]) == len(e["distances"]) == m
            assert all(0.4 < d < 5.0 for d in e["distances"])
    for c in of("surfaceAtoms"):
        n, e = len(structure(c)), c["expect"]
        kappa = c.get("args", {}).get("probe", 0.70)
        assert e["atoms"] == sorted(set(e["atoms"])) and all(0 <= i < n for i in e["atoms"])
        if "exposure" in e:  # exposed <=> kappa* >= kappa (null: nothing above, or left out as an adsorbate)
            k = e["exposure"]
            assert len(k) == n
            assert all(k[i] is None or k[i] >= kappa - 1e-6 for i in e["atoms"]), c["id"]
            assert all(k[i] is None or k[i] < kappa for i in set(range(n)) - set(e["atoms"])), c["id"]
            assert all(k[i] is not None and abs(k[i] - kappa) < 0.10 for i in e["borderline"]), c["id"]
        else:
            assert sorted(set(e["top"]) | set(e["bottom"])) == e["atoms"]


# ------------------------------------------------------------------------------------------------ analytic values
A = {"Pt": 3.92, "Cu": 3.615, "Ag": 4.086, "Fe": 2.866}
#: Row spacings of M3 §7.1 (Å) and the value it quotes, where it quotes one.
SPACINGS: dict[str, tuple[float, float | None]] = {
    **{f"m3-layers-pt111-p3x3-4l-{t}": (A["Pt"] / math.sqrt(3), 2.2632)
       for t in ("centred", "bottom-at-0", "bottom-below-0", "across-boundary", "shuffled", "ttf", "direction-c",
                 "direction-z", "direction-normal")},
    "m3-layers-pt111-p6x6-6l": (A["Pt"] / math.sqrt(3), 2.2632),
    "m3-layers-pt111-vacuum-along-a": (A["Pt"] / math.sqrt(3), 2.2632),
    "m3-layers-cu100-p2x2-4l": (A["Cu"] / 2, 1.8075),
    "m3-layers-ag111-p2x2-4l": (A["Ag"] / math.sqrt(3), 2.3591),
    "m3-layers-ru0001-p2x2-4l": (4.282 / 2, 2.141),
    "m3-layers-fe110-p2x2-4l": (A["Fe"] / math.sqrt(2), 2.0266),
    "m3-layers-fe100-p2x2-4l": (A["Fe"] / 2, 1.433),
    "m3-layers-fe111-1x1-6l": (A["Fe"] / (2 * math.sqrt(3)), 0.8274),
    "m3-layers-pt110-1x2-4l": (A["Pt"] / (2 * math.sqrt(2)), 1.3859),
    "m3-layers-pt211-1x1-6l": (A["Pt"] / (2 * math.sqrt(6)), 0.8002),
    "m3-layers-pt332-1x1-12planes": (A["Pt"] / (2 * math.sqrt(22)), 0.418),
    "m3-layers-srtio3-001-tio2-7l": (3.905 / 2, 1.9525),
    "m3-layers-nacl-100-4l": (5.64 / 2, 2.82),
    "m3-layers-bulk-pt-c": (A["Pt"] / 2, 1.96),
}


@pytest.mark.parametrize("cid", sorted(SPACINGS))
def test_rows_are_spaced_as_m3_states(cid: str):
    delta, quoted = SPACINGS[cid]
    if quoted is not None:  # within a unit of the last digit M3 quotes (Fe(111): 0.8274 for 0.82734)
        assert abs(delta - quoted) <= 10.0 ** -len(str(quoted).split(".")[1])
    hs = BY_ID[cid]["expect"]["heights"]
    assert np.allclose(np.diff(hs), delta, atol=1e-6, rtol=0), np.diff(hs)


def test_placements_and_twins_give_the_same_rows():
    rows = [BY_ID[f"m3-layers-pt111-p3x3-4l-{t}"]["expect"] for t in
            ("centred", "bottom-at-0", "bottom-below-0", "across-boundary", "ttf")]
    assert all(e["atomLayer"] == rows[0]["atomLayer"] and e["count"] == 4 for e in rows)
    assert all(comp == {"Pt": 9} for e in rows for comp in e["compositions"])
    assert [e["coords"] for e in rows] == ["periodic"] * 4 + ["invariant"]
    for a, b in (("pt111-co-top-fcc-skip", "pt111-co-top-fcc-ttf-skip"), ("tio2-110-2x1-3tl", "tio2-110-2x1-3tl-ttf"),
                 ("ru0001-p2x2-4l", "ru0001-p2x2-4l-ttf")):
        ea, eb = BY_ID[f"m3-layers-{a}"]["expect"], BY_ID[f"m3-layers-{b}"]["expect"]
        assert ea["atomLayer"] == eb["atomLayer"] and np.allclose(ea["heights"], eb["heights"], atol=1e-9)


def test_the_contcar_fixture_rows_match_acceptance_s14():
    e = BY_ID["m3-layers-contcar-pt111"]["expect"]
    assert e["count"] == 4 and all(comp == {"Pt": 9} for comp in e["compositions"])
    assert abs(e["heights"][0]) < 1e-4 and round(e["vacuum"], 4) == 14.9998 and e["warnings"] == {"equals": []}
    assert [i for i, o in enumerate(e["offset"]) if o] == [3, 7], "the two atoms VASP wrapped to f = 0.99999"


#: kappa* of the rows below the top one (M3 §3.9); the top row has nothing above it.
KAPPA = {"111": [2 / math.sqrt(3) - 1], "100": [math.sqrt(2) - 1], "110": [1.0],
         "211": [2 * math.sqrt(3) - 1, math.sqrt(3) - 1]}
KAPPA_BCC = {"110": [2 / math.sqrt(3) - 1], "100": [math.sqrt(3) - 1], "111": [2.0, 1.0]}
SERIES = [(el, KAPPA) for el in ("ni", "cu", "rh", "pd", "pt", "au", "ag")] + \
         [(el, KAPPA_BCC) for el in ("fe", "mo", "w")]


def test_exposure_thresholds_do_not_depend_on_the_metal():
    for facet in ("111", "100", "110", "211"):
        exposed = set()
        for el, table in SERIES:
            if facet not in table:
                continue
            c = BY_ID[f"m3-exposure-{el}{facet}"]
            s, e = structure(c), c["expect"]
            z = s.positions[:, 2]
            rows = sorted({round(float(x), 6) for x in z}, reverse=True)
            by_row = [[i for i in range(len(s)) if round(float(z[i]), 6) == r] for r in rows]
            assert all(e["exposure"][i] is None for i in by_row[0])
            for atoms, want in zip(by_row[1:], table[facet]):
                assert all(math.isclose(e["exposure"][i], want, abs_tol=1e-6) for i in atoms), (c["id"], want)
            exposed.add((table is KAPPA, tuple(e["atoms"])))
        assert len({x for x in exposed if x[0]}) <= 1 and len({x for x in exposed if not x[0]}) <= 1, facet


def test_exposure_cases_m3_names():
    tio2 = BY_ID["m3-exposure-tio2-110"]["expect"]
    s = structure(BY_ID["m3-exposure-tio2-110"])
    ti = [i for i in range(len(s)) if s.symbols[i] == "Ti" and tio2["exposure"][i] is not None
          and 0.5 < tio2["exposure"][i] < 0.6]
    assert len(ti) == 2 and not set(ti) & set(tio2["atoms"]), "Ti6c (kappa* 0.537) is not exposed"
    step = BY_ID["m3-exposure-pt211-edge-in-0.1"]["expect"]
    assert any(math.isclose(k, 0.77, abs_tol=0.01) and i in step["atoms"] for i, k in enumerate(step["exposure"]) if k)
