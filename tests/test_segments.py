"""The segment markers of the files that several chains change at the same time in waves 1-4 (plan.md §2.2, P-01).

In these files a chain adds code only between the two markers of its own segment::

    # --- surface-modeling M1 ---          (JS: // --- ... ---, CSS: /* --- ... --- */)
    ...
    # --- end M1 ---

so that git merges chains that run in parallel without conflicts: insertions into different segments merge on their
own, while two insertions at the same point conflict.  W1-S0 put the markers in place.  This test checks that each
file still has exactly the segments of the table in plan.md §2.2 (the constants below): every start and end marker
once per group, in pairs, in the table's order, neighbouring segments at least one line apart, and every group
indented and placed where the table puts it (in the class body, the table or the list it extends, after the
imports).  What the chains write inside their segments is not checked.  M7-T7 (wave 5) removes the markers and
this test together.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import NamedTuple

import pytest

ROOT = Path(__file__).resolve().parent.parent

# ------------------------------------------------------------------------------------- the table of plan.md §2.2
DEFAULTS = ("M1", "M2", "M3", "M4", "M5-adsorbates", "M5-sites", "M6")
STRUCTURE = ("M1-T3a", "M1-T3b", "M1-T4", "M2", "M3", "M4-geometry", "M4-placement")
NAMING = ("M1", "M2", "M6")
LATTICE = ("M1", "M2")
BUILD = ("M1", "M2", "M5-T1", "M5-T5", "M5-T6", "M5-T7", "M6")
ANALYSIS = ("M1", "M3", "M4", "M5-sites", "M5-topbottom", "M6")
MAIN = ("M1-sections", "M1-commands", "M2-cleave", "M2-slab", "M3-commands", "M3-layers", "M3-constraints",
        "M3-atomselection", "M4-move", "M4-commands", "M4-transform", "M4-clipboard", "M4-place", "M5-adsorbates",
        "M5-sitepick", "M6-interface")
CSS = ("M1", "M2-cleave", "M2-slab", "M3-markers", "M3-layers", "M3-constraints", "M3-atomselection", "M4-move",
       "M4-transform", "M4-place", "M4-card", "M5-markers", "M5-panel", "M6")
ICONS = ("M3", "M4", "M5")
APP = ("M2", "M3", "M4")


class Group(NamedTuple):
    """A run of segments at one place in a file.

    ``prefix`` is what comes before the comment token on each marker line (the indentation that puts the segment's
    code in the class body, the table or the list).  The group must lie in the container that the last line matching
    ``opens`` before it starts and the next line matching ``closes`` ends, with no ``closes`` line in between; with
    ``last``, no ``opens`` line may follow the group in that container either.  Lines inside segments do not count
    for ``opens`` and ``closes``.  A group without ``opens`` is at the end of its file and only checked for ``prefix``.
    """

    names: tuple[str, ...]
    where: str
    prefix: str = ""
    opens: str | None = None
    closes: str | None = None
    last: bool = False


#: The files and their groups, in file order (both __init__ files and both defaults files have two groups each).
FILES: dict[str, tuple[Group, ...]] = {
    "crystallume/core/defaults.py": (
        Group(DEFAULTS, "the key table of the module docstring, after the F0 keys",
              opens=r"``[a-z][a-z0-9_]*``\s", closes=r"=+\s+=+"),
        Group(DEFAULTS, "the SURFACE_DEFAULTS source table, after the F0 keys", "    ",
              opens=r"SURFACE_DEFAULTS = Defaults\(", closes=r"\}\)$"),
    ),
    "crystallume/web/js/core/defaults.js": (
        Group(DEFAULTS, "the key table of the doc comment, after the F0 keys", " * ",
              opens=r" \* \| `[a-z][A-Za-z0-9]*` \|", closes=r" \*/$"),
        Group(DEFAULTS, "the SURFACE_DEFAULTS source table, after the F0 keys", "  ",
              opens=r"export const SURFACE_DEFAULTS = ", closes=r"\}\);$"),
    ),
    "crystallume/core/structure.py": (
        Group(STRUCTURE, "the end of the class Structure body", "    ", opens=r"class Structure\b", closes=r"[^\s#]"),
    ),
    "crystallume/web/js/core/structure.js": (
        Group(STRUCTURE, "the end of the class Structure body", "  ", opens=r"export class Structure\b", closes=r"\}$"),
    ),
    "crystallume/core/naming.py": (Group(NAMING, "the end of the file"),),
    "crystallume/web/js/core/naming.js": (Group(NAMING, "the end of the file"),),
    "crystallume/core/lattice.py": (Group(LATTICE, "the end of the file"),),
    "crystallume/web/js/core/lattice.js": (Group(LATTICE, "the end of the file"),),
    "crystallume/build/__init__.py": (
        Group(BUILD, "after the imports", opens=r"(?:from|import) ", closes=r"__all__ = \[", last=True),
        Group(BUILD, "the end of the __all__ list", "    ", opens=r"__all__ = \[", closes=r"\]$"),
    ),
    "crystallume/analysis/__init__.py": (
        Group(ANALYSIS, "after the imports", opens=r"(?:from|import) ", closes=r"__all__ = \[", last=True),
        Group(ANALYSIS, "the end of the __all__ list", "    ", opens=r"__all__ = \[", closes=r"\]$"),
    ),
    "crystallume/web/js/main.js": (
        Group(MAIN, "after the panel imports (ui/panels/surface.js among them)",
              opens=r"import '\./ui/panels/[^']+\.js';$", closes=r"(?:async )?function ", last=True),
    ),
    "crystallume/web/css/app.css": (Group(CSS, "the end of the file"),),
    "crystallume/web/js/ui/icons.js": (
        Group(ICONS, "the icon table P", "  ", opens=r"const P = \{$", closes=r"\};$"),
    ),
    "crystallume/web/js/app.js": (
        Group(APP, "the end of the class App body", "  ", opens=r"export class App\b", closes=r"\}$"),
    ),
}

#: A marker line by file type: the prefix, then ``<token> --- surface-modeling <name> ---`` or ``... --- end <name> ---``.
NAME = r"(?P<name>[A-Za-z0-9][A-Za-z0-9-]*)"
MARKER = {
    ".py": re.compile(rf"(?P<prefix>[ \t]*)# --- (?P<kind>surface-modeling|end) {NAME} ---"),
    ".js": re.compile(rf"(?P<prefix>[ \t]*(?:\* )?)// --- (?P<kind>surface-modeling|end) {NAME} ---"),
    ".css": re.compile(rf"(?P<prefix>[ \t]*)/\* --- (?P<kind>surface-modeling|end) {NAME} --- \*/"),
}
#: A comment line that looks like a marker (a mistyped marker must not go unnoticed).
LOOKS_LIKE = {
    ".py": re.compile(r"[ \t]*#\s*-{2,}\s*(?:surface[- ]modeling|end)\b"),
    ".js": re.compile(r"[ \t]*(?:\*\s*)?//\s*-{2,}\s*(?:surface[- ]modeling|end)\b"),
    ".css": re.compile(r"[ \t]*/\*\s*-{2,}\s*(?:surface[- ]modeling|end)\b"),
}


class Segment(NamedTuple):
    name: str
    start: int   #: line index of the start marker
    end: int     #: line index of the end marker
    prefixes: tuple[str, str]


def lines_of(rel: str) -> list[str]:
    path = ROOT / rel
    assert path.is_file(), f"{rel} is missing"
    return path.read_text(encoding="utf-8").split("\n")


def segments(rel: str) -> tuple[list[str], list[list[Segment]]]:
    """The file's lines and its segments, grouped as in :data:`FILES`; fails unless the markers follow the table."""
    lines = lines_of(rel)
    ext = Path(rel).suffix
    marks: list[tuple[str, str, str, int]] = []
    for i, line in enumerate(lines):
        m = MARKER[ext].fullmatch(line)
        if m is None:
            assert not LOOKS_LIKE[ext].match(line), f"{rel}:{i + 1}: not a well-formed segment marker: {line!r}"
            continue
        marks.append(("start" if m["kind"] == "surface-modeling" else "end", m["name"], m["prefix"], i))
    groups = FILES[rel]
    found = [(kind, name) for kind, name, _, _ in marks]
    for name in dict.fromkeys(n for g in groups for n in g.names):
        want = sum(name in g.names for g in groups)
        starts, ends = found.count(("start", name)), found.count(("end", name))
        assert starts == ends == want, (
            f"{rel}: segment {name} has {starts} start and {ends} end markers; the table wants {want} of each")
    stray = sorted({name for _, name in found} - {n for g in groups for n in g.names})
    assert not stray, f"{rel}: segments that plan.md §2.2 does not list: {stray}"
    expected = [(kind, name) for g in groups for name in g.names for kind in ("start", "end")]
    assert found == expected, f"{rel}: the markers are not in pairs in the table's order:\n{found}\n!=\n{expected}"
    it = iter(marks)
    grouped = []
    for g in groups:
        segs = []
        for name in g.names:
            (_, _, p0, i0), (_, _, p1, i1) = next(it), next(it)
            segs.append(Segment(name, i0, i1, (p0, p1)))
        grouped.append(segs)
    return lines, grouped


# ------------------------------------------------------------------------------------------------------- tests
def test_the_table_has_the_ten_groups_of_plan_md():
    """plan.md §2.2: 10 rows (14 files) placed by W1-S0; the paired files share their segment names."""
    assert len(FILES) == 14
    assert sum(len(groups) for groups in FILES.values()) == 18
    for py, js in (("core/defaults.py", "web/js/core/defaults.js"), ("core/structure.py", "web/js/core/structure.js"),
                   ("core/naming.py", "web/js/core/naming.js"), ("core/lattice.py", "web/js/core/lattice.js")):
        assert [g.names for g in FILES[f"crystallume/{py}"]] == [g.names for g in FILES[f"crystallume/{js}"]]
    for groups in FILES.values():
        for g in groups:
            assert len(set(g.names)) == len(g.names)


@pytest.mark.parametrize("rel", sorted(FILES))
def test_markers_are_paired_once_per_group_in_table_order(rel: str):
    """Every start and end marker once per group, each start followed by its own end, groups and names in order."""
    _, grouped = segments(rel)
    assert [[s.name for s in segs] for segs in grouped] == [list(g.names) for g in FILES[rel]]
    for segs in grouped:
        assert all(s.start < s.end for s in segs)


@pytest.mark.parametrize("rel", sorted(FILES))
def test_neighbouring_segments_are_at_least_one_line_apart(rel: str):
    """Two segments next to each other keep a line between them, so that their insertion points are not adjacent."""
    lines, grouped = segments(rel)
    for segs in grouped:
        for a, b in zip(segs, segs[1:]):
            assert b.start - a.end >= 2, f"{rel}:{a.end + 1}: segments {a.name} and {b.name} touch"
    for g1, g2 in zip(grouped, grouped[1:]):
        assert g2[0].start - g1[-1].end >= 2, f"{rel}:{g1[-1].end + 1}: two groups touch"


@pytest.mark.parametrize("rel", sorted(FILES))
def test_groups_stay_where_the_table_puts_them(rel: str):
    """Each group sits in its class body, table, list or import block, with that place's indentation."""
    lines, grouped = segments(rel)
    inside = {i for segs in grouped for s in segs for i in range(s.start, s.end + 1)}
    outside = [i for i in range(len(lines)) if i not in inside]
    for g, segs in zip(FILES[rel], grouped):
        for s in segs:
            assert s.prefixes == (g.prefix, g.prefix), (
                f"{rel}:{s.start + 1}: segment {s.name} is indented {s.prefixes}; {g.where} needs {g.prefix!r}")
        first, last = segs[0].start, segs[-1].end
        if g.opens is None:
            continue
        opens, closes = re.compile(g.opens), re.compile(g.closes)
        before = [i for i in outside if i < first and opens.match(lines[i])]
        assert before, f"{rel}:{first + 1}: segments {g.names[0]}... are not in {g.where} (no line before them opens it)"
        o = before[-1]
        shut = [i for i in outside if o < i < first and closes.match(lines[i])]
        assert not shut, f"{rel}:{shut[0] + 1}: {g.where} ends before segment {g.names[0]} starts"
        after = [i for i in outside if i > last and closes.match(lines[i])]
        assert after, f"{rel}:{last + 1}: nothing closes {g.where} after segment {g.names[-1]}"
        if g.last:
            more = [i for i in outside if last < i < after[0] and opens.match(lines[i])]
            assert not more, f"{rel}:{more[0] + 1}: the segments must come after this line ({g.where})"
