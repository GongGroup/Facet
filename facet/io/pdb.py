"""PDB reader and writer.

Reader: ``ATOM``/``HETATM`` records (fixed columns, with a whitespace-split
fallback for sloppy files), ``CRYST1`` for the cell (the 1 Å placeholder box is
ignored) and ``MODEL``/``ENDMDL`` for multiple frames.  The element comes from
columns 77-78, or is derived from the atom name.  Residue information is kept
in ``props`` (``atom_names``, ``residue_names``, ``residue_ids``, ``chain_ids``).

Writer: ``CRYST1`` (when a cell is present), one ``MODEL`` per frame for
trajectories, ``HETATM`` records with the element in columns 77-78.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from ..core.elements import is_element, normalize_symbol
from ..core.lattice import cart_to_frac, cell_to_cellpar, cellpar_to_cell
from ..core.structure import Structure

__all__ = ["read_pdb", "write_pdb"]


def _element_from_name(name_field: str) -> str:
    """Derive an element from the 4-character PDB atom-name field (cols 13-16)."""
    raw = name_field.ljust(4)
    stripped = raw.strip()
    if not stripped:
        return "X"
    letters = "".join(ch for ch in stripped if ch.isalpha())
    if not letters:
        return "X"
    # Element symbols are right-justified in columns 13-14: a two-letter element
    # starts in column 13 (e.g. "FE  "), a one-letter one in column 14 (" CA ").
    if raw[0].isalpha() and raw[1].isalpha():
        two = raw[0].upper() + raw[1].lower()
        if is_element(two) and not (raw[0] in "HCNOS" and len(letters) >= 3):
            return two
    if raw[0] in " 0123456789" and raw[1].isalpha():
        return normalize_symbol(raw[1])
    return normalize_symbol(letters[0])


def _parse_atom(line: str) -> tuple[str, list[float], dict[str, Any]]:
    try:
        x, y, z = float(line[30:38]), float(line[38:46]), float(line[46:54])
        name = line[12:16]
        elem = line[76:78].strip() if len(line) >= 77 else ""
        resname = line[17:20].strip()
        chain = line[21:22].strip()
        resseq_txt = line[22:26].strip()
        resseq = int(resseq_txt) if resseq_txt.lstrip("-").isdigit() else 0
    except ValueError:
        # Whitespace-separated fallback: ATOM serial name resname [chain] resseq x y z ...
        toks = line.split()
        nums = []
        for k in range(len(toks) - 1, 1, -1):
            try:
                float(toks[k])
                nums.append(k)
            except ValueError:
                if len(nums) >= 3:
                    break
        nums.sort()
        if len(nums) < 3:
            raise
        # first three floats after the residue sequence number are x y z
        coord_start = nums[0]
        if len(nums) >= 4 and "." not in toks[nums[0]]:
            coord_start = nums[1]
        x, y, z = (float(toks[coord_start + d]) for d in range(3))
        name = " " + toks[2][:3] if len(toks) > 2 else " X  "
        elem = toks[-1] if toks[-1].isalpha() and len(toks[-1]) <= 2 else ""
        resname, chain, resseq = (toks[3] if len(toks) > 3 else ""), "", 0
    if elem:
        symbol = normalize_symbol("".join(ch for ch in elem if ch.isalpha()) or elem)
    else:
        symbol = _element_from_name(name)
    meta = {"atom_name": name.strip(), "res_name": resname, "chain": chain, "res_seq": resseq}
    return symbol, [x, y, z], meta


def read_pdb(text: str) -> list[Structure]:
    """Parse PDB text; returns one structure per ``MODEL`` (or one if none)."""
    cell = None
    sg = None
    title = ""
    models: list[list[tuple[str, list[float], dict[str, Any]]]] = []
    current: list[tuple[str, list[float], dict[str, Any]]] = []
    in_model = False
    for line in text.splitlines():
        rec = line[:6].upper()
        if rec.startswith("CRYST1"):
            try:
                a, b, c = float(line[6:15]), float(line[15:24]), float(line[24:33])
                al, be, ga = float(line[33:40]), float(line[40:47]), float(line[47:54])
            except ValueError:
                toks = line.split()
                a, b, c, al, be, ga = (float(t) for t in toks[1:7])
            sg = line[55:66].strip() or None
            if not (abs(a - 1) < 1e-6 and abs(b - 1) < 1e-6 and abs(c - 1) < 1e-6):
                cell = cellpar_to_cell(a, b, c, al, be, ga)
        elif rec.startswith("MODEL"):
            if current:
                models.append(current)
            current = []
            in_model = True
        elif rec.startswith("ENDMDL"):
            models.append(current)
            current = []
            in_model = False
        elif rec.startswith("ATOM") or rec.startswith("HETATM"):
            current.append(_parse_atom(line))
        elif rec.startswith(("TITLE", "COMPND")) and not title:
            title = line[10:].strip()
        elif rec.startswith("HEADER") and not title:
            title = line[10:50].strip()
    if current or (not models and not in_model):
        models.append(current)
    models = [m for m in models if m]
    if not models:
        raise ValueError("no ATOM/HETATM records found")
    out = []
    for m in models:
        symbols = [a[0] for a in m]
        pos = np.array([a[1] for a in m], dtype=float)
        props = {
            "atom_names": [a[2]["atom_name"] for a in m],
            "residue_names": [a[2]["res_name"] for a in m],
            "residue_ids": [a[2]["res_seq"] for a in m],
            "chain_ids": [a[2]["chain"] for a in m],
        }
        info: dict[str, Any] = {"source": "pdb"}
        if sg and cell is not None:
            info["spacegroup"] = sg
        out.append(Structure(symbols, pos, cell=cell, pbc=cell is not None, props=props, info=info, name=title[:120]))
    return out


def _atom_name(sym: str, given: Any) -> str:
    if isinstance(given, str) and given.strip():
        n = given.strip()[:4]
        return f" {n:<3s}" if len(n) < 4 and len(sym) == 1 else f"{n:<4s}"
    return f" {sym:<3s}" if len(sym) == 1 else f"{sym:<4s}"


def write_pdb(structure: Structure) -> str:
    """Serialise to PDB (one MODEL per frame when the structure has frames)."""
    out: list[str] = []
    if structure.name:
        out.append(f"TITLE     {structure.name[:70]}")
    out.append("REMARK   1 Generated by Facet")
    base_cell = structure.cell
    std_cell = None
    if base_cell is not None:
        a, b, c, al, be, ga = cell_to_cellpar(base_cell)
        sg = "P 1"
        out.append(f"CRYST1{a:9.3f}{b:9.3f}{c:9.3f}{al:7.2f}{be:7.2f}{ga:7.2f} {sg:<11s}{1:4d}")
        std_cell = cellpar_to_cell(a, b, c, al, be, ga)
    names = structure.props.get("atom_names")
    resn = structure.props.get("residue_names")
    resi = structure.props.get("residue_ids")
    chains = structure.props.get("chain_ids")
    multi = structure.n_frames > 1
    for k, frame in enumerate(structure.iter_frames()):
        if multi:
            out.append(f"MODEL     {k + 1:4d}")
        pos = frame.positions
        if frame.cell is not None:
            # PDB assumes the standard orientation (a along x, b in xy-plane).
            a, b, c, al, be, ga = cell_to_cellpar(frame.cell)
            pos = cart_to_frac(pos, frame.cell) @ cellpar_to_cell(a, b, c, al, be, ga)
        elif std_cell is not None and base_cell is not None:
            pos = cart_to_frac(pos, base_cell) @ std_cell
        for i, (sym, p) in enumerate(zip(frame.symbols, pos)):
            serial = (i + 1) % 100000
            nm = _atom_name(sym, names[i] if names else None)
            rn = (str(resn[i]) if resn and resn[i] else "MOL")[:3]
            ch = (str(chains[i]) if chains and chains[i] else "A")[:1]
            try:
                rs = int(resi[i]) if resi else 1
            except (TypeError, ValueError):
                rs = 1
            el = sym[:2].upper().rjust(2)
            out.append(
                f"HETATM{serial:5d} {nm}{' '}{rn:>3s} {ch}{rs % 10000:4d}    "
                f"{p[0]:8.3f}{p[1]:8.3f}{p[2]:8.3f}{1.0:6.2f}{0.0:6.2f}          {el}  "
            )
        if multi:
            out.append("ENDMDL")
    out.append("END")
    return "\n".join(out) + "\n"
