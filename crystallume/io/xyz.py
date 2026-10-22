"""XYZ and extended XYZ (extxyz) reader/writers.

Reading handles plain XYZ (``symbol x y z [ignored...]``) and the extended XYZ
convention where the comment line carries ``key=value`` pairs, notably::

    Lattice="ax ay az bx by bz cx cy cz" Properties=species:S:1:pos:R:3:forces:R:3 pbc="T T T"

Multiple concatenated frames are supported.  Extra per-atom columns from
``Properties`` become ``Structure.props`` (taken from the first frame); other
scalar ``key=value`` pairs go to ``Structure.info``.
"""

from __future__ import annotations

import re
from typing import Any

import numpy as np

from ..core.elements import normalize_symbol
from ..core.structure import Structure

__all__ = ["read_xyz", "write_xyz", "write_extxyz", "parse_comment"]

_KV_RE = re.compile(
    r"""([A-Za-z_][\w\-:.]*)\s*=\s*("(?:[^"\\]|\\.)*"|'[^']*'|\{[^}]*\}|[^\s"']+)"""
)
_RESERVED = {"lattice", "properties", "pbc"}


def _convert(value: str) -> Any:
    v = value.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        v = v[1:-1]
    if v.startswith("{") and v.endswith("}"):
        v = v[1:-1]
    low = v.lower()
    if low in ("t", "true"):
        return True
    if low in ("f", "false"):
        return False
    try:
        return int(v)
    except ValueError:
        pass
    try:
        return float(v)
    except ValueError:
        pass
    parts = v.split()
    if len(parts) > 1:
        try:
            return [float(p) for p in parts]
        except ValueError:
            pass
    return v


def parse_comment(comment: str) -> tuple[dict[str, str], str]:
    """Split an XYZ comment line into ``({key: raw_value}, leftover_text)``."""
    pairs: dict[str, str] = {}
    leftover = comment
    for m in _KV_RE.finditer(comment):
        pairs[m.group(1)] = m.group(2)
    if pairs:
        leftover = _KV_RE.sub("", comment).strip()
    return pairs, leftover


def _unquote(v: str) -> str:
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    if v.startswith("{") and v.endswith("}"):
        return v[1:-1]
    return v


def _parse_properties(spec: str) -> list[tuple[str, str, int]]:
    parts = _unquote(spec).split(":")
    if len(parts) % 3 != 0:
        raise ValueError(f"malformed Properties specification {spec!r}")
    return [(parts[k], parts[k + 1].upper(), int(parts[k + 2])) for k in range(0, len(parts), 3)]


def _parse_bool(tok: str) -> bool:
    return tok.strip().upper() in ("T", "TRUE", "1")


def _parse_frame(natoms: int, comment: str, atom_lines: list[str], lineno: int) -> Structure:
    pairs, leftover = parse_comment(comment)
    lower = {k.lower(): k for k in pairs}
    cell = None
    if "lattice" in lower:
        vals = [float(v) for v in _unquote(pairs[lower["lattice"]]).split()]
        if len(vals) != 9:
            raise ValueError(f"line {lineno + 1}: Lattice must have 9 numbers")
        cell = np.array(vals).reshape(3, 3)
    pbc = None
    if "pbc" in lower:
        toks = _unquote(pairs[lower["pbc"]]).split()
        pbc = [_parse_bool(t) for t in toks] if len(toks) == 3 else [_parse_bool(toks[0])] * 3
    elif cell is not None:
        pbc = [True, True, True]
    props_spec = (
        _parse_properties(pairs[lower["properties"]]) if "properties" in lower else [("species", "S", 1), ("pos", "R", 3)]
    )
    ncols = sum(c for _, _, c in props_spec)
    columns: dict[str, list[Any]] = {name: [] for name, _, _ in props_spec}
    for k, line in enumerate(atom_lines):
        toks = line.split()
        if len(toks) < ncols:
            if "properties" not in lower and len(toks) >= 4:
                toks = toks[:4]
            else:
                raise ValueError(f"line {lineno + 3 + k}: expected {ncols} columns, got {len(toks)}")
        col = 0
        for name, typ, count in props_spec:
            raw = toks[col: col + count]
            col += count
            if typ == "R":
                vals: list[Any] = [float(t.replace("D", "E").replace("d", "e")) for t in raw]
            elif typ == "I":
                vals = [int(t) for t in raw]
            elif typ == "L":
                vals = [_parse_bool(t) for t in raw]
            else:
                vals = list(raw)
            columns[name].append(vals[0] if count == 1 else vals)
    lname = {n.lower(): n for n in columns}
    if "species" in lname:
        symbols = [normalize_symbol(s) for s in columns[lname["species"]]]
    elif "z" in lname:
        symbols = [normalize_symbol(int(z)) for z in columns[lname["z"]]]
    else:
        raise ValueError("Properties must contain 'species' (or 'Z')")
    pos_key = lname.get("pos") or lname.get("positions")
    if pos_key is None:
        raise ValueError("Properties must contain 'pos'")
    positions = np.array(columns[pos_key], dtype=float).reshape(-1, 3)
    props = {
        name: vals
        for name, vals in columns.items()
        if name.lower() not in ("species", "pos", "positions", "z")
    }
    info: dict[str, Any] = {}
    name = ""
    for key, raw in pairs.items():
        if key.lower() in _RESERVED:
            continue
        if key.lower() == "name":
            name = str(_unquote(raw))
            continue
        info[key] = _convert(raw)
    if not pairs:
        name = leftover.strip()[:120]
    elif leftover:
        info.setdefault("comment", leftover)
    if natoms != len(symbols):  # pragma: no cover - guarded by caller
        raise ValueError("atom count mismatch")
    return Structure(symbols, positions, cell=cell, pbc=pbc, props=props, info=info, name=name)


def read_xyz(text: str) -> list[Structure]:
    """Parse (extended) XYZ text; returns one :class:`Structure` per frame."""
    lines = text.splitlines()
    frames: list[Structure] = []
    i = 0
    nlines = len(lines)
    while i < nlines:
        head = lines[i].strip()
        if not head:
            i += 1
            continue
        try:
            natoms = int(head.split()[0])
        except ValueError as exc:
            raise ValueError(f"line {i + 1}: expected the number of atoms, got {head[:40]!r}") from exc
        if natoms < 0:
            raise ValueError(f"line {i + 1}: negative atom count")
        comment = lines[i + 1] if i + 1 < nlines else ""
        atom_lines = lines[i + 2: i + 2 + natoms]
        if len(atom_lines) < natoms:
            raise ValueError(f"frame starting at line {i + 1} declares {natoms} atoms but only {len(atom_lines)} lines follow")
        frames.append(_parse_frame(natoms, comment, atom_lines, i))
        i += 2 + natoms
    if not frames:
        raise ValueError("no XYZ frames found")
    return frames


def _fmt(v: float) -> str:
    return f"{v:16.8f}"


def write_xyz(structure: Structure) -> str:
    """Plain XYZ: every frame as ``N / comment / symbol x y z``."""
    out: list[str] = []
    comment = (structure.name or structure.formula or "Crystallume").replace("\n", " ")
    for frame in structure.iter_frames():
        out.append(str(len(frame)))
        out.append(comment)
        for s, p in zip(frame.symbols, frame.positions):
            out.append(f"{s:<3s}{_fmt(p[0])}{_fmt(p[1])}{_fmt(p[2])}")
    return "\n".join(out) + "\n"


def _quote(v: str) -> str:
    if re.fullmatch(r"[^\s\"'=]+", v):
        return v
    return '"' + v.replace('"', "'") + '"'


def _prop_columns(structure: Structure) -> list[tuple[str, str, int, list[list[str]]]]:
    """Serialisable per-atom properties as (name, type, ncols, rows-of-tokens)."""
    cols = []
    for name, vals in structure.props.items():
        if not re.fullmatch(r"[A-Za-z_]\w*", name):
            continue
        rows: list[list[str]] = []
        typ: str | None = None
        width: int | None = None
        ok = True
        for v in vals:
            items = v if isinstance(v, (list, tuple)) else [v]
            if width is None:
                width = len(items)
            if len(items) != width or width == 0:
                ok = False
                break
            toks = []
            for it in items:
                if isinstance(it, (bool, np.bool_)):
                    t, tok = "L", ("T" if it else "F")
                elif isinstance(it, (int, np.integer)):
                    t, tok = "I", str(int(it))
                elif isinstance(it, (float, np.floating)):
                    t, tok = "R", f"{float(it):.8f}"
                elif isinstance(it, str) and it and not re.search(r"\s", it):
                    t, tok = "S", it
                else:
                    ok = False
                    break
                if typ is None:
                    typ = t
                elif typ != t:
                    if {typ, t} == {"I", "R"}:
                        typ = "R"
                    else:
                        ok = False
                        break
                toks.append(tok)
            if not ok:
                break
            rows.append(toks)
        if ok and typ and width:
            cols.append((name, typ, width, rows))
    return cols


def write_extxyz(structure: Structure) -> str:
    """Extended XYZ: ``Lattice``, ``Properties`` (incl. per-atom props), ``pbc`` and scalar info."""
    out: list[str] = []
    cols = _prop_columns(structure)
    prop_spec = "species:S:1:pos:R:3" + "".join(f":{n}:{t}:{w}" for n, t, w, _ in cols)
    extra_info = []
    for key, val in structure.info.items():
        if key in ("format", "filename") or not re.fullmatch(r"[A-Za-z_][\w\-]*", str(key)):
            continue
        if isinstance(val, bool):
            extra_info.append(f"{key}={'T' if val else 'F'}")
        elif isinstance(val, (int, float)) and not isinstance(val, bool):
            extra_info.append(f"{key}={val}")
        elif isinstance(val, str) and "\n" not in val and len(val) < 200:
            extra_info.append(f"{key}={_quote(val)}")
    for frame in structure.iter_frames():
        parts = []
        if frame.cell is not None:
            parts.append('Lattice="' + " ".join(f"{v:.8f}" for v in frame.cell.reshape(-1)) + '"')
        parts.append(f"Properties={prop_spec}")
        parts.append('pbc="' + " ".join("T" if p else "F" for p in frame.pbc) + '"')
        if structure.name:
            parts.append(f"name={_quote(structure.name)}")
        parts.extend(extra_info)
        out.append(str(len(frame)))
        out.append(" ".join(parts))
        for k, (s, p) in enumerate(zip(frame.symbols, frame.positions)):
            line = f"{s:<3s}{_fmt(p[0])}{_fmt(p[1])}{_fmt(p[2])}"
            for _, _, _, rows in cols:
                line += " " + " ".join(rows[k])
            out.append(line)
    return "\n".join(out) + "\n"

