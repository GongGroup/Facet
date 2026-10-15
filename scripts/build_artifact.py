#!/usr/bin/env python3
"""Package the web frontend as a self-contained static bundle.

    python scripts/build_artifact.py [--out dist/artifact] [--fragment]

Copies atomscope/web (HTML, CSS, JS, vendored three.js) into OUT. With --fragment the
entry page is written without <!doctype>/<html>/<head>/<body> wrappers, for hosts that
inject their own document skeleton (e.g. claude.ai artifacts). The bundle has no build
step and no server dependency: open it from any static host (GitHub Pages, S3, nginx).
"""
from __future__ import annotations

import argparse
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "atomscope" / "web"


def fragment(html: str) -> str:
    head = re.search(r"<head>(.*?)</head>", html, re.S).group(1)
    body = re.search(r"<body>(.*?)</body>", html, re.S).group(1)
    keep = [line for line in head.splitlines() if re.search(r"<title>|<link |<meta name=\"description\"", line) and "rel=\"icon\"" not in line]
    return "\n".join(keep) + "\n" + body.strip() + "\n"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", default=str(ROOT / "dist" / "artifact"))
    ap.add_argument("--fragment", action="store_true", help="write the page without document wrappers")
    args = ap.parse_args()
    out = Path(args.out)
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(WEB, out, ignore=shutil.ignore_patterns("__pycache__", "*.map", "LICENSE"))
    html = (WEB / "index.html").read_text(encoding="utf-8")
    (out / "index.html").write_text(fragment(html) if args.fragment else html, encoding="utf-8")
    files = sorted(p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_file())
    size = sum((out / f).stat().st_size for f in files)
    print(f"{len(files)} files, {size / 1024:.0f} KiB -> {out}")


if __name__ == "__main__":
    main()
