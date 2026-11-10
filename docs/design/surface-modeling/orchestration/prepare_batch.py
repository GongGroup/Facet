"""Create worktrees for the given chains at the main branch HEAD and print dev-workflow args, two chains per workflow.

Usage: python3 -I prepare_batch.py <label> <chain-id> [<chain-id> ...]
Prints one JSON object per line: the args for one surface-dev-chains workflow.
"""
import json
import pathlib
import subprocess
import sys

HERE = pathlib.Path(__file__).resolve().parent
SCRATCH = HERE.parent
WT = SCRATCH / "wt"
REPO = pathlib.Path("/home/user/crystallume")


def git(*args, cwd=REPO):
    return subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True).stdout.strip()


def main(argv):
    label, ids = argv[1], argv[2:]
    chains = {c["id"]: c for c in json.loads((HERE / "dag.json").read_text(encoding="utf-8"))["chains"]}
    merged = [l.strip() for l in (HERE / "merged.txt").read_text().splitlines() if l.strip()]
    base = git("rev-parse", "HEAD")
    out = []
    for cid in ids:
        c = chains[cid]
        wt = WT / cid
        if not wt.exists():
            git("worktree", "add", "-q", str(wt), "-b", f"sm/{cid}", base)
        out.append({
            "id": cid, "worktree": str(wt), "branch": f"sm/{cid}", "port": c.get("port") or 0,
            "files": ", ".join(c["files"])[:1500],
            "tasks": [{"id": t["id"], "title": t["title"], "brief": f"Read the full brief first: python3 -I {HERE}/chaininfo.py {cid} {t['id']}"} for t in c["tasks"]],
        })
    groups = [out[i:i + 2] for i in range(0, len(out), 2)]
    everyone = {g[0]["id"]: g for g in groups}
    for g in groups:
        others = [c for c in out if c not in g]
        ext = "; ".join(f"{c['id']} (files: {c['files'][:400]})" for c in others)
        print(json.dumps({
            "subwave": label, "base": base,
            "merged": "W0.1 (test bridge, vacuum module, constraints core, undo storage v2, panel shell, overlays)" + (", " + ", ".join(merged) if merged else ""),
            "extraLedgers": [str(HERE / "lead-decisions.md"), str(HERE / "ledger-features.md"), str(HERE / "specs" / "M7.md")],
            "external": ext, "chains": g,
        }, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv)
