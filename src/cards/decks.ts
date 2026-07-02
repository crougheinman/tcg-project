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
  ...repeat('stoneback_cub', 6),
  ...repeat('sky_talon', 2),
  ...repeat('granite_sentinel', 3),
  ...repeat('storm_drake', 2),
  ...repeat('dread_maw', 1),
  ...repeat('cinderbolt', 2),
  ...repeat('insight', 1),
  ...repeat('scorch', 1),
]; // 30

export const DECK_PYROMANCER: string[] = [
  ...repeat('aether_well', 12),
  ...repeat('pyre_adept', 3),
  ...repeat('ember_sprite', 2),
  ...repeat('stoneback_cub', 4),
  ...repeat('cinderbolt', 3),
  ...repeat('scorch', 2),
  ...repeat('pyroblast', 1),
  ...repeat('insight', 1),
  ...repeat('dread_maw', 2),
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
  ...repeat('bulwark', 1),
  ...repeat('granite_sentinel', 3),
  ...repeat('soothe', 2),
  ...repeat('cinderbolt', 2),
  ...repeat('scorch', 2),
  ...repeat('insight', 1),
  ...repeat('storm_drake', 2),
  ...repeat('topple', 1),
  ...repeat('take_counter', 1),
  ...repeat('dread_maw', 2),
]; // 30

export const DECK_IRONBLOSSOM: string[] = [
  ...repeat('aether_well', 12),
  ...repeat('ashigaru', 4),
  ...repeat('ronin_blade', 4),
  ...repeat('kensei_duelist', 3),
  ...repeat('iron_shogun', 1),
  ...repeat('iaijutsu_strike', 2),
  ...repeat('warding_stance', 1),
  ...repeat('shuriken_volley', 2),
  ...repeat('insight', 1),
]; // 30

export const DECK_GRAVETIDE: string[] = [
  ...repeat('aether_well', 12),
  ...repeat('shambling_ghoul', 4),
  ...repeat('plague_priest', 2),
  ...repeat('grave_necromancer', 2),
  ...repeat('rotting_hulk', 2),
  ...repeat('carrion_colossus', 2),
  ...repeat('raise_horde', 1),
  ...repeat('withering_touch', 2),
  ...repeat('soul_siphon', 1),
  ...repeat('grasp_from_grave', 2),
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
  {
    id: 'ironblossom',
    name: 'Iron Blossom',
    style: 'Aggro · Bushido Tempo',
    desc: 'Swift, disciplined blades and instant combat tricks. Strike first, strike true, and end it before they draw steel.',
    emblem: 'kensei_duelist',
    cards: DECK_IRONBLOSSOM,
  },
  {
    id: 'gravetide',
    name: 'Grave Tide',
    style: 'Swarm · Undead & Drain',
    desc: 'Raise a horde of expendable dead, bleed them with each dark ritual, and drag their attackers into the grave.',
    emblem: 'grave_necromancer',
    cards: DECK_GRAVETIDE,
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
