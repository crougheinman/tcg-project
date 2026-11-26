import type { Keyword } from '../engine/types';

// The Field Manual's content, as data. The UI (`src/ui/Rulebook.tsx`) only lays it out and the search
// (`search.ts`) only reads it, so adding a rule means adding a page or a block here. Keyword rule text is NOT
// written here: a `keywords` block reads `KEYWORD_INFO` (cards/keywords.ts), the one place keyword rules live.
// `rulebook.test.ts` fails when a keyword or a card mechanic has no page, so the manual cannot fall behind.

export type ChapterId = 'basics' | 'combat' | 'keywords' | 'abilities' | 'spells' | 'board';

export interface Chapter {
  id: ChapterId;
  /** One short word for the rotated side tab. */
  tab: string;
  title: string;
  blurb: string;
  /** Tab / accent colour (the tab text is always dark ink on top of it). */
  color: string;
}

/** The figures the manual can show (drawn by `src/ui/ManualFigures.tsx`; every id there is a live diagram built from real card data, or the annotated board screenshot). */
export type FigureId = 'turn' | 'block' | 'damage' | 'twostep' | 'blitz' | 'equip' | 'ninjutsu' | 'board';

export type Block =
  | { kind: 'p'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'note'; title?: string; text: string }
  | { kind: 'keywords'; keys: Keyword[] }
  | { kind: 'figure'; id: FigureId; caption: string };

export interface Page {
  id: string;
  chapter: ChapterId;
  title: string;
  /** Extra search words that are not in the text (other names players use for the same thing). */
  tags?: string[];
  blocks: Block[];
}

export const CHAPTERS: readonly Chapter[] = [
  { id: 'basics', tab: 'Basics', title: 'The Basics', blurb: 'How a game is won, and what a turn looks like.', color: '#ffd24a' },
  { id: 'combat', tab: 'Combat', title: 'Combat', blurb: 'Attacking, blocking and how damage is dealt.', color: '#ff6b5b' },
  { id: 'keywords', tab: 'Keywords', title: 'Keywords', blurb: 'The short words printed on creatures.', color: '#4fd8cf' },
  { id: 'abilities', tab: 'Abilities', title: 'Abilities', blurb: 'Triggers, activated and static abilities, equipment, ninjutsu.', color: '#b99cff' },
  { id: 'spells', tab: 'Spells', title: 'Spells and Zones', blurb: 'Casting options, the graveyard and common spell effects.', color: '#6fdc9a' },
  { id: 'board', tab: 'Board', title: 'Using the Board', blurb: 'What you see on screen and how to act on it.', color: '#ffa94d' },
];

export const PAGES: readonly Page[] = [
  // ───────────────────────────── Basics
  {
    id: 'goal',
    chapter: 'basics',
    title: 'Goal and winning',
    tags: ['win', 'lose', 'life', 'deck', 'library'],
    blocks: [
      { kind: 'p', text: 'Reduce your opponent from 20 life to 0 to win. The same goes for you: at 0 life you lose.' },
      { kind: 'p', text: 'If a player must draw from an empty deck, they lose.' },
      { kind: 'note', title: 'Decks', text: 'A deck is 30 cards, with at most 6 copies of any one card. Pick one of the eight clans, or build your own in the Deck Builder.' },
    ],
  },
  {
    id: 'opening-hand',
    chapter: 'basics',
    title: 'Opening hand and mulligan',
    tags: ['mulligan', 'keep', 'start', 'setup'],
    blocks: [
      { kind: 'p', text: 'Each player starts with 7 cards and may keep them or take a mulligan.' },
      { kind: 'p', text: 'A mulligan shuffles your hand back and draws one card fewer. You may do it up to 3 times. You decide first, then your opponent.' },
      { kind: 'note', title: 'Rule of thumb', text: 'A hand with 2 to 5 lands is usually a keeper. With none you cannot cast anything; with all lands you have nothing to cast.' },
    ],
  },
  {
    id: 'turn',
    chapter: 'basics',
    title: 'Turn structure',
    tags: ['phase', 'untap', 'draw', 'main', 'end turn', 'summoning sick', 'summoning sickness'],
    blocks: [
      {
        kind: 'list',
        items: [
          'Untap and draw a card. This is automatic.',
          'Main phase: play one land, cast creatures, sorceries and equipment, use abilities and equip.',
          'Combat: declare attackers, the opponent blocks, then damage is dealt.',
          'End: pass the turn to your opponent. Damage on creatures wears off.',
        ],
      },
      {
        kind: 'note',
        title: 'Summoning sickness',
        text: 'A creature cannot attack, or use an ability that taps it, on the turn it enters play. Haste lifts that.',
      },
      { kind: 'p', text: 'Instants and Flash creatures can be cast outside your main phase, whenever you are the one who can act.' },
      { kind: 'figure', id: 'turn', caption: 'One turn, left to right. Cyan steps are yours; the Block step belongs to the defender.' },
    ],
  },
  {
    id: 'mana',
    chapter: 'basics',
    title: 'Mana and lands',
    tags: ['cost', 'orb', 'land', 'tap'],
    blocks: [
      { kind: 'p', text: 'Each land taps for 1 mana. You may play at most one land per turn.' },
      { kind: 'p', text: "A card's cost is the number on its orb: you need that many untapped lands." },
      { kind: 'p', text: 'Some creatures make mana too. That mana floats in your pool and is spent before your lands, but it empties whenever the phase changes.' },
    ],
  },
  {
    id: 'card-types',
    chapter: 'basics',
    title: 'Card types',
    tags: ['land', 'creature', 'sorcery', 'instant', 'equipment', 'token', 'permanent'],
    blocks: [
      {
        kind: 'list',
        items: [
          'Land: taps for mana.',
          'Creature: has power / toughness; can attack and block.',
          'Sorcery: a one-time effect, cast only in your main phase.',
          'Instant: like a sorcery, but castable any time you can act, during combat or on defence while blocking.',
          'Equipment: stays in play and makes one of your creatures stronger (see Equipment).',
        ],
      },
      {
        kind: 'note',
        title: 'Tokens',
        text: 'Some effects create creature tokens (Zombies, Wolves). A token that dies, or is bounced, is simply gone: it never reaches the graveyard, though its dies triggers still fire.',
      },
    ],
  },

  // ───────────────────────────── Combat
  {
    id: 'attacking',
    chapter: 'combat',
    title: 'Attacking',
    tags: ['attack', 'declare attackers', 'vigilance', 'drag'],
    blocks: [
      { kind: 'p', text: 'In your main phase, go to Combat, tap the creatures you want to attack with, then press Attack. Only untapped creatures that are not summoning sick can attack.' },
      { kind: 'p', text: 'Attacking creatures tap, unless they have Vigilance, so a tapped attacker cannot block on your opponent’s turn.' },
      { kind: 'note', title: 'Shortcut', text: 'Drag a ready creature onto the enemy side of the board to go to Combat with it already picked.' },
    ],
  },
  {
    id: 'blocking',
    chapter: 'combat',
    title: 'Blocking',
    tags: ['block', 'defend', 'flying', 'reach', 'skulk', 'surprise'],
    blocks: [
      { kind: 'p', text: 'When you are attacked, tap one of your untapped creatures, then tap the attacker it should block. Confirm when you are done.' },
      { kind: 'list', items: ['Each blocker blocks one attacker, and each attacker is blocked by at most one blocker.', 'Flying attackers can only be blocked by creatures with Flying or Reach.', 'A creature with Skulk cannot be blocked by a creature with greater power.'] },
      { kind: 'p', text: 'You can cast instants, and Flash creatures, while you are blocking. A Flash creature that arrives now can block at once.' },
      { kind: 'note', text: 'If nothing you control can block, and you cannot cast anything useful, the block step is skipped and damage is dealt straight away.' },
      { kind: 'figure', id: 'block', caption: 'A block is one blocker for one attacker. Flying can only be blocked by Flying or Reach.' },
    ],
  },
  {
    id: 'damage',
    chapter: 'combat',
    title: 'Damage and death',
    tags: ['destroyed', 'dies', 'toughness', 'power', 'trade', 'graveyard'],
    blocks: [
      { kind: 'p', text: 'Unblocked attackers hit the player for their power. Blocked creatures trade damage: each deals its power to the other.' },
      { kind: 'p', text: 'A creature with damage equal to or above its toughness is destroyed and goes to the graveyard (unless it is indestructible). Damage wears off at the end of the turn.' },
      { kind: 'p', text: 'Counters and buffs from other cards are lost when a creature dies. Undying then gives the returned creature its own +1/+1 counter.' },
      { kind: 'figure', id: 'damage', caption: 'Each creature deals its power to the other. Damage at or above toughness destroys.' },
    ],
  },
  {
    id: 'two-step',
    chapter: 'combat',
    title: 'First strike and two-step damage',
    tags: ['first strike', 'double strike', 'trample', 'deathtouch', 'lifelink'],
    blocks: [
      { kind: 'p', text: 'With first strike or double strike in the fight, damage is dealt in two steps. Creatures destroyed in the first step do not strike back.' },
      {
        kind: 'list',
        items: [
          'First strike deals damage in the first step only, before creatures without it.',
          'Double strike deals damage in both steps.',
          'Trample sends damage beyond what its blocker needs to the player.',
          'Deathtouch destroys any creature it damages; lifelink gains its controller life equal to the damage dealt.',
        ],
      },
      { kind: 'figure', id: 'twostep', caption: 'The first striker hits in step one; the creature it destroys never gets to hit back.' },
    ],
  },

  // ───────────────────────────── Keywords (rule text comes from KEYWORD_INFO)
  {
    id: 'kw-evasion',
    chapter: 'keywords',
    title: 'Evasion',
    tags: ['unblockable', 'evade'],
    blocks: [
      { kind: 'p', text: 'Keywords that decide who can block whom.' },
      { kind: 'keywords', keys: ['flying', 'reach', 'skulk'] },
    ],
  },
  {
    id: 'kw-combat',
    chapter: 'keywords',
    title: 'Combat keywords',
    blocks: [
      { kind: 'p', text: 'Keywords that change how damage is dealt or how a fight is won.' },
      { kind: 'keywords', keys: ['firstStrike', 'doubleStrike', 'trample', 'deathtouch', 'lifelink', 'bushido', 'battleCry', 'exalted'] },
    ],
  },
  {
    id: 'kw-defence',
    chapter: 'keywords',
    title: 'Defence',
    tags: ['defense', 'protect'],
    blocks: [
      { kind: 'p', text: 'Keywords that keep a creature alive or out of reach.' },
      { kind: 'keywords', keys: ['defender', 'indestructible', 'hexproof'] },
      { kind: 'note', title: 'Ward', text: 'Ward is not a keyword but works the same way: Ward {N} makes your opponent’s spells that target the creature cost N more. A spell aimed at a player is not taxed.' },
    ],
  },
  {
    id: 'kw-speed',
    chapter: 'keywords',
    title: 'Speed and value',
    tags: ['tempo', 'haste', 'flash'],
    blocks: [
      { kind: 'p', text: 'Keywords about when a creature can act, and about getting more out of it.' },
      { kind: 'keywords', keys: ['haste', 'flash', 'vigilance', 'prowess', 'undying'] },
    ],
  },

  // ───────────────────────────── Abilities
  {
    id: 'triggers',
    chapter: 'abilities',
    title: 'Triggered abilities',
    tags: ['enter', 'enters', 'dies', 'last breath', 'landfall', 'morbid', 'attack trigger', 'second spell', 'skill'],
    blocks: [
      { kind: 'p', text: 'A trigger fires by itself when something happens. The card tells you what.' },
      {
        kind: 'list',
        items: [
          'Enters play: fires when the creature arrives. If it needs a target, you are asked to choose one.',
          'Dies (Last breath): fires when the creature dies. Tokens trigger too. If several die together, the active player’s go first.',
          'Spell trigger: fires whenever you cast a sorcery (some also on instants).',
          'Landfall: fires when a land enters under your control, whether played or ramped.',
          'Attack trigger: fires when its creature attacks, even if it is then blocked.',
        ],
      },
      {
        kind: 'note',
        title: 'Bonus conditions',
        text: 'Morbid is true once a creature has died this turn. A second-spell bonus applies once you have cast two spells this turn (creature spells count). Both are printed on the card that carries them.',
      },
    ],
  },
  {
    id: 'activated',
    chapter: 'abilities',
    title: 'Activated abilities',
    tags: ['ability', 'tap', 'mana ability', 'floating mana', 'pool'],
    blocks: [
      { kind: 'p', text: 'In your main phase, tap Ability, then a creature, to use its ability. Using one is not casting a spell.' },
      {
        kind: 'list',
        items: [
          '{T} means the creature must be untapped and not summoning sick. It then stays tapped through your opponent’s turn, so it cannot block.',
          'A mana cost is paid from your lands.',
          '{T}: Add one mana puts floating mana in your pool. The pool empties when the phase ends.',
        ],
      },
    ],
  },
  {
    id: 'statics',
    chapter: 'abilities',
    title: 'Static abilities',
    tags: ['beast blitz', 'lord', 'zombie', 'threshold', 'aura', 'buff', 'kunoichi'],
    blocks: [
      { kind: 'p', text: 'A static ability is always on while its creature is in play. It lifts other creatures, or the creature itself, and ends the moment the creature leaves.' },
      {
        kind: 'list',
        items: [
          'Beast Blitz (Kunoichi): your beasts get +1/+1. A second Kunoichi adds nothing.',
          'Lords (Rotting Hulk): your Zombies get +1/+1. Lords stack with each other.',
          'Threshold (Pyre Adept): active while you have 7 or more cards in your own graveyard.',
        ],
      },
      { kind: 'figure', id: 'blitz', caption: 'Beast Blitz in action: the bonus is on while Kunoichi is in play, and gone when she leaves.' },
    ],
  },
  {
    id: 'equipment',
    chapter: 'abilities',
    title: 'Equipment',
    tags: ['equip', 'katana', 'banner', 'attach'],
    blocks: [
      { kind: 'p', text: 'Cast equipment like a creature. It stays in play, unattached. Then, in your main phase, tap it and one of your creatures to attach it for its Equip cost.' },
      { kind: 'p', text: 'The creature gets the equipment’s bonus and keywords. To move it to another creature, pay the Equip cost again.' },
      { kind: 'note', text: 'If the creature leaves play, the equipment stays, unattached. A creature that returns through Undying does not get it back.' },
      { kind: 'figure', id: 'equip', caption: 'Equipping Ronin\u2019s Katana: +2/+0 and first strike for as long as it stays attached.' },
    ],
  },
  {
    id: 'ninjutsu',
    chapter: 'abilities',
    title: 'Ninjutsu',
    tags: ['ninja', 'swap', 'unblocked', 'kunoichi', 'kensei duelist'],
    blocks: [
      { kind: 'p', text: 'After blockers are declared, if you have an unblocked attacker and a ninja in hand that you can pay for, combat pauses and asks you.' },
      { kind: 'list', items: ['Tap the ninja, then the attacker.', 'The attacker returns to your hand. The ninja takes its place, tapped and attacking, so it hits instead.', 'It is not a cast. If you cannot use it, combat goes straight to damage as usual.'] },
      { kind: 'figure', id: 'ninjutsu', caption: 'An unblocked Ashigaru swaps out for a Kensei Duelist from your hand, which then hits for more.' },
    ],
  },

  // ───────────────────────────── Spells and zones
  {
    id: 'cast-options',
    chapter: 'spells',
    title: 'Cast options',
    tags: ['modal', 'kicker', 'x spell', 'ward', 'choose one'],
    blocks: [
      { kind: 'p', text: 'Some spells ask a question before they are cast.' },
      {
        kind: 'list',
        items: [
          'Modal ("choose one"): you pick which effect the spell has.',
          'Kicker {N}: pay the extra cost and the spell does its extra effect too.',
          'X: you choose X, pay it on top of the cost, and the effect scales with it.',
          'Ward {N} on a creature: your opponent’s spells that target it cost N more.',
        ],
      },
    ],
  },
  {
    id: 'graveyard',
    chapter: 'spells',
    title: 'Flashback and Unearth',
    tags: ['flashback', 'unearth', 'graveyard', 'exile', 'recursion'],
    blocks: [
      { kind: 'p', text: 'Your graveyard is more than a discard pile. Tap the graveyard counter to open it.' },
      {
        kind: 'list',
        items: [
          'Flashback: a spell with Flashback can be cast again from your graveyard for its flashback cost. It is then exiled.',
          'Unearth {N}: in your main phase, pay N to return that creature with haste. It is exiled at the end step, or instead of dying. Unearth is not a cast.',
        ],
      },
    ],
  },
  {
    id: 'cycling',
    chapter: 'spells',
    title: 'Cycling',
    tags: ['cycle', 'discard', 'draw'],
    blocks: [
      { kind: 'p', text: 'In your main phase you may pay a card’s cycling cost and discard it from your hand to draw a card. Tap Cycle, then the card.' },
      { kind: 'p', text: 'Cycling is not a cast, so it does not set off spell triggers.' },
    ],
  },
  {
    id: 'effects',
    chapter: 'spells',
    title: 'Common spell effects',
    tags: ['scry', 'loot', 'edict', 'sacrifice', 'bounce', 'rally', 'bite', 'rot', 'grave call', 'discard', 'hexproof'],
    blocks: [
      {
        kind: 'list',
        items: [
          'Scry N: look at the top N cards of your library one at a time and keep each on top or put it on the bottom.',
          'Loot: draw a card, then discard a card of your choice.',
          'Edict: the opponent sacrifices a creature of THEIR choice. A sacrificed creature dies even if it is indestructible.',
          'Bounce: send a creature back to its owner’s hand. A token just vanishes.',
          'Rally: all your creatures get a bonus until end of turn.',
          'Bite: your creature with the greatest power deals damage equal to its power to a target opposing creature.',
          'Rot: the opponent discards a card at random. Grave Call returns your most recently fallen creature to your hand.',
        ],
      },
      { kind: 'note', title: 'Hexproof', text: 'Hexproof stops your opponent’s spells and abilities from targeting a creature. Yours can; combat and damage to players are unaffected.' },
    ],
  },

  // ───────────────────────────── Using the board
  {
    id: 'board-read',
    chapter: 'board',
    title: 'Reading the board',
    tags: ['hud', 'life', 'cyan', 'red', 'hover', 'hold', 'log', 'activity', 'card details'],
    blocks: [
      { kind: 'figure', id: 'board', caption: 'The battlefield: your side is cyan at the bottom, your opponent\u2019s red at the top.' },
      { kind: 'list', items: ['Cyan is you; red is your opponent, everywhere on screen.', 'The bar above each side shows life and mana. Floating mana counts.', 'Hover a card, or press and hold it on a phone, to read its full details.', 'The activity log (bottom-right) lists every action, so you can follow what the opponent did.'] },
    ],
  },
  {
    id: 'board-phases',
    chapter: 'board',
    title: 'Phases and banners',
    tags: ['banner', 'guided mode', 'coach', 'tips', 'end turn', 'go to combat'],
    blocks: [
      { kind: 'p', text: 'Each phase change shows a banner. While it plays the board is held and the buttons wait, so a quick double tap cannot skip your attack.' },
      { kind: 'p', text: 'A block step with nothing that can block shows no banner at all.' },
      { kind: 'note', title: 'Guided Mode', text: 'Open the game menu (top left) and switch on Guided Mode: banners linger longer and a coach bubble tells you the next sensible move.' },
    ],
  },
  {
    id: 'board-actions',
    chapter: 'board',
    title: 'Acting on cards',
    tags: ['ability', 'cycle', 'equip', 'graveyard', 'drag', 'tap', 'cast'],
    blocks: [
      {
        kind: 'list',
        items: [
          'Cast: tap a card in your hand, or drag it onto the battlefield.',
          'Attack: drag a ready creature onto the enemy side, or go to Combat and tap your attackers.',
          'Block: tap your blocker, then the attacker.',
          'Ability and Cycle are modes: tap the button, then the creature or card. Equip: tap the equipment, then the creature.',
          'Graveyard: tap the counter to see it, and to use Flashback or Unearth from it.',
        ],
      },
    ],
  },
];

/** The pages a "?" link on the board opens (a Ninjutsu window, a Scry, a cast option...). Typed, so a typo is a compile error; the tests check each id is a real page. */
export const HELP_PAGES = ['effects', 'ninjutsu', 'cycling', 'equipment', 'activated', 'cast-options'] as const;
export type HelpPageId = (typeof HELP_PAGES)[number];

export const pageById = (id: string): Page | undefined => PAGES.find((p) => p.id === id);
export const chapterById = (id: ChapterId): Chapter => CHAPTERS.find((c) => c.id === id) as Chapter;
export const pagesOf = (chapter: ChapterId): Page[] => PAGES.filter((p) => p.chapter === chapter);
