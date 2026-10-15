"""Python client for the AtomScope REST API (standard library only).

    from atomscope import Client, build

    c = Client("http://127.0.0.1:8765")             # local mode: no login needed
    c = Client("https://atoms.example.org")
    c.login("alice", "secret")                       # cloud mode
    p = c.create_project("Copper", structures=[build.crystal("fcc", "Cu")])
    s = c.upload_structure("POSCAR")                 # parsed by the server → Structure
    bonds = c.bonds(s)
    for summary in c.projects():
        print(summary["id"], summary["name"])

Errors raise :class:`ClientError` carrying the HTTP status and the server's
``detail`` message.
"""

from __future__ import annotations

import json
import mimetypes
import os
import secrets
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Iterable

from .core.structure import Structure

__all__ = ["Client", "ClientError"]


class ClientError(RuntimeError):
    """HTTP error returned by the server."""

    def __init__(self, status: int, detail: str, url: str = "") -> None:
        super().__init__(f"HTTP {status}: {detail}")
        self.status = status
        self.detail = detail
        self.url = url


def _struct_dict(s: Structure | dict[str, Any]) -> dict[str, Any]:
    return s.to_dict() if isinstance(s, Structure) else dict(s)


class Client:
    """Thin wrapper around the ``/api/v1`` endpoints."""

    def __init__(self, base_url: str = "http://127.0.0.1:8765", token: str | None = None, timeout: float = 60.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout

    # ------------------------------------------------------------- plumbing
    def _url(self, path: str, query: dict[str, Any] | None = None) -> str:
        url = f"{self.base_url}/api/v1{path}"
        if query:
            q = {k: v for k, v in query.items() if v is not None}
            if q:
                url += "?" + urllib.parse.urlencode(q)
        return url

    def request(
        self,
        method: str,
        path: str,
        json_body: Any = None,
        data: bytes | None = None,
        headers: dict[str, str] | None = None,
        query: dict[str, Any] | None = None,
        raw: bool = False,
    ) -> Any:
        """Perform a request; returns parsed JSON (or bytes with ``raw=True``)."""
        hdrs = {"Accept": "application/json", "User-Agent": "atomscope-client"}
        if self.token:
            hdrs["Authorization"] = f"Bearer {self.token}"
        if json_body is not None:
            data = json.dumps(json_body).encode("utf-8")
            hdrs["Content-Type"] = "application/json"
        hdrs.update(headers or {})
        url = self._url(path, query)
        req = urllib.request.Request(url, data=data, headers=hdrs, method=method.upper())
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                body = resp.read()
        except urllib.error.HTTPError as exc:
            payload = exc.read()
            detail = payload.decode("utf-8", errors="replace")
            try:
                detail = json.loads(detail).get("detail", detail)
            except (ValueError, AttributeError):
                pass
            raise ClientError(exc.code, str(detail), url) from None
        except urllib.error.URLError as exc:
            raise ClientError(0, f"cannot reach {self.base_url}: {exc.reason}", url) from None
        if raw:
            return body
        return json.loads(body) if body else None

    @staticmethod
    def _multipart(fields: dict[str, str], files: dict[str, tuple[str, bytes]]) -> tuple[bytes, str]:
        boundary = "----atomscope" + secrets.token_hex(12)
        out = bytearray()
        for name, value in fields.items():
            out += f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n".encode()
            out += str(value).encode("utf-8") + b"\r\n"
        for name, (filename, content) in files.items():
            ctype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
            safe = filename.replace('"', "_")
            out += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{safe}\"\r\n"
                    f"Content-Type: {ctype}\r\n\r\n").encode()
            out += content + b"\r\n"
        out += f"--{boundary}--\r\n".encode()
        return bytes(out), f"multipart/form-data; boundary={boundary}"

    # ------------------------------------------------------------------ meta
    def health(self) -> dict[str, Any]:
        return self.request("GET", "/health")

    def info(self) -> dict[str, Any]:
        return self.request("GET", "/info")

    # ------------------------------------------------------------------ auth
    def register(self, username: str, password: str) -> dict[str, Any]:
        """Create an account (cloud mode) and remember the returned token."""
        res = self.request("POST", "/auth/register", {"username": username, "password": password})
        self.token = res["token"]
        return res["user"]

    def login(self, username: str, password: str) -> dict[str, Any]:
        """Log in (cloud mode) and remember the token; returns the user."""
        res = self.request("POST", "/auth/login", {"username": username, "password": password})
        self.token = res["token"]
        return res["user"]

    def logout(self) -> None:
        self.request("POST", "/auth/logout")
        self.token = None

    def me(self) -> dict[str, Any]:
        return self.request("GET", "/auth/me")

    # -------------------------------------------------------------- projects
    def projects(self, q: str | None = None) -> list[dict[str, Any]]:
        """Project summaries, newest first."""
        return self.request("GET", "/projects", query={"q": q})

    def get_project(self, pid: str) -> dict[str, Any]:
        return self.request("GET", f"/projects/{urllib.parse.quote(pid)}")

    def create_project(
        self,
        name: str = "Untitled project",
        structures: Iterable[Structure | dict[str, Any]] = (),
        scene: dict[str, Any] | None = None,
        **extra: Any,
    ) -> dict[str, Any]:
        """Create a project; *structures* may be :class:`Structure` objects, structure
        dicts or ``{id, name, structure}`` entries."""
        entries = []
        for s in structures:
            if isinstance(s, Structure):
                entries.append({"name": s.name or s.formula, "structure": s.to_dict()})
            elif isinstance(s, dict) and "structure" in s:
                entries.append({**s, "structure": _struct_dict(s["structure"])})
            else:
                entries.append({"structure": dict(s)})
        doc = {"name": name, "structures": entries, **extra}
        if scene is not None:
            doc["scene"] = scene
        return self.request("POST", "/projects", doc)

    def update_project(self, pid: str, project: dict[str, Any]) -> dict[str, Any]:
        """Replace a project (PUT)."""
        return self.request("PUT", f"/projects/{urllib.parse.quote(pid)}", project)

    def patch_project(self, pid: str, **fields: Any) -> dict[str, Any]:
        """Update selected top-level fields (PATCH)."""
        return self.request("PATCH", f"/projects/{urllib.parse.quote(pid)}", fields)

    def delete_project(self, pid: str) -> None:
        self.request("DELETE", f"/projects/{urllib.parse.quote(pid)}")

    def duplicate_project(self, pid: str) -> dict[str, Any]:
        return self.request("POST", f"/projects/{urllib.parse.quote(pid)}/duplicate")

    def download_project(self, pid: str, path: str | os.PathLike | None = None) -> dict[str, Any]:
        """Fetch the project document; optionally save it to *path*."""
        raw = self.request("GET", f"/projects/{urllib.parse.quote(pid)}/download", raw=True)
        if path is not None:
            Path(path).write_bytes(raw)
        return json.loads(raw)

    def import_project(self, path: str | os.PathLike, format: str | None = None) -> dict[str, Any]:
        """Upload a project JSON or a structure file as a new project."""
        p = Path(path)
        fields = {"format": format} if format else {}
        body, ctype = self._multipart(fields, {"file": (p.name, p.read_bytes())})
        return self.request("POST", "/projects/import", data=body, headers={"Content-Type": ctype})

    # -------------------------------------------------------------------- io
    def formats(self) -> dict[str, Any]:
        return self.request("GET", "/formats")

    def upload_structure(self, path: str | os.PathLike, format: str | None = None, index: int | str | None = None) -> Structure:
        """Upload a local file, let the server parse it, return a :class:`Structure`."""
        p = Path(path)
        fields: dict[str, str] = {}
        if format:
            fields["format"] = format
        if index is not None:
            fields["index"] = str(index)
        body, ctype = self._multipart(fields, {"file": (p.name, p.read_bytes())})
        res = self.request("POST", "/io/parse", data=body, headers={"Content-Type": ctype})
        return Structure.from_dict(res["structure"])

    def parse_text(self, text: str, format: str | None = None, filename: str | None = None) -> Structure:
        res = self.request("POST", "/io/parse", {"text": text, "format": format, "filename": filename})
        return Structure.from_dict(res["structure"])

    def export_structure(self, structure: Structure | dict[str, Any], format: str) -> str:
        """Server-side export; returns the file text."""
        return self.request("POST", "/io/export", {"structure": _struct_dict(structure), "format": format})["text"]

    # ----------------------------------------------------------------- build
    def build_crystal(self, prototype: str, elements: Iterable[str] | str | None = None, a: float | None = None,
                      c: float | None = None, supercell: Iterable[int] | None = None, **params: Any) -> Structure:
        body: dict[str, Any] = {"prototype": prototype, "a": a, "c": c, "params": params}
        if elements is not None:
            body["elements"] = elements if isinstance(elements, str) else list(elements)
        if supercell is not None:
            body["supercell"] = list(supercell)
        return Structure.from_dict(self.request("POST", "/build/crystal", body)["structure"])

    def build_cluster(self, kind: str, element: str | None = None, size: float | None = None,
                      a: float | None = None, **params: Any) -> Structure:
        body = {"kind": kind, "element": element, "size": size, "a": a, "params": params}
        return Structure.from_dict(self.request("POST", "/build/cluster", body)["structure"])

    def supercell(self, structure: Structure | dict[str, Any], repeat: Iterable[int]) -> Structure:
        body = {"structure": _struct_dict(structure), "repeat": list(repeat)}
        return Structure.from_dict(self.request("POST", "/build/supercell", body)["structure"])

    def molecule(self, name: str) -> Structure:
        return Structure.from_dict(self.request("GET", f"/build/molecule/{urllib.parse.quote(name)}")["structure"])

    def build_custom(self, name: str, **params: Any) -> Structure:
        return Structure.from_dict(self.request("POST", f"/build/custom/{urllib.parse.quote(name)}", params)["structure"])

    # -------------------------------------------------------------- analysis
    def bonds(self, structure: Structure | dict[str, Any], scale: float = 1.15, cutoff: float | None = None,
              pbc: bool = True) -> list[list[Any]]:
        """``[[i, j, d, [ox, oy, oz]], ...]``."""
        body = {"structure": _struct_dict(structure), "scale": scale, "cutoff": cutoff, "pbc": pbc}
        return self.request("POST", "/analysis/bonds", body)["bonds"]

    def summary(self, structure: Structure | dict[str, Any]) -> dict[str, Any]:
        return self.request("POST", "/analysis/summary", {"structure": _struct_dict(structure)})["summary"]

    def rdf(self, structure: Structure | dict[str, Any], rmax: float = 8.0, nbins: int = 160) -> dict[str, Any]:
        return self.request("POST", "/analysis/rdf", {"structure": _struct_dict(structure), "rmax": rmax, "nbins": nbins})
