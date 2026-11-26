/**
 * The Project explorer (ui/workbench.js): the open project as a tree — the project, then its documents (crystals,
 * surface slabs, molecules and clusters, trajectories, each with its icon) — with a small toolbar as in Materials
 * Studio (new document, duplicate, rename, delete, sort, properties, open project).
 *
 * Mouse: a click selects (the Properties explorer shows what is selected), a double-click opens the document's window,
 * a right-click opens its menu. Keyboard: ↑ ↓ Home End move, ← → fold and unfold the project, Enter opens, F2 renames,
 * Delete removes from the project (undoable), Shift+F10 or the context-menu key opens the menu.
 */
import { h, ic } from './dom.js';
import { toast, showMenu, confirmDialog } from './overlays.js';
import { formats } from '../io/index.js';
import { samples } from '../build/samples.js';
import { canDownload } from '../storage/files.js';
import { docKind, KIND_ICON, KIND_LABEL } from './workbench.js';

const SORTS = [['added', 'Order Added'], ['name', 'Name'], ['type', 'Type'], ['atoms', 'Number of Atoms']];
const KIND_ORDER = { crystal: 0, surface: 1, molecule: 2, trajectory: 3 };

export class ProjectExplorer {
  constructor(bench) {
    this.bench = bench;
    this.app = bench.app;
    this.shell = bench.shell;
    this.sel = null;          // 'root', a document id, or null (follows the active document)
    this.expanded = true;
    this.renaming = null;     // the id ('root' or a document) whose name is being edited
    const tb = (icon, tip, run, extra = {}) => {
      const b = h('button.xt-b', { type: 'button', 'aria-label': tip, 'data-tip': tip, ...extra }, ic(icon, 'sm'));
      b.addEventListener('click', (e) => run(e.currentTarget));
      return b;
    };
    this.tDel = tb('trash', 'Delete the selected document', () => this.remove(this._selDoc()));
    this.tDup = tb('copy', 'Duplicate the selected document', () => this.duplicate(this._selDoc()));
    this.tRen = tb('edit', 'Rename (F2)', () => this.rename(this.sel ?? this.app.project.activeStructure));
    this.tools = h('div.xtools', { role: 'toolbar', 'aria-label': 'Project tools' },
      tb('filePlus', 'New document', (b) => showMenu(b, this.newItems(), { label: 'New document' }), { 'aria-haspopup': 'menu' }),
      this.tDup, this.tRen, this.tDel, h('span.xt-sep'),
      tb('sort', 'Sort the documents', (b) => showMenu(b, this.sortItems(), { label: 'Sort' }), { 'aria-haspopup': 'menu' }),
      tb('props', 'Properties of the selected item', () => this.bench.focusProperties()), h('span.xt-sep'),
      tb('folder', 'Open project…', () => this.shell.runCommand('project.open')));
    this.tree = h('div.tree', { role: 'tree', tabindex: '0', 'aria-label': 'Project' });
    this.el = h('div.xbody.project-body', this.tools, this.tree);
    this.tree.addEventListener('click', (e) => { const r = e.target.closest('.ti'); if (!r || e.target.closest('input')) return; if (e.target.closest('.tw')) { this.expanded = !this.expanded; this.render(); return; } this.select(r.dataset.id); });
    this.tree.addEventListener('dblclick', (e) => { const r = e.target.closest('.ti'); if (!r || e.target.closest('input')) return; if (r.dataset.id === 'root') { this.expanded = !this.expanded; this.render(); } else this.open(r.dataset.id); });
    this.tree.addEventListener('contextmenu', (e) => { const r = e.target.closest('.ti'); if (!r) return; e.preventDefault(); this.select(r.dataset.id); this.menu({ x: e.clientX, y: e.clientY }, r.dataset.id); });
    this.tree.addEventListener('keydown', (e) => this._key(e));
  }

  focus() { requestAnimationFrame(() => (this.tree.querySelector('.ti[aria-selected="true"]') ?? this.tree).focus({ preventScroll: false })); }

  /** The documents in the order of the Sort menu. */
  docs() {
    const list = [...this.app.project.structures];
    const by = this.app.prefs.projectSort ?? 'added';
    if (by === 'name') list.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
    else if (by === 'type') list.sort((a, b) => KIND_ORDER[docKind(a.structure)] - KIND_ORDER[docKind(b.structure)]);
    else if (by === 'atoms') list.sort((a, b) => a.structure.length - b.structure.length);
    return list;
  }

  /** The id the explorer shows as selected: its own choice, else the active document, else the project. */
  current() {
    const p = this.app.project;
    if (this.sel === 'root') return 'root';
    if (this.sel && p.structures.some((e) => e.id === this.sel)) return this.sel;
    return p.activeStructure ?? 'root';
  }
  _selDoc() { const c = this.current(); return c === 'root' ? null : c; }

  select(id, { focus = false } = {}) {
    this.sel = id;
    // in place: a double-click must land on the row its first click selected
    const rows = [...this.tree.querySelectorAll('.ti')];
    if (rows.some((r) => r.dataset.id === id)) {
      for (const r of rows) { const on = r.dataset.id === id; r.setAttribute('aria-selected', String(on)); r.tabIndex = on ? 0 : -1; }
      this.tree.setAttribute('aria-activedescendant', `ti-${id}`);
      this.tDel.disabled = id === 'root'; this.tDup.disabled = id === 'root';
    } else this.render();
    this.bench.properties.schedule();
    if (focus) this.focus();
  }

  open(id) { if (id && id !== 'root') { this.sel = id; this.bench.mdi.activate(id); } }

  render() {
    if (this.renaming) return;   // the field being typed in stays
    const app = this.app, p = app.project, cur = this.current();
    const had = this.tree.contains(document.activeElement);
    const rows = [];
    const root = this._row({ id: 'root', level: 1, icon: 'project', label: p.name || 'Untitled project', bold: true, expanded: this.expanded, kids: p.structures.length > 0, selected: cur === 'root', tip: `${p.structures.length} document${p.structures.length === 1 ? '' : 's'}${p.location ? '' : ' · not saved yet'}` });
    rows.push(root);
    if (this.expanded) {
      for (const e of this.docs()) {
        const kind = docKind(e.structure);
        const open = this.bench.mdi.isOpen(e.id);
        rows.push(this._row({
          id: e.id, level: 2, icon: KIND_ICON[kind], label: e.name, selected: cur === e.id, current: e.id === p.activeStructure, open,
          tip: `${e.structure.formula()} · ${e.structure.length.toLocaleString()} atoms · ${KIND_LABEL[kind]}${open ? '' : ' · window closed (double-click to open)'}`,
        }));
      }
    }
    if (!p.structures.length) rows.push(h('div.tree-hint', 'No documents yet. Use New, import a file or pick a sample.'));
    this.tree.replaceChildren(...rows);
    this.tree.setAttribute('aria-activedescendant', `ti-${cur}`);
    if (had) this.tree.querySelector('.ti[aria-selected="true"]')?.focus({ preventScroll: true });
    const doc = cur !== 'root';
    this.tDel.disabled = !doc; this.tDup.disabled = !doc;
  }

  _row({ id, level, icon, label, bold = false, expanded = null, kids = false, selected = false, current = false, open = true, tip = null }) {
    const tw = h('span.tw', { 'aria-hidden': 'true' }, kids ? ic(expanded ? 'chevronDown' : 'chevronRight', 'sm') : null);
    const r = h('div.ti', {
      id: `ti-${id}`, role: 'treeitem', tabindex: selected ? '0' : '-1', 'aria-level': String(level), 'aria-selected': String(selected),
      'aria-expanded': kids ? String(!!expanded) : null, 'aria-current': current ? 'true' : null, 'data-tip': tip, dataset: { id, open: String(open) },
      style: { '--lvl': String(level - 1) },
    }, tw, ic(icon, 'sm'), h(`span.tl${bold ? '.b' : ''}`, label));
    if (this.renaming === id) r.querySelector('.tl').replaceWith(this._renameField(id, label));
    return r;
  }

  _key(e) {
    if (e.target.tagName === 'INPUT') return;
    const rows = [...this.tree.querySelectorAll('.ti')];
    const i = rows.findIndex((r) => r.getAttribute('aria-selected') === 'true');
    const go = (j) => { const r = rows[Math.max(0, Math.min(rows.length - 1, j))]; if (r) this.select(r.dataset.id, { focus: true }); };
    const id = rows[i]?.dataset.id;
    switch (e.key) {
      case 'ArrowDown': go(i + 1); break;
      case 'ArrowUp': go(i - 1); break;
      case 'Home': go(0); break;
      case 'End': go(rows.length - 1); break;
      case 'ArrowLeft': if (id === 'root' && this.expanded) { this.expanded = false; this.render(); } else go(0); break;
      case 'ArrowRight': if (id === 'root' && !this.expanded) { this.expanded = true; this.render(); } else if (id === 'root') go(1); break;
      case 'Enter': if (id === 'root') { this.expanded = !this.expanded; this.render(); } else this.open(id); break;
      case 'F2': this.rename(id); break;
      case 'Delete': case 'Backspace': if (id && id !== 'root') this.remove(id); else return; break;
      case 'ContextMenu': { const r = rows[i]?.getBoundingClientRect(); if (r) this.menu({ x: r.left + 24, y: r.bottom }, id); break; }
      case 'F10': if (!e.shiftKey) return; { const r = rows[i]?.getBoundingClientRect(); if (r) this.menu({ x: r.left + 24, y: r.bottom }, id); } break;
      default: return;
    }
    e.preventDefault(); e.stopPropagation();
  }

  // ---------------------------------------------------------------- actions
  rename(id) {
    if (!id) return;
    this.sel = id;
    this.renaming = null;
    this.render();
    this.renaming = id;
    const row = this.tree.querySelector(`.ti[data-id="${CSS.escape(id)}"]`);
    const label = row?.querySelector('.tl');
    if (!label) { this.renaming = null; return; }
    const f = this._renameField(id, label.textContent);
    label.replaceWith(f);
    f.focus(); f.select();
  }

  _renameField(id, value) {
    const app = this.app;
    const f = h('input.ti-edit', { value, 'aria-label': 'New name', spellcheck: false });
    let done = false;
    const end = (save) => {
      if (done) return;
      done = true;
      const name = f.value.trim();
      this.renaming = null;
      if (save && name && name !== value) {
        if (id === 'root') app.rename(name); else app.renameStructure(id, name);
      }
      this.render();
      this.focus();
    };
    f.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') end(true); if (e.key === 'Escape') end(false); });
    f.addEventListener('blur', () => end(true));
    f.addEventListener('click', (e) => e.stopPropagation());
    return f;
  }

  async remove(id) {
    const e = this.app.project.structures.find((x) => x.id === id);
    if (!e) return;
    const ok = await confirmDialog({ title: `Delete “${e.name}”?`, message: 'The document is removed from this project. Edit › Undo brings it back.', confirm: 'Delete', danger: true });
    if (!ok) return;
    const mdi = this.bench.mdi;
    // the next window (not a closed document) takes the view, as when its window is closed
    if (id === this.app.project.activeStructure) {
      const next = [...mdi.z].reverse().find((x) => x !== id);
      if (next) mdi.activate(next);
    }
    if (mdi.isOpen(id) && id !== this.app.project.activeStructure) mdi.wins.get(id).el.remove();
    this.app.removeStructure(id);
    if (this.sel === id) this.sel = null;
    toast(`Deleted ${e.name}`, { action: { label: 'Undo', run: () => this.app.undo() } });
  }

  duplicate(id) {
    const e = this.app.project.structures.find((x) => x.id === id);
    if (!e) return;
    const c = e.structure.clone();
    c.name = `${e.name} (2)`;
    try { this.app.addStructure(c, { replaceProject: false, label: `Duplicate ${e.name}` }); } catch (err) { toast(err.message, { type: 'error' }); }
  }

  newItems() {
    const run = (id) => () => this.shell.runCommand(id);
    const groups = new Map();
    for (const s of samples.list()) { const g = s.category ?? 'Other'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(s); }
    return [
      { header: 'New document' },
      { label: 'Build Crystal…', icon: 'build', run: run('build.crystal') },
      { label: 'Build Nanocluster…', icon: 'atom', run: run('build.cluster') },
      { label: 'Build Molecule…', icon: 'molecule', run: run('build.molecule') },
      { separator: true },
      { label: 'Import File…', icon: 'open', kbd: null, run: run('file.open') },
      { label: 'Import URL…', icon: 'link', run: run('file.importUrl') },
      { label: 'Paste Structure Text…', icon: 'clipboard', run: run('file.paste') },
      { label: 'From Sample', icon: 'library', items: [...groups].map(([g, list]) => ({ label: g, items: list.map((s) => ({ label: s.name ?? s.id, run: () => this._addSample(s.id) })) })) },
    ];
  }

  /** A sample as a new document of this project (Library › a sample replaces an untouched project instead). */
  _addSample(id) {
    const s = samples.get(id);
    if (!s) return;
    try { const st = s.build(); st.name = st.name || s.name; this.app.addStructure(st, { replaceProject: this.app.project.structures.length ? false : 'auto' }); }
    catch (e) { toast(e.message, { type: 'error' }); }
  }

  sortItems() {
    const by = this.app.prefs.projectSort ?? 'added';
    return [{ header: 'Sort documents by' }, ...SORTS.map(([v, l]) => ({ label: l, radio: true, checked: by === v, run: () => { this.app.setPref('projectSort', v); this.render(); } }))];
  }

  /** The context menu of a tree item. */
  menu(at, id) {
    const app = this.app, mdi = this.bench.mdi, sh = this.shell;
    if (id === 'root') {
      const provs = app.storage.list();
      showMenu(at, [
        { header: app.project.name || 'Project' },
        { label: 'New Document', icon: 'filePlus', items: this.newItems().slice(1) },
        { separator: true },
        { label: 'Save Project', icon: 'save', run: () => sh.runCommand('project.save') },
        { label: 'Save Project To', icon: 'folder', items: provs.map((p) => ({ label: p.label, icon: p.icon, run: () => sh.saveToProvider(p.id) })) },
        canDownload() ? { label: 'Download Project File', icon: 'download', run: () => sh.runCommand('project.download') } : null,
        { separator: true },
        { label: 'Rename', icon: 'edit', kbd: 'F2', run: () => this.rename('root') },
        { label: this.expanded ? 'Collapse' : 'Expand', run: () => { this.expanded = !this.expanded; this.render(); } },
        { label: 'Open All Windows', icon: 'windows', disabled: !app.project.structures.length, run: () => { const a = app.project.activeStructure; for (const e of app.project.structures) if (!mdi.isOpen(e.id)) mdi.activate(e.id); if (a) mdi.activate(a); } },
        { label: 'Close All Windows', icon: 'x', disabled: !mdi.list().length, run: () => mdi.closeAll() },
        { separator: true },
        { label: 'Properties', icon: 'props', run: () => { this.select('root'); this.bench.focusProperties(); } },
      ], { label: 'Project' });
      return;
    }
    const e = app.project.structures.find((x) => x.id === id);
    if (!e) return;
    const open = mdi.isOpen(id);
    const exportTo = (fmt) => () => { if (id !== app.project.activeStructure) mdi.activate(id); app.exportStructureFile(fmt).catch((err) => toast(err.message, { type: 'error' })); };
    const writers = canDownload() ? formats.writers().map((f) => ({ label: f.name ?? f.id, icon: 'file', hint: `.${f.extensions?.[0] ?? f.id}`, disabled: (f.id === 'poscar' || f.id === 'cif') && !e.structure.cell, run: exportTo(f.id) })) : [];
    showMenu(at, [
      { header: e.name },
      { label: open ? 'Activate Window' : 'Open', icon: 'windows', kbd: 'Enter', run: () => this.open(id) },
      open ? { label: 'Close Window', icon: 'x', run: () => mdi.close(id) } : null,
      { separator: true },
      { label: 'Rename', icon: 'edit', kbd: 'F2', run: () => this.rename(id) },
      { label: 'Duplicate', icon: 'copy', run: () => this.duplicate(id) },
      { label: 'Delete', icon: 'trash', kbd: 'Del', run: () => this.remove(id) },
      writers.length ? { separator: true } : null,
      writers.length ? { label: 'Export', icon: 'download', items: writers } : null,
      { separator: true },
      { label: 'Properties', icon: 'props', run: () => { this.select(id); this.bench.focusProperties(); } },
    ], { label: e.name });
  }
}
