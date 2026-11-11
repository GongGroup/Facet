"""The export check (F0-D §3.12): writer capabilities, ``export_report`` and its rules, ``ExportWarning`` from
``write()``, and ``close_contacts``.

The exact messages of every rule are shared cases in ``tests/data/surface/f0d/export.json`` (both languages); here
each rule is checked for the case where it applies and one where it does not, with Python inputs (numpy arrays,
trajectories built in Python), plus what only Python has: the registry, ``ExportWarning`` and the comparison of
``close_contacts`` with a brute-force search and with the JS twin.
"""

from __future__ import annotations

import io
import itertools
import json
import math
import warnings
from pathlib import Path

import numpy as np
import pytest

import facet as cl
from facet import Structure, build
from facet.analysis import close_contacts
from facet.io import (
    ExportWarning,
    FormatError,
    export_notes,
    export_report,
    export_warnings,
    formats,
    get_writer,
    register_writer,
    to_text,
    unregister_writer,
    write,
)
from facet.io.capabilities import (
    CAPABILITY_VALUES,
    OPTIONAL_CAPABILITIES,
    WRITER_CAPABILITIES,
    validate_capabilities,
)

DATA = Path(__file__).resolve().parent / "data"
CONTCAR = DATA / "surface" / "contcar_pt111.vasp"
ORTHO = np.diag([3.0, 3.0, 20.0])
HEX = np.array([[2.77, 0.0, 0.0], [-1.385, 2.39889, 0.0], [0.0, 0.0, 20.0]])
T, F = True, False


def two(positions=((0, 0, 1.0), (1.5, 1.5, 3.0)), **kw) -> Structure:
    """Pt at z = 1 and O at z = 3 in a 3 x 3 x 20 Å cell (no rule applies to it)."""
    kw.setdefault("cell", ORTHO)
    return Structure(["Pt", "O"], [list(p) for p in positions], **kw)


def trajectory(n: int = 3) -> Structure:
    """*n* frames of :func:`two` (Pt moving up by 0.1 Å per frame)."""
    return Structure.from_frames([two([(0, 0, 1.0 + 0.1 * k), (1.5, 1.5, 3.0)]) for k in range(n)])


def has(messages: list[str], fragment: str) -> bool:
    return any(fragment in m for m in messages)


# ------------------------------------------------------------------------------------------------ the table
def test_builtin_writers_carry_the_table():
    assert list(WRITER_CAPABILITIES) == ["json", "extxyz", "xyz", "poscar", "cif", "pdb", "xsd"]
    for name, caps in WRITER_CAPABILITIES.items():
        assert list(caps) == list(CAPABILITY_VALUES)
        assert get_writer(name).capabilities == dict(caps)
    listed = {w["name"]: w["capabilities"] for w in formats()["writers"]}
    assert listed["poscar"]["order"] == "species" and listed["extxyz"]["constraints"] == "cartesian"
    json.dumps(formats())  # what GET /formats sends


def test_the_table_is_read_only():
    with pytest.raises(TypeError):
        WRITER_CAPABILITIES["poscar"]["frames"] = "all"  # type: ignore[index]
    with pytest.raises(TypeError):
        WRITER_CAPABILITIES["new"] = {}  # type: ignore[index]


def test_both_languages_have_the_same_table(js):
    table = js("const m = await web('io/capabilities.js'); return {table: m.WRITER_CAPABILITIES, "
               "keys: Object.keys(m.CAPABILITY_VALUES), optional: m.OPTIONAL_CAPABILITIES, "
               "max: m.OVERLAP_CHECK_MAX_ATOMS, tol: m.OCCUPANCY_TOLERANCE};")
    assert table["table"] == {k: dict(v) for k, v in WRITER_CAPABILITIES.items()}
    assert table["keys"] == list(CAPABILITY_VALUES)
    assert table["optional"] == list(OPTIONAL_CAPABILITIES) == ["velocities"]
    from facet.io.capabilities import OCCUPANCY_TOLERANCE, OVERLAP_CHECK_MAX_ATOMS
    assert (table["max"], table["tol"]) == (OVERLAP_CHECK_MAX_ATOMS, OCCUPANCY_TOLERANCE)


MYFMT = {"label": "My format", "frames": "one", "cell": True, "constraints": "none", "occupancy": False,
         "order": "keep", "pbc": "stored", "overlap": False, "handedness": False, "velocities": False}
#: The nine capabilities of ledger L-F0-25 (F0-D §3.12.1), without the optional ``velocities`` of lead decision L-01.
LEDGER_ROW = {k: v for k, v in MYFMT.items() if k != "velocities"}
VELOCITIES_LOST = ("the atoms have velocities, but My format cannot store them; use POSCAR, Extended XYZ or "
                   "Facet JSON to keep them")


@pytest.fixture
def myfmt():
    yield "myfmt"
    unregister_writer("myfmt")


def test_register_writer_without_capabilities_reports_nothing(myfmt):
    spec = register_writer(myfmt, lambda s: "x\n", [".my"], "plugin format", source="plug")
    assert spec.capabilities is None and spec.to_json()["capabilities"] is None
    s = trajectory()
    s.set_prop("selective_dynamics", [[F, F, F], [T, T, T]])
    assert export_report(s, myfmt) == {"warnings": [], "notes": []}


def test_register_writer_validates_and_copies_capabilities(myfmt):
    caps = dict(MYFMT)
    spec = register_writer(myfmt, lambda s: "x\n", capabilities=caps)
    caps["frames"] = "all"
    assert spec.capabilities == MYFMT and list(spec.capabilities) == list(CAPABILITY_VALUES)
    rep = export_report(trajectory(2), myfmt)
    assert rep["warnings"] == ["My format holds one frame: wrote frame 1 of 2"]


@pytest.mark.parametrize("change, message", [
    ({"constraints": "yes"}, "writer 'myfmt': capabilities.constraints must be one of lattice, cartesian, atoms, none"),
    ({"overlap": 1}, "writer 'myfmt': capabilities.overlap must be true or false"),
    ({"cell": None}, "writer 'myfmt': capabilities.cell must be one of true, false, required"),
    ({"label": ""}, "writer 'myfmt': capabilities.label must be a non-empty string"),
    ({"extra": True}, "writer 'myfmt': unknown capability 'extra'"),
])
def test_register_writer_refuses_invalid_capabilities(myfmt, change, message):
    with pytest.raises(ValueError, match=message.replace("(", r"\(").replace(")", r"\)")):
        register_writer(myfmt, lambda s: "x\n", capabilities={**MYFMT, **change})
    with pytest.raises(FormatError):
        get_writer(myfmt)  # nothing was registered


def test_validate_capabilities_needs_the_ledger_keys_and_an_object():
    missing = {k: v for k, v in MYFMT.items() if k != "frames"}
    with pytest.raises(ValueError, match="capabilities.frames must be one of all, one"):
        validate_capabilities("myfmt", missing)
    with pytest.raises(ValueError, match=r"capabilities must be an object with the keys label, frames, cell, "
                                         r"constraints, occupancy, order, pbc, overlap, handedness "
                                         r"\(optional: velocities\)$"):
        validate_capabilities("myfmt", ["frames", "one"])
    with pytest.raises(ValueError, match="capabilities.velocities must be true or false"):
        validate_capabilities("myfmt", {**LEDGER_ROW, "velocities": 0})
    assert validate_capabilities("x", WRITER_CAPABILITIES["cif"]) == dict(WRITER_CAPABILITIES["cif"])
    assert OPTIONAL_CAPABILITIES == ("velocities",)


def test_the_ledger_row_is_enough_and_no_velocity_note_is_guessed(myfmt):
    """Ledger L-F0-25 lists nine capabilities; ``velocities`` (lead decision L-01) is optional: a writer that leaves it
    out (or gives ``None``) is registered and checked, gets no velocity note, and lists only what it declared."""
    s = trajectory(2)
    s.set_prop("velocities", [[0.0, 0.0, 0.01], [0.0, 0.0, 0.0]])
    for caps in (LEDGER_ROW, {**LEDGER_ROW, "velocities": None}):
        spec = register_writer(myfmt, lambda s: "x\n", capabilities=caps)
        assert spec.capabilities == LEDGER_ROW and list(spec.capabilities) == list(LEDGER_ROW)
        assert {w["name"]: w for w in formats()["writers"]}[myfmt]["capabilities"] == LEDGER_ROW
        assert export_report(s, myfmt) == {"warnings": ["My format holds one frame: wrote frame 1 of 2"], "notes": []}
    register_writer(myfmt, lambda s: "x\n", capabilities={**LEDGER_ROW, "velocities": False})
    assert export_notes(s, myfmt) == [VELOCITIES_LOST]
    register_writer(myfmt, lambda s: "x\n", capabilities={**LEDGER_ROW, "velocities": True})
    assert export_notes(s, myfmt) == []


# ------------------------------------------------------------------------------------------------ the rules
def _fixed(flags) -> Structure:
    s = Structure(["Pt"] * len(flags), [[0.0, 0.0, 1.0 + 2.3 * i] for i in range(len(flags))], cell=HEX)
    s.set_prop("selective_dynamics", flags)
    return s


def _occupied(values) -> Structure:
    s = two()
    s.set_prop("occupancy", np.array(values))
    return s


RULES = [
    # (rule, structure, format, kwargs, fragment that must be in the warnings or notes, or must not)
    ("W1", trajectory, "poscar", {}, "POSCAR holds one frame: wrote frame 1 of 3", True),
    ("W1", trajectory, "poscar", {"frame": -1}, "wrote frame 3 of 3", True),
    ("W1", trajectory, "extxyz", {}, "holds one frame", False),
    ("W1", two, "cif", {}, "holds one frame", False),
    ("W2", two, "xyz", {}, "does not store the unit cell", True),
    ("W2", lambda: build.molecule("water"), "xyz", {}, "does not store the unit cell", False),
    ("W3", lambda: build.molecule("water"), "poscar", {}, "POSCAR needs a unit cell", True),
    ("W3", two, "poscar", {}, "needs a unit cell", False),
    ("W4", lambda: _fixed([[F, F, F], [T, T, T], [T, T, F]]), "cif", {}, "2 atom(s) are fixed or partly fixed", True),
    ("W4", lambda: _fixed([[T, T, T], [T, T, T]]), "cif", {}, "cannot store constraints", False),
    ("W4", lambda: _fixed([[F, F, F], [T, T, F]]), "poscar", {}, "cannot store constraints", False),
    ("W5", lambda: _fixed([[F, T, F], [T, T, T]]), "extxyz", {}, "partial constraints of 1 atom(s)", True),
    ("W5", lambda: _fixed([[T, T, F], [T, T, T]]), "extxyz", {}, "were tightened", False),
    ("W6", lambda: _fixed([[T, T, F], [F, F, F]]), "extxyz", {}, "FixCartesian masks because 1 atom(s)", True),
    ("W6", lambda: _fixed([[F, F, F], [T, T, T]]), "extxyz", {}, "FixCartesian", False),
    ("W7", lambda: _occupied([0.5, 1.0]), "poscar", {}, "1 site(s) are partially occupied", True),
    ("W7", lambda: _occupied([0.5, 1.0]), "cif", {}, "partially occupied", False),
    ("W8", lambda: two(props={"site_name": ["a b", "c"]}), "extxyz", {}, "property 'site_name' was not written", True),
    ("W8", lambda: two(props={"site_name": ["a", "c"]}), "extxyz", {}, "was not written", False),
    ("W10", lambda: two(cell=ORTHO[[1, 0, 2]]), "poscar", {}, "the cell is left-handed", True),
    ("W10", lambda: two(cell=ORTHO[[1, 0, 2]]), "cif", {}, "left-handed", False),
    ("W11", lambda: Structure(["Pt"] * 4, [[0, 0, 5.0], [1.5, 1.5, 5.0], [0, 0, 5.0], [1.5, 1.5, 5.3]], cell=ORTHO),
     "poscar", {}, "2 pair(s) of atoms are closer than 0.5 Å (e.g. atoms 1 and 3, 0.00 Å apart)", True),
    ("W11", lambda: two(positions=[[0, 0, 0.1], [0, 0, 19.8]], pbc=[T, T, F]), "poscar", {},
     "1 pair(s) of atoms are closer than 0.5 Å (e.g. atoms 1 and 2, 0.30 Å apart)", True),
    ("W11", lambda: two(positions=[[0, 0, 0.1], [0, 0, 19.8]], pbc=[T, T, F]), "extxyz", {}, "closer than", False),
    ("N1", lambda: Structure(["O", "Pt", "O"], [[0, 0, 1], [0, 0, 3], [0, 0, 5]], cell=ORTHO), "poscar", {},
     "POSCAR groups atoms by element", True),
    ("N1", lambda: Structure(["Pt", "O", "O"], [[0, 0, 1], [0, 0, 3], [0, 0, 5]], cell=ORTHO), "poscar", {},
     "groups atoms", False),
    ("N2", lambda: two(pbc=[T, T, F]), "poscar", {},
     "c was not periodic and is written as a cell vector with a 18.0 Å gap", True),
    ("N2", lambda: two(pbc=[T, T, F]), "cif", {}, "always periodic", False),
    ("velocities", lambda: two(props={"velocities": np.array([[0.0, 0.0, 0.0], [0.0, 0.02, 0.0]])}), "cif", {},
     "the atoms have velocities, but CIF cannot store them", True),
    ("velocities", lambda: two(props={"velocities": [[0.0, 0.0, 0.0]] * 2}), "cif", {}, "velocities", False),
    ("velocities", lambda: two(props={"velocities": [[0.0, 0.0, 0.1], [0.0, math.nan, 0.1]]}), "poscar", {},
     "the velocities were not written: POSCAR needs three finite numbers for every atom", True),
    ("velocities", lambda: two(props={"velocities": [[0.0, 0.0, 0.1], [0.0, 0.2, 0.1]]}), "poscar", {},
     "velocities", False),
]


@pytest.mark.parametrize("rule, make, fmt, kwargs, fragment, applies", RULES,
                         ids=[f"{r[0]}-{r[2]}-{'yes' if r[5] else 'no'}-{k}" for k, r in enumerate(RULES)])
def test_rule(rule, make, fmt, kwargs, fragment, applies):
    rep = export_report(make(), fmt, **kwargs)
    found = has(rep["warnings"] + rep["notes"], fragment)
    assert found is applies, (rule, rep)
    if applies:  # warnings and notes in their own lists
        is_note = rule.startswith("N") or rule == "velocities"
        assert has(rep["notes" if is_note else "warnings"], fragment), (rule, rep)


NOT_WRITTEN = "the velocities were not written: POSCAR needs three finite numbers for every atom"


@pytest.mark.parametrize("velocities, written", [
    ([[0.0, 0.0, 0.1], [0.0, 0.2, 0.1]], True),
    (np.array([[0.0, 0.0, 0.1], [0.0, 0.2, 0.1]]), True),
    ([[0.0, 0.0, 0.1], [0.0, math.nan, 0.1]], False),
    ([[0.0, 0.0, 0.1], [0.0, math.inf, 0.1]], False),
    ([[0.0, 0.0, 0.1], [0.0, 0.2]], False),
    ([[0.0, 0.0, 0.1], None], False),
    ([[0.0, 0.0, 0.1], [0.0, True, 0.1]], False),
    ([[0.0, 0.0, 0.0], [0.0, math.nan, 0.0]], None),     # nothing but zeros: no velocity is lost
    ([[0.0, 0.0, 0.0], [0.0, 0.0, 0.0]], None),
])
def test_the_poscar_velocity_note_follows_the_writer(velocities, written):
    """Lead decision L-01: a note exactly when the structure has velocities and the POSCAR writer drops its velocity
    block (it does when any row is not three finite numbers), decided by the writer's own row function."""
    s = two(props={"velocities": velocities})
    block = "\n\n" in to_text(s, "poscar")          # the velocities follow the coordinates after a blank line
    assert block is (written is True)
    assert export_notes(s, "poscar") == ([NOT_WRITTEN] if written is False else [])
    assert export_warnings(s, "poscar") == []


def test_w9_results_of_the_first_frame():
    s = trajectory(2)
    s.set_prop("forces", np.zeros((2, 3)))
    s.info["energy"] = -1.5
    assert export_warnings(s, "extxyz") == ["forces, energy are known only for frame 1 and were written for that "
                                            "frame only"]
    assert export_warnings(s.get_frame(0), "extxyz") == []
    del s.props["forces"]
    assert export_warnings(s, "extxyz") == ["energy is known only for frame 1 and was written for that frame only"]


def test_the_checks_look_at_the_frame_written():
    s = Structure.from_frames([two(), two(cell=ORTHO[[1, 0, 2]])])
    assert not has(export_warnings(s, "poscar"), "left-handed")
    assert has(export_warnings(s, "poscar", frame=1), "left-handed")
    with pytest.raises(IndexError, match="frame 2 out of range"):
        export_report(s, "poscar", frame=2)


def test_server_formats_are_checked_at_the_frame_the_server_writes(js, myfmt):
    """F0-D §3.12.5: the web app's warnings for a format the server writes are those of the server's /io/export,
    which gets the whole structure and, like every Python writer, writes frame 0, whatever frame is on screen."""
    caps = {**MYFMT, "label": "Srv", "overlap": True, "handedness": True}
    traj = {"symbols": ["Pt", "O"], "positions": [[0.0, 0.0, 1.0], [1.5, 1.5, 3.0]], "cell": ORTHO.tolist(),
            "pbc": [T, T, T], "frames": [{"positions": [[0.0, 0.0, 1.0], [0.0, 0.0, 1.2]],
                                          "cell": ORTHO[[1, 0, 2]].tolist()}]}
    web = js("""
      const { Structure } = await web('core/structure.js');
      const { formats, exportStructure, exportReport } = await web('io/index.js');
      const s = Structure.fromJSON(input.traj);
      s.setFrame(1);   // on screen: frame 2, a left-handed cell and two atoms 0.2 Å apart
      let body = null;   // what installServerFormats posts to /io/export
      const off = formats.register({ id: 'srvframe', server: true, capabilities: input.caps,
                                     write: async (st) => { body = st.toJSON(); return ''; } });
      try {
        const out = exportStructure(s, 'srvframe');
        await out.text;
        return { warnings: out.warnings, notes: out.notes, body, frame2: exportReport(s, 'srvframe', { frame: 1 }) };
      } finally { off(); }
    """, {"traj": traj, "caps": caps})
    register_writer(myfmt, lambda s: "", capabilities=caps)
    server = export_report(Structure.from_dict(web["body"]), myfmt)   # the report of /io/export for that body
    assert web["warnings"] == server["warnings"] == ["Srv holds one frame: wrote frame 1 of 2"]
    assert web["notes"] == server["notes"] == []
    assert web["frame2"] == export_report(Structure.from_dict(web["body"]), myfmt, frame=1)
    assert len(web["frame2"]["warnings"]) == 3   # W1 (frame 2 of 2), W10, W11


def test_overlap_check_is_skipped_for_huge_structures():
    big = build.crystal("fcc", "Cu", a=3.61).repeat(37, 37, 37)
    assert len(big) > 200_000
    assert export_report(big, "poscar") == {"warnings": [],
                                            "notes": ["the overlap check was skipped for more than 200 000 atoms"]}


def test_unknown_format_and_wrappers():
    s = cl.read(CONTCAR)
    with pytest.raises(FormatError):
        export_report(s, "nope")
    rep = export_report(s, "cif")
    assert export_warnings(s, "cif") == rep["warnings"] and export_notes(s, "cif") == rep["notes"] == []
    assert rep["warnings"] == ["18 atom(s) are fixed or partly fixed (selective dynamics), but CIF cannot store "
                               "constraints; use POSCAR, Extended XYZ or Facet JSON to keep them"]
    assert export_report(s, "poscar") == {"warnings": [], "notes": []}  # acceptance S14-4
    assert s.pbc == [True, True, True]  # reading changes no pbc (design decision U1)


def test_positions_that_are_not_finite_skip_the_geometric_checks():
    s = Structure(["Pt", "Pt"], [[0, 0, 1.0], [0, 0, 1.0]], cell=ORTHO, pbc=[T, T, F])
    s.positions[1, 2] = np.nan
    assert export_report(s, "poscar") == {"warnings": [], "notes": []}  # no W11, no N2 (and no error)


def test_the_report_changes_nothing():
    s = Structure(["O", "Pt", "O"], [[0, 0, 0.1], [0, 0, 19.8], [0, 0, 0.1]], cell=ORTHO, pbc=[T, T, F],
                  props={"selective_dynamics": [[F, F, F], [T, T, F], [T, T, T]], "occupancy": [0.5, 1.0, 1.0]})
    before = s.to_dict(decimals=17)
    for fmt in ("poscar", "cif", "extxyz", "xyz", "pdb", "json"):
        export_report(s, fmt)
    assert s.to_dict(decimals=17) == before


def test_xdatcar_files_are_read_as_poscar(tmp_path):
    """A file named XDATCAR (or XDATCAR_run2) is read by the POSCAR reader, every configuration a frame."""
    text = ("Pt\n1.0\n3 0 0\n0 3 0\n0 0 3\nPt\n1\nDirect configuration=     1\n0 0 0\n"
            "Direct configuration=     2\n0.1 0 0\n")
    for name in ("XDATCAR", "XDATCAR_run2"):
        (tmp_path / name).write_text(text)
        s = cl.read(tmp_path / name)
        assert s.info["format"] == "poscar" and s.n_frames == 2
    assert cl.io.detect_format("XDATCAR") == "poscar"


# ------------------------------------------------------------------------------------------- ExportWarning
def test_write_issues_export_warnings(tmp_path):
    s = cl.read(CONTCAR)
    with pytest.warns(ExportWarning, match="18 atom\\(s\\) are fixed or partly fixed") as rec:
        write(tmp_path / "slab.cif", s)
    assert len(rec) == 1 and rec[0].filename == __file__  # stacklevel: the caller's line
    assert issubclass(ExportWarning, UserWarning) and cl.io.ExportWarning is ExportWarning
    assert (tmp_path / "slab.cif").read_text().startswith("# Generated by Facet")
    buf = io.StringIO()
    with pytest.warns(ExportWarning):
        write(buf, s, format="xyz")
    assert buf.getvalue().startswith("36\n")


def test_write_does_not_issue_notes_and_to_text_is_silent(tmp_path):
    mixed = Structure(["O", "Pt", "O"], [[0, 0, 1], [0, 0, 3], [0, 0, 5]], cell=ORTHO)
    assert export_notes(mixed, "poscar") and not export_warnings(mixed, "poscar")
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        write(tmp_path / "POSCAR", mixed)
        to_text(cl.read(CONTCAR), "cif")
        cl.write(tmp_path / "ok.vasp", cl.read(CONTCAR))


# ----------------------------------------------------------------------------------------- close_contacts
def _brute(s: Structure, cutoff: float, reach: int = 2) -> list[tuple[int, int, float]]:
    """Every pair within *cutoff* (the reference): for each pair, all translations within *reach* cell vectors of
    the one that rounds their fractional difference away, on the periodic axes."""
    periodic = [s.cell is not None and bool(p) for p in s.pbc]
    frac = s.frac_positions if s.cell is not None else None
    out = []
    for i in range(len(s)):
        for j in range(i, len(s)):
            base = [-round(frac[j, k] - frac[i, k]) if periodic[k] else 0 for k in range(3)]
            ranges = [range(base[k] - reach, base[k] + reach + 1) if periodic[k] else [0] for k in range(3)]
            shifts = np.array(list(itertools.product(*ranges)), dtype=float)
            tv = shifts @ s.cell if s.cell is not None else np.zeros((len(shifts), 3))
            d = np.linalg.norm(s.positions[j] + tv - s.positions[i], axis=1)
            if i == j:
                d[np.all(shifts == 0, axis=1)] = np.inf
            if d.min() < cutoff:
                out.append((i, j, float(d.min())))
    return out


def _random_structures(seed: int, count: int):
    rng = np.random.default_rng(seed)
    out = []
    while len(out) < count:
        n = int(rng.integers(1, 24))
        cell = rng.normal(size=(3, 3)) + np.eye(3) * rng.uniform(1.6, 4.0)
        if len(out) % 2:
            cell[[0, 1]] = cell[[1, 0]]  # left-handed cells too
        vol = abs(np.linalg.det(cell))
        heights = [vol / np.linalg.norm(np.cross(cell[(k + 1) % 3], cell[(k + 2) % 3])) for k in range(3)]
        cutoff = float(rng.uniform(0.3, 1.0))
        if min(heights) < cutoff:  # the documented range: plane spacings of at least the cutoff
            continue
        frac = rng.uniform(-1.3, 2.3, size=(n, 3))
        if len(out) % 3 == 0:
            frac[: n // 2] = frac[n // 2: 2 * (n // 2)] + rng.normal(scale=0.03, size=(n // 2, 3))
        pbc = [bool(v) for v in rng.integers(0, 2, size=3)]
        out.append((Structure(["H"] * n, frac @ cell, cell=cell, pbc=pbc), cutoff))
    return out


def test_close_contacts_matches_a_brute_force_search():
    for s, cutoff in _random_structures(11, 60):
        got = close_contacts(s, cutoff)
        want = _brute(s, cutoff)
        assert [(i, j) for i, j, _ in got] == [(i, j) for i, j, _ in want]
        assert np.allclose([d for *_, d in got], [d for *_, d in want], rtol=0, atol=1e-12)


def test_close_contacts_options_and_errors():
    s = Structure(["H"] * 5, [[0, 0, 0.1], [0, 0, 19.8], [1.5, 1.5, 10.0], [1.5, 1.5, 10.4], [1.5, 1.5, 11.0]],
                  cell=ORTHO)

    def pairs(**kw):
        return [(i, j) for i, j, _ in close_contacts(s, **kw)]

    assert pairs() == [(0, 1), (2, 3)]                        # (0, 1) across the c face
    assert pairs(pbc=False) == pairs(pbc=[T, T, F]) == [(2, 3)]
    assert pairs(cutoff=2.0) == [(0, 1), (2, 3), (2, 4), (3, 4)]
    assert pairs(cutoff=2.0, limit=2) == [(0, 1), (2, 3)] and pairs(limit=0) == []
    assert close_contacts(Structure()) == []
    one = Structure(["H"], [[0, 0, 0]], cell=np.diag([0.4, 5.0, 5.0]))
    assert close_contacts(one) == [(0, 0, 0.4)]  # an atom meets its own image
    for kwargs, message in [({"cutoff": 0}, "cutoff must be a positive number \\(got 0\\)"),
                            ({"cutoff": True}, "cutoff must be a positive number \\(got true\\)"),
                            ({"limit": -1}, "limit must be a non-negative integer \\(got -1\\)"),
                            ({"limit": 1e-7}, "limit must be a non-negative integer \\(got 1e-7\\)"),
                            ({"cutoff": -1e-7}, "cutoff must be a positive number \\(got -1e-7\\)"),
                            ({"cutoff": [0.5, -1e-5]}, "cutoff must be a positive number \\(got \\[0.5,-0.00001\\]\\)"),
                            ({"pbc": "yes"}, "pbc must be a bool or a list of three bools")]:
        with pytest.raises(ValueError, match=message):
            close_contacts(s, **kwargs)
    bad = Structure(["H", "H"], [[0, 0, 0], [0, 0, 1]])
    bad.positions[1, 2] = np.nan
    with pytest.raises(ValueError, match="positions must be finite numbers"):
        close_contacts(bad)


def test_close_contacts_is_read_only_and_uses_frame_0():
    s = Structure.from_frames([Structure(["H", "H"], [[0, 0, 0], [0, 0, 0.2]], cell=ORTHO),
                               Structure(["H", "H"], [[0, 0, 0], [0, 0, 2.0]], cell=ORTHO)])
    before = s.to_dict(decimals=17)
    assert [(i, j) for i, j, _ in close_contacts(s)] == [(0, 1)]
    assert close_contacts(s.get_frame(1)) == []
    assert s.to_dict(decimals=17) == before


def test_close_contacts_errors_read_the_same_in_both_languages(js):
    """Ledger §0.3: the messages are word for word the JS ones; numbers are written as JavaScript writes them
    (``1e-7``, ``0.00001``, ``100000000000000000000``, ``1e+21``; an int beyond the floats is ``Infinity``, as JSON
    gives it to JavaScript), other values as ``JSON.stringify`` does."""
    s = Structure(["H", "H"], [[0, 0, 0], [0, 0, 1.0]], cell=ORTHO)
    numbers = [-1e-7, -1.5e-7, -1e-6, -1.25e-6, -1e-5, 0, -0.0, -123.456, -0.1, -2.0**53, -(2.0**53 + 2), -1e15,
               -1e16, -1e20, -1e21, -1.5e21, -5e-324, -2.2250738585072014e-308, -1.7976931348623157e308, -1 / 3,
               -(2**60), -(10**400), 10**400]
    others = ["0.5", "Å", "a\nb", [0.5, 1e-7, -(10**400)], [], {"a": [1.0, None, "b"]}, True, False]
    bad = [{"cutoff": v} for v in numbers + others]
    bad += [{"limit": v} for v in (1e-7, 0.5, 2.5e-300, -2.0, -1e21, -(2**60), 10**400, "3", [1], True)]
    want = []
    for kw in bad:
        with pytest.raises(ValueError) as err:
            close_contacts(s, **kw)
        want.append(str(err.value))
    got = js("""
      const { Structure } = await web('core/structure.js');
      const { closeContacts } = await web('core/contacts.js');
      const s = Structure.fromJSON(input.s);
      return input.bad.map((o) => { try { closeContacts(s, o); return null; } catch (e) { return e.message; } });
    """, {"s": s.to_dict(), "bad": bad})
    assert got == want
    assert want[0] == "cutoff must be a positive number (got -1e-7)"
    assert want[numbers.index(-1e20)] == "cutoff must be a positive number (got -100000000000000000000)"
    assert want[numbers.index(10**400)] == "cutoff must be a positive number (got Infinity)"
    assert want[-4] == "limit must be a non-negative integer (got Infinity)"


def test_close_contacts_is_the_same_in_both_languages(js):
    """Bit for bit: the same pairs and the same distances (JSON keeps every double exactly)."""
    docs = [{"s": s.to_dict(decimals=17), "cutoff": c} for s, c in _random_structures(5, 80)]
    got = js("""
      const { Structure } = await web('core/structure.js');
      const { closeContacts } = await web('core/contacts.js');
      return input.map((x) => closeContacts(Structure.fromJSON(x.s), { cutoff: x.cutoff }));
    """, docs)
    want = [[list(p) for p in close_contacts(Structure.from_dict(d["s"]), d["cutoff"])] for d in docs]
    assert sum(map(len, want)) > 100 and got == want
