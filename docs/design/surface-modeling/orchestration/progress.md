# Progress log (lead's durable state; update after every step)

## Environment
- Dev Python: scratchpad/devenv/bin/python (fastapi, numpy, pytest, httpx, httpx2). Baseline: 169 tests pass in ~7.7 s at 1bb366f.
- Worktrees: scratchpad/wt/<task-id>, branches sm/<task-id> (local only). Main checkout /home/user/crystallume on claude/clever-thompson-5wtccp.
- Handbook for dev agents: design/dev-handbook.md. Wave-0 schedule: design/plan-w0.md.

## Design status (2026-11-09)
- Maps 01-07 done. Brief v2 with user decisions U1-U6.
- Specs v2 final: F0-D, F0-A, M1, M2, M3, M4. M5, M6 revising (workflow wf_8a90f1b6-8b8).
- Cross-check part 1 (ledger-F0, acceptance) running: wf_9fc0a271-937. Part 2 (ledger-features) running: wf_4216135b-f7c.
- Still to do: integrated plan for waves 1-5 (plan agent), copy design docs into repo docs/design/surface-modeling/, commit, push.

## Known pre-existing defects to fix in wave 0 (see ledger-F0 defect table)
- Python minimum_image_vectors fails in skewed cells (crystallume/analysis/geometry.py:21-40), reproduced 0.50 A -> 2.73 A.

## Implementation log
- 12:21 Design docs committed and pushed: 1729d01 (docs/design/surface-modeling/).
- 12:25 W0.1 launched from base 1729d01. Worktrees scratchpad/wt/{w0-d-base,w0-a-t1,w0-a-t10,w0-a-t4a}.
  - WF wf_b3c84879-d57: chains w0-d-base (F0-D T0 -> T7 -> T3), w0-a-t10 (F0-A T10).
  - WF wf_ee67ccbd-c47: chains w0-a-t1 (F0-A T1, port 8811), w0-a-t4a (F0-A T4a, port 8813).
  - Dev workflow script (reusable, args-driven): workflows/scripts/surface-dev-chains-wf_b3c84879-d57.js
  - Merge order for W0.1: w0-d-base -> w0-a-t1 -> w0-a-t10 -> w0-a-t4a.
- 12:45 Cross-check done: ledger-features.md (69 entries, includes lead decisions L-01..L-19), acceptance.md (S1-S16, E2E-1..6),
  lead-decisions.md. Committed and pushed 2eb358a (main branch now ahead of the W0.1 base; docs only).
- 12:45 Plan agent + M7 agent running: wf_dafeefaf-88b -> design/plan.md, design/plan.json, design/specs/M7.md.
- For W0.2+ pass extraLedgers: [design/lead-decisions.md, design/ledger-features.md] to the dev workflow.
- 14:50 W0.1 merged (no conflicts) and pushed: 43a4455. Python suite + node 475 tests pass (12 s). Browser smoke OK
  (Shift+5 opens Surface panel with section shells, delete+undo OK, no console errors). Merged chain ids: w0-d-base, w0-a-t1, w0-a-t10, w0-a-t4a.
- Deferred minor findings to fold into later chains:
  - F0-D vacuum: findVacuumGap(s) loops forever with non-finite coordinates when an axis has <= 1 finite fractional coordinate (fix in next F0-D chain).
  - tests/js_bridge.py run_js/run_node_tests: subprocess.run(text=True) without encoding='utf-8'.
  - Timing tests in default run (tests/js/vacuum.test.mjs:379 ...) must move to tests/perf/ (M7 §7.1).
  - Three error messages worded differently between languages (ledger §0.3 wants identical text).
  - F0-A T10: requireVacuumGap() fails open before core/vacuum.js loads; sixth rail button too wide on narrow phones;
    action menus flatten items without headers; hover card height assumption 110 px; DOM behaviour lacks automated tests.
  - F0-A T1: lastRecorded reset also on pop*; bumpRev fallback to delete after F0-D T2.
- 15:15 B2 launched from 43a4455 (8 chains, DAG-driven; running.txt / merged.txt are the scheduler state):
  - wf_36204e14-8ba: w0-d-t1, w0-d-t2 | wf_f0483d8c-7e4: w0-a-t5, w0-a-t4b
  - wf_f2c9258a-d8c: w0-d-t10, w1-m3-golden | wf_26e1761f-386: w3-m5-delaunay, w2-m4-movemath
  - Tools: design/prepare_batch.py <label> <chain ids> (worktrees + args), design/chaininfo.py, design/scheduler.py,
    design/chain-notes.json (lead's extra instructions per chain). Next ready after merges: run scheduler.py.
- 16:20 Merged and pushed w3-m5-delaunay + w2-m4-movemath: 12389ac (merged.txt updated). Notes for follow-ups in chain-notes.json
  (w2-m4-movetool: movemath interface changes; w3-m5-frame: delaunay checkDistinct non-termination).
- 16:22 B3: w0-a-t7a launched alone (wf_65c9cfa5-71c) WITHOUT core/__init__.py (w0-d-t1 owns it); add its re-export lines at merge.
- 17:05 Merged and pushed w0-d-t1, w0-d-t2, w0-d-t10, w1-m3-golden: 47e0d60 (no conflicts; pytest + node 1026 tests: 0 fail, 427 skipped shared cases waiting for later chains).
- 17:08 B4 launched from 47e0d60: wf_490bcc47-4f6 (w0-d-t4 POSCAR, w0-d-t5 extxyz), wf_0968cfb1-e31 (w1-m1-intmath, w1-m2-golden).
  Still running from earlier: w0-a-t5, w0-a-t4b (wf_f0483d8c-7e4), w0-a-t7a (wf_65c9cfa5-71c). w0-a-t2 waits for w0-a-t5 (app.js#measurements).
- 17:45 Merged w0-a-t7a + core/__init__.py re-exports (reciprocal_cell, plane_spacings): 6f6bbb4, pushed.
- 17:47 B5: w0-a-t8 (params schema + inputs, port 8864) launched: wf_9358806c-94d. Running: w0-a-t5, w0-a-t4b, w0-d-t4, w0-d-t5, w1-m1-intmath, w1-m2-golden, w0-a-t8.
- 18:40 Merged w0-a-t5 (U1 display verified in Chromium with contcar_pt111: 36 atoms, 50 drawn, pbc TTT, no toast) + w0-a-t4b: 783b47b, pushed.
- 18:43 B6 launched from 783b47b: wf_9766372c-c52 (w0-a-t2 edit primitives, w0-d-t9 exact MIC), wf_992c47aa-f85 (w0-a-t6 tool registry).
  Running: w0-d-t4, w0-d-t5, w1-m1-intmath, w1-m2-golden, w0-a-t8, w0-a-t2, w0-d-t9, w0-a-t6.
- 19:30 Merged w0-d-t4 (POSCAR: web keeps Selective dynamics; the strict todo is gone) + w0-d-t5 (extxyz move_mask): 5b07871, pushed.
  node: 1603 tests, 0 fail, 209 skipped (M3 layer cases), 0 todo.
- 19:32 B7: w0-d-t6 export channel launched (wf_b84463d7-c5f). Running: w1-m1-intmath, w1-m2-golden, w0-a-t8, w0-a-t2, w0-d-t9, w0-a-t6, w0-d-t6.
- 20:05 Merged w0-a-t6 tool registry: 803ccd4, pushed.
- 20:55 Merged w0-a-t8 params + inputs: af735ea, pushed.
- 20:58 B8: w0-a-t9 commands launched (wf_2a9fd13a-369). Running: w1-m1-intmath, w1-m2-golden, w0-a-t2, w0-d-t9, w0-d-t6, w0-a-t9.
- 21:35 Merged w1-m1-intmath + w1-m2-golden: 9909752, pushed (node 2079 tests, 0 fail).
- 21:38 B9: w1-m1-recipes launched (wf_73c2b5db-9b7). Running: w0-a-t2, w0-d-t9, w0-d-t6, w0-a-t9, w1-m1-recipes.
- 2026-11-10 00:20 Worker restarted; subagents had hit the weekly usage limit (fix:w0-d-t6, w0-a-t9, w1-m1-recipes failed).
  Pushed the pending merges of w0-a-t2 (edit primitives) and w0-d-t9 (exact MIC; skewed-cell check 0.5000 A): 1aa5bb4.
  User said "Try again": stashed w0-d-t6's half-done fix edits (stash@{0} in its worktree), resumed the three workflows
  (wf_b84463d7-c5f fix stage only, wf_2a9fd13a-369, wf_73c2b5db-9b7); new agents are running normally.
- 00:30 B10 launched from 1aa5bb4: wf_8a6773ef-17e (w1-scaffold [critical; analysis/__init__.py overlaps w0-d-t6, lead resolves at merge], w0-a-t3a),
  wf_8946f121-b14 (w0-a-t7b, w1-m2-data). Running now: w0-d-t6 (fix), w0-a-t9, w1-m1-recipes, w1-scaffold, w0-a-t3a, w0-a-t7b, w1-m2-data.
- 01:00 Merged w0-d-t6 export channel (fix stage finished after the retry): pushed. L-24 recorded (optional velocities capability). Model switched by the user to claude-fable-5-2; commit trailer now 'Claude Fable 5.2' (handbook updated).
- 01:05 Pushed 070201e (L-24 doc). B11: w1-m1-contracts launched (wf_a78abf55-450). Running: w0-a-t9, w1-m1-recipes, w1-scaffold, w0-a-t3a, w0-a-t7b, w1-m2-data, w1-m1-contracts.
- 01:45 Merged w1-m1-recipes: e18ce62, pushed (node 2407 tests, 0 fail).
- 02:10 Merged w1-scaffold (conflict in analysis/__init__.py resolved by hand: close_contacts kept, markers after it): 4e0963f.
  Lead fix 691a9db: wave-0 tests no longer pin SURFACE_DEFAULTS to exactly nine keys (modules append keys). Pushed.
- 02:15 B12 launched from 691a9db: wf_cfac44ad-916 (w1-m1-lattice [L], w1-m2-miller), wf_98109171-950 (w2-m4-geometry, w2-m4-fixtures).
  Running: w0-a-t9, w0-a-t3a, w0-a-t7b, w1-m2-data, w1-m1-contracts, w1-m1-lattice, w1-m2-miller, w2-m4-geometry, w2-m4-fixtures.
  Note for w5-release (M7-T7): segment markers in the JS doc comment of core/defaults.js carry a ' * ' prefix; cleanup must remove the ' *' blank lines too.
- 02:50 Merged w0-a-t9 commands: 5781695, pushed. Browser smoke on main OK (no console errors; U4 enforced in surface.cleave params; space-group label cleared on delete/replace and restored by undo; sel.delete now returns a Promise).
- 03:35 Merged w0-a-t7b (view along; N key verified in Chromium on main) + w1-m2-data: ac4bf11, pushed (node 2488 tests, 0 fail). L-25, L-26 recorded; w0-leftovers.md started for the wave-0 end fix chain.
- 03:45 Pushed a3286fb (L-25, L-26). B13 launched from a3286fb: wf_12a387be-d52 (w1-m3-layers [L, critical: M3-T1 + M3-T3a], w3-m5-library),
  wf_a152d65e-fa6 (w4-m6-data). Running: w0-a-t3a, w1-m1-contracts, w1-m1-lattice, w1-m2-miller, w2-m4-geometry, w2-m4-fixtures, w1-m3-layers, w3-m5-library, w4-m6-data.
