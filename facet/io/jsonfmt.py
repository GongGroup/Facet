"""Facet JSON format (``facet.structure/1``).

The reader also accepts a JSON *list* of structures (returned as frames when
compatible) and a whole project document (``facet.project/1``), in which
case the active structure is returned.
"""

from __future__ import annotations

import json
from typing import Any

from ..core.structure import Structure

__all__ = ["read_json", "write_json"]


def _from_obj(obj: Any) -> Structure | list[Structure]:
    if isinstance(obj, list):
        return [Structure.from_dict(o.get("structure", o) if isinstance(o, dict) else o) for o in obj]
    if not isinstance(obj, dict):
        raise ValueError("JSON must be an object or a list of objects")
    if "structures" in obj and isinstance(obj["structures"], list):
        entries = obj["structures"]
        if not entries:
            raise ValueError("project contains no structures")
        active = obj.get("activeStructure")
        chosen = next((e for e in entries if isinstance(e, dict) and e.get("id") == active), entries[0])
        data = chosen.get("structure", chosen)
        s = Structure.from_dict(data)
        if not s.name and chosen.get("name"):
            s.name = str(chosen["name"])
        return s
    if "structure" in obj and isinstance(obj["structure"], dict):
        return Structure.from_dict(obj["structure"])
    return Structure.from_dict(obj)


def read_json(text: str) -> Structure | list[Structure]:
    """Parse Facet structure/project JSON."""
    try:
        obj = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid JSON: {exc}") from exc
    return _from_obj(obj)


def write_json(structure: Structure) -> str:
    """Serialise to compact ``facet.structure/1`` JSON."""
    return json.dumps(structure.to_dict(), separators=(",", ":"), ensure_ascii=False) + "\n"
