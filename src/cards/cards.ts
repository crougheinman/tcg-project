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
    art: '/cards/aether_well.webp', // 420x421 WebP; other cards auto-wire to <id>.png
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
    art: '/cards/ember_sprite.webp', // 420x418 WebP; other cards auto-wire to <id>.png
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
    keywords: ['haste', 'vigilance'],
    art: '/cards/swift_lancer.webp', // WebP; other cards auto-wire to <id>.png
    text: 'Haste. Vigilance.',
    flavor: 'First to the charge, and gone before the dust settles.',
  },
  stoneback_cub: {
    id: 'stoneback_cub',
    name: 'Stoneback Cub',
    type: 'creature',
    bonus: { when: 'morbid', effect: { type: 'draw', amount: 1 } },
    text: 'Morbid — when it enters, if a creature died this turn, draw a card.',
    cost: 2,
    power: 2,
    toughness: 2,
    art: '/cards/stoneback_cub.webp', // 420x404 WebP; other cards auto-wire to <id>.png
    flavor: 'Its hide remembers every mountain it has slept against.',
  },
  sky_talon: {
    id: 'sky_talon',
    name: 'Sky Talon',
    type: 'creature',
    cost: 3,
    power: 2,
    toughness: 1,
    keywords: ['flying', 'vigilance', 'exalted'],
    onEnter: { type: 'scry', amount: 1 },
    text: 'Flying. Vigilance. Exalted. When it enters, scry 1.',
    art: '/cards/sky_talon.webp', // 420x420 WebP; other cards auto-wire to <id>.png
    flavor: 'It hunts the wind itself.',
  },
  thornwood_brute: {
    id: 'thornwood_brute',
    name: 'Thornwood Brute',
    type: 'creature',
    cost: 3,
    power: 3,
    toughness: 3,
    skill: 'Whipflash',
    onEnter: { type: 'damage', amount: 1, targets: 'creature' },
    text: 'Whipflash — when it enters, deal 1 damage to a creature.',
    art: '/cards/thornwood_brute.webp', // 420x412 WebP; other cards auto-wire to <id>.png
    flavor: 'The forest walks when the forest is angry.',
  },
  granite_sentinel: {
    id: 'granite_sentinel',
    name: 'Granite Sentinel',
    type: 'creature',
    cost: 4,
    power: 3,
    toughness: 5,
    keywords: ['reach'],
    landTrigger: { type: 'heal', amount: 1 },
    text: 'Reach. Landfall — whenever a land enters under your control, gain 1 life.',
    art: '/cards/granite_sentinel.webp', // 420x418 WebP; other cards auto-wire to <id>.png
    flavor: 'Patient as the mountain, immovable as its roots.',
  },
  storm_drake: {
    id: 'storm_drake',
    name: 'Storm Drake',
    type: 'creature',
    cost: 5,
    power: 4,
    toughness: 4,
    keywords: ['flying', 'vigilance', 'hexproof'],
    onAttack: { type: 'heal', amount: 1 },
    text: 'Flying. Vigilance. Hexproof. Whenever it attacks, gain 1 life.',
    art: '/cards/storm_drake.webp', // 420x422 WebP; other cards auto-wire to <id>.png
    flavor: 'Thunder is merely the sound of its wings.',
  },
  dread_maw: {
    id: 'dread_maw',
    name: 'Dread Maw',
    type: 'creature',
    cost: 5,
    power: 5,
    toughness: 4,
    keywords: ['trample'],
    text: 'Trample.',
    art: '/cards/dread_maw.webp', // 480x279 WebP; other cards auto-wire to <id>.png
    flavor: 'It does not hunt. It simply arrives, and the hunting is done.',
  },

  kunoichi: {
    id: 'kunoichi',
    name: 'Kunoichi',
    type: 'creature',
    cost: 2,
    power: 2,
    toughness: 1,
    keywords: ['skulk'],
    ninjutsu: 1,
    skill: 'Beast Blitz',
    activated: { cost: { tap: true }, effect: { type: 'mana', amount: 1 } },
    static: {
      affects: { ids: ['swift_lancer', 'sky_talon', 'stoneback_cub', 'wolf_token', 'thornwood_brute', 'dread_maw'] },
      power: 1,
      toughness: 1,
      unique: true, // a second Kunoichi adds nothing
      mark: 'blitz',
    },
    art: '/cards/kunoichi.webp', // 420x564 WebP; other cards auto-wire to <id>.png
    text: 'Skulk. Ninjutsu {1}. {T}: Add one mana. Beast Blitz — your Swift Lancer, Sky Talon, Stoneback Cub, Thornwood Brute, Dread Maw, and Wolves get +1/+1.',
    flavor: 'One whistle, and the wild answers.',
  },

  pyre_adept: {
    id: 'pyre_adept',
    name: 'Pyre Adept',
    type: 'creature',
    art: '/cards/pyre_adept.webp', // 420x420 WebP; other cards auto-wire to <id>.png
    cost: 2,
    power: 1,
    toughness: 2,
    keywords: ['prowess'],
    ward: 1,
    spellTrigger: { type: 'damage', amount: 1, targets: 'player' },
    static: { affects: { self: true }, power: 1, toughness: 1, when: 'threshold' },
    text: 'Prowess. Ward {1}. Whenever you cast a sorcery, deal 1 damage to your opponent. Threshold — with 7 or more cards in your graveyard, it gets +1/+1.',
    flavor: 'Every spell feeds the fire within.',
  },
  ancient_treant: {
    id: 'ancient_treant',
    name: 'Ancient Treant',
    type: 'creature',
    cost: 6,
    power: 7,
    toughness: 7,
    keywords: ['trample', 'undying'],
    cycling: 2,
    text: 'Trample. Undying. Cycling 2 — pay 2, discard this card: draw a card.',
    art: '/cards/ancient_treant.webp', // 520x285 WebP; other cards auto-wire to <id>.png
    flavor: 'Older than the kingdoms that fear it.',
  },
  bulwark: {
    id: 'bulwark',
    name: 'Bulwark',
    type: 'creature',
    cost: 3,
    power: 1,
    toughness: 6,
    keywords: ['defender', 'reach', 'flash'],
    text: 'Flash. Defender (cannot attack). Reach.',
    art: '/cards/bulwark.webp', // 420x419 WebP; other cards auto-wire to <id>.png
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
    art: '/cards/wolf_token.webp', // 420x423 WebP; other cards auto-wire to <id>.png
    flavor: 'The pack answers the call.',
  },

  // --- Iron Blossom (Samurai) creatures ---
  ashigaru: {
    id: 'ashigaru',
    name: 'Ashigaru',
    type: 'creature',
    cost: 1,
    power: 1,
    toughness: 2,
    keywords: ['bushido'],
    text: 'Bushido.',
    art: '/cards/ashigaru.webp', // 420x418 WebP; other cards auto-wire to <id>.png
    flavor: 'A footman of the clan — spear steady, honor steadier.',
  },
  ronin_blade: {
    id: 'ronin_blade',
    name: 'Ronin Blade',
    type: 'creature',
    cost: 2,
    power: 2,
    toughness: 2,
    keywords: ['haste'],
    unearth: 2,
    text: 'Haste. Unearth {2}.',
    art: '/cards/ronin_blade.webp', // 420x415 WebP; other cards auto-wire to <id>.png
    flavor: 'A masterless sword, restless even in the fray.',
  },
  kensei_duelist: {
    id: 'kensei_duelist',
    name: 'Kensei Duelist',
    type: 'creature',
    cost: 3,
    power: 3,
    toughness: 2,
    keywords: ['haste', 'firstStrike'],
    ninjutsu: 2,
    text: 'Haste. First strike. Ninjutsu {2}.',
    art: '/cards/kensei_duelist.webp', // 420x422 WebP; other cards auto-wire to <id>.png
    flavor:
      "\"One breath, one cut. There is no second.\" Calm as still water and strict as the creed, Hana of the Single Breath has walked away from four duels she could have finished. All four still wish she hadn't.",
  },
  iron_shogun: {
    id: 'iron_shogun',
    name: 'Iron Shogun',
    type: 'creature',
    cost: 5,
    power: 5,
    toughness: 4,
    keywords: ['firstStrike', 'battleCry'],
    onEnter: { type: 'rally', power: 1, toughness: 0 },
    text: 'First strike. Battle cry. When it enters, your creatures get +1/+0 until end of turn. The charge is led from the front.',
    art: '/cards/iron_shogun.webp', // 420x419 WebP; other cards auto-wire to <id>.png
    flavor: 'Where his banner rides, the line follows.',
  },

  // --- Grave Tide (Zombie / Necromancer) creatures ---
  zombie_token: {
    id: 'zombie_token',
    name: 'Zombie',
    type: 'creature',
    cost: 0,
    power: 1,
    toughness: 1,
    text: 'Token.',
    art: '/cards/zombie_token.webp', // 420x418 WebP; other cards auto-wire to <id>.png
    flavor: 'It rises again, and again, and again.',
  },
  shambling_ghoul: {
    id: 'shambling_ghoul',
    name: 'Shambling Ghoul',
    type: 'creature',
    cost: 2,
    power: 2,
    toughness: 2,
    onEnter: { type: 'loot' },
    text: 'When it enters, draw a card, then discard a card.',
    art: '/cards/shambling_ghoul.webp', // 420x420 WebP; other cards auto-wire to <id>.png
    flavor: 'It shambles ever forward, and never tires.',
  },
  plague_priest: {
    id: 'plague_priest',
    name: 'Plague Priest',
    type: 'creature',
    cost: 2,
    power: 1,
    toughness: 2,
    spellTrigger: { type: 'damage', amount: 1, targets: 'player' },
    skill: 'Rot',
    onEnter: { type: 'discard', amount: 1 },
    text: 'Rot — when it enters, your opponent discards a card at random. Whenever you cast a sorcery, they lose 1 life.',
    art: '/cards/plague_priest.webp', // 420x423 WebP; other cards auto-wire to <id>.png
    flavor: 'Every incantation spreads the rot a little further.',
  },
  grave_necromancer: {
    id: 'grave_necromancer',
    name: 'Grave Necromancer',
    type: 'creature',
    art: '/cards/grave_necromancer.webp', // 420x417 WebP; other cards auto-wire to <id>.png
    cost: 3,
    power: 1,
    toughness: 3,
    spellTrigger: { type: 'token', token: 'zombie_token', count: 1 },
    spellTriggerInstant: true,
    skill: 'Grave Call',
    onEnter: { type: 'recall' },
    text: 'Grave Call — when it enters, return your most recently fallen creature to your hand. Whenever you cast a spell, raise a 1/1 Zombie.',
    flavor: 'The dead make patient students.',
  },
  rotting_hulk: {
    id: 'rotting_hulk',
    name: 'Rotting Hulk',
    type: 'creature',
    cost: 4,
    power: 4,
    toughness: 5,
    onDeath: { type: 'token', token: 'zombie_token', count: 1 },
    static: { affects: { ids: ['zombie_token'] }, power: 1, toughness: 1 },
    text: 'Your Zombies get +1/+1. Last breath — when it dies, raise a 1/1 Zombie.',
    art: '/cards/rotting_hulk.webp', // 420x422 WebP; other cards auto-wire to <id>.png
    flavor: 'A mound of grave-flesh stitched with spite.',
  },
  carrion_colossus: {
    id: 'carrion_colossus',
    name: 'Carrion Colossus',
    type: 'creature',
    cost: 6,
    power: 7,
    toughness: 6,
    keywords: ['lifelink'],
    onEnter: { type: 'edict' },
    text: 'Lifelink. When it enters, your opponent sacrifices a creature of their choice.',
    art: '/cards/carrion_colossus.webp', // 420x418 WebP; other cards auto-wire to <id>.png
    flavor: 'The tide of the dead, made flesh at last.',
  },

  // --- Sorceries ---
  cinderbolt: {
    id: 'cinderbolt',
    bonus: { when: 'secondSpell', effect: { type: 'damage', amount: 1, targets: 'player' } },
    name: 'Cinderbolt',
    type: 'sorcery',
    cost: 1,
    effect: { type: 'damage', amount: 3, targets: 'any' },
    text: 'Deal 3 damage to any target. If it is your second spell this turn, also deal 1 damage to your opponent.',
    art: '/cards/cinderbolt.webp', // 420x422 WebP; other cards auto-wire to <id>.png
    flavor: 'A handful of the old warmth, spent all at once.',
  },
  war_drums: {
    id: 'war_drums',
    name: 'War Drums',
    type: 'sorcery',
    cost: 3,
    effect: { type: 'rally', power: 1, toughness: 0 },
    text: 'Your creatures get +1/+0 until end of turn.',
    art: '/cards/war_drums.webp', // 420x421 WebP; other cards auto-wire to <id>.png
    flavor: 'Every drum a heartbeat, every heartbeat a step.',
  },
  grave_toll: {
    id: 'grave_toll',
    name: 'Grave Toll',
    type: 'sorcery',
    cost: 4,
    effect: { type: 'edict' },
    text: 'Your opponent sacrifices a creature of their choice.',
    art: '/cards/grave_toll.webp', // 420x417 WebP; other cards auto-wire to <id>.png
    flavor: 'The bell asks only one. They choose which.',
  },
  scorch: {
    id: 'scorch',
    name: 'Scorch',
    type: 'sorcery',
    cost: 3,
    effect: { type: 'damage', amount: 5, targets: 'any' },
    text: 'Deal 5 damage to any target.',
    art: '/cards/scorch.webp', // 420x419 WebP; other cards auto-wire to <id>.png
    flavor: 'More of the warmth than any one person should hold.',
  },
  insight: {
    id: 'insight',
    name: 'Insight',
    type: 'sorcery',
    cost: 2,
    effect: { type: 'draw', amount: 2 },
    art: '/cards/insight.webp', // 480x360 WebP (~30 KB); other cards auto-wire to <id>.png
    text: 'Draw two cards.',
    flavor: 'The one thing four traditions agree is worth paying for.',
  },
  wild_growth: {
    id: 'wild_growth',
    name: 'Wild Growth',
    type: 'sorcery',
    cost: 1,
    effect: { type: 'buff', power: 2, toughness: 2, targets: 'creature' },
    text: 'Target creature gets +2/+2.',
    art: '/cards/wild_growth.webp', // 420x418 WebP; other cards auto-wire to <id>.png
    flavor: 'It never wears off. The forest is not in the habit of taking back.',
  },
  pyroblast: {
    id: 'pyroblast',
    name: 'Pyroblast',
    type: 'sorcery',
    cost: 4,
    effect: { type: 'damage', amount: 6, targets: 'any' },
    kicker: { cost: 3, effect: { type: 'damage', amount: 3, targets: 'player' } },
    text: 'Deal 6 damage to any target. Kicker {3}: also deal 3 damage to your opponent.',
    art: '/cards/pyroblast.webp', // 520x287 WebP; other cards auto-wire to <id>.png
    flavor: 'The sky itself catches fire.',
  },
  call_wolves: {
    id: 'call_wolves',
    name: 'Call Wolves',
    type: 'sorcery',
    cost: 2,
    effect: { type: 'token', token: 'wolf_token', count: 2 },
    text: 'Create two 1/1 Wolves.',
    art: '/cards/call_wolves.webp', // 480x355 WebP; other cards auto-wire to <id>.png
    flavor: 'One howl, and the wild comes running.',
  },
  raise_horde: {
    id: 'raise_horde',
    name: 'Raise Horde',
    type: 'sorcery',
    cost: 3,
    effect: { type: 'token', token: 'zombie_token', count: 2 },
    flashback: 5,
    text: 'Raise two 1/1 Zombies. Flashback ◈5 — cast it from your graveyard, then exile it.',
    art: '/cards/raise_horde.webp', // 420x420 WebP; other cards auto-wire to <id>.png
    flavor: 'The soil remembers every soldier it has swallowed.',
  },
  overgrowth: {
    id: 'overgrowth',
    name: 'Overgrowth',
    type: 'sorcery',
    cost: 2,
    effect: { type: 'ramp', amount: 2 },
    text: 'Put up to two lands from your hand onto the battlefield.',
    art: '/cards/overgrowth.webp', // 520x264 WebP; other cards auto-wire to <id>.png
    flavor: 'The forest rushes to meet you.',
  },
  soothe: {
    id: 'soothe',
    name: 'Soothe',
    type: 'instant',
    cost: 2,
    effect: { type: 'heal', amount: 6 },
    modes: [{ type: 'heal', amount: 6 }, { type: 'draw', amount: 2 }],
    text: 'Instant — Choose one: gain 6 life; or draw 2 cards.',
    art: '/cards/soothe.webp', // 420x421 WebP; other cards auto-wire to <id>.png
    flavor: 'Rest now. The walls will hold.',
  },
  windrush: {
    id: 'windrush',
    name: 'Windrush',
    type: 'instant',
    cost: 2,
    effect: { type: 'bounce' },
    text: "Instant — return target creature to its owner's hand.",
    art: '/cards/windrush.webp', // 420x420 WebP; other cards auto-wire to <id>.png
    flavor: 'Gone before it knew it was moved.',
  },
  topple: {
    id: 'topple',
    name: 'Topple',
    type: 'instant',
    cost: 2,
    effect: { type: 'tapAll', maxToughness: 2 },
    text: 'Instant — Tap all opponent creatures with toughness 2 or less.',
    art: '/cards/topple.webp', // 420x419 WebP; other cards auto-wire to <id>.png
    flavor: 'The small ones never see the ground rise to meet them.',
  },
  take_counter: {
    id: 'take_counter',
    name: 'Take Counter',
    type: 'instant',
    cost: 2,
    effect: { type: 'destroy', targets: 'creature' },
    blockOnly: true,
    text: 'Instant — cast only while blocking. Destroy target tapped creature.',
    art: '/cards/take_counter.webp', // 420x419 WebP; other cards auto-wire to <id>.png
    flavor: 'Strike when its guard is down.',
  },

  // --- Iron Blossom (Samurai) instants ---
  iaijutsu_strike: {
    id: 'iaijutsu_strike',
    name: 'Iaijutsu Strike',
    type: 'instant',
    cost: 1,
    effect: { type: 'buff', power: 1, toughness: 1, targets: 'creature' },
    text: 'Instant — target creature gets +1/+1.',
    art: '/cards/iaijutsu_strike.webp', // 420x422 WebP; other cards auto-wire to <id>.png
    flavor: 'The blade is sheathed before you see it move.',
  },
  warding_stance: {
    id: 'warding_stance',
    name: 'Warding Stance',
    type: 'instant',
    cost: 1,
    effect: { type: 'buff', power: 0, toughness: 3, targets: 'creature' },
    text: 'Instant — target creature gets +0/+3.',
    art: '/cards/warding_stance.webp', // 420x421 WebP; other cards auto-wire to <id>.png
    flavor: 'Brace. Breathe. Let the blow break upon you.',
  },
  shuriken_volley: {
    id: 'shuriken_volley',
    name: 'Shuriken Volley',
    type: 'instant',
    cost: 2,
    effect: { type: 'damage', amount: 3, targets: 'any' },
    text: 'Instant — deal 3 damage to any target.',
    art: '/cards/shuriken_volley.webp', // 420x422 WebP; other cards auto-wire to <id>.png
    flavor: 'Steel falls like rain, and just as quietly.',
  },

  // --- Grave Tide (Zombie / Necromancer) instants ---
  withering_touch: {
    id: 'withering_touch',
    name: 'Withering Touch',
    type: 'instant',
    cost: 2,
    effect: { type: 'damage', amount: 3, targets: 'any' },
    text: 'Instant — deal 3 damage to any target.',
    art: '/cards/withering_touch.webp', // 420x426 WebP; other cards auto-wire to <id>.png
    flavor: 'Flesh sloughs from bone at the lightest caress.',
  },
  soul_siphon: {
    id: 'soul_siphon',
    name: 'Soul Siphon',
    type: 'instant',
    cost: 2,
    effect: { type: 'heal', amount: 5 },
    text: 'Instant — drain vitality; gain 5 life.',
    art: '/cards/soul_siphon.webp', // 420x419 WebP; other cards auto-wire to <id>.png
    flavor: 'Their last breath becomes your first.',
  },
  grasp_from_grave: {
    id: 'grasp_from_grave',
    name: 'Grasp from the Grave',
    type: 'instant',
    cost: 2,
    effect: { type: 'destroy', targets: 'creature' },
    blockOnly: true,
    text: 'Instant — cast only while blocking. Destroy target tapped creature.',
    art: '/cards/grasp_from_grave.webp', // 420x417 WebP; other cards auto-wire to <id>.png
    flavor: 'Cold hands close around its ankles.',
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

/**
 * Cards that exist only because an effect creates them (Wolf, Zombie). Derived from
 * the `token` effects themselves rather than a hand-kept list, so a new token is
 * recognised the moment something references it. Shared by the deck builder (which
 * must not offer them), the engine (a dead token is gone, not a graveyard card) and
 * the result screen (tokens are not "cast").
 */
export const TOKEN_IDS: ReadonlySet<string> = new Set(
  Object.values(CARDS)
    .map((d) => (d.effect?.type === 'token' ? d.effect.token : null))
    .filter((id): id is string => !!id),
);

export function isToken(defId: string): boolean {
  return TOKEN_IDS.has(defId);
}

/** The beasts Kunoichi's Beast Blitz lifts (+1/+1 each) while she is on the battlefield: read from her static ability, so the data is the one source. */
export const BLITZ_BEASTS: readonly string[] = CARDS.kunoichi.static?.affects.ids ?? [];
