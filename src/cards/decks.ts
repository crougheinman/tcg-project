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
  ...repeat('aether_well', 11),
  ...repeat('pyre_adept', 4),
  ...repeat('ember_sprite', 2),
  ...repeat('stoneback_cub', 4),
  ...repeat('cinderbolt', 3),
  ...repeat('scorch', 2),
  ...repeat('pyroblast', 1),
  ...repeat('insight', 1),
  ...repeat('dread_maw', 2),
]; // 30

export const DECK_WILDBLITZ: string[] = [
  ...repeat('aether_well', 10),
  ...repeat('ember_sprite', 3),
  ...repeat('swift_lancer', 5),
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
  ...repeat('granite_sentinel', 4),
  ...repeat('soothe', 2),
  ...repeat('cinderbolt', 2),
  ...repeat('scorch', 2),
  ...repeat('insight', 1),
  ...repeat('storm_drake', 1),
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
  ...repeat('shambling_ghoul', 5),
  ...repeat('plague_priest', 2),
  ...repeat('grave_necromancer', 2),
  ...repeat('rotting_hulk', 2),
  ...repeat('carrion_colossus', 2),
  ...repeat('raise_horde', 1),
  ...repeat('withering_touch', 2),
  ...repeat('soul_siphon', 1),
  ...repeat('grasp_from_grave', 1),
]; // 30

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
    desc:
      'Swift beasts and open flame. Spend everything early — there is no plan for turn eight.',
    emblem: 'ember_sprite',
    cards: DECK_EMBERWOOD,
  },
  {
    id: 'skyward',
    name: 'Skyward',
    style: 'Control · Flyers',
    desc:
      'Walls hold the ground so the sky can win it. Survive the early game, then never land.',
    emblem: 'storm_drake',
    cards: DECK_SKYWARD,
  },
  {
    id: 'pyromancer',
    name: 'Pyromancer',
    style: 'Spellslinger · Burn',
    desc:
      'Few creatures, endless fire. Every sorcery through a Pyre Adept costs them life directly.',
    emblem: 'pyre_adept',
    cards: DECK_PYROMANCER,
  },
  {
    id: 'wildblitz',
    name: 'Wildblitz',
    style: 'Swarm · Beast Tribal',
    desc:
      'Many small lives, freely given. Flood the board, then lift the whole pack with Beast Blitz.',
    emblem: 'kunoichi',
    cards: DECK_WILDBLITZ,
  },
  {
    id: 'wildwood',
    name: 'Wildwood Titans',
    style: 'Ramp · Big Stompy',
    desc:
      'The forest hands you mana it was never lent. Ramp early, then crash in with giants.',
    emblem: 'ancient_treant',
    cards: DECK_WILDWOOD,
  },
  {
    id: 'stonewall',
    name: 'Stonewall',
    style: 'Control · Defensive',
    desc:
      'Owe nothing, outlast everything. Walls, removal and lifegain, closing with a lone drake.',
    emblem: 'granite_sentinel',
    cards: DECK_STONEWALL,
  },
  {
    id: 'ironblossom',
    name: 'Iron Blossom',
    style: 'Aggro · Bushido Tempo',
    desc:
      'A debt is settled in one cut. Swift blades and instant tricks — strike first, strike once.',
    emblem: 'kensei_duelist',
    cards: DECK_IRONBLOSSOM,
  },
  {
    id: 'gravetide',
    name: 'Grave Tide',
    style: 'Swarm · Undead & Drain',
    desc:
      'The dead have already paid. Raise them again, bleed with each ritual, drag attackers down.',
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
