# CLAUDE.md

Guidance for Claude Code (and anyone else) working in this repo. **Keep this file current: every change
you make must update it in the same commit if it touches anything described here** (commands, rules,
mechanics, tooling, conventions, known issues). See "Keeping this file current" at the bottom.

## What this is

**Entity Duel (Arcanum TCG)**: a small Magic-inspired card game. React + Vite + TypeScript, a pure
deterministic engine, an in-browser heuristic AI, online PvP over Supabase Realtime (lockstep), Zustand
for UI state, Capacitor for mobile. Hosted on Vercel. CI (`.github/workflows/ci.yml`) runs tsc, tests and build on PRs and pushes. Deeper docs: `card-art.md` (card art style guide and prompts), `README.md` (setup),
`ARCHITECTURE.md` (how it works and why, with a "what changed and what it found" log), `LORE.md` (the world,
the 8 decks, card flavour), `docs/MECHANICS_PLAN.md` (the mechanics roadmap, Phases 0-3 all done),
`tools/qa/README.md` (the QA harness).

## Commands

```bash
npm run dev           # http://localhost:5173 (the browser QA tools play against this; it can die between shell calls, check it)
npm test              # vitest: `engine` project on node, `ui` project on jsdom (all unit tests)
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
- **`tools/qa`**: the QA harness (fuzz oracle, win-rate sim, browser match runner, scenarios, smoke).

## UI systems worth knowing

- **Framer owns card transforms.** Effects on cards use box-shadow, CSS individual `scale`/`translate`/`rotate`,
  WAAPI, filter, or SVG, never `transform` on the card. `AnimatePresence custom={...}` + `variants` +
  `exit="out"` for exits (the `exit` prop can't take a resolver in v11).
- **Phase banners** (`PhaseBanner.tsx`, `phaseInfo.ts`): 3 s banners (`PHASE_BANNER_MS`) with a 1.2 s gap
  (`PHASE_GAP_MS`), dark `.pb-dim` backdrop. While a banner is pending or showing, `Board.tsx` renders the
  state from *before* the phase change (`hold`) and locks all cards (`cardsLocked`); both release when the
  banner leaves. A combat resolution is never held (`combatJustResolved`), and `BoardFx`, the block announce
  and `impactDelays` read the live game. AI waits `PHASE_PAUSE_MS` after a phase change.
  **An empty block step gets no banner** (`blockStepIsEmpty` in `phaseInfo.ts`): when the defender has no creature that can block any
  attacker (none untapped, or every attacker flies and they have no flyer/reach) and no instant or flash card they can afford,
  `PhaseBanner` skips the "Block phase" banner (no dim, no lock; it releases the board at once unless an earlier banner is still
  up), the Board auto-resolves the block for a human defender (same helper), and the store skips the AI's `PHASE_PAUSE_MS`
  (`phasePauseMs`) so the damage lands in about half a second instead of waiting out a banner that never came.
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
- **Zombie rise** (`CardView.tsx` `rising`, `.card.arena.rising` / `zombie-rise` in `index.css`): a Zombie token on the battlefield (Grave Necromancer's trigger, Raise Horde, Rotting Hulk's last breath) does not slam down; it claws up out of the ground: the card is revealed from its base upward behind a soil mound, wobbles, soil clods spray, and its P/T shield pops in last. Pure CSS per card with its own `--rise-delay` (250-580 ms, from the iid), so tokens raised together rise independently and nothing in the game or the telegraphs waits on it. `isRising(iid, seed)` is true for the first 2.5 s after a token is first drawn (table resets with each new game), so re-renders and hotseat flips never replay it. Reduced motion collapses it through the global rule.
- **Beast Blitz** (engine + store): Kunoichi gives `BLITZ_BEASTS` (+1/+1: Swift Lancer, Sky Talon, Stoneback
  Cub, Wolf, Thornwood Brute, Dread Maw). `blitzCue(player, card)` decides when it *announces* (log line,
  spotlight, cut-in): only when Kunoichi and a beast meet, whichever arrives second, or Call Wolves makes wolves
  beside her. Kunoichi alone is a plain 2/1. Empowered beasts wear `Lightning.tsx` (yellow bolts revolving around
  the card).
- **Home duellists** (`MainMenu.tsx` `useDuelists`, `.vs-side` in `index.css`): the two slabs behind the menu show random creatures from the eight decks, each swapped every 9 s (left first, right half a cycle later, never the same card on both sides). The corner tag shows the card name and its deck, and re-fades with the art. The art fades in, then drifts sideways (`vs-drift`, 18 s, opposite directions; the 1.3 zoom leaves room to travel). Reduced motion keeps the swap, drops the drift. Art comes from `def.art`, so it follows card-art replacements automatically.
- **Drag to attack** (`Board.tsx`, `CardView.tsx`): in your Main phase, dragging an untapped, non-summoning-sick
  creature onto the enemy zone (`.player-zone.opp`) advances to combat with it pre-picked (`autoAttack` ref).
  Other creatures are not draggable. Works for mouse and touch (framer sets `touch-action: none`).

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
6. **Tokens** never go to the graveyard (they still trigger dies effects). Dead creatures drop all buffs.
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
  with the same code otherwise; keep every deck between about 45% and 58%. Last measured range 46.6%-55.9% (before the owner's Beast Blitz change added Thornwood Brute and Dread Maw to the aura list, so re-measure Wildblitz and Emberwood).
- **Do not edit `src/` while a browser batch runs** (hot reload disturbs the matches). If every match "crashes"
  in 0 seconds, the dev server is down. One lone anomaly under load (`HUD_LIFE`, a missed tap) is usually a
  load flake: replay the same pairing a few times and compare with the code without your change before acting.
- Verify UI changes in a real browser at desktop, portrait phone (390 wide), small phone (320x568) and
  landscape phone; screenshots count as evidence, a guess does not.

## Mechanics currently in the game

Keywords (12): haste, flying, defender, reach, vigilance, first strike, double strike, trample, deathtouch,
lifelink, flash, prowess. Effects: damage, draw, buff, heal, ramp, token, tapAll, destroy, discard (random,
deterministic), recall (most recently fallen creature). Triggers: `onEnter` (a targeted one waits on `pending`,
resolved by `resolveTrigger`), `onDeath` (active player first; tokens trigger), `spellTrigger`. Flashback
(cast from the graveyard, then exiled; `PlayerState.exile`). Mulligan: opt-in at the engine, on in every real
game mode (A decides, then B; up to 3 mulligans; one card fewer each). Beast Blitz is still a hardcoded aura
list (`BLITZ_BEASTS` in `cards.ts`: Swift Lancer, Sky Talon, Stoneback Cub, Wolf, Thornwood Brute, Dread Maw;
it announces only when Kunoichi and a beast meet, see `blitzCue`). Until-end-of-turn buffs use `tempP`/`tempT`, cleared as the next turn begins.

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
warding_stance, scorch, ashigaru, cinderbolt, shuriken_volley, topple, take_counter, grasp_from_grave, soul_siphon, wild_growth, aether_well, withering_touch (every card now has new art).
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
  flavour), `docs/MECHANICS_PLAN.md` (status), `tools/qa/README.md` (tooling), the in-game Rulebook
  (`src/ui/Rulebook.tsx`) for player-facing rules, and this file.
- Report honestly: say what was and was not run, and call out anything unreproduced or unverified.

## Known issues

- `npm run lint` currently reports two `react-hooks/exhaustive-deps` warnings, both from the owner's recent commits: `src/ui/Board.tsx`
  ~line 154 (missing `game.players` in a `useEffect`) and `src/ui/BoardFx.tsx` ~line 694 (missing `flushCues`). The lint script
  allows zero warnings, so fix them (carefully: each changes when its effect runs) before relying on lint.
- Not done: keyword badges on board cards; Beast Blitz is not data-driven; the full 56-match browser pass has not been run since the mechanics phases.

## Change log (newest first; add a line per change)

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
