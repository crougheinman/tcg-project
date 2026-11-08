import { describe, expect, it } from 'vitest';
import { DECK_SIZE, MAX_COPIES, TOKEN_IDS, deckableCards, emblemFor, isCustomId, newCustomId, validateDeck } from '../customDecks';
import { DECK_LIST } from '../decks';
import { CARDS } from '../cards';

const pad = (id: string, n: number) => Array.from({ length: n }, () => id);
/** A legal baseline: 12 lands + 18 bodies, no copy over the limit. */
const legal = () => [...pad('aether_well', 12), ...pad('stoneback_cub', 6), ...pad('ashigaru', 6), ...pad('ronin_blade', 6)];

describe('deck validation', () => {
  it('accepts a legal deck', () => {
    expect(validateDeck('Mine', legal())).toEqual([]);
  });

  it('EVERY starter deck is expressible in the builder', () => {
    // The whole point of the copy limit being 6: if a starter could not be built
    // by hand, the rules the builder enforces would not be the game's rules.
    for (const d of DECK_LIST) {
      expect(validateDeck(d.name, d.cards), `starter ${d.id}`).toEqual([]);
    }
  });

  it('requires a name', () => {
    expect(validateDeck('   ', legal())).toContain('Give the deck a name.');
  });

  it('counts up and down to exactly the deck size', () => {
    expect(validateDeck('Mine', legal().slice(0, 28)).join()).toMatch(/Add 2 more cards \(28\/30\)/);
    expect(validateDeck('Mine', [...legal(), 'ashigaru']).join()).toMatch(/Remove 1 card \(31\/30\)/);
    expect(DECK_SIZE).toBe(30);
  });

  it('caps non-land copies but never lands', () => {
    const tooMany = [...pad('aether_well', 12), ...pad('ashigaru', MAX_COPIES + 1), ...pad('ronin_blade', 11)];
    expect(validateDeck('Mine', tooMany).join()).toMatch(/Too many/);

    // 30 lands is legal (useless, but the mana base is never capped).
    expect(validateDeck('Mine', pad('aether_well', 30))).toEqual([]);
  });

  it('rejects a deck that can never cast anything', () => {
    const landless = [...pad('ashigaru', 6), ...pad('ronin_blade', 6), ...pad('stoneback_cub', 6), ...pad('kensei_duelist', 6), ...pad('ember_sprite', 6)];
    expect(validateDeck('Mine', landless)).toContain('A deck with no lands can never cast anything.');
  });

  it('rejects unknown card ids rather than letting them reach the engine', () => {
    const bad = [...legal().slice(0, 29), 'not_a_card'];
    expect(validateDeck('Mine', bad).join()).toMatch(/Unknown card: not_a_card/);
  });
});

describe('deck presentation', () => {
  it('picks the most-played non-land as the emblem', () => {
    expect(emblemFor([...pad('aether_well', 20), ...pad('ashigaru', 6), ...pad('ronin_blade', 4)])).toBe('ashigaru');
  });

  it('breaks an emblem tie toward the costlier payoff', () => {
    const a = [...pad('aether_well', 10), ...pad('ember_sprite', 4), ...pad('dread_maw', 4)];
    expect(CARDS.dread_maw.cost).toBeGreaterThan(CARDS.ember_sprite.cost);
    expect(emblemFor(a)).toBe('dread_maw');
  });

  it('never returns empty, even for an all-land deck', () => {
    expect(emblemFor(pad('aether_well', 30))).toBeTruthy();
  });
});

describe('custom ids', () => {
  it('are recognisable and distinct from starter ids', () => {
    const id = newCustomId();
    expect(isCustomId(id)).toBe(true);
    for (const d of DECK_LIST) expect(isCustomId(d.id)).toBe(false);
  });

  it('do not collide', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newCustomId()));
    expect(ids.size).toBe(200);
  });
});

describe('tokens are not deckable', () => {
  it('derives the token set from the effects that create them', () => {
    // Not a hand-kept list: a new token card is excluded the moment some effect
    // references it.
    expect(TOKEN_IDS.has('wolf_token')).toBe(true);
    expect(TOKEN_IDS.has('zombie_token')).toBe(true);
    expect(TOKEN_IDS.has('ashigaru')).toBe(false);
  });

  it('keeps tokens out of the card pool the builder offers', () => {
    const ids = deckableCards().map((d) => d.id);
    for (const t of TOKEN_IDS) expect(ids).not.toContain(t);
    expect(ids).toContain('ashigaru'); // but real cards are still there
  });

  it('rejects a deck containing a token', () => {
    const withToken = [...pad('aether_well', 12), ...pad('ashigaru', 6), ...pad('ronin_blade', 6), ...pad('wolf_token', 6)];
    expect(validateDeck('Cheat', withToken).join()).toMatch(/Tokens cannot be in a deck: Wolf/);
  });

  it('no starter deck smuggles a token in', () => {
    for (const d of DECK_LIST) {
      for (const id of d.cards) expect(TOKEN_IDS.has(id), `${d.id} contains ${id}`).toBe(false);
    }
  });
});
