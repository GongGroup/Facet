"""Rename Crystallume to Facet in every tracked text file of a checkout (run from its root, then `git mv crystallume facet`).

Kept as they are: the repository's address and checkout paths, and the fixture written by Crystallume 0.3.1.
The places that must still understand the old name (settings, data folders, file schemas, messages) are edited by hand afterwards.
"""
import re
import subprocess
import sys

KEEP = re.compile(r"[Mm]astreina/crystallume|/home/user/crystallume|-home-user-crystallume|crystallume031")
SKIP_FILES = {"tests/data/surface/crystallume031_sd.extxyz"}
NAMES = (("CRYSTALLUME", "FACET"), ("Crystallume", "Facet"), ("crystallume", "facet"))


def rename(text: str) -> str:
    kept: list[str] = []

    def hold(m: re.Match) -> str:
        kept.append(m.group(0))
        return f"\x00{len(kept) - 1}\x00"

    text = KEEP.sub(hold, text)
    for old, new in NAMES:
        text = text.replace(old, new)
    return re.sub(r"\x00(\d+)\x00", lambda m: kept[int(m.group(1))], text)


def main() -> int:
    files = subprocess.run(["git", "ls-files", "-z"], check=True, capture_output=True).stdout.decode().split("\0")
    changed = 0
    for path in filter(None, files):
        if path in SKIP_FILES:
            continue
        try:
            with open(path, encoding="utf-8", newline="") as fh:
                text = fh.read()
        except (UnicodeDecodeError, IsADirectoryError, FileNotFoundError):
            continue
        new = rename(text)
        if new != text:
            with open(path, "w", encoding="utf-8", newline="") as fh:
                fh.write(new)
            changed += 1
    print(f"{changed} files changed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
