"""F0-D POSCAR: ops of the shared cases ``tests/data/surface/f0d/poscar.json``.

They test ``facet/io/poscar.py``; the JS halves, for ``web/js/io/poscar.js``, are in
``tests/js/ops/f0d_poscar.mjs``.  Reading cases also use the ``read`` op of ``tests/ops/f0d.py`` with
``args.format = "poscar"``.  Written files are compared through the canonical form of acceptance scenario S14
(:func:`poscar_canonical`), because the two writers print numbers differently (Python 16 decimals, JS 10):

- ``poscarCanon``: the canonical form of a ``text`` or ``file`` input, as ``value`` (a list of lines).
- ``poscarWrite`` (``order``, ``append`` = ``[[symbol, [x, y, z]], ...]``): the input structure (a ``text`` or
  ``file`` input is read as POSCAR) with the atoms ``append`` appended (default properties: Python ``append``, JS
  ``addAtom``), written as POSCAR; results ``text``, ``value`` (the canonical form of the text) and ``structure``
  (the text read back).
- ``poscarFrames``: a ``text`` or ``file`` input read as POSCAR or XDATCAR; results ``structure`` and ``value`` =
  ``{"frames": [{"positions", "cell"}, ...], "ownCells": [...]}``: every frame with the cell it uses, and for
  frames 1, 2, ... whether it has a cell of its own.
- ``poscarRoundtrip``: a ``text`` or ``file`` input read as POSCAR, written and read back without an edit (S14-4,
  design brief U1); ``value`` = ``{"canonicalDiff", "maxShift", "sameFlags", "sameSymbols", "pbc", "readNotes"}``
  (``canonicalDiff`` lists the lines whose canonical forms differ, ``maxShift`` is the largest distance in Å
  between an atom as read from the input and as read back); results ``text`` and ``structure`` (read back) too.

The canonical form (S14): the comment line with its words separated by single spaces; the numbers of the scale and
lattice lines with 10 decimals (``-0.0000000000`` written ``0.0000000000``); the species and counts lines as they
are; ``Selective dynamics`` when the file has it; the coordinate mode as its first letter in upper case; one line
per atom with its three coordinates (10 decimals) and its flags as upper-case letters; the velocities only when
they are not all zero, as a line ``velocities C`` (Cartesian) or ``velocities D`` followed by their rows.  Lattice
velocities and predictor-corrector data are left out.

Argument errors use the same messages as the JS side.
"""

from __future__ import annotations

import re
from typing import Any, Sequence

import numpy as np

from facet.core.constraints import FLAG_RE
from facet.core.structure import Structure, get_warnings
from facet.io.poscar import read_poscar, write_poscar

from ..cases import CaseInput, op

_LINES = re.compile(r"\r\n|\r|\n")
_WORDS = re.compile(r"[^ \t\f\v]+")
_NUMBER = re.compile(r"[-+]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eEdD][-+]?[0-9]+)?")
_WHOLE = re.compile(r"[0-9]+")


def _args(args: dict[str, Any], name: str, allowed: Sequence[str], required: Sequence[str] = ()) -> dict[str, Any]:
    unknown = sorted(k for k in args if k not in allowed)
    if unknown:
        raise ValueError(f"{name}: unknown args {', '.join(unknown)}")
    for k in required:
        if k not in args:
            raise ValueError(f"{name}: missing arg {k}")
    return args


# ------------------------------------------------------------------------------------------ canonical form
def _canon_number(word: str) -> str:
    if not _NUMBER.fullmatch(word):
        return word
    text = f"{float(word.replace('d', 'e').replace('D', 'e')):.10f}"
    return text[1:] if text.startswith("-") and not text.strip("-0.") else text


def _canon_flag(word: str) -> str:
    m = FLAG_RE.fullmatch(word)
    return word if m is None else m.group(1).upper()


def _first(words: list[str]) -> str:
    return words[0][0] if words else ""


def poscar_canonical(text: str) -> list[str]:
    """The canonical form of POSCAR text (acceptance scenario S14): equal forms mean "the same file"."""
    lines = _LINES.split(text)

    def words(k: int) -> list[str]:
        return _WORDS.findall(lines[k]) if k < len(lines) else []

    out = [" ".join(words(0))]
    out += [" ".join(_canon_number(w) for w in words(k)) for k in (1, 2, 3, 4)]
    k = 5
    if words(k) and not re.match(r"[-+]?[0-9]", words(k)[0]):
        out.append(" ".join(words(k)))
        k += 1
    counts = words(k)
    out.append(" ".join(counts))
    n = sum(int(c) for c in counts if _WHOLE.fullmatch(c))
    k += 1
    selective = _first(words(k)) in ("s", "S")
    if selective:
        out.append("Selective dynamics")
        k += 1
    out.append(_first(words(k)).upper())
    k += 1
    for i in range(n):
        w = words(k + i)
        row = [_canon_number(x) for x in w[:3]]
        if selective:
            row += [_canon_flag(x) for x in w[3:6]]
        out.append(" ".join(row))
    k += n
    if _first(words(k)) in ("L", "l"):
        k += 8
    if k < len(lines):
        mode = "C" if _first(words(k)) in ("", "C", "c", "K", "k") else "D"
        rows: list[list[str]] | None = []
        for i in range(n):
            w = words(k + 1 + i)
            if len(w) < 3 or not all(_NUMBER.fullmatch(x) for x in w[:3]):
                rows = None
                break
            rows.append([_canon_number(x) for x in w[:3]])
        if rows and any(float(x) != 0 for row in rows for x in row):
            out.append(f"velocities {mode}")
            out += [" ".join(row) for row in rows]
    return out


def _diff(a: list[str], b: list[str]) -> list[str]:
    """The lines where two canonical forms differ (``line 3: '...' / '...'``), and a length difference."""
    out = [f"line {i + 1}: '{x}' / '{y}'" for i, (x, y) in enumerate(zip(a, b)) if x != y]
    if len(a) != len(b):
        out.append(f"{len(a)} lines / {len(b)} lines")
    return out


def _text_input(inp: CaseInput, name: str) -> str:
    if inp.kind not in ("text", "file"):
        raise ValueError(f"{name}: needs a text or file input")
    return inp.text


# ------------------------------------------------------------------------------------------------- ops
@op("poscarCanon")
def poscar_canon_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    """The canonical form of the input text."""
    _args(args, "poscarCanon", ())
    return {"value": poscar_canonical(_text_input(inp, "poscarCanon"))}


@op("poscarWrite")
def poscar_write_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    """The input (read as POSCAR when it is text) with ``append`` atoms added, written as POSCAR."""
    _args(args, "poscarWrite", ("order", "append"))
    s = read_poscar(inp.text) if inp.kind in ("text", "file") else inp.structure.copy()
    for item in args.get("append", []):
        if not isinstance(item, list) or len(item) != 2:
            raise ValueError("poscarWrite: append must be a list of [symbol, [x, y, z]]")
        s.append(item[0], item[1])
    text = write_poscar(s, **({"order": args["order"]} if "order" in args else {}))
    return {"text": text, "value": poscar_canonical(text), "structure": read_poscar(text)}


@op("poscarFrames")
def poscar_frames_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    """Every frame of the input text read as POSCAR or XDATCAR, with the cell it uses."""
    _args(args, "poscarFrames", ())
    s = read_poscar(_text_input(inp, "poscarFrames"))
    frames = [{"positions": s.positions.tolist(), "cell": None if s.cell is None else s.cell.tolist()}]
    for fr in s.frames:
        cell = fr.get("cell", s.cell)
        frames.append({"positions": fr["positions"].tolist(), "cell": None if cell is None else cell.tolist()})
    return {"structure": s, "value": {"frames": frames, "ownCells": [fr.get("cell") is not None for fr in s.frames]}}


@op("poscarRoundtrip")
def poscar_roundtrip_op(inp: CaseInput, args: dict[str, Any]) -> dict[str, Any]:
    """Read the input as POSCAR, write it without an edit, read it back, and compare (S14-4, brief U1)."""
    _args(args, "poscarRoundtrip", ())
    original = _text_input(inp, "poscarRoundtrip")
    s: Structure = read_poscar(original)
    text = write_poscar(s)
    back = read_poscar(text)
    shift = float(np.linalg.norm(back.positions - s.positions, axis=1).max()) if len(s) else 0.0
    return {"text": text, "structure": back, "value": {
        "canonicalDiff": _diff(poscar_canonical(original), poscar_canonical(text)),
        "maxShift": shift,
        "sameFlags": back.props.get("selective_dynamics") == s.props.get("selective_dynamics"),
        "sameSymbols": back.symbols == s.symbols,
        "pbc": back.pbc,
        "readNotes": get_warnings(s.info),
    }}
