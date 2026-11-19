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
list (`BLITZ_BEASTS` in `cards.ts`). Until-end-of-turn buffs use `tempP`/`tempT`, cleared as the next turn begins.

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

## Workflow rules from the owner

- **Update this file with every change** (see below).
- **Never open a pull request unless asked.** When one is opened, assign it to `crougheinman`.
- **Push to `main` only when the owner says so** ("push to main"); otherwise commit and push to the working
  branch. Pushes are normal pushes, never forced; if `main` has moved, merge it in, resolve conflicts, re-run
  the checks, then push. The owner also commits to `main` directly, so always `git fetch` first.
- Commit by concern, with a message that says what and why. Commit messages end with the attribution lines the
  session provides; never put a model name in code, comments or docs.
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

## Keeping this file current

Whenever you change commands, tooling, rules, mechanics, card art conventions, deployment/env handling,
workflow rules or known issues, edit the matching section here in the same commit. When you fix a known
issue, delete it from "Known issues". When the owner states a new standing instruction, add it to
"Workflow rules from the owner". If a change touches nothing described here, say so in your summary instead
of making an empty edit.
