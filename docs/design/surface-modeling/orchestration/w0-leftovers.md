# Wave-0 leftovers for the wave-end review and fix chain

Minor review findings in wave-0 files that no later chain owns. The wave-0 end fix agent takes these.

## F0-A T7b (look along) — files: render/viewer.js#view-along, ui/shell.js#view-menu, main.js#view-commands
1. Reduced motion is only half done: resetView(animate = true) still plays the 420 ms camera animation when the user prefers reduced motion
   (Home / R, the view menu's Default view). F0-A section 2.2 B3 names resetView too.
2. View-menu items read 'Surface normal' and 'Bottom surface'; F0-A section 5.1 names them 'Surface normal (top)' (N) and 'Surface normal (bottom)' (Shift+N).
3. The Look along dialog does not explain Direction and Vector input as it is typed (F0-A section 2.2 B4, a 'should' item):
   'the direction [1 1 0] of the current cell' / 'the normal of the plane (1 1 1)'.
4. The direction label layer is export 'never' in every case; F0-A section 3.14.1 says exports include it when the export includes the gizmo (gizmo: true).
5. Test gaps: no automated test covers the three view commands in main.js or the dialog (the exactly-one rule of view.along and its message
   'Look along: give exactly one of uvw, hkl or vector.', the four-index hkl branch, the note toast).

## F0-A T10 (panel shell) — from the W0.1 review
6. Sixth rail button no longer fits on the narrowest phones (six buttons at min-width 56px + 16px padding need 352px).
7. Action menus flatten an action with items into bare entries without a label or header.
8. onHover places the hover card as if it were 110px tall; registerAtomInfo rows make it taller.
9. Only the pure helpers of the section shell are unit-tested; the DOM behaviour has no automated test.

## F0-A T1 (history)
10. lastRecorded is also reset by popUndo/popRedo/popTop; the spec and ledger L-F0-33 only reset it in clear() and detach() (the developer documented the choice; confirm or align).

## F0-D T7/T3 (vacuum, constraints)
11. Timing tests sit in the default run (tests/js/vacuum.test.mjs around line 379); M7 section 7.1 wants performance tests only under tests/perf/.
12. Three error messages are worded differently in the two languages because they name language-specific identifiers (ledger-F0 section 0.3 wants identical text).
