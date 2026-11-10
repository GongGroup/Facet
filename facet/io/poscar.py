"""VASP POSCAR / CONTCAR / XDATCAR reader and POSCAR writer (F0-D §3.10).

The JavaScript twin is ``facet/web/js/io/poscar.js``: the same rules and, word for word, the same errors and
notes; the shared cases are ``tests/data/surface/f0d/poscar.json``.

Reader:

* VASP 5 (species line) and VASP 4 (species from the element symbols in the comment line, else ``X``);
* one scale factor, a negative one (the target volume) or three that scale x, y and z separately (VASP 6);
* ``Direct`` and ``Cartesian`` coordinates; a word that starts with ``!`` or ``#`` begins a comment;
* ``Selective dynamics``: the flags go to ``props["selective_dynamics"]`` (True = free along the cell vector a, b
  or c), all-free rows included.  A flag is ``T``/``F`` in any of the spellings of
  :data:`~facet.core.constraints.FLAG_RE` (``.TRUE.``, ``t``, ...); a line with fewer than three words after
  the coordinates has no flags (a lone ``F`` may be fluorine), an unreadable word reads as T, words after the third
  flag are ignored (pymatgen writes the element there), and one note counts the lines with such problems.  The flags
  refer to the cell vectors in Direct and Cartesian files alike (VASP), so they are never converted;
* a species line that names an element twice (``Ga As H H``: two pseudo-hydrogens; an antiferromagnet split into
  two blocks) keeps its blocks in ``props["poscar_species"]``: the words as written when they differ (``H.75``,
  ``H1.25``), else ``H``, ``H#2``, ``H#3``, ...; the key is absent otherwise;
* XDATCAR: every ``Direct configuration=`` block is a frame; a lattice header before a block (variable-cell runs,
  ISIF = 3) gives that frame its own cell.  An incomplete last configuration is skipped with a note;
* the velocities after the coordinates of a CONTCAR go to ``props["velocities"]`` (Cartesian, Å/fs) unless they are
  all zero.  A blank mode line or one that starts with C or K means Cartesian (Å/fs, not scaled), any other mode
  line Direct (cell vectors per time step, converted assuming 1 fs, with a note).  The lattice velocities before
  them and the predictor-corrector data after them are skipped.

Writer: VASP 5 with Direct coordinates (not wrapped), frame 0.  The atoms are grouped into one block per species in
order of first appearance (:func:`~facet.core.structure.poscar_order`; the blocks of
``props["poscar_species"]`` when present); the species line holds element symbols (VASP reads two characters).
``Selective dynamics`` is written whenever ``props["selective_dynamics"]`` exists, even when every atom is free; the
velocities when they are not all zero, after a blank line.  A number that would print as ``-0.000…`` is written
without the sign.  A structure without a cell is placed in a box with 10 Å of vacuum on each side.
"""

from __future__ import annotations

import math
import re
from typing import Any

import numpy as np

from ..core.constraints import FLAG_RE, MOVE_FLAGS_KEY, move_flags
from ..core.elements import is_element, normalize_symbol
from ..core.lattice import cart_to_frac
from ..core.structure import Structure, poscar_order

__all__ = ["read_poscar", "write_poscar"]

_LINE_BREAK = re.compile(r"\r\n|\r|\n")
_WORD = re.compile(r"[^ \t\f\v]+")
_FIRST_CHAR = re.compile(r"[^ \t\f\v]")
#: A number as Fortran writes it: optional sign, digits with an optional point, optional E or D exponent.
_NUMBER = re.compile(r"[-+]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eEdD][-+]?[0-9]+)?")
_WHOLE = re.compile(r"[0-9]+")
_NUMERIC_START = re.compile(r"[-+]?[0-9]")
_SYMBOL = re.compile(r"[A-Z][a-z]?")
_COMMENT_SPLIT = re.compile(r"[ \t\f\v,]+")
_CONFIGURATION = re.compile(r"configuration[ \t]*=", re.IGNORECASE)

_TOO_SHORT = ("POSCAR is too short: it needs a comment line, a scale factor, three lattice vectors, the atom counts "
              "and the coordinates")
_VASP4 = "VASP 4 POSCAR without element names in the comment line; species set to X"
_DIRECT_VELOCITIES = "velocities in direct coordinates were converted to Å/fs assuming a time step of 1 fs"
_LAST_CONFIGURATION = "XDATCAR: the last configuration is incomplete and was skipped"
#: The lines of the lattice velocities of a CONTCAR: the title line, the initialization state, 3 velocities, 3 vectors.
_LATTICE_VELOCITY_LINES = 8


# ------------------------------------------------------------------------------------------------- words
def _words(line: str) -> list[str]:
    """The words of *line* (split at spaces and tabs) before the first one that starts with ``!`` or ``#``."""
    out = []
    for w in _WORD.findall(line):
        if w[0] in "!#":
            break
        out.append(w)
    return out


def _first_char(line: str) -> str:
    """The first character of *line* that is not a space or a tab (``""`` for a blank line)."""
    m = _FIRST_CHAR.search(line)
    return m.group(0) if m else ""


def _show(word: str) -> str:
    """*word* quoted for a message (at most 32 characters)."""
    return "'" + (word if len(word) <= 32 else word[:32] + "...") + "'"


def _is_number(word: str) -> bool:
    return _NUMBER.fullmatch(word) is not None


def _number(word: str, line_no: int) -> float:
    """*word* as a float (Fortran ``D`` exponents too); ``ValueError`` ``line 4: expected a number, found 'x'``."""
    if _NUMBER.fullmatch(word):
        x = float(word.replace("d", "e").replace("D", "e"))
        if math.isfinite(x):
            return x
    raise ValueError(f"line {line_no}: expected a number, found {_show(word)}")


def _numbers3(words: list[str], line_no: int) -> list[float] | None:
    """The first three words as numbers, or ``None`` when there are fewer than three or one is not a number."""
    if len(words) < 3 or not all(_is_number(w) for w in words[:3]):
        return None
    try:
        return [_number(w, line_no) for w in words[:3]]
    except ValueError:   # a number too large for a float
        return None


def _is_counts_start(word: str) -> bool:
    return _NUMERIC_START.match(word) is not None


# ------------------------------------------------------------------------------------------------ header
def _scales(words: list[str], line_no: int) -> list[float]:
    """The scale line: three factors (x, y, z) when its first three words are numbers, else one factor."""
    if len(words) >= 3 and all(_is_number(w) for w in words[:3]):
        return [_number(w, line_no) for w in words[:3]]
    if not words:
        raise ValueError(f"line {line_no}: expected the scale factor, found nothing")
    return [_number(words[0], line_no)]


def _lattice_vector(words: list[str], line_no: int) -> list[float]:
    if len(words) < 3:
        raise ValueError(f"line {line_no}: a lattice vector needs three numbers, found {len(words)}")
    return [_number(w, line_no) for w in words[:3]]


def _det3(m: list[list[float]]) -> float:
    """The determinant, summed like ``det3`` of ``web/js/core/util.js``."""
    return (m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
            - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
            + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]))


def _scaled_cell(lattice: list[list[float]], scales: list[float], line_no: int) -> tuple[np.ndarray, list[float]]:
    """The cell (VASP semantics of the scale line) and the factors of the Cartesian x, y and z components."""
    if len(scales) == 3:
        factor = list(scales)
    elif scales[0] < 0:
        vol = abs(_det3(lattice))
        if not vol > 0:
            raise ValueError(f"line {line_no}: a negative scale factor (target volume) needs a cell with a "
                             f"non-zero volume")
        f = float(np.cbrt(-scales[0] / vol))
        factor = [f, f, f]
    else:
        factor = [scales[0]] * 3
    return np.array([[v * factor[k] for k, v in enumerate(row)] for row in lattice], dtype=float), factor


def _to_cartesian(rows: list[list[float]], cell: np.ndarray) -> np.ndarray:
    """``rows @ cell``, summed like ``fracToCart`` of ``web/js/core/util.js`` (bit for bit the same numbers)."""
    f = np.array(rows, dtype=float).reshape(-1, 3)
    return f[:, 0:1] * cell[0] + f[:, 1:2] * cell[1] + f[:, 2:3] * cell[2]


def _vasp4_species(comment: str, n_blocks: int) -> list[str] | None:
    """VASP 4: the element symbols written as such in the comment line, if there are enough of them."""
    found = [w for w in _COMMENT_SPLIT.split(comment) if _SYMBOL.fullmatch(w) and is_element(w)]
    return found[:n_blocks] if len(found) >= n_blocks else None


def _block_labels(words: list[str], elements: list[str]) -> list[str] | None:
    """The ``poscar_species`` label of every species block, or ``None`` when no element has two blocks."""
    blocks: dict[str, list[int]] = {}
    for b, e in enumerate(elements):
        blocks.setdefault(e, []).append(b)
    if all(len(bs) == 1 for bs in blocks.values()):
        return None
    labels = list(elements)
    for e, bs in blocks.items():
        if len(bs) == 1:
            continue
        raw = [words[b] for b in bs]
        names = raw if len(set(raw)) == len(raw) else [e] + [f"{e}#{t}" for t in range(2, len(bs) + 1)]
        for b, name in zip(bs, names):
            labels[b] = name
    return labels


def _frame_header(lines: list[str], start: int, stop: int, natoms: int) -> tuple[np.ndarray, list[float]] | None:
    """The cell and factors of the lattice header that ends just before line index *stop* (an XDATCAR configuration
    line), within ``lines[start:stop]``; ``None`` when those lines do not end with a complete header."""
    if stop - 1 < start:
        return None
    count_words = _words(lines[stop - 1])
    if not count_words or not all(_WHOLE.fullmatch(c) for c in count_words):
        return None
    top = stop - 1                                    # the line after the lattice vectors
    if stop - 2 >= start:
        sw = _words(lines[stop - 2])
        if sw and not _is_counts_start(sw[0]):
            top = stop - 2                            # a species line
    if top - 4 < start:
        return None
    try:
        scales = _scales(_words(lines[top - 4]), top - 3)
        lattice = [_lattice_vector(_words(lines[top - 3 + t]), top - 2 + t) for t in range(3)]
        cell, factor = _scaled_cell(lattice, scales, top - 3)
    except ValueError:
        return None
    total = sum(int(c) for c in count_words)
    if total != natoms:
        raise ValueError(f"line {stop}: the XDATCAR header counts {total} atoms instead of {natoms}")
    return cell, factor


# ------------------------------------------------------------------------------------------------ reader
def _velocities(lines: list[str], k: int, natoms: int, cell: np.ndarray,
                notes: list[str]) -> list[list[float]] | None:
    """The velocity block that starts at line index *k* (just after the coordinates), as Cartesian Å/fs rows.

    ``None`` when there is none, when it is incomplete (with a note) or when every velocity is zero.
    """
    if k < len(lines) and _first_char(lines[k]) in ("L", "l"):
        k += _LATTICE_VELOCITY_LINES                  # "Lattice velocities and vectors": skipped
    if k >= len(lines):
        return None
    cartesian = _first_char(lines[k]) in ("", "C", "c", "K", "k")
    rows: list[list[float]] = []
    for i in range(natoms):
        j = k + 1 + i
        row = _numbers3(_words(lines[j]), j + 1) if j < len(lines) else None
        if row is None:
            if i:
                notes.append(f"velocities: the block after the coordinates is incomplete (line {j + 1}); "
                             f"it was ignored")
            return None
        rows.append(row)
    if not any(v != 0 for row in rows for v in row):
        return None
    if cartesian:
        return rows
    notes.append(_DIRECT_VELOCITIES)
    return _to_cartesian(rows, cell).tolist()


def read_poscar(text: str) -> Structure:
    """Parse POSCAR, CONTCAR or XDATCAR text into a :class:`Structure` (an XDATCAR's configurations as frames).

    See the module docstring for what is read.  Errors raise ``ValueError`` naming the line, with the same text as
    the JavaScript reader (``line 7: expected the atom counts (whole numbers), found 'x'``).
    """
    lines = _LINE_BREAK.split(text)
    if sum(1 for ln in lines if _first_char(ln)) < 7:
        raise ValueError(_TOO_SHORT)
    comment = lines[0].strip(" \t\f\v")
    notes: list[str] = []

    def line(k: int) -> str:
        return lines[k] if k < len(lines) else ""

    scales = _scales(_words(line(1)), 2)
    lattice = [_lattice_vector(_words(line(k)), k + 1) for k in (2, 3, 4)]
    cell, factor = _scaled_cell(lattice, scales, 2)

    k = 5
    species_words: list[str] | None = None
    words = _words(line(k))
    if words and not _is_counts_start(words[0]):
        species_words = words
        k += 1
    count_words = _words(line(k))
    if not count_words:
        raise ValueError(f"line {k + 1}: expected the atom counts (whole numbers), found nothing")
    for c in count_words:
        if not _WHOLE.fullmatch(c):
            raise ValueError(f"line {k + 1}: expected the atom counts (whole numbers), found {_show(c)}")
    counts = [int(c) for c in count_words]
    if species_words is None:
        elements = _vasp4_species(comment, len(counts))
        if elements is None:
            elements = ["X"] * len(counts)
            notes.append(_VASP4)
        species_words = list(elements)
    else:
        elements = [normalize_symbol(w) for w in species_words]
    if len(elements) != len(counts):
        raise ValueError(f"line {k + 1}: {len(elements)} element names but {len(counts)} atom counts")
    natoms = sum(counts)
    k += 1

    if k >= len(lines):
        raise ValueError(f"line {k + 1}: expected the coordinate mode (Direct or Cartesian), found nothing")
    selective = _first_char(lines[k]) in ("s", "S")
    if selective:
        k += 1
        if k >= len(lines):
            raise ValueError(f"line {k + 1}: expected the coordinate mode (Direct or Cartesian), found nothing")
    mode = lines[k]
    cartesian = _first_char(mode) in ("c", "C", "k", "K")
    xdatcar = _CONFIGURATION.search(mode) is not None
    k += 1

    coords: list[list[float]] = []
    flags: list[list[bool]] = []
    problems = 0
    first_problem = ""
    for i in range(natoms):
        j = k + i
        words = _words(lines[j]) if j < len(lines) else []
        if not words:
            raise ValueError(f"expected {natoms} coordinate line(s), found {i}")
        if len(words) < 3:
            raise ValueError(f"line {j + 1}: expected three coordinates, found {len(words)}")
        coords.append([_number(w, j + 1) for w in words[:3]])
        if not selective:
            continue
        rest = words[3:]
        if len(rest) < 3:
            row, bad = [True, True, True], "no flags"
        else:
            row, bad = [], ""
            for w in rest[:3]:
                m = FLAG_RE.fullmatch(w)
                row.append(True if m is None else m.group(1) in "Tt")
                if m is None and not bad:
                    bad = _show(w)
        flags.append(row)
        if bad:
            problems += 1
            first_problem = first_problem or f"line {j + 1}, {bad}"
    k += natoms
    if problems:
        notes.append(f"selective dynamics: {problems} line(s) had missing or unreadable T/F flags "
                     f"(first: {first_problem}); those directions were read as T (free)")

    positions = (np.array(coords, dtype=float).reshape(-1, 3) * np.array(factor)) if cartesian \
        else _to_cartesian(coords, cell)
    symbols = [e for e, c in zip(elements, counts) for _ in range(c)]
    props: dict[str, Any] = {}
    if selective:
        props[MOVE_FLAGS_KEY] = flags
    labels = _block_labels(species_words, elements)
    if labels is not None:
        props["poscar_species"] = [lab for lab, c in zip(labels, counts) for _ in range(c)]

    frames: list[dict[str, Any]] = []
    if xdatcar:
        frames = _configurations(lines, k, natoms, cell, factor, notes)
    else:
        velocities = _velocities(lines, k, natoms, cell, notes)
        if velocities is not None:
            props["velocities"] = velocities
    info: dict[str, Any] = {"warnings": notes} if notes else {}
    return Structure(symbols, positions, cell=cell, pbc=True, frames=frames, props=props, info=info,
                     name=comment[:120])


def _configurations(lines: list[str], k: int, natoms: int, cell: np.ndarray, factor: list[float],
                    notes: list[str]) -> list[dict[str, Any]]:
    """The XDATCAR configurations after the first one (which ends before line index *k*), as frames."""
    frames: list[dict[str, Any]] = []
    while True:
        stop = next((b for b in range(k, len(lines)) if _CONFIGURATION.search(lines[b])), None)
        if stop is None:
            return frames
        header = _frame_header(lines, k, stop, natoms)
        frame_cell, frame_factor = header if header is not None else (cell, factor)
        cartesian = _first_char(lines[stop]) in ("c", "C", "k", "K")
        rows: list[list[float]] = []
        for i in range(natoms):
            j = stop + 1 + i
            words = _words(lines[j]) if j < len(lines) else []
            if not words:
                notes.append(_LAST_CONFIGURATION)
                return frames
            if len(words) < 3:
                raise ValueError(f"line {j + 1}: expected three coordinates, found {len(words)}")
            rows.append([_number(w, j + 1) for w in words[:3]])
        pos = (np.array(rows, dtype=float).reshape(-1, 3) * np.array(frame_factor)) if cartesian \
            else _to_cartesian(rows, frame_cell)
        frames.append({"positions": pos, "cell": frame_cell} if header is not None else {"positions": pos})
        k = stop + 1 + natoms


# ------------------------------------------------------------------------------------------------ writer
def _fixed(value: float, decimals: int) -> str:
    """*value* with *decimals* decimals; a value that rounds to zero is written without a minus sign."""
    text = f"{value:.{decimals}f}"
    if text.startswith("-") and not text.strip("-0."):
        return text[1:]
    return text


def _is_real(x: Any) -> bool:
    return isinstance(x, (int, float, np.integer, np.floating)) and not isinstance(x, (bool, np.bool_))


def _velocity_rows(structure: Structure) -> list[list[float]] | None:
    """The velocities the writer writes: one row of three finite numbers per atom, not all zero; else ``None``."""
    col = structure.props.get("velocities")
    if col is None or len(col) != len(structure):
        return None
    rows = []
    for v in col:
        if isinstance(v, np.ndarray):
            v = v.tolist()
        if not isinstance(v, (list, tuple)) or len(v) != 3 or not all(_is_real(x) and math.isfinite(x) for x in v):
            return None
        rows.append([float(x) for x in v])
    return rows if any(x != 0 for row in rows for x in row) else None


def _species_blocks(structure: Structure) -> list[str]:
    """The block label of every atom: its ``poscar_species`` label when that names the atom's element (a label left
    behind by changing an atom's element is ignored), else the element symbol."""
    col = structure.props.get("poscar_species")
    labels = list(col) if isinstance(col, (list, tuple)) and len(col) == len(structure) else None
    out = []
    for i, sym in enumerate(structure.symbols):
        lab = labels[i] if labels is not None else None
        out.append(lab if isinstance(lab, str) and lab and normalize_symbol(lab) == sym else sym)
    return out


def write_poscar(structure: Structure, *, order: str = "species") -> str:
    """Serialise to VASP 5 POSCAR (Direct coordinates, frame 0).

    *order* ``"species"`` (default) groups the atoms into one block per species in order of first appearance;
    ``"keep"`` keeps the atom order and writes one block per run of atoms of one species (an element may then appear
    twice on the species line, which VASP accepts unless machine-learned force fields are on).  See the module
    docstring for the flags, velocities and number format.
    """
    if order not in ("species", "keep"):
        raise ValueError("order must be 'species' or 'keep'")
    s = structure.get_frame(0) if structure.frames else structure
    if s.cell is None:
        s = s.copy()
        s.center(vacuum=10.0)
    labels = _species_blocks(s)
    idx = poscar_order(s.symbols, blocks=labels) if order == "species" else list(range(len(s)))
    names: list[str] = []
    counts: list[int] = []
    prev: str | None = None
    for i in idx:
        if labels[i] != prev:
            names.append(s.symbols[i])
            counts.append(0)
            prev = labels[i]
        counts[-1] += 1
    frac = cart_to_frac(s.positions, s.cell)
    flags = move_flags(s) if MOVE_FLAGS_KEY in s.props else None
    velocities = _velocity_rows(s)
    comment = (s.name or s.formula or "Facet").replace("\r", " ").replace("\n", " ")
    out = [comment, "   1.00000000000000"]
    for vec in s.cell:
        out.append("".join(f"{_fixed(v, 16):>22s}" for v in vec))
    out.append("".join(f"{e:>5s}" for e in names))
    out.append("".join(f"{c:>5d}" for c in counts))
    if flags is not None:
        out.append("Selective dynamics")
    out.append("Direct")
    for i in idx:
        line = "".join(f"{_fixed(v, 16):>20s}" for v in frac[i])
        if flags is not None:
            line += "".join(f"{'T' if f else 'F':>3s}" for f in flags[i])
        out.append(line)
    if velocities is not None:
        out.append("")
        for i in idx:
            out.append("".join(f"{_fixed(v, 16):>20s}" for v in velocities[i]))
    return "\n".join(out) + "\n"
