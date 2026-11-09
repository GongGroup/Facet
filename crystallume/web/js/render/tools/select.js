/**
 * The Select tool (V), the default (F0-A §3.13.1): no handler of its own. A click selects (Shift adds, Ctrl/⌘
 * toggles, empty space clears: app._onAtomClick), a drag on empty space draws the viewer's selection rectangle (Q: a
 * lasso), a double-click selects the bonded fragment. The status-bar hint is the shell's own (it follows the
 * selection), and the key V is bound by the command tool.select.
 */
import { tools } from './index.js';

export const selectTool = {
  id: 'select', title: 'Select', tip: 'Select and inspect atoms', icon: 'pointer', key: 'v', order: 10,
  toolbar: true, selects: true,
};

tools.register(selectTool);
