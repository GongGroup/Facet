"""CIF (Crystallographic Information File) reader and P1 writer.

Reader:

* full CIF 1.1 tokenizer: ``data_`` blocks, ``loop_``, quoted strings,
  semicolon text fields and comments; CIF2/mmCIF-style dotted tags
  (``_space_group_symop.operation_xyz``) are normalised to underscores;
* numbers with standard uncertainties (``3.905(2)``) and the special values
  ``?`` / ``.``;
* atoms from ``_atom_site_fract_x/y/z`` (or ``_atom_site_Cartn_*``), element
  from ``_atom_site_type_symbol`` (charges stripped) or from the site label;
* symmetry operators from ``_symmetry_equiv_pos_as_xyz`` or
  ``_space_group_symop_operation_xyz``; generated positions are wrapped to
  [0, 1) and de-duplicated within a fractional tolerance (periodic-aware).

Every data block that contains atom sites yields one structure.

Writer: a single P1 data block with fractional coordinates.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from .._version import __version__ as _VERSION
from ..core.elements import normalize_symbol, symbol_from_label
from ..core.lattice import cart_to_frac, cell_to_cellpar, cellpar_to_cell
from ..core.structure import Structure

__all__ = ["read_cif", "write_cif", "parse_cif_blocks", "parse_symop", "CifBlock"]

#: Default fractional tolerance for merging symmetry-equivalent positions.
SYMPREC = 1e-3

@dataclass
class CifBlock:
    """One parsed ``data_`` block: scalar tags and loops (tags lower-cased)."""

    name: str
    tags: dict[str, Any] = field(default_factory=dict)
    loops: list[dict[str, list[Any]]] = field(default_factory=list)

    def get(self, *names: str, default: Any = None) -> Any:
        for n in names:
            if n in self.tags:
                return self.tags[n]
        return default

    def loop_with(self, tag: str) -> dict[str, list[Any]] | None:
        for lp in self.loops:
            if tag in lp:
                return lp
        return None

    def column(self, *names: str) -> list[Any] | None:
        for n in names:
            lp = self.loop_with(n)
            if lp is not None:
                return lp[n]
            if n in self.tags:
                return [self.tags[n]]
        return None


# ------------------------------------------------------------------ tokenizer
class _Tok:
    __slots__ = ("kind", "value", "quoted")

    def __init__(self, kind: str, value: str, quoted: bool = False) -> None:
        self.kind = kind
        self.value = value
        self.quoted = quoted


def _tokenize(text: str) -> list[_Tok]:
    tokens: list[_Tok] = []
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        if line.startswith(";"):
            buf = [line[1:]]
            i += 1
            while i < n and not lines[i].startswith(";"):
                buf.append(lines[i])
                i += 1
            tokens.append(_Tok("value", "\n".join(buf).strip(), quoted=True))
            i += 1
            continue
        pos = 0
        ln = len(line)
        while pos < ln:
            c = line[pos]
            if c.isspace():
                pos += 1
                continue
            if c == "#":
                break
            if c in "'\"":
                end = pos + 1
                while True:
                    end = line.find(c, end)
                    if end == -1:
                        val, pos = line[pos + 1:], ln
                        break
                    if end + 1 >= ln or line[end + 1].isspace():
                        val, pos = line[pos + 1:end], end + 1
                        break
                    end += 1
                tokens.append(_Tok("value", val, quoted=True))
                continue
            end = pos
            while end < ln and not line[end].isspace():
                end += 1
            word = line[pos:end]
            pos = end
            low = word.lower()
            if word.startswith("_"):
                tokens.append(_Tok("tag", low.replace(".", "_")))
            elif low.startswith("data_"):
                tokens.append(_Tok("data", word[5:]))
            elif low == "loop_":
                tokens.append(_Tok("loop", word))
            elif low.startswith("save_") or low == "global_" or low == "stop_":
                tokens.append(_Tok("skip", word))
            else:
                tokens.append(_Tok("value", word))
        i += 1
    return tokens


def _value(tok: _Tok) -> Any:
    if not tok.quoted and tok.value in ("?", "."):
        return None
    return tok.value


def parse_cif_blocks(text: str) -> list[CifBlock]:
    """Parse CIF text into :class:`CifBlock` objects."""
    toks = _tokenize(text)
    blocks: list[CifBlock] = []
    cur: CifBlock | None = None
    k = 0
    nt = len(toks)

    def ensure() -> CifBlock:
        nonlocal cur
        if cur is None:
            cur = CifBlock("unnamed")
            blocks.append(cur)
        return cur

    while k < nt:
        t = toks[k]
        if t.kind == "data":
            cur = CifBlock(t.value or "unnamed")
            blocks.append(cur)
            k += 1
        elif t.kind == "loop":
            blk = ensure()
            k += 1
            names: list[str] = []
            while k < nt and toks[k].kind == "tag":
                names.append(toks[k].value)
                k += 1
            values: list[Any] = []
            while k < nt and toks[k].kind == "value":
                values.append(_value(toks[k]))
                k += 1
            if names:
                ncol = len(names)
                nrow = len(values) // ncol
                loop = {nm: [values[r * ncol + c] for r in range(nrow)] for c, nm in enumerate(names)}
                blk.loops.append(loop)
        elif t.kind == "tag":
            blk = ensure()
            if k + 1 < nt and toks[k + 1].kind == "value":
                blk.tags[t.value] = _value(toks[k + 1])
                k += 2
            else:
                blk.tags[t.value] = None
                k += 1
        else:
            k += 1
    return blocks


# -------------------------------------------------------------- numbers/ops
_NUM_RE = re.compile(r"^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)(?:\(\d+\))?$")


def _num(v: Any) -> float | None:
    """Parse a CIF number, dropping standard uncertainties like ``3.905(2)``."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    m = _NUM_RE.match(str(v).strip())
    if not m:
        return None
    return float(m.group(1))


def parse_symop(op: str) -> tuple[np.ndarray, np.ndarray]:
    """Parse a symmetry operator such as ``"-x+1/2, y, z-1/4"`` into ``(R, t)``."""
    s = op.strip().strip("'\"").lower().replace(" ", "")
    parts = s.split(",")
    if len(parts) != 3:
        raise ValueError(f"invalid symmetry operator {op!r}")
    rot = np.zeros((3, 3))
    trans = np.zeros(3)
    for row, expr in enumerate(parts):
        if not expr:
            raise ValueError(f"invalid symmetry operator {op!r}")
        for m in re.finditer(r"([+-]?)([^+-]+)", expr):
            sign = -1.0 if m.group(1) == "-" else 1.0
            term = m.group(2)
            var = term[-1]
            if var in "xyz":
                coef_txt = term[:-1].rstrip("*")
                coef = 1.0
                if coef_txt:
                    coef = float(coef_txt.split("/")[0]) / float(coef_txt.split("/")[1]) if "/" in coef_txt else float(coef_txt)
                rot[row, "xyz".index(var)] += sign * coef
            elif "/" in term:
                a, b = term.split("/", 1)
                trans[row] += sign * float(a) / float(b)
            else:
                trans[row] += sign * float(term)
    return rot, trans


def _snap(frac: np.ndarray, tol: float) -> np.ndarray:
    """Snap coordinates within *tol* of multiples of 1/12 or 1/8 (e.g. 0.3333 -> 1/3)."""
    out = frac.copy()
    for den in (12.0, 8.0):
        tgt = np.round(out * den) / den
        close = np.abs(out - tgt) < tol
        out = np.where(close, tgt, out)
    return out


def _wrap01(f: np.ndarray) -> np.ndarray:
    g = f - np.floor(f)
    g[g >= 1.0 - 1e-8] = 0.0
    g[np.abs(g) < 1e-8] = 0.0
    return g


_NEIGH27 = [(a, b, c) for a in (-1, 0, 1) for b in (-1, 0, 1) for c in (-1, 0, 1)]


def _expand(
    frac: np.ndarray, symbols: list[str], labels: list[str], occ: list[float | None],
    ops: list[tuple[np.ndarray, np.ndarray]], tol: float,
) -> tuple[np.ndarray, list[str], list[str], list[float | None]]:
    """Apply symmetry operators to every site and merge duplicates.

    Duplicates are first removed inside each orbit (vectorised), then across
    orbits with a periodic spatial hash, so the cost stays ~linear in the
    number of generated atoms.  Only atoms of the same element are merged.
    """
    rots = np.array([r for r, _ in ops])
    trans = np.array([t for _, t in ops])
    ncell = max(1, int(np.floor(1.0 / max(tol, 1e-6))))
    buckets: dict[tuple[int, int, int], list[int]] = {}
    out_f: list[np.ndarray] = []
    out_s: list[str] = []
    out_l: list[str] = []
    out_o: list[float | None] = []
    lim = tol + 1e-7
    for f, sym, lab, oc in zip(frac, symbols, labels, occ):
        gen = _wrap01(np.einsum("kij,j->ki", rots, f) + trans)
        d = gen[:, None, :] - gen[None, :, :]
        d -= np.round(d)
        close = np.max(np.abs(d), axis=2) < lim
        first = np.argmax(close, axis=1)  # index of first equivalent point
        for g in gen[first == np.arange(len(gen))]:
            key = tuple(int(v) % ncell for v in np.floor(g * ncell))
            dup = False
            for dk in _NEIGH27:
                k2 = ((key[0] + dk[0]) % ncell, (key[1] + dk[1]) % ncell, (key[2] + dk[2]) % ncell)
                for idx in buckets.get(k2, ()):
                    if out_s[idx] != sym:
                        continue
                    dd = out_f[idx] - g
                    dd -= np.round(dd)
                    if np.max(np.abs(dd)) < lim:
                        dup = True
                        break
                if dup:
                    break
            if dup:
                continue
            buckets.setdefault(key, []).append(len(out_f))  # type: ignore[arg-type]
            out_f.append(g)
            out_s.append(sym)
            out_l.append(lab)
            out_o.append(oc)
    return np.array(out_f).reshape(-1, 3), out_s, out_l, out_o


def _block_to_structure(blk: CifBlock, symprec: float) -> Structure | None:
    fx = blk.column("_atom_site_fract_x")
    cx = blk.column("_atom_site_cartn_x")
    if fx is None and cx is None:
        return None
    pars = [_num(blk.get(t)) for t in ("_cell_length_a", "_cell_length_b", "_cell_length_c")]
    angs = [_num(blk.get(t)) for t in ("_cell_angle_alpha", "_cell_angle_beta", "_cell_angle_gamma")]
    if any(p is None for p in pars):
        raise ValueError(f"data block {blk.name!r} has atom sites but no cell lengths")
    angs = [90.0 if a is None else a for a in angs]
    cell = cellpar_to_cell(*pars, *angs)  # type: ignore[arg-type]

    if fx is not None:
        loop = blk.loop_with("_atom_site_fract_x") or {"_atom_site_fract_x": fx}
        keys = ("_atom_site_fract_x", "_atom_site_fract_y", "_atom_site_fract_z")
    else:
        loop = blk.loop_with("_atom_site_cartn_x") or {"_atom_site_cartn_x": cx}
        keys = ("_atom_site_cartn_x", "_atom_site_cartn_y", "_atom_site_cartn_z")
    if not all(k in loop for k in keys):
        raise ValueError("atom site loop is missing coordinate columns")
    nsite = len(loop[keys[0]])
    labels_raw = loop.get("_atom_site_label") or [None] * nsite
    types_raw = loop.get("_atom_site_type_symbol") or [None] * nsite
    occ_raw = loop.get("_atom_site_occupancy") or [None] * nsite
    coords, symbols, labels, occ = [], [], [], []
    for r in range(nsite):
        xyz = [_num(loop[k][r]) for k in keys]
        if any(v is None for v in xyz):
            continue  # unknown position: skip site
        coords.append(xyz)
        t, lab = types_raw[r], labels_raw[r]
        if t:
            sym = normalize_symbol(str(t))
        elif lab:
            sym = symbol_from_label(str(lab))
        else:
            sym = "X"
        symbols.append(sym)
        labels.append(str(lab) if lab else f"{sym}{r + 1}")
        occ.append(_num(occ_raw[r]))
    if not coords:
        raise ValueError(f"data block {blk.name!r} contains no usable atom sites")
    arr = np.array(coords, dtype=float)
    frac = arr if fx is not None else cart_to_frac(arr, cell)

    op_strings = blk.column(
        "_symmetry_equiv_pos_as_xyz",
        "_space_group_symop_operation_xyz",
        "_space_group_symop_operation_xyz_",
    )
    warnings: list[str] = []
    ops: list[tuple[np.ndarray, np.ndarray]] = []
    for s in op_strings or []:
        if s:
            ops.append(parse_symop(str(s)))
    sg = blk.get("_symmetry_space_group_name_h-m", "_space_group_name_h-m_alt", "_space_group_name_h-m")
    sgnum = blk.get("_symmetry_int_tables_number", "_space_group_it_number")
    if not ops:
        ops = [(np.eye(3), np.zeros(3))]
        if sg and str(sg).replace(" ", "").upper() not in ("P1", "P1(1)"):
            warnings.append(f"no symmetry operators found for space group {sg!r}; atoms used as listed (P1)")
    frac = _snap(frac, symprec)
    full_f, full_s, full_l, full_o = _expand(frac, symbols, labels, occ, ops, symprec)

    info: dict[str, Any] = {"source": "cif"}
    if sg:
        info["spacegroup"] = " ".join(str(sg).split())
    if sgnum is not None and _num(sgnum) is not None:
        info["spacegroupNumber"] = int(_num(sgnum))  # type: ignore[arg-type]
    formula = blk.get("_chemical_formula_sum")
    if formula:
        info["formulaSum"] = str(formula)
    if warnings:
        info["warnings"] = warnings
    props: dict[str, Any] = {"labels": full_l}
    if any(o is not None and abs(o - 1.0) > 1e-6 for o in full_o):
        props["occupancy"] = [1.0 if o is None else o for o in full_o]
        info.setdefault("warnings", []).append("structure contains partially occupied sites (all sites kept)")
    name = blk.name if blk.name and blk.name != "unnamed" else (str(formula) if formula else "")
    return Structure(full_s, full_f @ cell, cell=cell, pbc=True, props=props, info=info, name=name)


def read_cif(text: str, symprec: float = SYMPREC) -> list[Structure]:
    """Parse CIF text; one symmetry-expanded :class:`Structure` per data block with atoms."""
    blocks = parse_cif_blocks(text)
    out = []
    for blk in blocks:
        s = _block_to_structure(blk, symprec)
        if s is not None:
            out.append(s)
    if not out:
        raise ValueError("no data block with atom sites (_atom_site_fract_x) found")
    return out


# ------------------------------------------------------------------- writer
def _cif_str(v: str) -> str:
    if v and re.fullmatch(r"[^\s'\"#$_;\[\]][^\s]*", v):
        return v
    return "'" + v.replace("'", "") + "'"


def write_cif(structure: Structure) -> str:
    """Write frame 0 as a P1 CIF (structures without a cell get a 10 Å vacuum box)."""
    s = structure.get_frame(0) if structure.frames else structure
    if s.cell is None:
        s = s.copy()
        s.center(vacuum=10.0)
    a, b, c, al, be, ga = cell_to_cellpar(s.cell)
    frac = cart_to_frac(s.positions, s.cell)
    block = re.sub(r"[^\w\-]+", "_", s.name or s.formula or "structure").strip("_") or "structure"
    comp = s.composition
    out = [
        f"# Generated by AtomScope {_VERSION}",
        f"data_{block}",
        f"_audit_creation_method           'AtomScope {_VERSION}'",
        f"_chemical_formula_sum            '{' '.join(f'{e}{n}' for e, n in comp.items())}'",
        f"_cell_length_a                   {a:.6f}",
        f"_cell_length_b                   {b:.6f}",
        f"_cell_length_c                   {c:.6f}",
        f"_cell_angle_alpha                {al:.6f}",
        f"_cell_angle_beta                 {be:.6f}",
        f"_cell_angle_gamma                {ga:.6f}",
        f"_cell_volume                     {abs(np.linalg.det(s.cell)):.6f}",
        "_symmetry_space_group_name_H-M   'P 1'",
        "_symmetry_Int_Tables_number      1",
        "",
        "loop_",
        "_symmetry_equiv_pos_as_xyz",
        "  'x, y, z'",
        "",
        "loop_",
        "_atom_site_label",
        "_atom_site_type_symbol",
        "_atom_site_fract_x",
        "_atom_site_fract_y",
        "_atom_site_fract_z",
        "_atom_site_occupancy",
    ]
    counter: dict[str, int] = {}
    occ = s.props.get("occupancy")
    for k, (sym, f) in enumerate(zip(s.symbols, frac)):
        counter[sym] = counter.get(sym, 0) + 1
        label = f"{sym}{counter[sym]}"
        o = 1.0
        if occ is not None:
            try:
                o = float(occ[k])
            except (TypeError, ValueError):
                o = 1.0
        out.append(f"  {_cif_str(label):<8s} {_cif_str(sym):<3s} {f[0] + 0.0:12.8f} {f[1] + 0.0:12.8f} {f[2] + 0.0:12.8f} {o:.4f}")
    return "\n".join(out) + "\n"

