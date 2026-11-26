# CLAUDE.md

Guidance for Claude Code (and anyone else) working in this repo. **Keep this file current: every change
you make must update it in the same commit if it touches anything described here** (commands, rules,
mechanics, tooling, conventions, known issues). See "Keeping this file current" at the bottom.

## What this is

**Entity Duel (Arcanum TCG)**: a small Magic-inspired card game. React + Vite + TypeScript, a pure
deterministic engine, an in-browser heuristic AI, online PvP over Supabase Realtime (lockstep), Zustand
for UI state, Capacitor for mobile. Hosted on Vercel. CI (`.github/workflows/ci.yml`) runs tsc, tests and build on PRs and pushes. Deeper docs: `card-art.md` (card art style guide and prompts), `README.md` (setup),
`ARCHITECTURE.md` (how it works and why, with a "what changed and what it found" log), `LORE.md` (the world,
the 8 decks, card flavour), `docs/MECHANICS_PLAN.md` (the mechanics roadmap: Phases 0-3 done; Phase 4 is built in parts, 4a-4i done; Equipment has two printed cards),
`tools/qa/README.md` (the QA harness).

## Commands

```bash
npm run dev           # http://localhost:5173 (the browser QA tools play against this; it can die between shell calls, check it)
npm test              # vitest: `engine` project on node (engine, ai, cards, net, audio, rulebook), `ui` project on jsdom (all unit tests)
npm run lint          # eslint, ZERO warnings allowed
npx tsc --noEmit      # type-check (the build also runs it)
npm run build         # tsc + vite build into dist/
npm run qa:fuzz       # engine fuzz vs an independent oracle (SEEDS=100 for the full ~22,000-game pass; default 12)
N=80 npm run qa:winrate   # AI-vs-AI deck win rates (balance); use N>=40, margin ~ +/-4 points at 80
npm run qa:scenarios  # real-browser scenarios (needs dev server + Playwright)
npm run qa:smoke      # 8 real matches, every deck twice (needs dev server + Playwright)
```

Local environment gaps (not bugs): `jsdom` / `@testing-library/react` are not installed in some checkouts, so the
`ui` vitest project and store tests that need a DOM do not run there, and `tsc` reports 2
`@testing-library/react` import errors. Run `npm install` to get them. Preview config: `.claude/launch.json`
(`tcg-dev`, port 5190).

Before calling any change done: `npm run lint`, `npx tsc --noEmit`, `npm test`, and the QA run that fits
the change (below). Playwright is not a project dependency; it must exist where the browser tools run.

## Architecture in one screen

- **`src/engine`**: the rules. `applyAction(state, action)` is a pure, validated reducer; `rules.ts` holds
  `actorOf` (who may act now), `legalActions`, `validateAction`, combat helpers (`strikesIn`, `splitDamage`,
  `duel`, `blockError`/`canBlock`); `state.ts` builds games (`createInitialState(..., { mulligan })`).
- **`src/ai`**: ranks `legalActions`; judges blocks with `duel`; never invents moves.
- **`src/store/gameStore.ts`**: the only place with side effects (timers, net, storage). Telegraphs (cast
  windows, charge-ups, AI pauses) live here and in `src/ui/fxTiming.ts`.
- **`src/ui`**: `Board.tsx` and friends; `BoardFx` is a read-only visual layer; pure helpers
  (`blockSelection`, `combatTally`, `phaseInfo`, `resultStats`) are unit-tested in the jsdom project.
- **`src/net`**: lockstep PvP over Supabase; `keys.ts` picks and vets the env key.
- **`src/cards`**: card data (`cards.ts`), decks (`decks.ts`), builder rules (`customDecks.ts`),
  keyword text (`keywords.ts`: the one place keyword rules are written for players).
- **`src/rulebook`**: the Field Manual's words (`content.ts`: chapters and pages as data) and its search / paging maths (`search.ts`); `src/ui/Rulebook.tsx` only lays them out.
- **`tools/qa`**: the QA harness (fuzz oracle, win-rate sim, browser match runner, scenarios, smoke).

## UI systems worth knowing

- **Framer owns card transforms.** Effects on cards use box-shadow, CSS individual `scale`/`translate`/`rotate`,
  WAAPI, filter, or SVG, never `transform` on the card. `AnimatePresence custom={...}` + `variants` +
  `exit="out"` for exits (the `exit` prop can't take a resolver in v11).
- **Phase banners** (`PhaseBanner.tsx`, `phaseInfo.ts`): 2.2 s banners (`PHASE_BANNER_MS`; the End phase, a pass-through, 1.4 s via
  `END_BANNER_MS` / `phaseBannerInfo(...).short`) with a 0.5 s gap (`PHASE_GAP_MS`), dark `.pb-dim` backdrop. They were 3 s with a 1.2 s gap, which
  chained to a 10 s hand-over at each turn change and 12-23 s after the player's own attack, all with the cards locked. While a banner is pending or showing, `Board.tsx` renders the
  state from *before* the phase change (`hold`) and locks all cards (`cardsLocked`); both release when the
  banner leaves. A combat resolution is never held (`combatJustResolved`), and `BoardFx`, the block announce
  and `impactDelays` read the live game. AI waits `PHASE_PAUSE_MS` (banner + 0.6 s; `END_PAUSE_MS` after the End phase) after a phase change, so it never acts while the board is still
  holding the old state; keep it tied to the banner length if you retime the banners.
  **An empty block step gets no banner** (`blockStepIsEmpty` in `phaseInfo.ts`): when the defender has no creature that can block any
  attacker (none untapped, or every attacker flies and they have no flyer/reach) and no instant or flash card they can afford,
  `PhaseBanner` skips the "Block phase" banner (no dim, no lock; it releases the board at once unless an earlier banner is still
  up), the Board auto-resolves the block for a human defender (same helper), and the store skips the AI's `PHASE_PAUSE_MS`
  (`phasePauseMs`) so the damage lands in about half a second instead of waiting out a banner that never came.
  **Action buttons are inert while the board is held** (`act` in `Board.tsx`, dimmed via `.board.holding`): they are drawn from the held, pre-change state
  but dispatch against the live one, so a quick second tap on "Go to Combat" used to hit the same button again and skip the attack step
  (scenario S9 is the regression check).
  **Releasing the hold:** `Board` holds the pre-change state on every phase change and only `PhaseBanner`'s `onLock(false)` releases it.
  An empty block step shows no banner, so it must release the hold itself unless an earlier banner's own lock is still pending
  (`lockOn` ref). It used to check "previous banner's gap over" instead, and when the previous banner had left but its 1.2 s gap was
  still running nothing released the hold: the board stayed on the pre-attack state for 15 s (found by the smoke batch; regression
  test in `phaseBanner.test.tsx`). `useLockFailsafe` (`LOCK_FAILSAFE_MS` 40 s) releases a hold OR a lock that never lets go. Keep it
  well above ordinary chains: a turn change holds the board ~10 s and, after the player's own attack, the clash plus the block / End /
  enemy-Main banners chain to 12-23 s (measured over a smoke batch, with the old 3 s / 1.2 s timings), and after a combat resolves the board holds nothing but the cards
  stay locked, so a 15 s failsafe would cut those chains short.
- **Combat clash timing** (`firstStrike.ts`, `fxTiming.ts`): `combatHoldMs` delays the next banner until the
  clash is over (+1.3 s). Kills play impact → crack (0.3 s, `ShatterFx`) → pulverize (0.2 s) → gone; the dying
  card stays until then via `CardView` variants.
- **Skill cut-ins** (`CutIn.tsx`, `CastSpotlight.tsx`): a slanted band across the middle with the caster's face
  right of centre (so the floating spotlight card never covers it), speed lines, flash, dim backdrop. Kinds in
  `fxTiming.ts`: `CUTINS` (cast-time skills: Beast Blitz `blitz`, Grave Call `grave`, Thornwood Brute's Whipflash `whip`, Plague Priest's Rot `rot`, 2.4 s) and
  `TRIGGER_CUTINS` (spell triggers: Pyre Adept `pyre`, 1.8 s). `FLASH_CUTINS` (keyed by card id: Bulwark `flash`, 2.4 s) plays only for a Flash cast, i.e. `isFlashCast` in `rules.ts`: a flash
  creature cast outside `main1` (attack or block step); cast in the main phase it is an ordinary creature. Colours are CSS vars on `.blitz-ult.<kind>`.
  One band per kind at a time. To add one: art in `public/ui/`, entry in `CutIn.tsx` `ART`, a table entry, a
  colour block in `index.css`. `--cut-bg` can be a gradient.
- **First-strike cut-in** (`FS_CUTINS`, `fsSpotMs`, `fsIntroMs` in `fxTiming.ts`; `FirstStrikeFx`, `BoardFx.tsx`): when a first
  striker clashes with its blocker/attacker, the cinematic is "First Strike!" spotlight, then blackout and slashes. A first
  striker listed in `FS_CUTINS` (Kensei Duelist, kind `strike`, `strike-face.webp`) puts its cut-in band on that spotlight and
  holds it longer (`FS_CUTIN_SPOT_MS` 1.7 s vs `FS_SPOT_MS` 0.9 s); `combatHoldMs` / `combatImpactDelays` (`firstStrike.ts`) use the
  per-card `fsIntroMs`, so strikes and the next banner wait for it. Plays alongside the action, so online play is untouched. To add
  one: art in `public/ui/`, a `CutIn.tsx` `ART` entry, an `FS_CUTINS` entry, a colour block in `index.css`.
- **Iaijutsu blackout film** (`IaijutsuCinematic.tsx`, `cinematics.ts`, `.iai*` in `index.css`): Iaijutsu Strike cast on a Kensei Duelist (`isIaijutsuOnHana`; off under reduced motion) replaces the floating card with a 5 s full-screen film (`IAIJUTSU_MS`, constants in `fxTiming.ts`): fade to black, letterbox bars, film grain / scratches / flicker, the clip (`public/ui/iaijutsu.mp4`, 640x360, 3 s, poster `iaijutsu-poster.webp`) played ONCE after 450 ms by a `<video>` with no loop (it holds its last frame, so it never repeats like the GIF it came from), slow push-in, falling petals, vertical 居合 title, one diagonal cut of light, then the table returns. The store marks the spotlight `cinematic: 'iaijutsu'` and gives the cast a 5 s `charging` window vs AI / hotseat (the effect waits); online it plays alongside and never delays the action. `CastSpotlight` renders it outside `.cast-stage` (z 98, above banners) and keeps it out of the card/cut-in lists. Board prefetches the clip once when a deck holds the card (`warmIaijutsuClip`). Every `.iai*` keyframe is a share of `--iai-ms`, so changing `IAIJUTSU_MS` retimes it; the title characters are stacked blocks, not vertical writing mode (that overlapped).
- **Zone shows** (`zoneCues.ts`, `ZoneFx.tsx`, `.zfx*` in `index.css`, `BoardFx.tsx`): a card moved by a skill gets its own show, fired from the state diff (`zoneCues(before, after)`, pure and tested; it reads the new log lines so a sorcery cast from hand to graveyard is never read as a discard). **Discard** (Plague Priest's Rot, `DISCARD_FX_MS` 3 s): the discarded card drops in face up from its owner's side in a purple light, holds, then rots away (greys, blurs, rises, fades) with spores. **Raise** (Grave Necromancer's Grave Call, `RAISE_FX_MS` 3.4 s): a green bloom and beam come first, then the returned creature fades in out of the light (blurred and over-bright, settling into focus) under "Returned from the grave", then slips toward its owner's hand. They start after the cast's cut-in: online the cut-in plays alongside the action, so `cutInRemainingMs` waits out what is left of the `rot` / `grave` spotlight (spotlights carry `at`, set by `pushSpotlight`); vs AI the store already waited, so it starts at once. Plays alongside the action, never delays it. z 70, click-through; reduced motion drops the travel, blur and motes. Every `.zfx*` keyframe is a share of `--zfx-ms`; note the per-segment easing (a strong ease-out on the whole animation front-loaded the fade and the card vanished early).
- **Moment cut-ins** (`momentCues.ts`, `BoardFx.tsx`): creatures whose signature *moment* cuts in without delaying the action: Iron Shogun's The Charge (`charge`, when declared as an attacker), Storm Drake's Thunder (`thunder`, when it enters), Rotting Hulk's Last breath (`breath`, when it dies). `momentCues(before, after)` is a pure diff of two game states (unit-tested), table `MOMENT_CUTINS`; `BoardFx` pushes the spotlight, so it plays alongside the action in PvP too. The Charge is parked until the block-step phase banner has left (`locked` from `Board`, failsafe `PARKED_CUE_FAILSAFE_MS`). Note: `src/ui/__tests__` runs in the jsdom project, which needs `jsdom` installed.
- **Pyre Adept fist** (`BoardFx.tsx` `punchTo` / `impactShake`, `Projectile.tsx` kind `fist`, `ImpactFx.tsx` `big`, `.fire-fist` in `index.css`, `FIST_TRAVEL_MS` / `PUNCH_MS` in `fxTiming.ts`): the spell trigger charges (`TRIGGER_CHARGE_MS`), the adept card jabs toward the target, a flaming fist accelerates in and knocks the target back, then a big impact (more rings and rays, bigger burst) and a decaying board jolt play. Life loss is applied on landing (`flushDamage` waits `TRIGGER_CHARGE_MS + FIST_TRAVEL_MS`). Visual only; online play is untouched.
- **Zombie rise** (`CardView.tsx` `rising`, `.card.arena.rising` / `zombie-rise` in `index.css`): a Zombie token on the battlefield (Grave Necromancer's trigger, Raise Horde, Rotting Hulk's last breath) does not slam down; it claws up out of the ground: the card is revealed from its base upward behind a soil mound, wobbles, soil clods spray, and its P/T shield pops in last. Pure CSS per card with its own `--rise-delay` (250-580 ms, from the iid), so tokens raised together rise independently and nothing in the game or the telegraphs waits on it. `isRising(iid, seed)` is true for the first 2.5 s after a token is first drawn (table resets with each new game), so re-renders and hotseat flips never replay it. Reduced motion collapses it through the global rule.
- **Beast Blitz** (engine + store): Kunoichi's static gives `BLITZ_BEASTS` (+1/+1: Swift Lancer, Sky Talon, Stoneback
  Cub, Wolf, Thornwood Brute, Dread Maw). `blitzCue(player, card)` decides when it *announces* (log line,
  spotlight, cut-in): only when Kunoichi and a beast meet, whichever arrives second, or Call Wolves makes wolves
  beside her. Kunoichi alone is a plain 2/1. Empowered beasts wear `Lightning.tsx` (yellow bolts revolving around
  the card).
- **Home duellists** (`MainMenu.tsx` `useDuelists`, `.vs-side` in `index.css`): the two slabs behind the menu show random creatures from the eight decks, each swapped every 9 s (left first, right half a cycle later, never the same card on both sides). The corner tag shows the card name and its deck, and re-fades with the art. The art fades in, then drifts sideways (`vs-drift`, 18 s, opposite directions; the 1.3 zoom leaves room to travel). Reduced motion keeps the swap, drops the drift. Art comes from `def.art`, so it follows card-art replacements automatically.
- **Drag to attack** (`Board.tsx`, `CardView.tsx`): in your Main phase, dragging an untapped, non-summoning-sick
  creature onto the enemy zone (`.player-zone.opp`) advances to combat with it pre-picked (`autoAttack` ref).
  Other creatures are not draggable. Works for mouse and touch (framer sets `touch-action: none`).

- **Field Manual** (what was the plain "Rulebook"; `src/ui/Rulebook.tsx`, `src/rulebook/`, `.fm*` in `index.css`): an overlay book with six chapters (Basics, Combat, Keywords, Abilities, Spells and Zones, Using the Board; 25 pages) shown as rotated side tabs (`writing-mode: vertical-rl`, one colour each), prev / next paging across chapters (buttons with the neighbour page's title, arrow keys, swipe), and a header search (`/` focuses it; every term must match as a word prefix; title > tags > body; a few synonyms; results show a snippet and opening one lights the words with `<mark>`). Wide screens show a two-page spread: the page on the left, this chapter's page list on the right; under 860px it is one page with the list as a strip above it. The words are DATA in `content.ts` (`CHAPTERS`, `PAGES` of `p` / `list` / `note` / `keywords` blocks); a `keywords` block reads `KEYWORD_INFO`, so keyword rules are still written once. **To document a new rule, add a page or block there**: `rulebook.test.ts` fails when a keyword is on no page, when a card field (`cycling`, `ninjutsu`, `ward`, `landTrigger`...) or an `Effect` type has no word in the manual (the `EFFECT_TERMS` table is a `Record<Effect['type'], ...>`, so a new effect type fails the build until it is decided). The book renders through a portal on `<body>` (opened from the game's top bar it used to sit under the phase banners and the Activity panel, because the board is its own stacking context), refocuses itself when a search result unmounts (or the arrow keys and Esc stop working), and Esc first backs out of an active search, then closes. `<Rulebook page="ninjutsu">` opens at a page (nothing uses it yet). The user-facing name is "Field Manual" (home menu, game menu, tooltips); the component and file keep the name `Rulebook`. Not done yet: figures (live card diagrams and annotated screenshots) and context "?" links from the board; see the plan in the change log.
- **Codex detail view** (`CardGallery.tsx`, `.gallery-detail` in `index.css`): the whole modal is the card. The art
  (`.gallery-detail-art`, `object-fit: cover`) fills it edge to edge and name / type / cost / P/T / rules / flavor sit in a
  frosted translucent panel (`.gallery-detail-info`) at the bottom. Phone width uses a shorter box and a compact panel so
  landscape art (Dread Maw) keeps its face visible. Grid cards and the deck builder still use `CardFace`.
  **3D tilt** (`useTilt.ts`): the card (`.gallery-detail`, inside `.gallery-stage` which holds the perspective) rotates toward the
  pointer (mouse/pen/finger drag, up to 14deg) or the phone's gyroscope (`deviceorientation`, relative to how the phone is held when
  the card opens; iOS needs `requestGyro()` called from the opening tap). A rAF loop eases and writes CSS vars (`--rx/--ry`
  degrees, `--px/--py` -1..1, `--gx/--gy` glare) so there are no React re-renders; the art counter-slides, the info panel slides
  with the tilt, and a soft-light sheen follows the light. Off under `prefers-reduced-motion`. Gyro needs a secure context (https/localhost).

## Preview / testing quirks

- The preview tab can throttle and serve stale screenshots; to inspect a transient effect, clone the DOM and
  pause `document.getAnimations()`.
- A full reload loses the game. Start via Play vs AI → a deck → Keep hand; find the live store by importing each
  `gameStore` URL from `performance.getEntriesByType('resource')` and picking the one with `getState().game`
  (HMR leaves several instances). Seed with `useGame.setState({ game: structuredClone(...) })`.
- Mana = number of untapped lands. Aura (`blitz` flag) only recomputes after an engine action.

## Rules that must not be broken

1. **Determinism.** All rules live in `applyAction`. No `Math.random` or clocks in the engine (use the game's
   own rng, `s.rngState`). Online play replays the action log on both clients; any non-determinism desyncs.
2. **One actor at a time.** `actorOf(state)` is the single source of "who acts". Never re-inline it. The
   mulligan phase, pending triggers and the block step (defender acts) all go through it.
3. **A choice needs a `pending` state** (see `resolveTrigger`); no engine rule waits on the UI.
4. **Online play never delays an action.** Visual lead-ins (cast spotlight, banners) play *alongside* the
   action in PvP; the AI-pause and telegraph delays are vs AI / hotseat only.
5. **1:1 blocking.** Menace / gang blocks are out of scope (they break the block planner).
6. **Tokens** never go to the graveyard (they still trigger dies effects), and neither does an unearthed creature (it is exiled). Dead creatures drop all buffs (Undying then gives the returned creature its own +1/+1 counter).
7. **Cards are data.** New mechanics go in `types.ts` (`Effect`, `CardDef`, `Keyword`) and the engine, with the
   player-facing text in `cards/keywords.ts`. Card data constraints are enforced by tests (e.g. what a dies
   trigger may need, flashback only on untargeted spells, deck copy limit `MAX_COPIES` = 6).
8. **Seat colours:** cyan (`--me`) is the local player, red (`--foe`) is the enemy, everywhere.

## Testing and QA: what to run when

- **Every change:** lint, tsc, `npm test`. New behaviour gets a test that you have seen fail without the
  change (mutation-style: break the code, watch the test fail, restore). Rule changes also get a check in the
  independent fuzz oracle (`tools/qa/engine-fuzz.ts`, written from the rules text, not the engine's helpers).
- **Small changes** (a card, text, one UI piece): add `npm run qa:smoke` (8 matches, ~4-5 min). The owner asked
  for this. **Do not run the full 56-match browser pass unless asked** (it takes 15+ minutes).
- **Rules / combat / store / whole-layout changes:** also `SEEDS=100 npm run qa:fuzz` and `npm run qa:scenarios`.
- **Balance-affecting changes** (card stats, keywords, deck lists): `N=80 npm run qa:winrate` before and after
  with the same code otherwise; keep every deck between about 45% and 58%. Last measured range 45.2%-54.1% (N=80; 44.4%-54.0% at N=120; after the equipment cards; the closest to the floor is Skyward, which was already at 45.0% before them and sits just under it at N=120, the closest to the ceiling Gravetide / Ironblossom).
- **The browser harness knows about the board hold** (`tools/qa/ui-match.cjs`): the human waits for `.board.cards-locked` / `.phase-banner`
  to clear before acting (the board ignores clicks while a banner is up), the DOM-vs-state checks (HUD, acting ring, tapped, ATK tags,
  phase bar...) are skipped while the board is held (it deliberately draws the pre-change state for a banner plus a gap, longer than the
  checks' tolerances), clicks freeze the target's infinite animations first (a creature that can attack bobs forever, and Playwright
  refuses to click an element that is "not stable"), and `LOCK_STUCK` flags a hold over 36 s. Each result carries `maxHeldMs` and `longHolds`.
- **Do not edit `src/` while a browser batch runs** (hot reload disturbs the matches). If every match "crashes"
  in 0 seconds, the dev server is down. One lone anomaly under load (`HUD_LIFE`, a missed tap) is usually a
  load flake: replay the same pairing a few times and compare with the code without your change before acting.
- Verify UI changes in a real browser at desktop, portrait phone (390 wide), small phone (320x568) and
  landscape phone; screenshots count as evidence, a guess does not.

## Mechanics currently in the game

Keywords (19): undying (when it dies without a +1/+1 counter it returns with one, once; Ancient Treant), hexproof (your opponent's spells and abilities cannot target it; `canTargetCreature`; Storm Drake), haste, flying, defender, reach, vigilance, first strike, double strike, trample, deathtouch,
lifelink, flash, prowess, skulk (cannot be blocked by greater power; Kunoichi), bushido (+1/+1 when it blocks or is blocked, until end of turn; Ashigaru, a 1/2),
indestructible (damage, deathtouch and destroy do not kill it, only 0 toughness; `isLethal`; on no printed card yet, see `docs/MECHANICS_PLAN.md` Part 4a), battle cry (each other attacker +1/+0; Iron Shogun), exalted (a lone attacker +1/+1 per exalted creature; Sky Talon).
Trigger data on `CardDef` (Part 4b, untargeted effects only, damage only at the player): `landTrigger` (Landfall: per land that enters, played or ramped; Granite Sentinel), `onAttack` (Storm Drake), `bonus: { when: 'morbid' | 'secondSpell', effect }` (Stoneback Cub, Cinderbolt). Per-turn counters `diedThisTurn` / `spellsThisTurn` on the game state, reset in `beginTurn`; creature spells count as spells. Effects: damage, draw, buff, heal, ramp, token, tapAll, destroy, discard (random,
deterministic), recall (most recently fallen creature), rally (all your creatures +P/+T until end of turn; Iron Shogun on entering), bounce (target creature back to its owner's hand, not a death; needs a target, so as an enter effect it waits on `pending` like Whipflash; no printed card yet), edict (the opponent sacrifices a creature of THEIR choice: automatic with one, otherwise `pending` `{ kind: 'sacrifice', controller: victim }` resolved by `resolveTrigger`; a sacrificed (`doomed`) creature dies even if indestructible; Carrion Colossus). Cycling: `CardDef.cycling` + the `cycle` action (main phase, not a cast; Ancient Treant). Triggers: `onEnter` (a targeted one waits on `pending`,
resolved by `resolveTrigger`), `onDeath` (active player first; tokens trigger), `spellTrigger`. Flashback
(cast from the graveyard, then exiled; `PlayerState.exile`). Mulligan: opt-in at the engine, on in every real
game mode (A decides, then B; up to 3 mulligans; one card fewer each). Static abilities are data (Part 4d):
`CardDef.static` (`StaticAbility`: `affects` ids / others / self, power, toughness, `when: 'threshold'` = 7+ cards in the controller's own graveyard, `unique`, `mark: 'blitz'`). Each creature's bonus is `auraP` / `auraT`,
rebuilt from scratch after every action (`staticBonus` in `rules.ts`; `recomputeStatics` + `settle` in `reducer.ts`: recompute, then deaths and recomputes until stable), so lords stack and nothing leaks. Beast Blitz is
Kunoichi's static (`unique`: a second Kunoichi adds nothing; `BLITZ_BEASTS` is read from it; it announces only when Kunoichi and a beast meet, see `blitzCue`). Printed: Pyre Adept (Threshold +1/+1), Rotting Hulk (Zombies +1/+1). Activated abilities (Part 4e): `CardDef.activated` (`{ cost: { tap?, mana? }, effect }`, untargeted effects only, every ability must cost something, a mana ability must tap) used by the `activate` action in main1 (`activateError` in `rules.ts` is the one legality check; the Board has an Ability mode like Cycle). A tap ability needs the creature untapped and not summoning sick and leaves it tapped through the opponent's turn (it cannot block). The effect `mana` adds to `PlayerState.pool` (floating mana, spent before lands, emptied whenever the phase changes). Not a cast: no spell triggers. Printed: Kunoichi ({T}: Add one mana); non-mana abilities (ping, heal, draw, token) are engine-ready but on no card yet. Choices (Part 4f): effects `scry` (`pending` kind `scry`, answered by the `scry` action: keep on top or bottom, one card at a time), `loot` (draw, then `pending` kind `discard` answered by `resolveTrigger` with a hand card; logged "loots away", never "discards", which is Rot's show) and `bite` (a targeted spell effect: your highest-power creature deals its power to target opposing creature); scry / loot are enter effects (Sky Talon scry 1, Shambling Ghoul loot), bite is on no card yet (waits for art, `card-art.md`). A targeted enter effect with only hexproof targets left fizzles instead of leaving a `pending` nobody can answer. Cast options (Part 4f2): `CardDef.x` (X spell: damage / heal / draw amount * X, X paid on top), `kicker: { cost, effect }` (untargeted extra effect when paid), `modes: Effect[]` (modal; `effect` must equal `modes[0]`) and `ward: N` on creatures (spells that target it cost N more; a spell at a player is not taxed), named by optional `x` / `kicked` / `mode` on the `castSorcery` action. `spellEffect` and `castCost` in `rules.ts` are the ONLY definitions of what a cast does and costs (validation, `legalActions`, payment, AI, UI all use them); a flashback cast takes no options. The Board opens a `CastOptions` modal before the target. Printed: Soothe (modal: gain 6 or draw 2), Pyroblast (Kicker {3}: 3 more damage to the opponent), Pyre Adept (Ward {1}); no X spell is printed yet. Graveyard (Part 4g): Undying returns the creature from `checkDeaths` after its dies trigger (`CardInstance.revived`; a returned creature is summoning sick and never fights again that combat: `checkDeaths` returns the iids that died and `resolveCombat` excludes them); Unearth (`CardDef.unearth`, the `unearth` action, `CardInstance.unearthed`): a graveyard creature returns with haste for its cost, not a cast, exiled quietly in `toEnd` or instead of dying (`PlayerState.exile`); an Undying creature must have no enter effect (data test). Printed: Ancient Treant (Undying), Ronin Blade (Unearth {2}); Undying on a cheap creature wrecks balance (Wildblitz 74.6% with a Swift Lancer). Ninjutsu (Part 4h): `CardDef.ninjutsu: cost`. After blockers are declared, `ninjutsuOptions` (a payable ninja in the attacker's hand x an UNBLOCKED attacker) decides whether combat PAUSES: only then a `pending` `{ kind: 'ninjutsu', controller: attacker }` opens (phase stays `combat_block`) and is answered by `ninjutsu { ninja, attacker }` or `skipNinjutsu`, both of which finish combat (a swap bounces the attacker, puts the ninja in tapped and attacking, recomputes statics, then resolves). With no ninja in hand nothing changes. A ninja has no enter effect (data test). Anything that treated "actor in combat_block" as the blocker must exclude a pending window (the Board's `inBlock` does). Printed: Kunoichi (Ninjutsu {1}), Kensei Duelist (Ninjutsu {2}). Equipment (Part 4i): `CardType` `'equipment'`, `CardDef.equip: { cost, power, toughness, keywords? }`, `CardInstance.attachedTo` / `grantedKw`; actions `castEquipment` (a spell for the counters, not a creature, never in the graveyard) and `equip { equipment, creature }` (main phase, pay the equip cost; moving it pays again). The bonus is a term in `staticBonus` (so in `auraP` / `auraT`) and granted keywords are `grantedKw` read by `hasKeyword`; an equipment is unattached the moment its creature leaves play (`detachFrom`; `recomputeStatics` is the safety net) and a creature returned by Undying does not get it back. The Board draws equipment at the end of the creature row; tap yours, then a creature. Printed (one copy each in Iron Blossom, replacing Warding Stance and War Drums, which stay in the Codex and the deck builder): Ronin's Katana (cast 2, +2/+0 and first strike, Equip {2}) and Clan Banner (cast 2, +1/+1, Equip {1}); swapping a footman or a land for them dropped Iron Blossom to 45-48%, and a +0/+3 plate would unbalance the decks. Until-end-of-turn buffs use `tempP`/`tempT`, cleared as the next turn begins.

## Online play (Supabase) and deployment

- Env vars (Vercel: mark both **Config**, not Secret, then **redeploy**; `VITE_` values are baked in at build):
  `VITE_SUPABASE_URL` (the plain project address; a pasted `/rest/v1` is stripped) and
  `VITE_SUPABASE_PUBLISHABLE_KEY` (legacy `VITE_SUPABASE_ANON_KEY` still read as a fallback).
- A secret / `service_role` key in any `VITE_` variable **fails the build** (`vite.config.ts`) and is refused at
  runtime (`src/net/keys.ts`). Never put one there.
- Saved online matches from before the mulligan change cannot be replayed (the restore path reports it).

## Card art

Art auto-wires to `public/cards/<id>.png`. To replace art: crop to the interior (no frames, parchment or
captions), size it for its use (landscape 4:3 art window in the hover preview, portrait board cards use
`object-fit: cover`), export **WebP** (about 400-480 px, target under 45 KB), delete the old PNG, set
`art: '/cards/<id>.webp'` on the card in `cards.ts`, and check it in the game at desktop and phone.
Replaced so far: insight, kunoichi, swift_lancer, pyre_adept, grave_necromancer, ember_sprite, stoneback_cub,
sky_talon, thornwood_brute, granite_sentinel, storm_drake, dread_maw, soothe, pyroblast, ancient_treant, call_wolves, overgrowth, bulwark, zombie_token, shambling_ghoul, plague_priest,
rotting_hulk, carrion_colossus, raise_horde, wolf_token, ronin_blade, kensei_duelist, iron_shogun, iaijutsu_strike,
warding_stance, scorch, ashigaru, cinderbolt, shuriken_volley, topple, take_counter, grasp_from_grave, soul_siphon, wild_growth, aether_well, withering_touch, windrush, war_drums, grave_toll, ronins_katana, clan_banner (every card now has new art).
The design guide (house style, shared prompt line, composition rules, and a prompt per card) is `card-art.md`: use it when
asking for new art, and add a prompt there for any card whose art is replaced.
Effect art (cut-in faces) lives in `public/ui/` (`blitz-face.webp`, `grave-grin.webp`, `pyre-glare.webp`, `whip-face.webp`, `flash-guard.webp`, `rot-face.webp`, `charge-face.webp`, `thunder-face.webp`, `breath-face.webp`, `strike-face.webp`). The Iaijutsu film's clip and poster are `iaijutsu.mp4` / `iaijutsu-poster.webp` there too.

## Workflow rules from the owner

- **Update this file with every change** (see below).
- **Never open a pull request unless asked.** When one is opened, assign it to `crougheinman`.
- Commit and push only when asked. "push to main" = commit pending work, then `git push origin HEAD:main`.
- **Push to `main` only when the owner says so** ("push to main"); otherwise commit and push to the working
  branch. Pushes are normal pushes, never forced; if `main` has moved, merge it in, resolve conflicts, re-run
  the checks, then push. The owner also commits to `main` directly, so always `git fetch` first.
- Commit by concern, with a message that says what and why. **Never credit Claude** in commits or PR bodies (no
  `Co-Authored-By`, no "Generated with Claude Code"): the user is the sole contributor. Never put a model name
  in code, comments or docs.
- Update the relevant docs in the same change: `ARCHITECTURE.md` (design + findings), `LORE.md` (card text and
  flavour), `docs/MECHANICS_PLAN.md` (status), `tools/qa/README.md` (tooling), the in-game Field Manual
  (`src/rulebook/content.ts`) for player-facing rules, and this file.
- Report honestly: say what was and was not run, and call out anything unreproduced or unverified.

## Known issues

- `npm run lint` currently reports two `react-hooks/exhaustive-deps` warnings, both from the owner's recent commits: `src/ui/Board.tsx`
  ~line 154 (missing `game.players` in a `useEffect`) and `src/ui/BoardFx.tsx` ~line 694 (missing `flushCues`). The lint script
  allows zero warnings, so fix them (carefully: each changes when its effect runs) before relying on lint.
- Not done: keyword badges on board cards; the full 56-match browser pass has not been run since the mechanics phases.

## Change log (newest first; add a line per change)

- Field Manual (the rulebook reworked, phases 1-2 of the plan; figures not done): 25 pages in 6 chapters as data (`src/rulebook/content.ts`), rotated colour tabs on the outer edge, two-page spread on desktop and one page on phones, prev / next with arrow keys and swipe, search with snippets and highlighting, Esc / `/` keys, focus trap, reduced-motion page turns; the home and game menus now say "Field Manual". Replaces the old single scrolling parchment (8 sections, one 12-paragraph "Tips" dump). 48 new tests: 42 on the content and search (`src/rulebook/__tests__/rulebook.test.ts`, incl. the coverage rules above; the word-boundary, AND-match, clamp, keyword-coverage, title-weight and snippet-source rules each mutation-checked) and 6 on the component (`src/ui/__tests__/rulebook.test.tsx`; the portal, the refocus and the Esc rules mutation-checked). Real browser at desktop, 390 wide, 320x568 and landscape 844x390: no horizontal overflow, every tab label fits (landscape scrolls the rail), search / tabs / paging / Esc driven with real clicks and keys, and opened from the game's top bar during a live match. That check found four real bugs, all fixed: the whole book was wider than a 320px screen (grid track sizing), the search box was squeezed to a few letters beside the title on a small phone, focus was lost when a search result was opened (arrows and Esc died), and the book painted UNDER the phase banner and Activity panel in a game (it lived in the board's stacking context; the old rulebook had the same flaw; now a portal). `npm run lint` still shows only the two known warnings. Also run: `npm run qa:scenarios` 40/40 and `npm run qa:smoke` 8/8 clean (0 anomalies; neither opens the manual, so they show only that nothing else broke). Not done: figures (live card diagrams for combat, Beast Blitz and equipment, plus annotated screenshots for the interface pages), "?" links that open a page from the board, a keyboard-only pass with a screen reader, `Rulebook.tsx` was not renamed.

- Equipment is now printed: the owner supplied the art for **Ronin's Katana** (cast 2, +2/+0 and first strike, Equip {2}) and **Clan Banner** (cast 2, +1/+1, Equip {1}) (420px WebP, 19 / 27 KB). Iron Blossom swaps Warding Stance for the Katana and War Drums for the Banner (one copy each). Chosen by the sim (N=120, Iron Blossom 54.2% before, 53.9% with this swap): putting them in place of creatures or lands dropped the deck to 36-48%, and swapping Insight (the clan's one shared card) or a Iaijutsu Strike (Hana's signature) was avoided. Win rates 45.2%-54.1% (N=80), 44.4%-54.0% (N=120). `LORE.md` and `card-art.md` updated. Warding Stance and War Drums remain real cards (Codex, deck builder). Verified: lint (only the two known warnings), tsc, 471 tests, `SEEDS=100` fuzz 22,400 games zero findings, scenarios 40/40, smoke 8/8 clean, and the real art, tags and an attached banner seen in a real browser at desktop and iPhone 13 width. Not verified: no smoke match cast or equipped an equipment (the runner's `castEquipment` / `equip` gestures remain untested end to end), the Katana's equip was not driven in the browser, landscape phone and 320x568 not checked.

- Phase 4i (`docs/MECHANICS_PLAN.md`): Equipment. New permanent type `equipment`, `CardDef.equip`, actions `castEquipment` / `equip`, attachment (`attachedTo`), bonus through `staticBonus` and keywords through `grantedKw` / `hasKeyword`, `detachFrom` on every way a creature leaves play (and not re-attached after Undying). AI casts equipment and attaches it to its hardest hitter; Board draws equipment in the creature row, an equip pick (tap the equipment, then a creature) and equipment tags. No printed card (art needed: `card-art.md` Ronin's Katana and Clan Banner prompts). 15 engine tests (`equipment.test.ts`, 13 rules mutation-checked), fuzz oracle extended (`EQUIP_*`, aura / keyword re-derivation, stress games swap throwaway equipment into the decks; eight rule breaks each detected, and a new rule for the Undying-return case). The first Board layout (a separate equipment row) was hidden under the player platform: found by looking in a real browser at desktop and iPhone 13 width and fixed. Verified: `SEEDS=100` fuzz 22,400 games zero findings (with the finished oracle), scenarios 40/40, smoke 8/8 clean; casting, equipping and the tags driven in a real browser with a runtime-registered throwaway card at desktop and iPhone 13 width. Not verified: no deck holds equipment, so smoke and scenarios never touch it, and the match runner's `castEquipment` / `equip` gestures (added) are untested end to end; the opponent's AI equipping is covered by tests, fuzz and the trial sim only; landscape phone and 320x568 not checked; the card shows the art fallback until art exists.

- Phase 4h (`docs/MECHANICS_PLAN.md`): Ninjutsu (Equipment not done). `CardDef.ninjutsu`, `ninjutsuOptions`, a `pending` kind `ninjutsu` that pauses combat between blocks and damage ONLY when a swap is possible, actions `ninjutsu` / `skipNinjutsu`; the swap bounces the unblocked attacker, puts the ninja in tapped and attacking and recomputes statics before damage. AI `pickNinjutsu`; Board prompt, ninja pick and attacker tap, "No ninjutsu" button; `inBlock` / block tally exclude a pending window. Cards: Kunoichi Ninjutsu {1}, Kensei Duelist Ninjutsu {2}. 9 engine tests (`ninjutsu.test.ts`, 11 rules mutation-checked), fuzz oracle reworked for split combat (`combatView`, `NINJUTSU_*`; eight rule breaks each detected, one of which, a missing statics recompute, is a real ordering rule). Win rates 45.5%-55.4% (N=80), 45.0%-54.2% (N=120). Verified: `SEEDS=100` fuzz 22,400 games zero findings, scenarios 40/40, smoke 8/8 clean; the Ninjutsu window was driven in a real browser (real clicks) at desktop and iPhone 13 width (Kensei swapped in for an Ashigaru, opponent 20 to 17). That browser run found a real crash: the Board looked up the card behind EVERY pending decision, and a Ninjutsu window (like a Scry or Loot raised by a bonus) has no card (`def` is empty), so `getDef('')` threw and blanked the page (fixed in `Board.tsx`; no unit test, since it needs a Board render). Not verified: no smoke match opened a window, so the match runner's `ninjutsu` / `skipNinjutsu` gestures are untested end to end; the opponent-AI side of the window is covered by tests and fuzz only; landscape phone and 320x568 not checked. The fuzz also surfaced two oracle imprecisions about unearthed creatures killed in combat (fixed in the oracle, not the engine). Separately, `customDecks.test.ts` "custom ids do not collide" failed once and passed on three reruns: it builds 200 ids from a timestamp plus 4 random characters, so it can collide (pre-existing, not touched).

- Phase 4g (`docs/MECHANICS_PLAN.md`): Undying and Unearth. Keyword `undying` (returns once with a +1/+1 counter after its dies trigger; `revived`), `CardDef.unearth` + the `unearth` action (graveyard creature returns with haste, exiled at the end step or instead of dying; `unearthed`); AI unearths a power-2+ body with spare mana; Board Unearth button in the graveyard viewer plus an "Unearthed" tag; log verb "unearths". **Fixed a real engine bug the oracle found**: a creature killed by first strike that returned through Undying fought again in the regular damage step (`checkDeaths` now returns what died; `resolveCombat` excludes it; two regression tests). Cards: Ronin Blade Unearth {2}, Ancient Treant Undying (Undying on Swift Lancer / Sky Talon / Ashigaru gave 74.6% / 60.0% / 69.1% and was rejected). 11 engine tests (`graveyard2.test.ts`, 11 rules mutation-checked), fuzz oracle extended (`UNDYING_*`, `UNEARTH_*`, older die-and-stay-dead checks carved out, Morbid tracker reads "dies" lines; eight rule breaks each detected). Win rates 45.5%-55.5% (N=80), 45.4%-54.5% (N=120). Verified: `SEEDS=100` fuzz 22,400 games zero findings, scenarios 40/40 (they exercise the changed `resolveCombat`), smoke 8/8 clean; the Unearth flow (graveyard viewer button, haste body, "Unearthed" tag, mana spent) was driven in a real browser at desktop and iPhone 13 width. Not verified: no smoke match unearthed anything, so the match runner's `unearth` gesture is untested end to end; the end-step exile and Undying were checked only in tests and fuzz, not in the UI; landscape phone and 320x568 not checked.

- Phase 4f2 (`docs/MECHANICS_PLAN.md`): Modal, X spells, Kicker and Ward. Optional `x` / `kicked` / `mode` on `castSorcery`; `spellEffect` and `castCost` (cost + X + kicker + ward of an opposing target) are the one definition used by validation, `legalActions`, payment, AI and UI; `CardDef.x` / `kicker` / `modes` / `ward`; AI pays kickers, picks X; Board `CastOptions` modal (`effectText.ts`) and a ward notice; match-runner gesture for the modal. Cards: Soothe modal (gain 6 or draw 2), Pyroblast Kicker {3}, Pyre Adept Ward {1}; no X spell printed. 15 engine tests (`castoptions.test.ts`, ten rules mutation-checked), fuzz oracle extended (`SPELL_COST`, chosen-effect life; stress-sprinkles all four; six breaks each detected). Win rates 45.9%-55.7% (N=80), 46.0%-55.5% (N=120). A modal spell with no mode named means the first mode (so old saved casts replay). Verified: `SEEDS=100` fuzz 22,400 games zero findings, scenarios 40/40, smoke 8/8 clean; the `CastOptions` modal (Soothe's draw mode, a kicked Pyroblast, the ward notice) was driven in a real browser at desktop and iPhone 13 width, but no smoke match happened to cast a modal / kicker card, so the match runner's cast-options gesture is untested end to end; landscape phone and 320x568 not checked. One process slip: an oracle edit was not saved the first time, so the first "zero findings" and mutation runs proved nothing; they were redone after writing it.

- Phase 4f, first half (`docs/MECHANICS_PLAN.md`; Modal / X / Kicker / Ward are 4f2): Scry, Loot, Bite and Hexproof. New effects `scry` / `loot` / `bite`, `pending` kinds `scry` / `discard`, the `scry` action, keyword `hexproof` with one shared `canTargetCreature` (validation, `legalTargets`, `legalActions`, enter-effect picks, Board cues; an enter effect with only hexproof targets fizzles). AI scries / loots / bites sensibly; Board gets a Scry modal (`ScryPrompt`) and a Loot prompt; log verbs scries / loots / puts. Cards: Sky Talon scry 1, Shambling Ghoul loot, Storm Drake hexproof (a hexproof Kunoichi was rejected by the sim); Bite waits for art (`card-art.md`: Savage Bite). 18 engine tests (`choices.test.ts`, 11 rules mutation-checked), fuzz oracle extended (`HEXPROOF_TARGETED`, `SCRY_*`, `LOOT_*`, `BITE_*`; six rule breaks each detected; stress-sprinkles all four). Win rates 46.6%-55.4% (N=80), 46.5%-55.6% (N=120). Verified: `SEEDS=100` fuzz 22,400 games zero findings, scenarios 40/40, smoke 8/8 clean (two real Scry and two real Loot gestures; the match runner got both gestures first), Scry / Loot / hexproof cues seeded in a real browser at desktop and iPhone 13 width; landscape phone and 320x568 not checked, and the opponent's side of Scry / Loot is only covered by tests and fuzz.

- Phase 4e (`docs/MECHANICS_PLAN.md`): activated abilities. `CardDef.activated`, the `activate` action (main phase, tap and/or mana cost, untargeted effect), floating mana (`PlayerState.pool`, effect `mana`, spent before lands, emptied on every phase change), `activateError`; AI `scoreActivate` (taps a mana creature only when it unlocks a card; keeps real attackers attacking); Board Ability mode; match-runner `activate` gesture; activity-log verb "adds". Card: Kunoichi gets "{T}: Add one mana" (the same on Ember Sprite or Ashigaru was rejected by the sim). 14 engine tests (`activated.test.ts`, 8 rules mutation-checked), fuzz oracle extended (`ACTIVATE_*`, `POOL_*`, spent-mana accounting; stress-sprinkles abilities; each rule mutation-detected, a missing tap hangs the run). Win rates 45.7%-52.9% (N=80), 46.1%-53.3% (N=120). Also merged `main` (Windrush, War Drums, Grave Toll) into the branch first. The HUD mana pips now count floating mana (`PlayerBar` `slots`; the first smoke run flagged `HUD_MANA` on it, the harness check was updated to match). Verified: `SEEDS=100` fuzz 22,400 games zero findings, scenarios 40/40, smoke 8/8 clean (one match used the real Ability gesture), the Ability flow seeded in a real browser at desktop and iPhone 13 width (a 3-cost creature cast with 2 lands plus floating mana); landscape phone and 320x568 not checked, and no non-mana ability has been played in the UI (none printed).

- Phase 4d (`docs/MECHANICS_PLAN.md`): data-driven static abilities. `CardDef.static`, `auraP` / `auraT` rebuilt from scratch by `recomputeStatics` / `settle` (replaces the incremental `recomputeAura`; deaths and recomputes alternate until stable, recomputing before the first death check). Beast Blitz is now Kunoichi's static (`unique`, `mark: 'blitz'`; clears the old "not data-driven" known issue); new Lords (`others` / ids / self) and Threshold. Cards: Pyre Adept Threshold +1/+1, Rotting Hulk "your Zombies get +1/+1". The board's buff crown shows for aura bonuses. 13 engine tests (`statics.test.ts`, mutation-checked), fuzz oracle checks every creature's expected aura independently (`AURA_WRONG`) and stress-sprinkles statics; a 56,000-step differential trace old vs new engine is identical. Win rates 45.0%-54.6% (N=80), 46.7%-55.4% (N=120). `SEEDS=100` fuzz 22,400 games zero findings, browser scenarios 40/40, smoke 8/8 clean; a seeded board (Hulk + Zombies, Kunoichi + Wolf, Threshold Pyre Adept) checked in a real browser at desktop and iPhone 13 width (crowns and Blitz lightning show); landscape phone and 320x568 were not checked.
- Three Phase 4c spells are real cards now that their art arrived (420px WebP, 32-38 KB): **Windrush** (Skyward instant, 2, bounce; 2 copies for 2 Stoneback Cubs), **War Drums** (Iron Blossom sorcery, 3, Rally +1/+0; 1 copy for 1 Shuriken Volley) and **Grave Toll** (Grave Tide sorcery, 4, Edict; 1 copy for 1 Shambling Ghoul). Iron Blossom keeps its Insight (`LORE.md` calls it the clan's one shared card). Win rates N=80: 46.4%-53.8% (Iron Blossom 51.1%; a 2-copy War Drums built on cutting Insight and a Ronin Blade fell to 39.8%, one cutting Insight and an Ashigaru to 44.1%). `newSpells.test.ts` (War Drums mutation-checked), fuzz 12 seeds clean. Smoke batch not run.
- Phase 4c (`docs/MECHANICS_PLAN.md`): Bounce, Edict, Rally and Cycling (effects `bounce` / `edict` / `rally`, `pending` kind `sacrifice` chosen by the victim, `doomed` flag, `cycle` action, `CardDef.cycling`). AI scores them and picks what to bounce / sacrifice / cycle; Board gets a sacrifice prompt and a Cycle mode; the activity log's first-person verbs now cover sacrifice, cycle, return, discard. Cards: Carrion Colossus (Edict), Ancient Treant (Cycling 2), Iron Shogun (Rally on entering); a bouncing Storm Drake and a cycling Dread Maw were rejected by the sim; `card-art.md` has prompts for the three new spells that wait for art (Windrush, War Drums, Grave Toll). 23 engine tests (9 rules mutation-checked), fuzz oracle extended (it found that a bounced creature must not trigger). Win rates 45.7%-54.6%. Browser scenarios and smoke: see below once run.
- Phase 4b (`docs/MECHANICS_PLAN.md`): Landfall, Morbid, second-spell bonuses, Battle cry, Exalted and attack triggers (`landTrigger` / `onAttack` / `bonus` on `CardDef`, `diedThisTurn` / `spellsThisTurn` counters). Cards: Granite Sentinel (Landfall: gain 1), Stoneback Cub (Morbid: draw), Cinderbolt (second spell: 1 damage), Sky Talon (Exalted), Storm Drake (attack: gain 1), Iron Shogun (Battle cry); an Ember Sprite attack ping and a Swift Lancer Battle cry were rejected by the sim. 21 engine tests (8 mechanics mutation-checked), 4 for the new floating labels (`triggerCues`), fuzz oracle extended with its own counters (22,400 games, zero findings, each rule mutation-detected). Win rates 45.7%-54.5%. Browser scenarios 40/40 (K2's expected damage became 3: a lone Sky Talon is Exalted); smoke 8/8 with one `PREVIEW_STUCK` on a phone match that did not reproduce in 3 replays of the pairing (load flake).
- Fixed: during a phase banner the action buttons (Go to Combat, End Turn, Attack, Confirm Blocks...) showed the old phase but acted on the live state, so a double-tap on Go to Combat skipped the attack step. They now do nothing while the board is held and look dimmed. The browser scenarios script was also stale (it ignored the board hold, bobbing attackers and the new cut-in / banner timings): 10 -> 40 of 40 pass with it fixed (S9, the double-tap check, passes only with the button fix). Smoke 8/8 clean.
- Phase 4a (first part of Phase 4, `docs/MECHANICS_PLAN.md`): Skulk, Bushido, Indestructible. Kunoichi has Skulk, Ashigaru is a 1/2 with Bushido, Indestructible waits for a card (Pyromancer fell to 43% with it on a Sentinel or Drake). Tests (`keywords2.test.ts`, mutation-checked), `duel` property test extended, fuzz oracle extended (22,400 games, zero findings), block planner explains Skulk refusals. Also fixed the fuzz tool: its policy ignored skulk and its Beast Blitz list had only the original four beasts (it had reported `BLITZ_FLAG` on every run). Win rates N=80: 45.5%-54.6%. Browser scenarios 40/40 and smoke 8/8 clean (after the fixes below).
- Shorter board lock: banners 3 s -> 2.2 s, End phase banner 1.4 s (new `END_BANNER_MS`, `short` flag), gap 1.2 s -> 0.5 s, combat-to-End gap 1.3 s -> 0.7 s, AI pause = banner + 0.6 s. After the player's own attack the board is free at 6.9 s instead of 9.7 s (staged timeline); tests for the End banner length. Smoke batch 8/8 clean: the longest board hold fell from 23.3 s to 8.4 s and the 8 matches ran about 15% faster (504 s vs about 590 s).
- QA smoke batch trustworthy again (8/8 clean, exit 0): the harness now waits out the board hold, skips DOM-vs-state checks while held, freezes infinite animations for clicks and reports `maxHeldMs` / `longHolds` / `LOCK_STUCK`; and it caught a real bug of mine: an empty block step left the board frozen on the pre-attack state when the previous banner had left but its gap was running (fixed in `PhaseBanner` with `lockOn`, test added). New `useLockFailsafe` (40 s) covers a held board or locked cards.
- Pyre Adept's trigger now throws a flaming fist instead of a bolt: the adept charges, jabs at the target (`punchTo`), a fist (`Projectile` kind `fist`, `.fire-fist`) accelerates in, and it lands as a big impact (`SpellImpactFx big`: 3 rings, 14 rays, bigger burst) plus a board jolt (`impactShake`). Timings `FIST_TRAVEL_MS` / `PUNCH_MS`; damage waits for the landing. Verified by DOM/WAAPI instrumentation, not by a captured frame.
- Zombie tokens rise out of the ground (reveal from the base up behind a soil mound, wobble, flying clods, P/T shield last), asynchronously per card, for Grave Necromancer's trigger, Raise Horde and Rotting Hulk.
- No block-phase banner when nothing can block (no able creature for any attacker, no affordable instant): `blockStepIsEmpty` (tests), Board auto-resolve now uses it (flyers vs ground blockers count), AI pause skipped. Smoke batch not run.
- Rot's discarded card is shown face up and rots away (purple light, greys and fades); Grave Call shows a green bloom first, then the returned creature fades in. New `zoneCues` diff helper (tests), `ZoneFx`, `cutInRemainingMs`; spotlights gained an `at` timestamp. Smoke batch skipped at the owner's request.
- Iaijutsu Strike on Hana plays a 5 s blackout film (Japanese-cinema style: bars, grain, the supplied clip once through as a non-looping video, petals, 居合 title, cut of light); store `cinematic` spotlight + `isIaijutsuOnHana`, tests for AI (5 s hold), PvP (no delay) and reduced motion.
- New Thornwood Brute Whipflash cut-in face (panda-faced brute mid-lash, dark background, 1002x394); the `whip` band loses its multiply-over-gradient trick and gets a dark green background; `card-art.md` prompt added.
- Moment cut-ins for Iron Shogun (The Charge, on attack), Storm Drake (Thunder, on enter) and Rotting Hulk (Last breath, on death): new `charge` / `thunder` / `breath` kinds, `momentCues` diff helper with tests, parked behind the block banner for The Charge.
- `card-art.md`: Iaijutsu Strike prompt redone around Hana (the moment after the draw: blade re-sheathed, a sliced lantern and blossom); the old generic swordsman prompt is gone. Art not delivered yet.
- Kensei Duelist card text: rules stay "Haste. First strike."; the flavour now carries Hana's personality from `LORE.md` (calm, strict, four duels she walked away from) next to her signature line.
- Kensei Duelist First-strike cut-in: new `strike` kind (`public/ui/strike-face.webp`, 1024x434, Hana's eyes snapping open, cold steel-silver band) on the "First Strike!" spotlight, which holds 1.7 s for her instead of 0.9 s (`FS_CUTINS`, `fsSpotMs`, `fsIntroMs`); `firstStrike.test.ts` added; `card-art.md` prompt marked delivered.
- `card-art.md`: cut-in prompts for Iron Shogun (the Charge), Storm Drake (Thunder) and Rotting Hulk (Last breath); not wired in the game yet.
- `card-art.md`: Plague Priest Rot cut-in prompt (new `rot` kind, not wired yet) and a refined Withering Touch card art prompt.
- New Aether Well card art; new Grave Necromancer card art and Grave Call cut-in face (`grave-grin.webp`, 731x365, Sael matched to the Soul Siphon art); old Aether Well PNG deleted.
- `card-art.md`: prompts for a redo of the Grave Necromancer card art and the Grave Call cut-in (Sael, matched to the Soul Siphon art).
- New card art for Topple, Take Counter, Grasp from the Grave, Soul Siphon and Wild Growth, 420px WebP; old PNGs deleted. Only Withering Touch and Aether Well remain on original art.
- New Cinderbolt (flame in an open hand) and Shuriken Volley (Hana mid-throw) card art, 420px WebP; old PNGs deleted.
- Home page: random creature art on both sides with the matching name and deck, swapping every 9 s and drifting slowly sideways (also fixes the broken hardcoded Iron Shogun / Storm Drake PNGs).
- `card-art.md`: prompts for the last nine cards on original art (Cinderbolt, Shuriken Volley, Take Counter, Topple, Grasp from the Grave, Soul Siphon, Withering Touch, Wild Growth, Aether Well).
- New Ashigaru card art (clan footman with a levelled spear), 420px WebP; old PNG deleted.
- `card-art.md`: added the Ashigaru card art prompt.
- Bulwark Flash cut-in: new `flash` kind with Marrek's face (`public/ui/flash-guard.webp`), played only when a flash creature is cast at instant speed (`isFlashCast`); tests added.
- New 420px WebP art (~33-44 KB) for the Wolf token, Ronin Blade, Kensei Duelist, Iron Shogun, Iaijutsu Strike, Warding Stance and Scorch; old PNGs deleted; `card-art.md` status updated.
- `card-art.md`: added the Bulwark Flash cut-in prompt (art only; no `flash` cut-in exists in the game yet).
- New Kunoichi card art (Kasei crouched on a ledge with wolf and hawk spirits), 420px WebP.
- `card-art.md`: added the Kunoichi card art prompt (matches the new Beast Blitz cut-in face).
- New Beast Blitz cut-in face (`public/ui/blitz-face.webp`, 1015x405): Kasei mid-battle-cry with wolf and hawk spirits behind her.
- `card-art.md`: added the Kunoichi (Beast Blitz) cut-in prompt.
- New Pyre Adept cut-in face (`public/ui/pyre-glare.webp`, 1014x402): snarling adept with blazing eyes, matching the new card art.
- New Pyre Adept card art (two flames, snarling adept); `card-art.md` gained a skill cut-in art section with specs and the Pyre Adept cut-in prompt.
- `card-art.md`: added the Pyre Adept prompt (matches the current art; Sorae, kept distinct from the Pyroblast mage).
- New 420px WebP art (~34-42 KB) for the Zombie token, Shambling Ghoul, Plague Priest, Rotting Hulk, Carrion Colossus and Raise Horde; old PNGs deleted; `card-art.md` status updated.
- Added `card-art.md`: card art design guide (house style, composition rules, palettes, delivery checklist) with the prompt for each card.
- New WebP art (420-520px, ~35-40 KB) for Pyroblast, Ancient Treant, Call Wolves, Overgrowth and Bulwark; old PNGs deleted.
- Skill cut-in for Thornwood Brute's Whipflash (snarling panda-faced brute on a thorn-green band); new `whip` cut-in kind.
- Card Codex detail card tilts in 3D: follows the mouse on desktop, the gyroscope on phones; parallax art, floating panel, glare.
- Card Codex detail view: the art fills the whole modal; details sit in a translucent frosted panel over it.
- New optimized WebP art (420-480px, ~40 KB) for Ember Sprite, Stoneback Cub, Sky Talon, Thornwood Brute, Granite
  Sentinel, Storm Drake and Dread Maw; explicit `art:` set, old PNGs deleted.
- Merged `main` (owner's CLAUDE.md, new Kunoichi/Swift Lancer art) into this branch; one CLAUDE.md now holds the owner's rules
  plus the UI-systems notes and this log. Attribution rule kept as "never credit Claude".
- Skill cut-ins for Grave Call (necromancer grin) and Pyre Adept's spell trigger (burning glare); Kunoichi's cut-in
  uses the battle-cry face; new optimized art for Grave Necromancer and Pyre Adept. `BlitzUltimate` → `CutIn`.
- Beast Blitz announces only when Kunoichi and a beast meet; Thornwood Brute and Dread Maw added to the beasts;
  lightning replaces the fangs/flames on empowered beasts.
- Drag a ready creature onto the enemy board in Main to start combat with it as the attacker.
- Phase banners hold the board (pre-change state) and lock the cards until they leave.
- Beast Blitz cut-in (band across the middle); dark backdrops for skills and phase banners.
- Combat death sequence (impact → crack → pulverize), banner/clash spacing, Attack-phase card lock.
- Board UX: move nudges, block lines, haste tag, first-strike cinematic, blitz mark.

## Keeping this file current

Whenever you change commands, tooling, rules, mechanics, card art conventions, deployment/env handling,
workflow rules or known issues, edit the matching section here in the same commit. When you fix a known
issue, delete it from "Known issues". When the owner states a new standing instruction, add it to
"Workflow rules from the owner". If a change touches nothing described here, say so in your summary instead
of making an empty edit.
