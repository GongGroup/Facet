#!/usr/bin/env python3
"""Package the web frontend as a self-contained static bundle.

    python scripts/build_artifact.py [--out dist/artifact] [--fragment] [--plugin DIR ...]

Copies facet/web (HTML, CSS, JS, vendored three.js) into OUT. With --fragment the
entry page is written without <!doctype>/<html>/<head>/<body> wrappers, for hosts that
inject their own document skeleton (e.g. claude.ai artifacts). The bundle has no build
step and no server dependency: open it from any static host (GitHub Pages, S3, nginx).

--plugin DIR (repeatable) adds a plugin's frontend: its static folder is copied to
OUT/plugins/<name>/ and listed in OUT/plugins.json, which the app reads at start-up.
Only the JavaScript part runs in a static bundle; Python readers, builders and analyses
need the server (facet serve --plugins ...).
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "facet" / "web"


def plugin_frontend(directory: Path) -> tuple[str, Path, list[str]]:
    """(name, static dir, module paths relative to it) of the plugin in *directory*.

    The plugin is loaded with Facet's plugin manager when possible (exact name and
    declared frontend modules); otherwise its folder name and static/*.js are used.
    """
    directory = directory.resolve()
    entry = directory / "plugin.py" if (directory / "plugin.py").is_file() else directory
    try:
        sys.path.insert(0, str(ROOT))
        import logging

        from facet.plugins import PluginManager

        logging.getLogger("facet.plugins").setLevel(logging.CRITICAL)
        rec = PluginManager([], use_entry_points=False).load_file(entry, root=directory, default_name=directory.name)
        if rec.status == "loaded" and rec.static_dir is not None:
            prefix = f"plugins/{rec.slug}/"
            mods = [u[len(prefix):] if u.startswith(prefix) else u.rsplit("/", 1)[-1] for u in rec.frontend]
            return rec.name, rec.static_dir, mods
        if rec.status == "error":
            print(f"warning: {directory.name}: plugin did not load ({rec.error}); copying static/*.js", file=sys.stderr)
    except Exception as exc:  # pragma: no cover - facet not importable here
        print(f"warning: {directory.name}: {exc}; copying static/*.js", file=sys.stderr)
    static = directory / "static"
    if not static.is_dir():
        raise SystemExit(f"error: {directory} has no static/ folder with a frontend module")
    return directory.name, static, sorted(p.name for p in static.glob("*.js"))


def fragment(html: str) -> str:
    head = re.search(r"<head>(.*?)</head>", html, re.S).group(1)
    body = re.search(r"<body>(.*?)</body>", html, re.S).group(1)
    keep = [line for line in head.splitlines() if re.search(r"<title>|<link |<meta name=\"description\"", line) and "rel=\"icon\"" not in line]
    return "\n".join(keep) + "\n" + body.strip() + "\n"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=str(ROOT / "dist" / "artifact"))
    ap.add_argument("--fragment", action="store_true", help="write the page without document wrappers")
    ap.add_argument("--plugin", metavar="DIR", action="append", default=[],
                    help="include this plugin's frontend (its static/ folder) and list it in plugins.json")
    args = ap.parse_args()
    out = Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(WEB, out, ignore=shutil.ignore_patterns("__pycache__", "*.map", "LICENSE"))
    html = (WEB / "index.html").read_text(encoding="utf-8")
    (out / "index.html").write_text(fragment(html) if args.fragment else html, encoding="utf-8")
    manifest = []
    for d in args.plugin:
        name, static, modules = plugin_frontend(Path(d))
        slug = re.sub(r"[^A-Za-z0-9_.-]+", "-", name.strip()).strip("-.").lower() or "plugin"
        dest = out / "plugins" / slug
        shutil.copytree(static, dest, dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__", "*.map"))
        manifest += [{"name": name, "url": f"plugins/{slug}/{m}"} for m in modules]
        print(f"plugin {name}: {', '.join(modules) or 'no frontend modules'} -> {dest.relative_to(out)}/")
    if args.plugin:
        (out / "plugins.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    files = sorted(p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_file())
    size = sum((out / f).stat().st_size for f in files)
    print(f"{len(files)} files, {size / 1024:.0f} KiB -> {out}")


if __name__ == "__main__":
    main()
