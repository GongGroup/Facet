#!/usr/bin/env python3
"""Pick the next chains to start from the surface-modeling work DAG (dag.json next to this script).

Usage:
  python3 -I scheduler.py --merged MERGED --running RUNNING [--slots N] [--json]
  python3 -I scheduler.py --check
  python3 -I scheduler.py --critical-path [--merged MERGED]
  python3 -I scheduler.py --simulate N [--merged MERGED]

MERGED and RUNNING are text files with one chain id per line (blank lines and lines starting with '#' are ignored;
a missing file counts as empty). A chain counts as running from the moment an agent starts it until it is merged
into the integration branch, so list chains that are developed, under review or waiting to be merged as running.

Ready = not merged, not running, every "after" chain merged, and no file conflict with a running chain. The ready
chains are printed best first (critical chains first, then by the length of the longest path of work that depends
on them, then by size), keeping only chains that do not conflict with a chain printed above them. --slots N is the
total number of developer agents: at most N minus the number of running chains are printed.

File conflicts (dag.json "files"): "path" is the whole file, "path/" a whole directory, "path#segment" one marked
segment or named line range of the file. Two entries conflict when they name the same path and at least one has no
segment or both name the same segment, when a directory contains the other path, or when a glob matches it.

--check validates dag.json (format, unique ids, every "after" id exists, acyclic, every task of plan.json and of the
remaining wave-0 work (plan-w0.md W0.2-W0.6) exactly once, marker segments only after the chain that creates them,
unique UI ports) and prints statistics. --critical-path prints the longest chain of remaining work in size units
(S=1, M=2, L=3) and compares it with the sequential sub-wave plan. --simulate N replays the greedy rule with N
agents (chain size = duration) and prints the resulting timeline.
"""
from __future__ import annotations

import argparse
import fnmatch
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
UNITS = {"S": 1, "M": 2, "L": 3}
CHAIN_KEYS = {"id", "wave", "title", "after", "files", "port", "critical", "size", "tasks", "mergeNotes"}
TASK_KEYS = {"id", "title", "brief"}
WAVES = {"W0", "W1", "W2", "W3", "W4", "W5"}

# Remaining wave-0 work: plan-w0.md W0.2-W0.6 (F0-D and F0-A task tables, spec section 9).
W0_REMAINING_TASKS = [
    "F0-D-T1", "F0-D-T2", "F0-A-T7a", "F0-A-T5", "F0-A-T4b", "F0-D-T10",      # W0.2
    "F0-D-T4", "F0-D-T5", "F0-A-T2", "F0-A-T8", "F0-A-T7b",                    # W0.3
    "F0-D-T6", "F0-A-T3a", "F0-A-T9", "F0-D-T9",                               # W0.4
    "F0-D-T8", "F0-A-T3b", "F0-A-T6",                                          # W0.5
    "F0-D-T11", "F0-A-T11", "F0-A-T12",                                        # W0.6
]

# Marker segments (plan.md section 2.2 segment table) and named ranges that a chain creates: (path, segment) -> task
# whose chain must be merged before any chain that edits the segment starts.
_SEG_TABLE = [
    (["facet/core/defaults.py", "facet/web/js/core/defaults.js"],
     ["M1", "M2", "M3", "M4", "M5-adsorbates", "M5-sites", "M6"], "W1-S0"),
    (["facet/core/structure.py", "facet/web/js/core/structure.js"],
     ["M1-T3a", "M1-T3b", "M1-T4", "M2", "M3", "M4-geometry", "M4-placement"], "W1-S0"),
    (["facet/core/naming.py", "facet/web/js/core/naming.js"], ["M1", "M2", "M6"], "W1-S0"),
    (["facet/core/lattice.py", "facet/web/js/core/lattice.js"], ["M1", "M2"], "W1-S0"),
    (["facet/build/__init__.py"], ["M1", "M2", "M5-T1", "M5-T5", "M5-T6", "M5-T7", "M6"], "W1-S0"),
    (["facet/analysis/__init__.py"], ["M1", "M3", "M4", "M5-sites", "M5-topbottom", "M6"], "W1-S0"),
    (["facet/web/js/main.js"],
     ["M1-sections", "M1-commands", "M2-cleave", "M2-slab", "M3-commands", "M3-layers", "M3-constraints",
      "M3-atomselection", "M4-move", "M4-commands", "M4-transform", "M4-clipboard", "M4-place", "M5-adsorbates",
      "M5-sitepick", "M6-interface", "segments"], "W1-S0"),
    (["facet/web/css/app.css"],
     ["M1", "M2-cleave", "M2-slab", "M3-markers", "M3-layers", "M3-constraints", "M3-atomselection", "M4-move",
      "M4-transform", "M4-place", "M4-card", "M5-markers", "M5-panel", "M6", "segments"], "W1-S0"),
    (["facet/web/js/ui/icons.js"], ["M3", "M4", "M5"], "W1-S0"),
    (["facet/web/js/app.js"], ["M2", "M3", "M4", "segments"], "W1-S0"),
    (["facet/core/intmath.py", "facet/web/js/core/intmath.js"], ["M2"], "M1-T1"),
    (["facet/core/cellops.py", "facet/web/js/core/cellops.js"], ["M1-T3a", "M1-T3b", "M1-T10"], "M1-T1"),
    (["facet/build/surface.py"], ["M2-T2", "M2-T3", "M2-T3b", "M2-T4", "M2-T5"], "M2-T2"),
    (["facet/web/js/build/surface.js"], ["M2-T2", "M2-T6a", "M2-T3b", "M2-T6b", "M2-T5"], "M2-T2"),
    (["facet/core/infohandlers.py", "facet/web/js/core/infohandlers.js"], ["M1", "M5"], "M1-T10"),
    (["facet/web/js/ui/panels/transform.js"], ["M4-T7a", "M4-T7b"], "M4-T6a"),
    (["facet/analysis/sites.py", "facet/web/js/core/sites.js"], ["M5-T3", "M5-T4", "M5-T11"], "M5-T3"),
    (["facet/build/adsorbate.py", "facet/web/js/build/adsorbates.js"],
     ["M5-T1", "M5-T5", "M5-T6", "M5-T7"], "M5-T1"),
    (["facet/web/js/ui/panels/surface-interface.js"], ["M6-T7b", "M6-T7c"], "M6-T7a"),
    (["facet/web/js/app.js"], ["beginStructureEdit"], "F0-A-T3a"),
    (["facet/web/js/main.js"], ["edit.applyPreview"], "F0-A-T3a"),
]
MARKERS = {(p, s): t for paths, segs, t in _SEG_TABLE for p in paths for s in segs}


# --------------------------------------------------------------------------------------------------- helpers
def read_ids(path):
    if not path or not os.path.exists(path):
        return []
    out = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            s = line.split("#", 1)[0].strip()
            if s:
                out.append(s)
    return out


def split(entry):
    if "#" in entry:
        p, s = entry.split("#", 1)
        return p.strip(), s.strip()
    return entry.strip(), None


def paths_overlap(p, q):
    if p == q:
        return True
    if p.endswith("/") and q.startswith(p):
        return True
    if q.endswith("/") and p.startswith(q):
        return True
    if "*" in p and fnmatch.fnmatch(q, p):
        return True
    if "*" in q and fnmatch.fnmatch(p, q):
        return True
    return False


def entries_conflict(a, b):
    pa, sa = split(a)
    pb, sb = split(b)
    if pa == pb:
        return sa is None or sb is None or sa == sb
    return paths_overlap(pa, pb)


def chains_conflict(ca, cb):
    for a in ca["files"]:
        for b in cb["files"]:
            if entries_conflict(a, b):
                return (a, b)
    return None


def load(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def topo_order(chains):
    by_id = {c["id"]: c for c in chains}
    indeg = {c["id"]: 0 for c in chains}
    succ = {c["id"]: [] for c in chains}
    for c in chains:
        for a in c["after"]:
            if a in by_id:
                indeg[c["id"]] += 1
                succ[a].append(c["id"])
    queue = sorted(x for x, d in indeg.items() if d == 0)
    order = []
    while queue:
        x = queue.pop(0)
        order.append(x)
        for s in succ[x]:
            indeg[s] -= 1
            if indeg[s] == 0:
                queue.append(s)
    cyclic = sorted(set(indeg) - set(order))
    return order, cyclic, succ


def schedule_numbers(chains, done=frozenset()):
    """Earliest finish, latest finish and downstream length for the chains not in `done` (done chains weigh 0)."""
    by_id = {c["id"]: c for c in chains}
    order, cyclic, succ = topo_order(chains)
    if cyclic:
        raise SystemExit("dag has a cycle: " + ", ".join(cyclic))
    w = {x: (0 if x in done else UNITS[by_id[x]["size"]]) for x in by_id}
    eft = {}
    for x in order:
        eft[x] = max([eft[a] for a in by_id[x]["after"] if a in by_id], default=0) + w[x]
    length = max(eft.values(), default=0)
    down = {}
    for x in reversed(order):
        down[x] = max([w[s] + down[s] for s in succ[x]], default=0)
    lft = {}
    for x in reversed(order):
        lft[x] = min([lft[s] - w[s] for s in succ[x]], default=length)
    return order, eft, lft, down, length, w


def ancestors(chains):
    by_id = {c["id"]: c for c in chains}
    memo = {}
    order, _, _ = topo_order(chains)
    for x in order:
        s = set()
        for a in by_id[x]["after"]:
            if a in by_id:
                s.add(a)
                s |= memo.get(a, set())
        memo[x] = s
    return memo


def ready_chains(chains, merged, running, slots=None):
    by_id = {c["id"]: c for c in chains}
    _, _, _, down, _, _ = schedule_numbers(chains, frozenset(merged))
    run = [by_id[r] for r in running if r in by_id]
    cand = [c for c in chains if c["id"] not in merged and c["id"] not in running
            and all(a in merged for a in c["after"])]
    blocked = []
    free = []
    for c in cand:
        hit = next(((r["id"], x) for r in run for x in [chains_conflict(c, r)] if x), None)
        (blocked if hit else free).append((c, hit))
    free.sort(key=lambda cx: (not cx[0]["critical"], -down[cx[0]["id"]], -UNITS[cx[0]["size"]], cx[0]["id"]))
    limit = None if slots is None else max(0, slots - len(run))
    picked, deferred = [], []
    for c, _ in free:
        if limit is not None and len(picked) >= limit:
            deferred.append((c, "no free slot"))
            continue
        hit = next(((p["id"], x) for p in picked for x in [chains_conflict(c, p)] if x), None)
        if hit:
            deferred.append((c, f"conflicts with {hit[0]} on {hit[1][0]}"))
        else:
            picked.append(c)
    return picked, deferred, [(c, f"conflicts with running {h[0]} on {h[1][0]}") for c, h in blocked], down


# --------------------------------------------------------------------------------------------------- commands
def cmd_ready(dag, args):
    chains = dag["chains"]
    ids = {c["id"] for c in chains}
    merged = set(read_ids(args.merged))
    running = set(read_ids(args.running))
    for x in sorted((merged | running) - ids):
        print(f"warning: unknown chain id {x!r} ignored", file=sys.stderr)
    merged &= ids
    running &= ids
    both = merged & running
    if both:
        print("warning: listed as merged and running (treated as merged): " + ", ".join(sorted(both)), file=sys.stderr)
        running -= both
    for r in sorted(running):
        miss = [a for a in next(c for c in chains if c["id"] == r)["after"] if a not in merged]
        if miss:
            print(f"warning: running chain {r} has unmerged prerequisites: {', '.join(miss)}", file=sys.stderr)
    picked, deferred, blocked, down = ready_chains(chains, merged, running, args.slots)
    if args.json:
        print(json.dumps([{"id": c["id"], "wave": c["wave"], "size": c["size"], "critical": c["critical"],
                           "down": down[c["id"]], "port": c["port"], "title": c["title"]} for c in picked],
                         ensure_ascii=False, indent=1))
    else:
        for i, c in enumerate(picked, 1):
            crit = "critical" if c["critical"] else "-"
            port = c["port"] or "-"
            print(f"{i:2d}. {c['id']:<24} {c['wave']}  {c['size']}  {crit:<8}  down={down[c['id']]:<3} "
                  f"port={port:<5} {c['title'][:90]}")
    left = len([c for c in chains if c["id"] not in merged])
    print(f"# {len(merged)} merged, {len(running)} running, {left - len(running)} to start; "
          f"{len(picked)} ready to start now"
          + (f" (slots {args.slots})" if args.slots is not None else ""), file=sys.stderr)
    for c, why in deferred + blocked:
        print(f"#   also ready, not listed: {c['id']} ({why})", file=sys.stderr)
    return 0


def parse_w0_plan(path):
    """Chain ids of the batches W0.2-W0.6 in plan-w0.md, per batch."""
    out = {}
    if not os.path.exists(path):
        return out
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            m = re.match(r"\|\s*(W0\.\d)\s*\|([^|]*)\|", line)
            if m and m.group(1) != "W0.1":
                out[m.group(1)] = re.findall(r"`(w0-[a-z0-9-]+)`", m.group(2))
    return out


def cmd_check(dag, args):
    errors, info = [], []
    if not isinstance(dag, dict) or set(dag) != {"chains"}:
        errors.append(f"top-level keys must be exactly ['chains'], got {sorted(dag) if isinstance(dag, dict) else type(dag)}")
        return report(errors, info)
    chains = dag["chains"]
    ids, ports, tasks = {}, {}, {}
    for i, c in enumerate(chains):
        cid = c.get("id", f"#{i}")
        if set(c) != CHAIN_KEYS:
            errors.append(f"chain {cid}: keys {sorted(c)} != {sorted(CHAIN_KEYS)}")
            continue
        if not isinstance(c["id"], str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]*", c["id"]):
            errors.append(f"chain {cid}: bad id")
        if cid in ids:
            errors.append(f"chain id {cid} is used twice")
        ids[cid] = c
        if c["wave"] not in WAVES:
            errors.append(f"chain {cid}: wave {c['wave']!r} not in {sorted(WAVES)}")
        if not isinstance(c["title"], str) or not c["title"].strip():
            errors.append(f"chain {cid}: empty title")
        if c["size"] not in UNITS:
            errors.append(f"chain {cid}: size {c['size']!r} not S, M or L")
        if not isinstance(c["critical"], bool):
            errors.append(f"chain {cid}: critical must be true or false")
        if not isinstance(c["port"], int) or isinstance(c["port"], bool) or c["port"] < 0:
            errors.append(f"chain {cid}: bad port {c['port']!r}")
        elif c["port"]:
            if c["port"] in ports:
                errors.append(f"port {c['port']} used by {ports[c['port']]} and {cid}")
            ports[c["port"]] = cid
        if not isinstance(c["after"], list) or not all(isinstance(a, str) for a in c["after"]):
            errors.append(f"chain {cid}: after must be a list of chain ids")
        elif len(set(c["after"])) != len(c["after"]):
            errors.append(f"chain {cid}: duplicate ids in after")
        if not isinstance(c["files"], list) or not c["files"] or not all(isinstance(f, str) and f.strip() for f in c["files"]):
            errors.append(f"chain {cid}: files must be a non-empty list of paths")
        elif len(set(c["files"])) != len(c["files"]):
            errors.append(f"chain {cid}: duplicate file entries")
        if not isinstance(c["mergeNotes"], str):
            errors.append(f"chain {cid}: mergeNotes must be a string")
        if not isinstance(c["tasks"], list) or not c["tasks"]:
            errors.append(f"chain {cid}: no tasks")
            continue
        for t in c["tasks"]:
            if not isinstance(t, dict) or set(t) != TASK_KEYS:
                errors.append(f"chain {cid}: task keys {sorted(t) if isinstance(t, dict) else t} != {sorted(TASK_KEYS)}")
                continue
            if not t["brief"].strip() or not t["title"].strip():
                errors.append(f"task {t['id']}: empty title or brief")
            tasks.setdefault(t["id"], []).append(cid)
    if errors:
        return report(errors, info)
    for c in chains:
        for a in c["after"]:
            if a == c["id"]:
                errors.append(f"chain {c['id']} lists itself in after")
            elif a not in ids:
                errors.append(f"chain {c['id']}: after id {a!r} does not exist")
    order, cyclic, _ = topo_order(chains)
    if cyclic:
        errors.append("cycle among: " + ", ".join(cyclic))
        return report(errors, info)
    for t, cs in sorted(tasks.items()):
        if len(cs) > 1:
            errors.append(f"task {t} appears {len(cs)} times ({', '.join(cs)})")

    # every task of plan.json and of the remaining wave-0 work exactly once
    expected = {}
    plan_path = args.plan or os.path.join(HERE, "plan.json")
    if os.path.exists(plan_path):
        plan = load(plan_path)
        plan_chain_ids = []
        for w in plan["waves"]:
            for sw in w["subwaves"]:
                for pc in sw["chains"]:
                    plan_chain_ids.append(pc["id"])
                    for t in pc["tasks"]:
                        expected[t["id"]] = f"plan.json {sw['id']} {pc['id']}"
                        if t["id"] in tasks:
                            mine = next(x for x in ids[tasks[t["id"]][0]]["tasks"] if x["id"] == t["id"])
                            if mine["brief"] != t["brief"] or mine["title"] != t["title"]:
                                errors.append(f"task {t['id']}: title or brief differs from plan.json")
        for pid in plan_chain_ids:
            if pid not in ids:
                info.append(f"plan.json chain {pid} merged into another chain")
    else:
        errors.append(f"plan.json not found at {plan_path} (pass --plan)")
    for t in W0_REMAINING_TASKS:
        expected[t] = "plan-w0.md W0.2-W0.6"
    for t, where in expected.items():
        if t not in tasks:
            errors.append(f"task {t} ({where}) is missing")
    for t in tasks:
        if t not in expected:
            errors.append(f"task {t} is neither in plan.json nor in the remaining wave-0 work")
    w0 = parse_w0_plan(args.w0 or os.path.join(HERE, "plan-w0.md"))
    for batch, cids in sorted(w0.items()):
        for x in cids:
            if x not in ids:
                errors.append(f"plan-w0.md {batch} chain {x} is missing")

    # marker segments only after the chain that creates them; known segment names on marker files
    task_chain = {t: cs[0] for t, cs in tasks.items()}
    anc = ancestors(chains)
    for c in chains:
        for e in c["files"]:
            p, s = split(e)
            if s is None or (p, s) not in MARKERS:
                continue
            creator = task_chain.get(MARKERS[(p, s)])
            if creator is None:
                errors.append(f"{c['id']}: {e} needs {MARKERS[(p, s)]}, which no chain has")
            elif creator != c["id"] and creator not in anc[c["id"]]:
                errors.append(f"{c['id']}: {e} must come after {creator} ({MARKERS[(p, s)]} creates the segment)")

    # statistics
    _, eft, lft, _, length, _ = schedule_numbers(chains)
    crit = {c["id"] for c in chains if lft[c["id"]] - eft[c["id"]] == 0}
    flagged = {c["id"] for c in chains if c["critical"]}
    if crit != flagged:
        info.append("critical flags differ from the zero-slack set: flagged only "
                    + (", ".join(sorted(flagged - crit)) or "-") + "; zero slack only " + (", ".join(sorted(crit - flagged)) or "-"))
    unordered = 0
    for i, a in enumerate(chains):
        for b in chains[i + 1:]:
            if a["id"] in anc[b["id"]] or b["id"] in anc[a["id"]]:
                continue
            if chains_conflict(a, b):
                unordered += 1
    n_edges = sum(len(c["after"]) for c in chains)
    per_wave = ", ".join(f"{wv}: {sum(1 for c in chains if c['wave'] == wv)}" for wv in sorted(WAVES))
    info.append(f"{len(chains)} chains ({per_wave}), {len(tasks)} tasks, {n_edges} after-edges, {len(ports)} UI ports")
    info.append(f"longest path {length} size units; {len(crit)} chains with zero slack")
    info.append(f"{unordered} pairs of unordered chains share a file (the scheduler never runs such a pair at once)")
    return report(errors, info)


def report(errors, info):
    for line in info:
        print(line)
    if errors:
        print(f"FAILED: {len(errors)} problem(s)")
        for e in errors:
            print("  -", e)
        return 1
    print("OK: format valid; ids unique; every after id exists; acyclic; every plan.json and remaining wave-0 task "
          "appears exactly once; marker segments follow their creators; ports unique")
    return 0


def cmd_critical(dag, args):
    chains = dag["chains"]
    by_id = {c["id"]: c for c in chains}
    merged = set(read_ids(args.merged)) & set(by_id)
    order, eft, lft, down, length, w = schedule_numbers(chains, frozenset(merged))
    # walk back from the latest finisher along a zero-slack predecessor that finishes last
    end = max((x for x in by_id if x not in merged), key=lambda x: (eft[x], -len(x)), default=None)
    path = []
    x = end
    while x is not None:
        path.append(x)
        preds = [a for a in by_id[x]["after"] if a not in merged and eft[a] == eft[x] - w[x]]
        x = max(preds, key=lambda a: (eft[a], a)) if preds else None
    path.reverse()
    print(f"critical path: {length} size units (S=1, M=2, L=3), {len(path)} chains"
          + (f", {len(merged)} chains already merged" if merged else ""))
    for x in path:
        c = by_id[x]
        print(f"  {eft[x] - w[x]:>3} -> {eft[x]:<3} {c['size']}  {x:<24} {c['title'][:80]}")
    # comparison with the sequential sub-wave plan (wave-end reviews not counted in either)
    plan_path = args.plan or os.path.join(HERE, "plan.json")
    task_chain = {t["id"]: c["id"] for c in chains for t in c["tasks"]}
    total, batches = 0, 0
    w0 = parse_w0_plan(args.w0 or os.path.join(HERE, "plan-w0.md"))
    for b, cids in sorted(w0.items()):
        sizes = [UNITS[by_id[x]["size"]] for x in cids if x in by_id]
        if sizes:
            total += max(sizes)
            batches += 1
    w0_total = total
    if os.path.exists(plan_path):
        plan = load(plan_path)
        for wv in plan["waves"]:
            for sw in wv["subwaves"]:
                sizes = []
                for pc in sw["chains"]:
                    tid = pc["tasks"][0]["id"]
                    if tid in task_chain:
                        sizes.append(UNITS[by_id[task_chain[tid]]["size"]])
                if sizes:
                    total += max(sizes)
                    batches += 1
    print(f"sequential plan for comparison: {batches} batches (W0.2-W0.6 + 24 sub-waves), "
          f"{total} size units if each batch lasts as long as its largest chain ({w0_total} in W0.2-W0.6); "
          f"the DAG's critical path is {length} ({100 * length / max(total, 1):.0f}% of it). "
          "Wave-end reviews are counted in neither.")
    return 0


def cmd_simulate(dag, args):
    chains = dag["chains"]
    by_id = {c["id"]: c for c in chains}
    merged = set(read_ids(args.merged)) & set(by_id)
    running = {}          # id -> finish time
    t = 0
    timeline = []
    peak = 0
    while len(merged) < len(chains):
        picked, _, _, _ = ready_chains(chains, merged, set(running), args.simulate)
        for c in picked:
            running[c["id"]] = t + UNITS[c["size"]]
            timeline.append((t, c["id"]))
        peak = max(peak, len(running))
        if not running:
            print("stuck: nothing ready and nothing running; unmet: "
                  + ", ".join(sorted(set(by_id) - merged)[:10]))
            return 1
        t = min(running.values())
        for x in [x for x, f in running.items() if f == t]:
            del running[x]
            merged.add(x)
    print(f"greedy simulation with {args.simulate} agents: makespan {t} size units, peak {peak} chains at once")
    by_t = {}
    for s, x in timeline:
        by_t.setdefault(s, []).append(x)
    for s in sorted(by_t):
        print(f"  t={s:<3} start " + ", ".join(by_t[s]))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter,
                                 epilog=__doc__.split("\n\n", 1)[1])
    ap.add_argument("--dag", default=os.path.join(HERE, "dag.json"), help="DAG file (default: dag.json next to this script)")
    ap.add_argument("--plan", help="plan.json for --check and --critical-path (default: next to this script)")
    ap.add_argument("--w0", help="plan-w0.md for --check and --critical-path (default: next to this script)")
    ap.add_argument("--merged", help="file with merged chain ids, one per line")
    ap.add_argument("--running", help="file with running chain ids, one per line")
    ap.add_argument("--slots", type=int, help="total developer agents (running chains count against it)")
    ap.add_argument("--json", action="store_true", help="print the ready chains as JSON")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--check", action="store_true", help="validate dag.json")
    g.add_argument("--critical-path", action="store_true", help="print the longest chain of remaining work")
    g.add_argument("--simulate", type=int, metavar="N", help="replay the greedy rule with N agents")
    args = ap.parse_args(argv)
    dag = load(args.dag)
    if args.check:
        return cmd_check(dag, args)
    if args.critical_path:
        return cmd_critical(dag, args)
    if args.simulate:
        return cmd_simulate(dag, args)
    if args.merged is None or args.running is None:
        ap.error("--merged and --running are required (or use --check, --critical-path, --simulate)")
    return cmd_ready(dag, args)


if __name__ == "__main__":
    sys.exit(main())
