# Developer handbook for the surface-modeling implementation (agents read this first)

## Where things are
- Main checkout (integration only, never edit it from a task): `/home/user/crystallume`, branch `claude/clever-thompson-5wtccp`.
- Your task has its own git worktree and local branch, given in your task prompt, under
  `/tmp/claude-0/-home-user-crystallume/f118e1c6-ea51-5594-ad44-3edbe2cba708/scratchpad/wt/<task-id>` on branch `sm/<task-id>`.
  Edit files ONLY inside your worktree. Use absolute paths with the Read/Edit/Write tools.
- Design (binding, in this order of precedence): brief `design/00-architecture.md` (section U = user decisions, highest priority),
  lead decisions `design/lead-decisions.md` (L-20 approves the renames in `design/specs/M7.md` §6.8, which then override
  the ledgers), API ledgers `design/ledger-F0.md` and `design/ledger-features.md` (they override module specs where they differ),
  the M7 master spec `design/specs/M7.md` (§5 command and shortcut registry, §6 API inventory, §7 test layout and markers),
  module specs `design/specs/<ID>.md`, acceptance scenarios `design/acceptance.md`, plan `design/plan.md`.
  `design/` means `/tmp/claude-0/-home-user-crystallume/f118e1c6-ea51-5594-ad44-3edbe2cba708/scratchpad/design/`.
  The specs are long: read the sections your task cites (grep for the headings) rather than whole files.

## Environment
- Python with the test dependencies: `DEVPY=/tmp/claude-0/-home-user-crystallume/f118e1c6-ea51-5594-ad44-3edbe2cba708/scratchpad/devenv/bin/python`.
  Run from the worktree root so that your worktree's `crystallume` package is the one imported:
  `cd <worktree> && $DEVPY -m pytest -q -p no:cacheprovider` (the whole suite takes about 8 s today).
- Node: `/opt/node22/bin/node`. Web modules are ES modules; once `crystallume/web/js/package.json` (`{"type":"module"}`) exists,
  import them by absolute path. Run node tests by passing the files, e.g. `node --test tests/js/*.test.mjs` (a directory argument fails on Node 22/24).
- Browser checks: start the app from your worktree on a port unique to your task:
  `cd <worktree> && $DEVPY -m crystallume serve --port <port> --data <scratch dir> &` and stop it when done.
  ALWAYS pass `--data` with a fresh folder under `scratchpad/data/<task-id>/`: the default `~/.crystallume` is shared,
  and the app's autosave would write test projects into it.
  Playwright and Chromium are preinstalled: `require('playwright')` works from any directory, `chromium.launch()` needs no options.
  Do not run `playwright install`. Screenshots you only look at yourself: `deviceScaleFactor: 1`; save under
  `/tmp/claude-0/-home-user-crystallume/f118e1c6-ea51-5594-ad44-3edbe2cba708/scratchpad/shots/<task-id>/`.
- No new runtime dependencies (numpy only on the Python side, nothing on the web side). Do not install anything into the repository.

## Rules
- Follow the existing code style of each file. Python: type hints, docstrings like the existing ones. JS: ES modules, no build step.
- UI text is English and short; docs are plain English (see the existing README and docs/).
- Every behaviour change needs tests: Python tests under `tests/`, JS tests under `tests/js/` run through the pytest bridge, and shared
  golden cases under `tests/data/surface/` where the brief asks for Python/JS parity.
- Before committing: the full Python suite passes, the node tests pass, and `git status` shows no stray files (no `__pycache__`,
  `.pytest_cache`, egg-info or scratch files inside the worktree).
- Commit on your task branch with a clear message whose last lines are exactly:

  ```
  Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MaviWo7rz9dBfANJT1RT2q
  ```
  Do not put model names or identifiers anywhere else (code, comments, docs).
- Never push, never touch other branches, never edit the main checkout.
- If the spec is ambiguous or wrong, follow the brief's principles, decide, and record the decision in your final report.
  If you must touch a file your task does not own, keep the change minimal and say so in the report.
