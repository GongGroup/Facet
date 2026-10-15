"""Command-line interface: ``atomscope <command> ...``.

Commands::

    atomscope serve   [--host H] [--port P] [--mode local|cloud] [--data DIR] [--plugins DIR ...]
                      [--no-registration] [--open] [--cors ORIGIN ...]
    atomscope convert IN OUT [--from FMT] [--to FMT] [--index I]
    atomscope build crystal fcc Cu --a 3.61 --repeat 3 3 3 -o out.xyz
    atomscope build cluster icosahedron Au --size 3 -o au55.xyz
    atomscope build molecule caffeine -o caffeine.xyz
    atomscope info FILE [--format FMT] [--bonds] [--json]
    atomscope user create NAME [--password PW] [--data DIR]     (also: list, delete, passwd)
    atomscope plugins [--plugins DIR ...] [--json]
    atomscope formats
"""

from __future__ import annotations

import argparse
import getpass
import json
import logging
import sys
from pathlib import Path
from typing import Sequence

from ._version import __version__

__all__ = ["main", "build_parser"]


def _err(msg: str) -> int:
    print(f"atomscope: error: {msg}", file=sys.stderr)
    return 1


# ------------------------------------------------------------------ commands
def cmd_serve(args: argparse.Namespace) -> int:
    from .config import Settings
    from .server import serve

    settings = Settings.from_env(
        host=args.host,
        port=args.port,
        mode=args.mode,
        data_dir=Path(args.data) if args.data else None,
        plugin_dirs=[Path(p) for p in args.plugins] if args.plugins else None,
        allow_registration=False if args.no_registration else None,
        cors_origins=args.cors or None,
        web_dir=Path(args.web_dir) if args.web_dir else None,
        log_level=args.log_level,
    )
    serve(settings=settings, open_browser=args.open)
    return 0


def _write_or_print(structure, output: str | None, fmt: str | None) -> None:
    from .io import to_text, write

    if output:
        write(output, structure, format=fmt)
        print(f"wrote {len(structure)} atoms ({structure.formula}) to {output}", file=sys.stderr)
    else:
        sys.stdout.write(to_text(structure, fmt or "extxyz"))


def cmd_convert(args: argparse.Namespace) -> int:
    from .io import read, write

    index = args.index
    if index is not None and ":" not in index:
        index = int(index)
    s = read(args.input, format=args.from_, index=index)
    write(args.output, s, format=args.to)
    print(f"converted {args.input} -> {args.output} ({len(s)} atoms, {s.n_frames} frame(s))", file=sys.stderr)
    return 0


def cmd_build(args: argparse.Namespace) -> int:
    from . import build

    if args.kind == "crystal":
        kw = {}
        if args.u is not None:
            kw["u"] = args.u
        if args.vacuum is not None:
            kw["vacuum"] = args.vacuum
        s = build.crystal(args.prototype, args.elements or None, a=args.a, c=args.c, **kw)
        if args.repeat:
            s = s.repeat(*args.repeat)
    elif args.kind == "cluster":
        kw = {}
        if args.ino is not None:
            kw["ino"] = args.ino
        if args.truncate is not None:
            kw["truncate"] = args.truncate
        size = args.size if args.size is not None else build.CLUSTERS.get(args.cluster_kind, {}).get("defaultSize", 3)
        s = build.cluster(args.cluster_kind, args.element, size, a=args.a, **kw)
    else:
        s = build.molecule(args.name)
    _write_or_print(s, args.output, args.format)
    return 0


def _fmt_num(v: float | None, unit: str = "", digits: int = 4) -> str:
    return "—" if v is None else f"{v:.{digits}f}{unit}"


def cmd_info(args: argparse.Namespace) -> int:
    from .analysis import coordination_numbers, summary
    from .io import read

    s = read(args.file, format=args.format)
    info = summary(s)
    if args.bonds:
        cn = coordination_numbers(s)
        info["bonds"] = int(cn.sum() // 2)
        info["averageCoordination"] = float(cn.mean()) if len(cn) else 0.0
    if args.json:
        print(json.dumps(info, indent=2, ensure_ascii=False))
        return 0
    print(f"File        : {args.file} ({s.info.get('format', '?')})")
    if s.name:
        print(f"Name        : {s.name}")
    print(f"Formula     : {info['formula']}  (reduced {info['reducedFormula']})")
    print(f"Atoms       : {info['natoms']}    Frames: {info['nframes']}")
    print("Composition : " + ", ".join(f"{k} {v}" for k, v in info["composition"].items()))
    if info["cellpar"]:
        a, b, c, al, be, ga = info["cellpar"]
        print(f"Cell        : a={a:.4f} b={b:.4f} c={c:.4f} Å  α={al:.2f} β={be:.2f} γ={ga:.2f}°")
        print(f"Volume      : {_fmt_num(info['volume'], ' Å^3', 3)}    Density: {_fmt_num(info['density'], ' g/cm^3', 4)}")
    else:
        print("Cell        : none (molecule / cluster)")
    print("PBC         : " + " ".join("T" if p else "F" for p in info["pbc"]))
    if info.get("spacegroup"):
        print(f"Space group : {info['spacegroup']}")
    size = info["boundingBox"]["size"]
    print(f"Extent      : {size[0]:.3f} x {size[1]:.3f} x {size[2]:.3f} Å")
    if args.bonds:
        print(f"Bonds       : {info['bonds']}    mean coordination {info['averageCoordination']:.2f}")
    for w in s.info.get("warnings", []) if isinstance(s.info.get("warnings"), list) else []:
        print(f"Warning     : {w}")
    return 0


def _user_store(args: argparse.Namespace):
    from .config import Settings
    from .storage import SQLiteStore

    settings = Settings.from_env(data_dir=Path(args.data) if args.data else None)
    return SQLiteStore(settings.db_path, secret=settings.resolve_secret()), settings


def _ask_password(given: str | None) -> str:
    if given:
        return given
    if sys.stdin.isatty():
        pw = getpass.getpass("Password: ")
        if pw != getpass.getpass("Repeat password: "):
            raise ValueError("passwords do not match")
        return pw
    return sys.stdin.readline().rstrip("\n")


def cmd_user(args: argparse.Namespace) -> int:
    store, settings = _user_store(args)
    try:
        if args.action == "create":
            user = store.create_user(args.name, _ask_password(args.password))
            print(f"created user {user['username']} ({user['id']}) in {settings.db_path}")
        elif args.action == "list":
            users = store.list_users()
            for u in users:
                print(f"{u['id']}  {u['username']:<24s} created {u['created']}")
            if not users:
                print(f"no users in {settings.db_path}")
        elif args.action == "delete":
            store.delete_user(args.name, delete_projects=not args.keep_projects)
            print(f"deleted user {args.name}")
        elif args.action == "passwd":
            store.set_password(args.name, _ask_password(args.password))
            print(f"password updated for {args.name}")
    except KeyError as exc:
        return _err(f"no such user: {exc.args[0]}")
    finally:
        store.close()
    return 0


def cmd_plugins(args: argparse.Namespace) -> int:
    from .config import Settings
    from .plugins import PluginManager

    settings = Settings.from_env(plugin_dirs=[Path(p) for p in args.plugins] if args.plugins else None)
    logging.getLogger("atomscope.plugins").setLevel(logging.CRITICAL)
    mgr = PluginManager(settings.plugin_dirs, use_entry_points=True).load_all()
    data = mgr.to_json()
    if args.json:
        print(json.dumps(data, indent=2))
        return 0
    if not data:
        dirs = ", ".join(str(d) for d in settings.plugin_dirs) or "none"
        print(f"no plugins found (plugin dirs: {dirs}; entry-point group 'atomscope.plugins')")
        return 0
    for p in data:
        mark = "ok   " if p["status"] == "loaded" else "ERROR"
        print(f"[{mark}] {p['name']} {p['version']} — {p['description']}")
        print(f"        source: {p['source']}")
        if p["error"]:
            print(f"        error : {p['error']}")
        for key in ("readers", "writers", "builders", "analyses", "routes", "frontend"):
            if p.get(key):
                print(f"        {key:<8s}: {', '.join(p[key])}")
        presets = {k: v for k, v in (p.get("presets") or {}).items() if v}
        if presets:
            print("        presets : " + "; ".join(f"{k}: {', '.join(map(str, v))}" for k, v in presets.items()))
    return 0


def cmd_formats(args: argparse.Namespace) -> int:
    from .io import formats

    f = formats()
    print("Readers:")
    for r in f["readers"]:
        names = " ".join(r["extensions"] + [n.upper() for n in r["filenames"]])
        print(f"  {r['name']:<8s} {names:<28s} {r['description']}")
    print("Writers:")
    for w in f["writers"]:
        print(f"  {w['name']:<8s} {' '.join(w['extensions']):<28s} {w['description']}")
    return 0


# -------------------------------------------------------------------- parser
def build_parser() -> argparse.ArgumentParser:
    """Create the argument parser (exposed for documentation and tests)."""
    p = argparse.ArgumentParser(prog="atomscope", description="AtomScope — visualise atoms, clusters and crystals.")
    p.add_argument("--version", action="version", version=f"atomscope {__version__}")
    p.add_argument("-v", "--verbose", action="store_true", help="verbose logging")
    sub = p.add_subparsers(dest="command", metavar="COMMAND")

    s = sub.add_parser("serve", help="run the web app / REST API server")
    s.add_argument("--host", help="bind address (default 127.0.0.1; 0.0.0.0 for LAN/cloud)")
    s.add_argument("--port", type=int, help="port (default 8765)")
    s.add_argument("--mode", choices=["local", "cloud"], help="local: single user, files on disk; cloud: accounts + SQLite")
    s.add_argument("--data", metavar="DIR", help="data directory (default ~/.atomscope)")
    s.add_argument("--plugins", metavar="DIR", nargs="+", action="extend", help="plugin directories")
    s.add_argument("--no-registration", action="store_true", help="cloud mode: disable self-registration")
    s.add_argument("--open", action="store_true", help="open the browser")
    s.add_argument("--cors", metavar="ORIGIN", nargs="+", action="extend", help="allowed CORS origins ('*' for any)")
    s.add_argument("--web-dir", metavar="DIR", help="serve the frontend from this directory instead")
    s.add_argument("--log-level", choices=["critical", "error", "warning", "info", "debug"], help="log level")
    s.set_defaults(func=cmd_serve)

    c = sub.add_parser("convert", help="convert between file formats")
    c.add_argument("input")
    c.add_argument("output")
    c.add_argument("--from", dest="from_", metavar="FMT", help="input format (auto-detected)")
    c.add_argument("--to", metavar="FMT", help="output format (from extension)")
    c.add_argument("--index", help="frame selection: -1, 0:10:2 ... (default: all frames)")
    c.set_defaults(func=cmd_convert)

    b = sub.add_parser("build", help="build crystals, clusters and molecules")
    bsub = b.add_subparsers(dest="kind", metavar="KIND", required=True)
    bc = bsub.add_parser("crystal", help="crystal from a prototype")
    bc.add_argument("prototype", help="sc bcc fcc hcp diamond zincblende wurtzite rocksalt cscl fluorite perovskite "
                                      "rutile graphene mos2 graphite")
    bc.add_argument("elements", nargs="*", help="element symbols in role order (default per prototype)")
    bc.add_argument("--a", type=float, help="lattice constant a (Å)")
    bc.add_argument("--c", type=float, help="lattice constant c (Å)")
    bc.add_argument("--u", type=float, help="internal parameter (wurtzite, rutile)")
    bc.add_argument("--vacuum", type=float, help="vacuum (2D prototypes)")
    bc.add_argument("--repeat", type=int, nargs=3, metavar=("NX", "NY", "NZ"), help="supercell")
    bk = bsub.add_parser("cluster", help="nanoparticle / cluster")
    bk.add_argument("cluster_kind", help="icosahedron cuboctahedron decahedron octahedron tetrahedron sphere fullerene")
    bk.add_argument("element", nargs="?", help="element symbol")
    bk.add_argument("--size", type=float, help="shells / atoms per edge / radius (Å)")
    bk.add_argument("--a", type=float, help="fcc lattice constant (Å)")
    bk.add_argument("--ino", type=int, help="decahedron (100) truncation")
    bk.add_argument("--truncate", type=int, help="octahedron vertex truncation")
    bm = bsub.add_parser("molecule", help="molecule from the built-in library")
    bm.add_argument("name", help="water methane ammonia co2 benzene ethanol methanol ethylene acetylene caffeine c60")
    for sp in (bc, bk, bm):
        sp.add_argument("-o", "--output", help="output file (default: extended XYZ on stdout)")
        sp.add_argument("--format", help="output format (default: from extension)")
    b.set_defaults(func=cmd_build)

    i = sub.add_parser("info", help="summarise a structure file")
    i.add_argument("file")
    i.add_argument("--format", help="input format (auto-detected)")
    i.add_argument("--bonds", action="store_true", help="also count bonds")
    i.add_argument("--json", action="store_true", help="JSON output")
    i.set_defaults(func=cmd_info)

    u = sub.add_parser("user", help="manage cloud-mode accounts")
    usub = u.add_subparsers(dest="action", metavar="ACTION", required=True)
    for name, helptext in (("create", "create a user"), ("passwd", "set a user's password")):
        x = usub.add_parser(name, help=helptext)
        x.add_argument("name")
        x.add_argument("--password", help="password (prompted when omitted)")
        x.add_argument("--data", metavar="DIR", help="data directory (default ~/.atomscope)")
    ul = usub.add_parser("list", help="list users")
    ul.add_argument("--data", metavar="DIR")
    ud = usub.add_parser("delete", help="delete a user and their projects")
    ud.add_argument("name")
    ud.add_argument("--keep-projects", action="store_true", help="keep the user's projects in the database")
    ud.add_argument("--data", metavar="DIR")
    u.set_defaults(func=cmd_user)

    pl = sub.add_parser("plugins", help="list discovered plugins")
    pl.add_argument("--plugins", metavar="DIR", nargs="+", action="extend", help="plugin directories")
    pl.add_argument("--json", action="store_true")
    pl.set_defaults(func=cmd_plugins)

    f = sub.add_parser("formats", help="list supported file formats")
    f.set_defaults(func=cmd_formats)
    return p


def main(argv: Sequence[str] | None = None) -> int:
    """Entry point of the ``atomscope`` console script."""
    parser = build_parser()
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    if not getattr(args, "func", None):
        parser.print_help()
        return 0
    try:
        return int(args.func(args) or 0)
    except KeyboardInterrupt:
        return 130
    except (OSError, ValueError) as exc:
        return _err(str(exc))


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
