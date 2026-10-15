"""VASP POSCAR / CONTCAR reader and writer.

Reader features:

* VASP 5 (species line) and VASP 4 (species guessed from the comment line);
* universal scale factor, negative scale = target volume, or three per-axis
  scale factors (VASP 6);
* ``Direct`` and ``Cartesian`` coordinates;
* ``Selective dynamics`` (flags stored in ``props["selective_dynamics"]``);
* POTCAR-style species suffixes (``Fe_pv``, ``Ti/abc123``) are stripped.

The writer emits VASP 5 format with direct coordinates.  Atoms are grouped by
species (stable order of first appearance) because POSCAR requires contiguous
blocks.  Structures without a cell are placed in a box with 10 Å vacuum.
"""

from __future__ import annotations

import numpy as np

from ..core.elements import is_element, normalize_symbol
from ..core.lattice import cart_to_frac
from ..core.structure import Structure

__all__ = ["read_poscar", "write_poscar"]


def _is_number(tok: str) -> bool:
    try:
        float(tok)
        return True
    except ValueError:
        return False


def read_poscar(text: str) -> Structure:
    """Parse POSCAR/CONTCAR text."""
    lines = text.splitlines()
    if len(lines) < 7:
        raise ValueError("POSCAR is too short")
    comment = lines[0].strip()
    scale_toks = lines[1].split()
    try:
        scales = [float(t) for t in scale_toks[:3] if _is_number(t)]
    except ValueError as exc:  # pragma: no cover
        raise ValueError("line 2: invalid scale factor") from exc
    if not scales:
        raise ValueError("line 2: missing scale factor")
    try:
        lattice = np.array([[float(v) for v in lines[k].split()[:3]] for k in (2, 3, 4)])
    except ValueError as exc:
        raise ValueError("lines 3-5: invalid lattice vectors") from exc
    if lattice.shape != (3, 3):
        raise ValueError("lines 3-5: each lattice vector needs three numbers")

    idx = 5
    toks = lines[idx].split()
    species: list[str] | None = None
    if toks and not _is_number(toks[0]):
        species = [normalize_symbol(t) for t in toks]
        idx += 1
    try:
        counts = [int(t) for t in lines[idx].split() if not t.startswith("!")]
    except ValueError as exc:
        raise ValueError(f"line {idx + 1}: expected atom counts") from exc
    idx += 1
    warnings: list[str] = []
    if species is None:
        guess = [normalize_symbol(t) for t in comment.replace(",", " ").split()]
        guess = [g for g in guess if is_element(g)]
        if len(guess) >= len(counts):
            species = guess[: len(counts)]
        else:
            species = ["X"] * len(counts)
            warnings.append("VASP 4 POSCAR without element names in the comment line; species set to 'X'")
    if len(species) != len(counts):
        raise ValueError(f"{len(species)} species but {len(counts)} counts")
    natoms = sum(counts)

    selective = False
    mode_line = lines[idx].strip()
    if mode_line[:1] in ("s", "S"):
        selective = True
        idx += 1
        mode_line = lines[idx].strip()
    cartesian = mode_line[:1] in ("c", "C", "k", "K")
    idx += 1

    coords = np.zeros((natoms, 3))
    flags: list[list[bool]] = []
    for k in range(natoms):
        if idx + k >= len(lines):
            raise ValueError(f"expected {natoms} coordinate lines, found {k}")
        parts = lines[idx + k].split()
        try:
            coords[k] = [float(v) for v in parts[:3]]
        except (ValueError, IndexError) as exc:
            raise ValueError(f"line {idx + k + 1}: invalid coordinates") from exc
        if selective:
            fl = [p.upper().startswith("T") for p in parts[3:6]]
            flags.append(fl + [True] * (3 - len(fl)))

    # Scaling (VASP semantics)
    if len(scales) == 3:
        factor = np.array(scales)
        cell = lattice * factor[None, :]
    elif scales[0] < 0:
        vol = abs(np.linalg.det(lattice))
        f = (abs(scales[0]) / vol) ** (1.0 / 3.0)
        factor = np.array([f, f, f])
        cell = lattice * f
    else:
        factor = np.array([scales[0]] * 3)
        cell = lattice * scales[0]
    if cartesian:
        positions = coords * factor[None, :]
    else:
        positions = coords @ cell

    symbols = [s for s, c in zip(species, counts) for _ in range(c)]
    props = {"selective_dynamics": flags} if selective else {}
    info: dict = {}
    if warnings:
        info["warnings"] = warnings
    return Structure(symbols, positions, cell=cell, pbc=True, props=props, info=info, name=comment[:120])


def write_poscar(structure: Structure) -> str:
    """Serialise to VASP 5 POSCAR (direct coordinates, frame 0 only)."""
    s = structure.get_frame(0) if structure.frames else structure
    if s.cell is None:
        s = s.copy()
        s.center(vacuum=10.0)
    order: list[str] = list(dict.fromkeys(s.symbols))
    rank = {e: k for k, e in enumerate(order)}
    idx = sorted(range(len(s)), key=lambda i: rank[s.symbols[i]])
    counts = [s.symbols.count(e) for e in order]
    frac = cart_to_frac(s.positions, s.cell)[idx]
    sd = s.props.get("selective_dynamics")
    selective = sd is not None and all(isinstance(v, (list, tuple)) and len(v) == 3 for v in sd)
    comment = (s.name or s.formula or "AtomScope").replace("\n", " ")
    out = [comment, "   1.00000000000000"]
    for vec in s.cell:
        out.append("".join(f"{v:22.16f}" for v in vec))
    out.append("".join(f"{e:>5s}" for e in order))
    out.append("".join(f"{c:>5d}" for c in counts))
    if selective:
        out.append("Selective dynamics")
    out.append("Direct")
    for row, i in zip(frac, idx):
        line = "".join(f"{v + 0.0:20.16f}" for v in row)
        if selective:
            line += "".join(f"{'T' if f else 'F':>3s}" for f in sd[i])  # type: ignore[index]
        out.append(line)
    return "\n".join(out) + "\n"
