# CLAUDE.md

Guidance for Claude Code (and anyone else) working in this repo. **Keep this file current: every change
you make must update it in the same commit if it touches anything described here** (commands, rules,
mechanics, tooling, conventions, known issues). See "Keeping this file current" at the bottom.

## What this is

**Entity Duel (Arcanum TCG)**: a small Magic-inspired card game. React + Vite + TypeScript, a pure
deterministic engine, an in-browser heuristic AI, online PvP over Supabase Realtime (lockstep), Zustand
for UI state, Capacitor for mobile. Hosted on Vercel. CI (`.github/workflows/ci.yml`) runs tsc, tests and build on PRs and pushes. Deeper docs: `README.md` (setup),
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
- **Combat clash timing** (`firstStrike.ts`, `fxTiming.ts`): `combatHoldMs` delays the next banner until the
  clash is over (+1.3 s). Kills play impact → crack (0.3 s, `ShatterFx`) → pulverize (0.2 s) → gone; the dying
  card stays until then via `CardView` variants.
- **Skill cut-ins** (`CutIn.tsx`, `CastSpotlight.tsx`): a slanted band across the middle with the caster's face
  right of centre (so the floating spotlight card never covers it), speed lines, flash, dim backdrop. Kinds in
  `fxTiming.ts`: `CUTINS` (cast-time skills: Beast Blitz `blitz`, Grave Call `grave`, 2.4 s) and
  `TRIGGER_CUTINS` (spell triggers: Pyre Adept `pyre`, 1.8 s). Colours are CSS vars on `.blitz-ult.<kind>`.
  One band per kind at a time. To add one: art in `public/ui/`, entry in `CutIn.tsx` `ART`, a table entry, a
  colour block in `index.css`.
- **Beast Blitz** (engine + store): Kunoichi gives `BLITZ_BEASTS` (+1/+1: Swift Lancer, Sky Talon, Stoneback
  Cub, Wolf, Thornwood Brute, Dread Maw). `blitzCue(player, card)` decides when it *announces* (log line,
  spotlight, cut-in): only when Kunoichi and a beast meet, whichever arrives second, or Call Wolves makes wolves
  beside her. Kunoichi alone is a plain 2/1. Empowered beasts wear `Lightning.tsx` (yellow bolts revolving around
  the card).
- **Drag to attack** (`Board.tsx`, `CardView.tsx`): in your Main phase, dragging an untapped, non-summoning-sick
  creature onto the enemy zone (`.player-zone.opp`) advances to combat with it pre-picked (`autoAttack` ref).
  Other creatures are not draggable. Works for mouse and touch (framer sets `touch-action: none`).

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
Replaced so far: insight, kunoichi, swift_lancer, pyre_adept, grave_necromancer.
Effect art (cut-in faces) lives in `public/ui/` (`blitz-face.webp`, `grave-grin.webp`, `pyre-glare.webp`).

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

- `npm run lint` currently reports one warning (`src/ui/Board.tsx` ~line 154, `react-hooks/exhaustive-deps`, a
  missing `game.players` dependency in a `useEffect`). It came in with the owner's Board UX commits; the lint
  script allows zero warnings, so fix it (carefully: it changes when that effect runs) before relying on lint.
- Not done: keyword badges on board cards; Beast Blitz is not data-driven; no animation for discard/recall
  beyond the log and the cast spotlight; the full 56-match browser pass has not been run since the mechanics phases.

## Change log (newest first; add a line per change)

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
