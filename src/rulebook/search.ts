import { KEYWORD_INFO } from '../cards/keywords';
import type { Block, Page } from './content';

// Search and paging for the Field Manual. Pure functions, so the ranking and the boundaries are unit-tested
// without a DOM. The UI only renders what these return.

/** Words players use for something the text spells differently. Each key also matches the listed words. */
const SYNONYMS: Record<string, string[]> = {
  kill: ['destroy', 'dies', 'death'],
  death: ['dies', 'destroyed'],
  die: ['dies'],
  hp: ['life'],
  heal: ['lifelink', 'gain'],
  fly: ['flying'],
  mull: ['mulligan'],
  draw: ['cycling', 'loot'],
  sac: ['sacrifice'],
};

/** Plain text of a block, keyword rules included, for indexing. */
export function blockText(b: Block): string {
  switch (b.kind) {
    case 'p':
      return b.text;
    case 'note':
      return `${b.title ?? ''} ${b.text}`;
    case 'list':
      return b.items.join(' ');
    case 'keywords':
      return b.keys.map((k) => `${KEYWORD_INFO[k].label} ${KEYWORD_INFO[k].rule}`).join(' ');
  }
}

/** Everything the page says, in one string (title, tags, body). */
export function pageText(p: Page): string {
  return [p.title, ...(p.tags ?? []), ...p.blocks.map(blockText)].join(' \n ');
}

/** Lower-case words of a query; anything shorter than 2 letters is noise. */
export function queryTerms(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9+/-]+/)
    .filter((t) => t.length >= 2);
}

const norm = (s: string) => s.toLowerCase();

/** Does `text` contain a word starting with `term` (or with one of its synonyms)? */
function wordStarts(text: string, term: string): number {
  const alts = [term, ...(SYNONYMS[term] ?? [])];
  let first = -1;
  for (const a of alts) {
    // A match must begin at a word boundary, so "ward" does not match "toward".
    const re = new RegExp(`(^|[^a-z0-9])${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
    const m = re.exec(text);
    if (m) {
      const at = m.index + m[1].length;
      if (first < 0 || at < first) first = at;
    }
  }
  return first;
}

export interface Snippet {
  before: string;
  match: string;
  after: string;
}

export interface SearchHit {
  page: Page;
  score: number;
  snippet: Snippet;
}

const SNIP = 54;

function snippetOf(text: string, terms: readonly string[]): Snippet {
  const flat = text.replace(/\s*\n\s*/g, ' · ');
  let at = -1;
  let term = '';
  for (const t of terms) {
    const i = wordStarts(norm(flat), t);
    if (i >= 0 && (at < 0 || i < at)) {
      at = i;
      term = t;
    }
  }
  // Nothing in the text itself (the page matched on its title or tags): show how the page begins instead.
  if (at < 0 || !term) return { before: '', match: '', after: flat.slice(0, SNIP * 2) + (flat.length > SNIP * 2 ? '\u2026' : '') };
  // The matched word, widened to the end of the word it starts.
  let end = at;
  while (end < flat.length && /[A-Za-z0-9]/.test(flat[end])) end++;
  const from = Math.max(0, at - SNIP);
  const to = Math.min(flat.length, end + SNIP);
  return {
    before: (from > 0 ? '\u2026' : '') + flat.slice(from, at),
    match: flat.slice(at, end),
    after: flat.slice(end, to) + (to < flat.length ? '\u2026' : ''),
  };
}

/**
 * Pages that contain EVERY term (as a word prefix; synonyms count). Ranked: a hit in the title counts most, then a tag,
 * then the body (a little more for each repeat); ties keep book order. An empty query finds nothing.
 */
export function searchPages(pages: readonly Page[], query: string): SearchHit[] {
  const terms = queryTerms(query);
  if (!terms.length) return [];
  const hits: SearchHit[] = [];
  pages.forEach((page, order) => {
    const body = norm(pageText(page));
    const title = norm(page.title);
    const tags = norm((page.tags ?? []).join(' \n '));
    let score = 0;
    for (const t of terms) {
      if (wordStarts(body, t) < 0) return; // every term must be somewhere on the page
      score += 1;
      if (wordStarts(title, t) >= 0) score += 10;
      if (wordStarts(tags, t) >= 0) score += 5;
    }
    hits.push({ page, score: score * 1000 - order, snippet: snippetOf(page.blocks.map(blockText).join(' \n '), terms) });
  });
  return hits.sort((a, b) => b.score - a.score);
}

/** Split `text` into plain and matched runs for `<mark>`; matches are word prefixes of any term (synonyms excluded, so only what was typed is lit). */
export function markRuns(text: string, terms: readonly string[]): { text: string; hit: boolean }[] {
  if (!terms.length) return [{ text, hit: false }];
  const alt = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`(^|[^A-Za-z0-9])((?:${alt})[A-Za-z0-9]*)`, 'gi');
  const runs: { text: string; hit: boolean }[] = [];
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const start = m.index + m[1].length;
    if (start > last) runs.push({ text: text.slice(last, start), hit: false });
    runs.push({ text: m[2], hit: true });
    last = start + m[2].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), hit: false });
  return runs.length ? runs : [{ text, hit: false }];
}

/** The page `dir` steps from `index`, or the same index at either end of the book (the buttons disable there). */
export function stepIndex(count: number, index: number, dir: 1 | -1): number {
  return Math.min(count - 1, Math.max(0, index + dir));
}
