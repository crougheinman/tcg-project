// A short fingerprint of the balance-relevant game data (every card's numbers and rules, every deck list), so rows
// recorded before and after a balance change are never mixed up. Text, flavour and art do not change how the game
// plays, so they are left out: fixing a typo must not start a new "balance era".

const IGNORED = new Set(['text', 'flavor', 'art', 'name', 'skill']);

function stable(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stable);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const k of Object.keys(v as object).sort()) if (!IGNORED.has(k)) o[k] = stable((v as Record<string, unknown>)[k]);
    return o;
  }
  return v;
}

/** FNV-1a (32 bit) of a string, as 8 hex digits. Not a security hash: a label for "same data". */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function contentHash(cards: Record<string, unknown>, decks: { id: string; cards: string[] }[]): string {
  const deckLists = decks.map((d) => ({ id: d.id, cards: d.cards }));
  return fnv1a(JSON.stringify(stable({ cards, decks: deckLists })));
}
