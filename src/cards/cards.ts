import type { CardDef } from '../engine/types';

// Original, MTG-inspired card definitions. Single mana resource for MVP
// (lands tap for one generic mana; colors come later).

export const CARDS: Record<string, CardDef> = {
  // --- Land ---
  aether_well: {
    id: 'aether_well',
    name: 'Aether Well',
    type: 'land',
    cost: 0,
    text: 'Tap: add one mana.',
    flavor: 'It hums with borrowed light.',
  },

  // --- Creatures ---
  ember_sprite: {
    id: 'ember_sprite',
    name: 'Ember Sprite',
    type: 'creature',
    cost: 1,
    power: 1,
    toughness: 1,
    keywords: ['haste'],
    text: 'Haste.',
  },
  swift_lancer: {
    id: 'swift_lancer',
    name: 'Swift Lancer',
    type: 'creature',
    cost: 2,
    power: 2,
    toughness: 1,
    keywords: ['haste'],
    text: 'Haste.',
  },
  stoneback_cub: {
    id: 'stoneback_cub',
    name: 'Stoneback Cub',
    type: 'creature',
    cost: 2,
    power: 2,
    toughness: 2,
  },
  sky_talon: {
    id: 'sky_talon',
    name: 'Sky Talon',
    type: 'creature',
    cost: 3,
    power: 2,
    toughness: 2,
    keywords: ['flying'],
    text: 'Flying.',
  },
  thornwood_brute: {
    id: 'thornwood_brute',
    name: 'Thornwood Brute',
    type: 'creature',
    cost: 3,
    power: 3,
    toughness: 3,
  },
  granite_sentinel: {
    id: 'granite_sentinel',
    name: 'Granite Sentinel',
    type: 'creature',
    cost: 4,
    power: 3,
    toughness: 5,
  },
  storm_drake: {
    id: 'storm_drake',
    name: 'Storm Drake',
    type: 'creature',
    cost: 5,
    power: 4,
    toughness: 4,
    keywords: ['flying'],
    text: 'Flying.',
  },
  dread_maw: {
    id: 'dread_maw',
    name: 'Dread Maw',
    type: 'creature',
    cost: 5,
    power: 5,
    toughness: 4,
  },

  // --- Sorceries ---
  cinderbolt: {
    id: 'cinderbolt',
    name: 'Cinderbolt',
    type: 'sorcery',
    cost: 1,
    effect: { type: 'damage', amount: 3, targets: 'any' },
    text: 'Deal 3 damage to any target.',
  },
  scorch: {
    id: 'scorch',
    name: 'Scorch',
    type: 'sorcery',
    cost: 3,
    effect: { type: 'damage', amount: 5, targets: 'any' },
    text: 'Deal 5 damage to any target.',
  },
  insight: {
    id: 'insight',
    name: 'Insight',
    type: 'sorcery',
    cost: 2,
    effect: { type: 'draw', amount: 2 },
    text: 'Draw two cards.',
  },
  wild_growth: {
    id: 'wild_growth',
    name: 'Wild Growth',
    type: 'sorcery',
    cost: 1,
    effect: { type: 'buff', power: 2, toughness: 2, targets: 'creature' },
    text: 'Target creature gets +2/+2.',
  },
};

// Auto-wire art to /public/cards/<id>.svg. A missing file falls back to the
// plain text frame (CardView hides broken images). Set `art` on a card above to
// point somewhere else (e.g. a PNG).
for (const id of Object.keys(CARDS)) {
  if (!CARDS[id].art) CARDS[id].art = `/cards/${id}.svg`;
}

export function getDef(id: string): CardDef {
  const def = CARDS[id];
  if (!def) throw new Error(`Unknown card def: ${id}`);
  return def;
}
