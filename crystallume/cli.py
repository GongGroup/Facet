"""Command-line interface: ``crystallume <command> ...``.

Commands::

    crystallume serve   [--host H] [--port P] [--mode local|cloud] [--data DIR] [--plugins DIR ...]
                      [--no-registration] [--open] [--cors ORIGIN ...] [--root-path /PREFIX]
                      [--forwarded-allow-ips IP[,IP...]]
    crystallume convert IN OUT [--from FMT] [--to FMT] [--index I] [--plugins DIR]
    crystallume build crystal fcc Cu --a 3.61 --repeat 3 3 3 -o out.xyz
    crystallume build cluster icosahedron Au --size 3 -o au55.xyz
    crystallume build molecule caffeine -o caffeine.xyz
    crystallume build custom hello-chain --param n=12 --param element=Ag -o chain.xyz
    crystallume analyze NAME FILE [--param KEY=VALUE ...]        (summary, coordination, rdf or a plugin analysis)
    crystallume info FILE [--format FMT] [--bonds] [--json]
    crystallume user create NAME [--password PW] [--data DIR]     (also: list, delete, passwd)
    crystallume plugins [--plugins DIR ...] [--json]
    crystallume plugins new NAME [--dir DIR]                      (scaffold a plugin)
    crystallume formats

``convert``, ``info``, ``formats``, ``build`` and ``analyze`` load plugins first (``--plugins DIR``,
else ``CRYSTALLUME_PLUGIN_DIRS``, plus installed entry-point plugins), so plugin file formats,
builders and analyses work on the command line too. Their ``--plugins`` takes one directory per flag
(repeat it, or join directories with ``os.pathsep``) and may come anywhere on the line.

``convert`` and ``build`` check what the written file loses (``crystallume.io.export_report``) and print
``crystallume: warning: ...`` and ``crystallume: note: ...`` lines on stderr; the exit code stays 0.
"""

from __future__ import annotations

import argparse
import getpass
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Sequence

from ._version import __version__

__all__ = ["main", "build_parser", "load_cli_plugins", "parse_params"]


def _err(msg: str) -> int:
    print(f"crystallume: error: {msg}", file=sys.stderr)
    return 1


# ------------------------------------------------------------------- plugins
def load_cli_plugins(plugin_dirs: Sequence[str] | None = None, verbose: bool = False):
    """Load plugins for a command: *plugin_dirs*, else ``CRYSTALLUME_PLUGIN_DIRS``; plus entry points.

    Failed plugins are reported as one warning line each (tracebacks with ``-v``).
    Returns the :class:`~crystallume.plugins.PluginManager`.
    """
    from .config import Settings
    from .plugins import PluginManager

    dirs = [d for item in plugin_dirs or () for d in str(item).split(os.pathsep) if d]
    settings = Settings.from_env(plugin_dirs=[Path(p) for p in dirs] if dirs else None)
    logger = logging.getLogger("crystallume.plugins")
    level = logger.level
    if not verbose:
        logger.setLevel(logging.CRITICAL)
    try:
        mgr = PluginManager(settings.plugin_dirs, use_entry_points=settings.entry_point_plugins).load_all()
    finally:
        logger.setLevel(level)
    for r in mgr.records:
        if r.status == "error":
            print(f"crystallume: warning: plugin {r.name} failed to load: {r.error}", file=sys.stderr)
    return mgr


def _coerce(value: str, kind: str | None) -> Any:
    """Turn a ``--param`` string into the type the parameter schema asks for."""
    if kind == "int":
        return int(value)
    if kind == "float":
        return float(value)
    if kind == "bool":
        v = value.strip().lower()
        if v in ("1", "true", "yes", "on", "y", "t"):
            return True
        if v in ("0", "false", "no", "off", "n", "f"):
            return False
        raise ValueError(f"not a boolean: {value!r}")
    if kind in ("string", "element", "select"):
        return value
    try:
        return json.loads(value)
    except ValueError:
        return value


def parse_params(pairs: Sequence[str] | None, schema: Sequence[dict[str, Any]] = ()) -> dict[str, Any]:
    """``["n=8", "element=Au"]`` → ``{"n": 8, "element": "Au"}`` using the plugin's parameter schema."""
    types = {p.get("name"): p.get("type") for p in schema or () if isinstance(p, dict)}
    out: dict[str, Any] = {}
    for item in pairs or ():
        key, sep, value = item.partition("=")
        key = key.strip()
        if not sep or not key:
            raise ValueError(f"--param expects KEY=VALUE, got {item!r}")
        try:
            out[key] = _coerce(value, types.get(key))
        except ValueError as exc:
            raise ValueError(f"--param {key}: {exc}") from None
    return out


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
        forwarded_allow_ips=args.forwarded_allow_ips,
    )
    serve(settings=settings, open_browser=args.open, root_path=args.root_path)
    return 0


def _print_export_report(structure, fmt: str) -> None:
    """The export check of *fmt* on stderr: ``crystallume: warning: ...`` and ``crystallume: note: ...`` lines."""
    from .io import export_report

    report = export_report(structure, fmt)
    for msg in report["warnings"]:
        print(f"crystallume: warning: {msg}", file=sys.stderr)
    for msg in report["notes"]:
        print(f"crystallume: note: {msg}", file=sys.stderr)


def _export(structure, output: str, fmt: str | None) -> str:
    """Write *structure* to the file *output* (format: *fmt*, else from the name) and return the format written.

    ``write()``'s :class:`~crystallume.io.ExportWarning` are silenced: the caller prints the export check itself.
    """
    import warnings

    from .io import ExportWarning, _writer_for_name, write

    fmt = fmt or _writer_for_name(output)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", ExportWarning)
        write(output, structure, format=fmt)  # no format: write() explains that it cannot infer one
    return fmt or ""


def _write_or_print(structure, output: str | None, fmt: str | None) -> None:
    from .io import to_text

    if output:
        fmt = _export(structure, output, fmt)
        print(f"wrote {len(structure)} atoms ({structure.formula}) to {output}", file=sys.stderr)
    else:
        fmt = fmt or "extxyz"
        sys.stdout.write(to_text(structure, fmt))
    _print_export_report(structure, fmt)


def cmd_convert(args: argparse.Namespace) -> int:
    from .io import read

    index = args.index
    if index is not None and ":" not in index:
        index = int(index)
    s = read(args.input, format=args.from_, index=index)
    fmt = _export(s, args.output, args.to)
    print(f"converted {args.input} -> {args.output} ({len(s)} atoms, {s.n_frames} frame(s))", file=sys.stderr)
    _print_export_report(s, fmt)
    return 0


def cmd_build(args: argparse.Namespace) -> int:
    import warnings

    from . import build

    if args.kind == "crystal":
        kw = {}
        if args.u is not None:
            kw["u"] = args.u
        if args.vacuum is not None:
            kw["vacuum"] = args.vacuum
        with warnings.catch_warnings():
            # --vacuum is explained by the note below rather than by build.crystal's DeprecationWarning
            warnings.filterwarnings("ignore", message=r"build\.crystal\(vacuum=\)", category=DeprecationWarning)
            s = build.crystal(args.prototype, args.elements or None, a=args.a, c=args.c, **kw)
        if args.vacuum is not None:
            print("crystallume: note: --vacuum adds vacuum on each side; "
                  "use 'crystallume edit vacuum IN --vacuum V' for the total gap", file=sys.stderr)
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
    elif args.kind == "custom":
        builders = args.plugin_manager.builders
        if not args.name:
            if not builders:
                print("no plugin builders (load plugins with --plugins DIR)", file=sys.stderr)
            for b in builders.values():
                params = " ".join(f"{p.get('name')}={p.get('default')}" for p in b.meta.get("params", []))
                print(f"{b.name:<20s} {b.meta.get('label', b.name)} [plugin {b.plugin}]  {params}")
            return 0
        spec = builders.get(args.name)
        if spec is None:
            return _err(f"unknown builder {args.name!r}; available: {', '.join(builders) or 'none (load plugins with --plugins DIR)'}")
        from .core.structure import Structure

        try:
            result = spec.func(**parse_params(args.param, spec.meta.get("params", [])))
        except TypeError as exc:
            return _err(f"builder {args.name!r}: {exc}")
        s = result if isinstance(result, Structure) else Structure.from_dict(result)
    else:
        s = build.molecule(args.name)
    _write_or_print(s, args.output, args.format)
    return 0


def cmd_analyze(args: argparse.Namespace) -> int:
    from .core.structure import jsonable
    from .io import read

    s = read(args.file, format=args.format, index=-1)
    analyses = args.plugin_manager.analyses
    builtin = {"summary", "coordination", "rdf"}
    if args.name in builtin:
        from . import analysis

        params = parse_params(args.param)
        if args.name == "summary":
            result: Any = analysis.summary(s)
        elif args.name == "coordination":
            cn = analysis.coordination_numbers(s, **params)
            by: dict[str, list[int]] = {}
            for sym, c in zip(s.symbols, cn.tolist()):
                by.setdefault(sym, []).append(c)
            result = {"average": float(cn.mean()) if len(cn) else 0.0,
                      "byElement": {k: sum(v) / len(v) for k, v in by.items()}, "coordination": cn.tolist()}
        else:
            r, g = analysis.rdf(s, **params)
            result = {"r": [round(float(x), 6) for x in r], "g": [round(float(x), 6) for x in g]}
    else:
        spec = analyses.get(args.name)
        if spec is None:
            names = sorted(builtin | set(analyses))
            return _err(f"unknown analysis {args.name!r}; available: {', '.join(names)}")
        try:
            result = spec.func(s, **parse_params(args.param, spec.meta.get("params", [])))
        except TypeError as exc:
            return _err(f"analysis {args.name!r}: {exc}")
    print(json.dumps(jsonable(result), indent=2, ensure_ascii=False))
    return 0


def _fmt_num(v: float | None, unit: str = "", digits: int = 4) -> str:
    return "—" if v is None else f"{v:.{digits}f}{unit}"


def cmd_info(args: argparse.Namespace) -> int:
    from .analysis import coordination_numbers, find_vacuum_gap, summary
    from .io import read

    s = read(args.file, format=args.format)
    info = summary(s)
    gap = find_vacuum_gap(s)  # any structure alike (design decision U1): a report, nothing changes
    info["vacuumGap"] = gap
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
    if gap is not None:
        print(f"Vacuum gap  : {gap['width']:.2f} Å along {'abc'[gap['axis']]}")
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


def cmd_plugins_new(args: argparse.Namespace) -> int:
    from .plugins import PluginManager, plugin_template

    if not args.name:
        return _err("plugins new needs a NAME, e.g. crystallume plugins new my-plugin --dir ./plugins")
    parent = Path(args.dir or ".").expanduser()
    root = parent / args.name
    files = plugin_template(args.name, parent=str(parent))
    existing = [f for f in files if (root / f).exists()]
    if existing and not args.force:
        return _err(f"{root} already has {', '.join(existing)}; pass --force to overwrite")
    for rel, text in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    logging.getLogger("crystallume.plugins").setLevel(logging.CRITICAL)
    rec = PluginManager([], use_entry_points=False).load_file(root / "plugin.py", root=root, default_name=args.name)
    if rec.status != "loaded":
        return _err(f"created {root}, but it does not load: {rec.error}")
    print(f"created plugin {rec.name!r} in {root}")
    for rel in files:
        print(f"  {root / rel}")
    print(f"try it:  crystallume serve --plugins {parent}")
    print(f"         crystallume analyze {next(iter(rec.analyses), 'NAME')} STRUCTURE_FILE --plugins {parent}")
    return 0


def cmd_plugins(args: argparse.Namespace) -> int:
    from .config import Settings
    from .plugins import PluginManager

    if args.action == "new":
        return cmd_plugins_new(args)
    settings = Settings.from_env(plugin_dirs=[Path(p) for p in args.plugins] if args.plugins else None)
    logging.getLogger("crystallume.plugins").setLevel(logging.CRITICAL)
    mgr = PluginManager(settings.plugin_dirs, use_entry_points=True).load_all()
    data = mgr.to_json()
    if args.json:
        print(json.dumps(data, indent=2))
        return 0
    if not data:
        dirs = ", ".join(str(d) for d in settings.plugin_dirs) or "none"
        print(f"no plugins found (plugin dirs: {dirs}; entry-point group 'crystallume.plugins')")
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
    src = lambda x: "" if x.get("source", "builtin") == "builtin" else f"  [plugin {x['source']}]"  # noqa: E731
    print("Readers:")
    for r in f["readers"]:
        names = " ".join(r["extensions"] + [n.upper() for n in r["filenames"]])
        print(f"  {r['name']:<8s} {names:<28s} {r['description']}{src(r)}")
    print("Writers:")
    for w in f["writers"]:
        print(f"  {w['name']:<8s} {' '.join(w['extensions']):<28s} {w['description']}{src(w)}")
    return 0


# -------------------------------------------------------------------- parser
def build_parser() -> argparse.ArgumentParser:
    """Create the argument parser (exposed for documentation and tests)."""
    p = argparse.ArgumentParser(prog="crystallume", description="Crystallume — visualise atoms, clusters and crystals.")
    p.add_argument("--version", action="version", version=f"crystallume {__version__}")
    p.add_argument("-v", "--verbose", action="store_true", help="verbose logging")
    sub = p.add_subparsers(dest="command", metavar="COMMAND")

    s = sub.add_parser("serve", help="run the web app / REST API server")
    s.add_argument("--host", help="bind address (default 127.0.0.1; 0.0.0.0 for LAN/cloud)")
    s.add_argument("--port", type=int, help="port (default 8765)")
    s.add_argument("--mode", choices=["local", "cloud"], help="local: single user, files on disk; cloud: accounts + SQLite")
    s.add_argument("--data", metavar="DIR", help="data directory (default ~/.crystallume, or an existing ~/.atomscope)")
    s.add_argument("--plugins", metavar="DIR", nargs="+", action="extend", help="plugin directories")
    s.add_argument("--no-registration", action="store_true", help="cloud mode: disable self-registration")
    s.add_argument("--open", action="store_true", help="open the browser")
    s.add_argument("--cors", metavar="ORIGIN", nargs="+", action="extend", help="allowed CORS origins ('*' for any)")
    s.add_argument("--web-dir", metavar="DIR", help="serve the frontend from this directory instead")
    s.add_argument("--log-level", choices=["critical", "error", "warning", "info", "debug"], help="log level")
    s.add_argument("--root-path", metavar="/PREFIX",
                   help="URL prefix when a reverse proxy serves the app under a sub-path, e.g. /crystallume "
                        "(CRYSTALLUME_ROOT_PATH)")
    s.add_argument("--forwarded-allow-ips", metavar="IP[,IP...]",
                   help="addresses or networks (CIDR) of the reverse proxy whose X-Forwarded-For/-Proto headers are "
                        "trusted, so rate limits see the real client (CRYSTALLUME_FORWARDED_ALLOW_IPS; avoid '*': "
                        "clients could then forge their address)")
    s.set_defaults(func=cmd_serve)

    def with_plugins(sp: argparse.ArgumentParser) -> None:
        # one DIR per flag, so the option may come before the positional arguments
        sp.add_argument("--plugins", metavar="DIR", action="append",
                        help=f"plugin directory; repeat the flag or join directories with {os.pathsep!r} "
                             "(default: CRYSTALLUME_PLUGIN_DIRS)")
        sp.set_defaults(needs_plugins=True)

    c = sub.add_parser("convert", help="convert between file formats")
    c.add_argument("input")
    c.add_argument("output")
    c.add_argument("--from", dest="from_", metavar="FMT", help="input format (auto-detected)")
    c.add_argument("--to", metavar="FMT", help="output format (from extension)")
    c.add_argument("--index", help="frame selection: -1, 0:10:2 ... (default: all frames)")
    with_plugins(c)
    c.set_defaults(func=cmd_convert)

    b = sub.add_parser("build", help="build crystals, clusters and molecules")
    bsub = b.add_subparsers(dest="kind", metavar="KIND", required=True)
    bc = bsub.add_parser("crystal", help="crystal from a prototype")
    bc.add_argument("prototype", help="sc bcc fcc hcp diamond zincblende wurtzite rocksalt cscl fluorite perovskite "
                                      "rutile graphene hbn mos2 graphite")
    bc.add_argument("elements", nargs="*", help="element symbols in role order (default per prototype)")
    bc.add_argument("--a", type=float, help="lattice constant a (Å)")
    bc.add_argument("--c", type=float, help="lattice constant c (Å; 2D prototypes: the cell height)")
    bc.add_argument("--u", type=float, help="internal parameter (wurtzite, rutile)")
    bc.add_argument("--vacuum", type=float, help="vacuum on each side (Å); the gap between periodic images is twice this")
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
    bu = bsub.add_parser("custom", help="structure from a plugin builder (omit NAME to list them)")
    bu.add_argument("name", nargs="?", help="builder name, e.g. hello-chain")
    bu.add_argument("-p", "--param", metavar="KEY=VALUE", action="append", default=[],
                    help="builder parameter (repeatable), e.g. --param n=12")
    for sp in (bc, bk, bm, bu):
        sp.add_argument("-o", "--output", help="output file (default: extended XYZ on stdout)")
        sp.add_argument("--format", help="output format (default: from extension)")
        with_plugins(sp)
    b.set_defaults(func=cmd_build)

    a = sub.add_parser("analyze", help="run an analysis (summary, coordination, rdf or a plugin analysis)")
    a.add_argument("name", help="analysis name, e.g. rdf or hello-com")
    a.add_argument("file", help="structure file (the last frame is analysed)")
    a.add_argument("-p", "--param", metavar="KEY=VALUE", action="append", default=[],
                   help="analysis parameter (repeatable), e.g. --param rmax=6")
    a.add_argument("--format", help="input format (auto-detected)")
    with_plugins(a)
    a.set_defaults(func=cmd_analyze)

    i = sub.add_parser("info", help="summarise a structure file")
    i.add_argument("file")
    i.add_argument("--format", help="input format (auto-detected)")
    i.add_argument("--bonds", action="store_true", help="also count bonds")
    i.add_argument("--json", action="store_true", help="JSON output")
    with_plugins(i)
    i.set_defaults(func=cmd_info)

    u = sub.add_parser("user", help="manage cloud-mode accounts")
    usub = u.add_subparsers(dest="action", metavar="ACTION", required=True)
    for name, helptext in (("create", "create a user"), ("passwd", "set a user's password")):
        x = usub.add_parser(name, help=helptext)
        x.add_argument("name")
        x.add_argument("--password", help="password (prompted when omitted)")
        x.add_argument("--data", metavar="DIR", help="data directory (default ~/.crystallume, or an existing ~/.atomscope)")
    ul = usub.add_parser("list", help="list users")
    ul.add_argument("--data", metavar="DIR")
    ud = usub.add_parser("delete", help="delete a user and their projects")
    ud.add_argument("name")
    ud.add_argument("--keep-projects", action="store_true", help="keep the user's projects in the database")
    ud.add_argument("--data", metavar="DIR")
    u.set_defaults(func=cmd_user)

    pl = sub.add_parser("plugins", help="list discovered plugins, or scaffold one with 'plugins new NAME'")
    pl.add_argument("action", nargs="?", choices=["list", "new"], default="list", help="list (default) or new")
    pl.add_argument("name", nargs="?", help="plugins new: the plugin name, e.g. my-plugin")
    pl.add_argument("--dir", metavar="DIR", help="plugins new: parent directory (default: current directory)")
    pl.add_argument("--force", action="store_true", help="plugins new: overwrite existing files")
    pl.add_argument("--plugins", metavar="DIR", nargs="+", action="extend", help="plugin directories")
    pl.add_argument("--json", action="store_true")
    pl.set_defaults(func=cmd_plugins)

    f = sub.add_parser("formats", help="list supported file formats")
    with_plugins(f)
    f.set_defaults(func=cmd_formats)
    return p


def main(argv: Sequence[str] | None = None) -> int:
    """Entry point of the ``crystallume`` console script."""
    parser = build_parser()
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    if not getattr(args, "func", None):
        parser.print_help()
        return 0
    try:
        if getattr(args, "needs_plugins", False):
            args.plugin_manager = load_cli_plugins(args.plugins, verbose=args.verbose)
        return int(args.func(args) or 0)
    except KeyboardInterrupt:
        return 130
    except (OSError, ValueError) as exc:
        return _err(str(exc))


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
