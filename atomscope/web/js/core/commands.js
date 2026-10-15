/** Command registry used by the command palette, keyboard shortcuts and plugins. */
const registry = new Map();
export const commands = {
  /** {id, title, category, kbd, keywords, run(app), when?(app)} */
  register(c) { registry.set(c.id, c); return () => registry.delete(c.id); },
  get: (id) => registry.get(id),
  list: () => [...registry.values()],
  run(id, ...args) { const c = registry.get(id); if (!c) throw new Error(`Unknown command ${id}`); return c.run(...args); },
};
