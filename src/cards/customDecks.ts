import { CARDS, getDef } from './cards';
import { DECK_LIST, type DeckMeta } from './decks';

// Player-built decks. Cards are already fully data-driven, so a deck is just a
// list of CardDef ids — the engine needs no changes to play one.
//
// Custom decks are deliberately LOCAL ONLY (vs AI and hotseat). The PvP
// handshake exchanges deck *ids* and each client resolves them from its own
// copy of the catalog, so a custom id the peer has never heard of would have
// them build a different deck from the same seed — a guaranteed desync. Sending
// the card list over the wire would fix it, but that is a protocol change that
// also widens the peer-trust surface, so it is left as a separate piece of work.

/**
 * Cards that exist only because an effect makes them (Wolf, Zombie). They have
 * no cost and no way into a hand, so they must never be deckable. Derived from
 * the `token` effects themselves rather than a hand-kept list, so a new token
 * card is excluded the moment it is referenced.
 */
export const TOKEN_IDS: ReadonlySet<string> = new Set(
  Object.values(CARDS)
    .map((d) => (d.effect?.type === 'token' ? d.effect.token : null))
    .filter((id): id is string => !!id),
);

/** Every card a player may actually put in a deck. */
export function deckableCards() {
  return Object.values(CARDS).filter((d) => !TOKEN_IDS.has(d.id));
}

export const DECK_SIZE = 30;
/** Matches the densest starter (Skyward runs 6 Stoneback Cub), so the builder can express any of them. */
export const MAX_COPIES = 6;
const KEY = 'custom-decks';
const PREFIX = 'custom:';

export interface CustomDeck {
  id: string; // always PREFIX + something
  name: string;
  cards: string[];
}

export function isCustomId(id: string): boolean {
  return id.startsWith(PREFIX);
}

/**
 * Everything wrong with a deck, in the order a player would want to fix it.
 * Empty means it is legal. Pure — no storage, no DOM — so it is unit-tested.
 */
export function validateDeck(name: string, cards: string[]): string[] {
  const issues: string[] = [];

  if (!name.trim()) issues.push('Give the deck a name.');

  const unknown = [...new Set(cards.filter((id) => !CARDS[id]))];
  if (unknown.length) issues.push(`Unknown card: ${unknown.join(', ')}.`);

  const tokens = [...new Set(cards.filter((id) => TOKEN_IDS.has(id)))];
  if (tokens.length) {
    issues.push(`Tokens cannot be in a deck: ${tokens.map((id) => CARDS[id].name).join(', ')}.`);
  }

  if (cards.length !== DECK_SIZE) {
    const diff = DECK_SIZE - cards.length;
    issues.push(
      diff > 0
        ? `Add ${diff} more card${diff === 1 ? '' : 's'} (${cards.length}/${DECK_SIZE}).`
        : `Remove ${-diff} card${diff === -1 ? '' : 's'} (${cards.length}/${DECK_SIZE}).`,
    );
  }

  const counts = new Map<string, number>();
  for (const id of cards) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, n] of counts) {
    const def = CARDS[id];
    // Lands are the mana base; capping them would make real decks unbuildable.
    if (!def || def.type === 'land') continue;
    if (n > MAX_COPIES) issues.push(`Too many ${def.name} (${n}/${MAX_COPIES}).`);
  }

  const lands = cards.filter((id) => CARDS[id]?.type === 'land').length;
  if (lands === 0) issues.push('A deck with no lands can never cast anything.');

  return issues;
}

/** The card that best represents a deck: its most-played non-land. */
export function emblemFor(cards: string[]): string {
  const counts = new Map<string, number>();
  for (const id of cards) {
    if (CARDS[id] && CARDS[id].type !== 'land') counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let best = '';
  let bestN = 0;
  for (const [id, n] of counts) {
    // Ties break toward the costlier card — decks are remembered by their payoff.
    if (n > bestN || (n === bestN && best && getDef(id).cost > getDef(best).cost)) {
      best = id;
      bestN = n;
    }
  }
  return best || cards[0] || 'aether_well';
}

/** Present a custom deck the same way DeckSelect shows a starter. */
export function customMeta(d: CustomDeck): DeckMeta {
  const lands = d.cards.filter((id) => CARDS[id]?.type === 'land').length;
  const creatures = d.cards.filter((id) => CARDS[id]?.type === 'creature').length;
  return {
    id: d.id,
    name: d.name,
    style: 'Custom · Your build',
    desc: `${d.cards.length} cards — ${lands} lands, ${creatures} creatures, ${d.cards.length - lands - creatures} spells.`,
    emblem: emblemFor(d.cards),
    cards: d.cards,
  };
}

// ---- storage (localStorage can throw: private mode, disabled cookies) ----

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadCustomDecks(): CustomDeck[] {
  try {
    const raw = store()?.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as CustomDeck[];
    if (!Array.isArray(list)) return [];
    // Drop anything corrupt rather than letting it reach the engine.
    return list.filter(
      (d) => d && typeof d.id === 'string' && typeof d.name === 'string' && Array.isArray(d.cards),
    );
  } catch {
    return [];
  }
}

function writeAll(list: CustomDeck[]): void {
  try {
    store()?.setItem(KEY, JSON.stringify(list));
  } catch {
    /* quota or unavailable */
  }
}

export function newCustomId(): string {
  return `${PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Insert or replace by id. */
export function saveCustomDeck(deck: CustomDeck): void {
  const list = loadCustomDecks();
  const at = list.findIndex((d) => d.id === deck.id);
  if (at === -1) list.push(deck);
  else list[at] = deck;
  writeAll(list);
}

export function deleteCustomDeck(id: string): void {
  writeAll(loadCustomDecks().filter((d) => d.id !== id));
}

/**
 * Resolve any deck id — custom first, then the built-ins. Use this anywhere a
 * player-chosen deck is turned into cards; `deckById` alone only knows starters
 * and silently falls back to Emberwood for an id it does not recognise.
 */
export function resolveDeck(id: string): DeckMeta {
  if (isCustomId(id)) {
    const found = loadCustomDecks().find((d) => d.id === id);
    if (found) return customMeta(found);
  }
  return DECK_LIST.find((d) => d.id === id) ?? DECK_LIST[0];
}
