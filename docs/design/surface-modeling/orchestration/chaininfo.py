"""Print a chain's definition (or one task's brief) from dag.json for developer agents.

Usage: python3 -I chaininfo.py <chain-id> [<task-id>]
"""
import json
import pathlib
import sys

DAG = pathlib.Path(__file__).with_name("dag.json")
EXTRA = pathlib.Path(__file__).with_name("chain-notes.json")


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    chains = {c["id"]: c for c in json.loads(DAG.read_text(encoding="utf-8"))["chains"]}
    extra = json.loads(EXTRA.read_text(encoding="utf-8")) if EXTRA.exists() else {}
    c = chains.get(argv[1])
    if c is None:
        print(f"unknown chain {argv[1]!r}")
        return 1
    print(f"CHAIN {c['id']} ({c['wave']}, size {c['size']}{', critical' if c.get('critical') else ''}): {c['title']}")
    print(f"Depends on (already merged): {', '.join(c['after']) or 'nothing'}")
    print("Files this chain owns:")
    for f in c["files"]:
        print(f"  - {f}")
    if c.get("mergeNotes"):
        print(f"Merge notes: {c['mergeNotes']}")
    if extra.get(c["id"]):
        print(f"Extra instructions from the lead: {extra[c['id']]}")
    tasks = c["tasks"] if len(argv) < 3 else [t for t in c["tasks"] if t["id"] == argv[2]]
    for t in tasks:
        print(f"\nTASK {t['id']}: {t['title']}\n{t['brief']}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
