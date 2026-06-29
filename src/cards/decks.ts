// Starter decks: lists of CardDef ids. 30 cards each, ~12 lands.
// Both sides can use the same list for MVP; two flavors provided.

function repeat(id: string, n: number): string[] {
  return Array.from({ length: n }, () => id);
}

export const DECK_EMBERWOOD: string[] = [
  ...repeat('aether_well', 12),
  ...repeat('ember_sprite', 2),
  ...repeat('swift_lancer', 3),
  ...repeat('stoneback_cub', 3),
  ...repeat('kunoichi', 2),
  ...repeat('thornwood_brute', 1),
  ...repeat('dread_maw', 2),
  ...repeat('cinderbolt', 3),
  ...repeat('scorch', 1),
  ...repeat('wild_growth', 1),
]; // 30

export const DECK_SKYWARD: string[] = [
  ...repeat('aether_well', 12),
  ...repeat('stoneback_cub', 3),
  ...repeat('sky_talon', 3),
  ...repeat('granite_sentinel', 3),
  ...repeat('storm_drake', 2),
  ...repeat('dread_maw', 1),
  ...repeat('cinderbolt', 2),
  ...repeat('insight', 2),
  ...repeat('scorch', 2),
]; // 30

export const DECK_PYROMANCER: string[] = [
  ...repeat('aether_well', 13),
  ...repeat('pyre_adept', 3),
  ...repeat('ember_sprite', 2),
  ...repeat('stoneback_cub', 2),
  ...repeat('cinderbolt', 4),
  ...repeat('scorch', 2),
  ...repeat('pyroblast', 2),
  ...repeat('insight', 2),
]; // 30

export const DECK_WILDBLITZ: string[] = [
  ...repeat('aether_well', 12),
  ...repeat('ember_sprite', 3),
  ...repeat('swift_lancer', 3),
  ...repeat('stoneback_cub', 3),
  ...repeat('kunoichi', 3),
  ...repeat('call_wolves', 3),
  ...repeat('wild_growth', 2),
  ...repeat('cinderbolt', 1),
]; // 30

export const DECK_WILDWOOD: string[] = [
  ...repeat('aether_well', 14),
  ...repeat('overgrowth', 3),
  ...repeat('granite_sentinel', 3),
  ...repeat('storm_drake', 2),
  ...repeat('dread_maw', 3),
  ...repeat('ancient_treant', 2),
  ...repeat('wild_growth', 2),
  ...repeat('thornwood_brute', 1),
]; // 30

export const DECK_STONEWALL: string[] = [
  ...repeat('aether_well', 13),
  ...repeat('bulwark', 3),
  ...repeat('granite_sentinel', 3),
  ...repeat('soothe', 2),
  ...repeat('cinderbolt', 2),
  ...repeat('scorch', 1),
  ...repeat('insight', 1),
  ...repeat('storm_drake', 1),
  ...repeat('topple', 2),
  ...repeat('take_counter', 2),
]; // 30

export const STARTER_DECKS: Record<string, string[]> = {
  Emberwood: DECK_EMBERWOOD,
  Skyward: DECK_SKYWARD,
};

export interface DeckMeta {
  id: string;
  name: string;
  style: string;
  desc: string;
  emblem: string; // a card whose art represents the deck
  cards: string[];
}

export const DECK_LIST: DeckMeta[] = [
  {
    id: 'emberwood',
    name: 'Emberwood',
    style: 'Aggro · Beasts & Burn',
    desc: 'Swift creatures and direct damage. Pressure early, then burn them out before they stabilize.',
    emblem: 'ember_sprite',
    cards: DECK_EMBERWOOD,
  },
  {
    id: 'skyward',
    name: 'Skyward',
    style: 'Control · Flyers',
    desc: 'Evasive flyers and sturdy walls. Survive the early game, then rule the skies.',
    emblem: 'storm_drake',
    cards: DECK_SKYWARD,
  },
  {
    id: 'pyromancer',
    name: 'Pyromancer',
    style: 'Spellslinger · Burn',
    desc: 'Spell-heavy with few creatures. Pyre Adept punishes every sorcery — burn them out from the deck.',
    emblem: 'pyre_adept',
    cards: DECK_PYROMANCER,
  },
  {
    id: 'wildblitz',
    name: 'Wildblitz',
    style: 'Swarm · Beast Tribal',
    desc: 'Flood the board with beasts and Wolves, then overrun with Kunoichi’s Beast Blitz anthem.',
    emblem: 'kunoichi',
    cards: DECK_WILDBLITZ,
  },
  {
    id: 'wildwood',
    name: 'Wildwood Titans',
    style: 'Ramp · Big Stompy',
    desc: 'Overgrowth ramps you into giants early. Crash in with Treants, Drakes, and the Dread Maw.',
    emblem: 'ancient_treant',
    cards: DECK_WILDWOOD,
  },
  {
    id: 'stonewall',
    name: 'Stonewall',
    style: 'Control · Defensive',
    desc: 'Walls, removal, and lifegain. Outlast everything, then close with a lone Storm Drake.',
    emblem: 'granite_sentinel',
    cards: DECK_STONEWALL,
  },
];

export function deckById(id: string): DeckMeta {
  return DECK_LIST.find((d) => d.id === id) ?? DECK_LIST[0];
}
export function otherDeck(id: string): DeckMeta {
  return DECK_LIST.find((d) => d.id !== id) ?? DECK_LIST[0];
}
export function randomDeck(): DeckMeta {
  return DECK_LIST[Math.floor(Math.random() * DECK_LIST.length)];
}
