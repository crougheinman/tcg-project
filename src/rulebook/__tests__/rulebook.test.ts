import { describe, expect, it } from 'vitest';
import { CARDS } from '../../cards/cards';
import { KEYWORD_INFO } from '../../cards/keywords';
import type { Effect, Keyword } from '../../engine/types';
import { CHAPTERS, HELP_PAGES, PAGES, chapterById, pageById, pagesOf, type FigureId } from '../content';
import { blockText, markRuns, pageText, queryTerms, searchPages, stepIndex } from '../search';

const ALL_TEXT = PAGES.map(pageText).join(' \n ').toLowerCase();

describe('field manual: structure', () => {
  it('has unique page ids and every page belongs to a known chapter', () => {
    const ids = PAGES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PAGES) expect(CHAPTERS.map((c) => c.id)).toContain(p.chapter);
  });

  it('gives every chapter at least one page, and keeps a chapter’s pages together in tab order', () => {
    for (const c of CHAPTERS) expect(pagesOf(c.id).length).toBeGreaterThan(0);
    // Prev / next walks PAGES in order, so a chapter's pages must be contiguous and the chapters in tab order.
    const seen = PAGES.map((p) => p.chapter).filter((c, i, a) => i === 0 || a[i - 1] !== c);
    expect(seen).toEqual(CHAPTERS.map((c) => c.id));
  });

  it('has a title and some text on every page', () => {
    for (const p of PAGES) {
      expect(p.title.trim().length).toBeGreaterThan(2);
      expect(p.blocks.length).toBeGreaterThan(0);
      expect(p.blocks.map(blockText).join('').trim().length).toBeGreaterThan(20);
    }
  });

  it('looks pages and chapters up by id', () => {
    expect(pageById('ninjutsu')?.title).toBe('Ninjutsu');
    expect(pageById('nope')).toBeUndefined();
    expect(chapterById('combat').tab).toBe('Combat');
  });
});

describe('field manual: figures and help links', () => {
  it('uses every figure id, each at least once, and writes a caption for each', () => {
    const used: FigureId[] = [];
    for (const p of PAGES) for (const b of p.blocks) if (b.kind === 'figure') { used.push(b.id); expect(b.caption.length).toBeGreaterThan(10); }
    expect(new Set(used)).toEqual(new Set<FigureId>(['turn', 'block', 'damage', 'twostep', 'blitz', 'equip', 'ninjutsu', 'board']));
  });

  it('finds figure captions in search', () => {
    expect(searchPages(PAGES, 'thumbnail')).toEqual([]);
    expect(searchPages(PAGES, 'Katana').map((h) => h.page.id)).toContain('equipment');
  });

  it('points every "?" link on the board at a real page', () => {
    for (const id of HELP_PAGES) expect(pageById(id), `help page ${id}`).toBeTruthy();
  });
});

describe('field manual: coverage (it fails when a rule has no page)', () => {
  it('documents every keyword exactly once, from KEYWORD_INFO', () => {
    const placed: Keyword[] = [];
    for (const p of PAGES) for (const b of p.blocks) if (b.kind === 'keywords') placed.push(...b.keys);
    const all = Object.keys(KEYWORD_INFO) as Keyword[];
    expect([...placed].sort()).toEqual([...all].sort());
  });

  // Card fields that are a mechanic in their own right -> a word the manual must use for it.
  const FIELD_TERMS: Record<string, string> = {
    cycling: 'cycling',
    unearth: 'unearth',
    ninjutsu: 'ninjutsu',
    equip: 'equip',
    kicker: 'kicker',
    modes: 'modal',
    ward: 'ward',
    activated: 'activated',
    static: 'static',
    landTrigger: 'landfall',
    onAttack: 'attack trigger',
    onDeath: 'dies',
    onEnter: 'enters play',
    spellTrigger: 'spell trigger',
    flashback: 'flashback',
    x: 'x spell',
  };
  // Engine-ready mechanics that no card prints yet (X spells) are documented too, so a card can arrive without a manual change.
  it.each(Object.entries(FIELD_TERMS))('explains the card field "%s" (%s)', (_field, term) => {
    expect(ALL_TEXT).toContain(term);
  });

  it('explains morbid and the second-spell bonus', () => {
    expect(Object.values(CARDS).some((c) => c.bonus?.when === 'morbid')).toBe(true);
    expect(Object.values(CARDS).some((c) => c.bonus?.when === 'secondSpell')).toBe(true);
    expect(ALL_TEXT).toContain('morbid');
    expect(ALL_TEXT).toContain('second-spell');
  });

  // Every effect type: the term that names it, or null when the card's own text already says it all (damage, draw...).
  // A Record, so adding an Effect type fails the build until it is decided here.
  const EFFECT_TERMS: Record<Effect['type'], string | null> = {
    damage: null,
    draw: null,
    buff: null,
    heal: null,
    ramp: null,
    token: null,
    tapAll: null,
    destroy: null,
    discard: 'rot',
    recall: 'grave call',
    rally: 'rally',
    bounce: 'bounce',
    mana: 'floating mana',
    scry: 'scry',
    loot: 'loot',
    bite: 'bite',
    edict: 'edict',
  };
  it.each(Object.entries(EFFECT_TERMS).filter(([, t]) => t))('explains the "%s" effect (%s)', (_type, term) => {
    expect(ALL_TEXT).toContain(term as string);
  });
});

describe('field manual: search', () => {
  const top = (q: string) => searchPages(PAGES, q)[0]?.page.id;

  it('finds a page by a word in its title', () => {
    expect(top('ninjutsu')).toBe('ninjutsu');
    expect(top('mulligan')).toBe('opening-hand');
    expect(top('cycling')).toBe('cycling');
  });

  it('ranks the page that is ABOUT a phrase above pages that only mention it', () => {
    expect(top('first strike')).toBe('two-step');
    expect(top('equipment')).toBe('equipment');
  });

  it('needs every term to be on the page', () => {
    expect(searchPages(PAGES, 'ninjutsu zzzzqq')).toEqual([]);
    expect(searchPages(PAGES, 'ninjutsu unblocked').map((h) => h.page.id)).toContain('ninjutsu');
  });

  it('matches word starts only, and is case-insensitive', () => {
    expect(searchPages(PAGES, 'NINJ').map((h) => h.page.id)).toContain('ninjutsu');
    // the middle or end of a word is not a match: "unblocked" is on the ninjutsu page, "nblocked" is not a word start anywhere
    expect(searchPages(PAGES, 'unblocked').map((h) => h.page.id)).toContain('ninjutsu');
    expect(searchPages(PAGES, 'nblocked')).toEqual([]);
    // "ward" begins a word on the cast-options page, but must not match inside a word like "toward" / "reward".
    expect(markRuns('toward the ward', ['ward']).filter((r) => r.hit).map((r) => r.text)).toEqual(['ward']);
  });

  it('knows a few common synonyms', () => {
    expect(searchPages(PAGES, 'mull').map((h) => h.page.id)).toContain('opening-hand');
    expect(searchPages(PAGES, 'hp').length).toBeGreaterThan(0);
  });

  it('returns nothing for an empty or one-letter query', () => {
    expect(searchPages(PAGES, '')).toEqual([]);
    expect(searchPages(PAGES, '  ')).toEqual([]);
    expect(searchPages(PAGES, 'a')).toEqual([]);
    expect(queryTerms('First, Strike!')).toEqual(['first', 'strike']);
  });

  it('shows the matched word inside its snippet', () => {
    const hit = searchPages(PAGES, 'trample')[0];
    expect(hit.snippet.match.toLowerCase()).toBe('trample');
    expect((hit.snippet.before + hit.snippet.match + hit.snippet.after).length).toBeGreaterThan(10);
  });

  it('builds the snippet from the page text, and from its start when only the title or tags matched', () => {
    const body = searchPages(PAGES, 'unblocked')[0].snippet;
    expect(body.match.toLowerCase()).toBe('unblocked');
    // "ninja" is in the body but "kunoichi" only in the tags of the page about Ninjutsu: still a readable snippet, not a tag list
    const tagOnly = searchPages(PAGES, 'swap').find((h) => h.page.id === 'ninjutsu');
    expect(tagOnly).toBeTruthy();
    expect(tagOnly!.snippet.before + tagOnly!.snippet.match + tagOnly!.snippet.after).not.toContain(' · ninja · ');
  });

  it('finds keyword rules that live only in KEYWORD_INFO', () => {
    expect(searchPages(PAGES, 'surprise blocker').map((h) => h.page.id)).toContain('kw-speed');
  });
});

describe('field manual: highlighting and paging', () => {
  it('splits text into runs that join back to the original', () => {
    const text = 'Flying creatures can be blocked by flyers or Reach.';
    const runs = markRuns(text, ['fly', 'reach']);
    expect(runs.map((r) => r.text).join('')).toBe(text);
    expect(runs.filter((r) => r.hit).map((r) => r.text)).toEqual(['Flying', 'flyers', 'Reach']);
    expect(markRuns(text, [])).toEqual([{ text, hit: false }]);
  });

  it('stops at the first and last page', () => {
    expect(stepIndex(5, 0, -1)).toBe(0);
    expect(stepIndex(5, 4, 1)).toBe(4);
    expect(stepIndex(5, 2, 1)).toBe(3);
    expect(stepIndex(5, 2, -1)).toBe(1);
  });
});
