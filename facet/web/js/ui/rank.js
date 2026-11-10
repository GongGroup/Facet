/**
 * Command palette ranking and category order (no DOM: tested in node). ui/shell.js re-exports rankCommands.
 *
 * rankCommands(list, query) → [{cmd, alias}], best first. A command scores by its title: 1000 when the title starts
 * with the query, 900 when one of its words does (the rest of the title from that word on), 800 when the title
 * contains it, 700 when every query word starts a title word, 600 when every query word starts a title or
 * category word, 400 when every query word (of three letters or more) starts a title, category or keyword word.
 * Its aliases (the Materials Studio names) score by the first three rules, 5 points below the title: 995, 895, 795.
 * The better of the two counts, and `alias` is the alias that matched when an alias scored higher than the title
 * (the palette shows it after the title), else null. Ties go to the shorter matched text, then to the list order.
 * When nothing matches as words, letters of the query in order within the category and title still match (score
 * 1–100, fewer gaps first; never aliases or keywords). An empty query keeps the list as it is.
 */

/** Palette and shortcut-dialog groups in this order; other categories follow alphabetically. */
export const CATEGORY_ORDER = Object.freeze(['File', 'Edit', 'Cell', 'Surface', 'View', 'Tools', 'Window', 'Export', 'Look', 'Representation', 'Lighting', 'Colours', 'Effects', 'Sample', 'Trajectory', 'Help']);
/** How many points an alias match scores below the same kind of title match. */
export const ALIAS_PENALTY = 5;

/** The rank of a category: its place in CATEGORY_ORDER, 100 for others. */
export const categoryRank = (c) => { const i = CATEGORY_ORDER.indexOf(c); return i < 0 ? 100 : i; };
/** Sort categories by CATEGORY_ORDER, the others alphabetically after them. */
export const byCategory = (a, b) => categoryRank(a) - categoryRank(b) || String(a).localeCompare(String(b));

/** A command's aliases as a list of names (a single name is allowed). */
export const aliasesOf = (c) => (c?.aliases == null ? [] : [].concat(c.aliases)).filter((a) => typeof a === 'string' && a.trim());

const split = (s) => String(s ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const prefixes = (ws, pool) => ws.every((w) => pool.some((t) => t.startsWith(w)));

/** The score of `text` by the first three title rules (starts with, a word starts with, contains), or 0. */
function phraseScore(text, q) {
  const t = text.toLowerCase(), tw = split(text);
  if (t.startsWith(q)) return 1000;
  if (tw.some((_, i) => tw.slice(i).join(' ').startsWith(q))) return 900;
  if (t.includes(q)) return 800;
  return 0;
}

/** Palette ranking: title prefix/substring, then all words as word prefixes, aliases too; subsequence only as a last resort. */
export function rankCommands(list, query) {
  const q = String(query ?? '').toLowerCase().trim();
  if (!q) return list.map((cmd) => ({ cmd, alias: null }));
  const words = q.split(/\s+/);
  const scored = [];
  list.forEach((c, order) => {
    const title = String(c.title ?? c.id ?? ''), tw = split(title), cw = split(c.category), kw = split(c.keywords);
    let s = phraseScore(title, q);
    if (!s) {
      if (prefixes(words, tw)) s = 700;
      else if (prefixes(words, [...tw, ...cw])) s = 600;
      else if (words.every((w) => w.length >= 3) && prefixes(words, [...tw, ...cw, ...kw])) s = 400;
    }
    let alias = null, length = title.length;
    for (const a of aliasesOf(c)) {
      const as = phraseScore(a, q);
      if (as && as - ALIAS_PENALTY > s) { s = as - ALIAS_PENALTY; alias = a; length = a.length; }
    }
    if (s) scored.push([s, length, order, c, alias]);
  });
  if (!scored.length) {
    // nothing matched as words: fall back to letters in order within the category and title (never keywords)
    list.forEach((c, order) => {
      const title = String(c.title ?? c.id ?? '');
      const t = `${c.category ?? ''} ${title}`.toLowerCase();
      let i = 0, gaps = 0;
      for (const ch of q.replace(/\s+/g, '')) { const j = t.indexOf(ch, i); if (j < 0) { i = -1; break; } gaps += j - i; i = j + 1; }
      if (i >= 0) scored.push([100 - Math.min(99, gaps), title.length, order, c, null]);
    });
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]).map((x) => ({ cmd: x[3], alias: x[4] }));
}
