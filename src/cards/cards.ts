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
    flavor:
      'Born from the first sparks of a campfire, these mischievous sprites love a quick race before they fizzle out.',
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
    flavor: 'First to the charge, and gone before the dust settles.',
  },
  stoneback_cub: {
    id: 'stoneback_cub',
    name: 'Stoneback Cub',
    type: 'creature',
    cost: 2,
    power: 2,
    toughness: 2,
    flavor: 'Its hide remembers every mountain it has slept against.',
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
    flavor: 'It hunts the wind itself.',
  },
  thornwood_brute: {
    id: 'thornwood_brute',
    name: 'Thornwood Brute',
    type: 'creature',
    cost: 3,
    power: 3,
    toughness: 3,
    text: 'Whipflash — when it enters, deal 1 damage to a creature.',
    flavor: 'The forest walks when the forest is angry.',
  },
  granite_sentinel: {
    id: 'granite_sentinel',
    name: 'Granite Sentinel',
    type: 'creature',
    cost: 4,
    power: 3,
    toughness: 5,
    flavor: 'Patient as the mountain, immovable as its roots.',
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
    flavor: 'Thunder is merely the sound of its wings.',
  },
  dread_maw: {
    id: 'dread_maw',
    name: 'Dread Maw',
    type: 'creature',
    cost: 5,
    power: 5,
    toughness: 4,
    flavor: 'It does not hunt. It simply arrives, and the hunting is done.',
  },

  kunoichi: {
    id: 'kunoichi',
    name: 'Kunoichi',
    type: 'creature',
    cost: 2,
    power: 2,
    toughness: 1,
    text: 'Beast Blitz — your Swift Lancer, Sky Talon, and Stoneback Cub get +1/+1.',
    flavor: 'One whistle, and the wild answers.',
  },

  pyre_adept: {
    id: 'pyre_adept',
    name: 'Pyre Adept',
    type: 'creature',
    cost: 2,
    power: 1,
    toughness: 2,
    spellTrigger: { type: 'damage', amount: 1, targets: 'player' },
    text: 'Whenever you cast a sorcery, deal 1 damage to your opponent.',
    flavor: 'Every spell feeds the fire within.',
  },
  ancient_treant: {
    id: 'ancient_treant',
    name: 'Ancient Treant',
    type: 'creature',
    cost: 6,
    power: 7,
    toughness: 7,
    flavor: 'Older than the kingdoms that fear it.',
  },
  bulwark: {
    id: 'bulwark',
    name: 'Bulwark',
    type: 'creature',
    cost: 3,
    power: 1,
    toughness: 6,
    keywords: ['defender'],
    text: 'Defender (cannot attack).',
    flavor: 'The line holds here.',
  },
  wolf_token: {
    id: 'wolf_token',
    name: 'Wolf',
    type: 'creature',
    cost: 0,
    power: 1,
    toughness: 1,
    text: 'Token.',
    flavor: 'The pack answers the call.',
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
  pyroblast: {
    id: 'pyroblast',
    name: 'Pyroblast',
    type: 'sorcery',
    cost: 4,
    effect: { type: 'damage', amount: 6, targets: 'any' },
    text: 'Deal 6 damage to any target.',
    flavor: 'The sky itself catches fire.',
  },
  call_wolves: {
    id: 'call_wolves',
    name: 'Call Wolves',
    type: 'sorcery',
    cost: 2,
    effect: { type: 'token', token: 'wolf_token', count: 2 },
    text: 'Create two 1/1 Wolves.',
    flavor: 'One howl, and the wild comes running.',
  },
  overgrowth: {
    id: 'overgrowth',
    name: 'Overgrowth',
    type: 'sorcery',
    cost: 2,
    effect: { type: 'ramp', amount: 2 },
    text: 'Put up to two lands from your hand onto the battlefield.',
    flavor: 'The forest rushes to meet you.',
  },
  soothe: {
    id: 'soothe',
    name: 'Soothe',
    type: 'sorcery',
    cost: 2,
    effect: { type: 'heal', amount: 6 },
    text: 'Gain 6 life.',
    flavor: 'Rest now. The walls will hold.',
  },
  topple: {
    id: 'topple',
    name: 'Topple',
    type: 'sorcery',
    cost: 2,
    effect: { type: 'tapAll', maxToughness: 2 },
    text: "Tap all opponent creatures with toughness 2 or less.",
    flavor: 'The small ones never see the ground rise to meet them.',
  },
  take_counter: {
    id: 'take_counter',
    name: 'Take Counter',
    type: 'sorcery',
    cost: 2,
    effect: { type: 'destroy', targets: 'creature' },
    text: 'Destroy target tapped creature.',
    flavor: 'Strike when its guard is down.',
  },
};

// Auto-wire art to /public/cards/<id>.png. CardView falls back to <id>.svg if the
// PNG is missing, then to the plain text frame. Drop a PNG in to use it — no code
// change needed. Set `art` on a card above to override entirely.
for (const id of Object.keys(CARDS)) {
  if (!CARDS[id].art) CARDS[id].art = `/cards/${id}.png`;
}

export function getDef(id: string): CardDef {
  const def = CARDS[id];
  if (!def) throw new Error(`Unknown card def: ${id}`);
  return def;
}
