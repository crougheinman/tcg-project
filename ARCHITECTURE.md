# Arcanum TCG — Architecture

Onboarding deep-dive for anyone (human or model) picking up this codebase. Read this
first, then the code. Every claim is anchored to `file:line`.

---

## 1. What it is

Arcanum TCG (labeled "Entity Duel" in some UI) is a Magic-inspired trading card game.
~7,100 lines of TypeScript across ~42 source files. Modes: **vs AI** (heuristic, in-browser, offline), **local
hotseat**, and **online PvP**. Web + mobile (Capacitor).

Stack:
- **React + Vite + TypeScript** — UI + build.
- **Pure-TS deterministic engine** (`src/engine`) — the single source of truth for the rules.
- **Heuristic AI** (`src/ai`) — runs in the browser, zero cost.
- **Supabase Realtime** — PvP transport (lockstep: relay actions only, both clients replay
  through the same engine; no server compute).
- **Zustand** (`src/store`) — UI/runtime state; the only bridge between engine and React.
- **Capacitor** — Android/iOS wrapper.

**The whole thing rests on one thesis:** the rules engine is a pure, seeded, side-effect-free
reducer `applyAction(state, action) => newState`. Same seed + same action stream ⇒ byte-identical
game on every client. That determinism is what makes free PvP possible — clients agree on a seed
and exchange only actions.

---

## 2. Architecture & data flow

Four layers, one deterministic engine at the bottom, exactly one bridge (the Zustand store)
between the engine and everything else.

```
                    ┌────────────────────────────────────────┐
                    │  UI (React + framer-motion + three.js)  │
                    │  Board.tsx · BoardFx.tsx · CardView …    │
                    └───────────────┬───────────────▲─────────┘
                      dispatch(action)              │ selectors read `game`
                                    ▼               │
                    ┌────────────────────────────────────────┐
                    │  STORE  (Zustand `useGame`)             │
                    │  one canonical GameState · scheduleAi   │
                    └───┬─────────────┬─────────────┬─────────┘
             pickAction │             │ applyAction │ sendAction / onAction
                        ▼             ▼             ▼
                ┌────────────┐  ┌───────────┐  ┌──────────────────┐
                │  AI (ai.ts)│  │  ENGINE   │  │  NET (match.ts)  │
                │ stateless  │  │ applyAction│ │ seq'd lockstep   │
                │ heuristic  │  │ pure/clone │  │ over Supabase    │
                └────────────┘  └─────┬─────┘  └────────┬─────────┘
                                reads │ CardDef          │ actions ⇄ peer
                                      ▼                  │
                                ┌───────────┐            │
                                │ CARDS     │◄───────────┘
                                │ cards/decks│ both peers replay same seed
                                └───────────┘
```

**Flow.** UI pointer/touch events become an `Action`, passed to the store's single
`dispatch` (`src/store/gameStore.ts` → `dispatch`), which calls the pure reducer
`applyAction(state, action)` (`src/engine/reducer.ts:21`).
- **AI mode:** after applying, the store recursively schedules the AI (`scheduleAi`,
  `gameStore.ts:87`) — a self-terminating `setTimeout` recursion, *not* a `useEffect`, so it
  can't fall into a render loop.
- **PvP mode:** after applying locally, the store forwards the action to the net relay
  (`gameStore.ts` `dispatch` → `net.sendAction`), and inbound peer actions are applied through
  the same `applyAction` (`startPvp` → `net.onAction`).
- The UI never mutates game state. `BoardFx.tsx` is a **read-only** VFX orchestrator that derives
  visuals by diffing successive `GameState`s.

### The determinism thesis, and how the code upholds it

- **Pure reducer.** `applyAction` `structuredClone`s the state before mutating
  (`reducer.ts:24`); inputs are never touched.
- **Validate before clone.** `validateAction` (`rules.ts`) throws on illegal input *before* any
  mutation, so networked/malicious actions can't corrupt shared state. The store catches the throw
  and surfaces an error instead of crashing.
- **No wall-clock / global random in the engine.** There is no `Math.random` / `Date` /
  `performance.now` anywhere in `src/engine`. The PRNG is threaded explicitly through
  `GameState.rngState` (`src/engine/rng.ts`, `state.ts`). (Note: the in-game PRNG is currently
  **vestigial** — `rngState` only advances during the two opening shuffles and is never consumed
  after; all in-game "randomness" is deterministic array iteration.)
- **State-based-action loop.** Every action ends with `checkDeaths → recomputeAura → checkDeaths`
  (`reducer.ts:118-120`) — double-checked because removing an aura source (Beast Blitz) can newly
  kill a creature.
- **Network outcomes stay out of GameState.** Forfeit/disconnect are tracked in the store's
  `forfeit` field, never in `GameState`, so a network event can't diverge the two engines.

---

## 3. The actor model (critical for PvP correctness)

**At every phase, exactly one player may legally originate actions.** This is the invariant the
lockstep transport depends on (`src/net/match.ts` header comment). It is encoded in one place:

```ts
// src/engine/rules.ts
export function actorOf(state: GameState): PlayerId {
  return state.phase === 'combat_block' ? opponentOf(state.active) : state.active;
}
```

| Phase | Legal actor | Actions |
|-------|-------------|---------|
| `main1` | `active` | playLand, castCreature, castSorcery (sorcery/instant), whipflash, advance |
| `combat_attack` | `active` | declareAttackers, castSorcery (instant), advance |
| `combat_block` | **`opponentOf(active)`** (defender) | declareBlockers (resolves combat), castSorcery (instant) |
| `end` | `active` | advance (→ next turn) |

Key subtleties:
- During `combat_block` the **defender** is the sole actor: the reducer forces the instant caster
  to `actorOf(state)` (`reducer.ts` `castSorcery`), so the active player literally cannot cast
  there. `declareBlockers` itself calls `resolveCombat` (`reducer.ts` `declareBlockers`), so the
  active player never needs to act during `combat_block`.
- `actorOf` is reused everywhere the "who acts now" question is asked: the reducer's `castSorcery`
  caster, the validator's `castSorcery` caster, and the store's `telegraphFor`. **Do not
  re-inline this expression** — call `actorOf`.
- **In PvP, the store enforces this:** `dispatch` drops any local action when
  `myId !== actorOf(game)` (`gameStore.ts` `dispatch`). Without that guard, the non-actor client
  can stamp the same lockstep `seq` as the actor and permanently desync (see §7, Recent fixes).

---

## 4. Subsystem tour

**Engine — `src/engine`.** The pure reducer `applyAction(state, action) => newState`
(`reducer.ts:21`) short-circuits on a set winner, runs `validateAction` (`rules.ts`) which throws
before cloning, then `structuredClone`s and switches on action type. Combat resolves inside
`declareBlockers` → `resolveCombat` (`reducer.ts:277`), which skips dead attackers with
`findCreature(...)?.card; if (!atk) continue` (`reducer.ts:289`). `checkDeaths` (`reducer.ts:333`)
is the state-based-action engine: damage ≥ toughness dies, life ≤ 0 sets the winner. The `blitz`
flag separates the Beast Blitz aura from permanent buffs (`recomputeAura`, `reducer.ts:133`) so a
Wild-Growth-style buff survives when the aura ends. Types live in `types.ts` (the `Action` union
is at `types.ts:107`).

**AI — `src/ai/ai.ts`.** A stateless, greedy, no-look-ahead heuristic returning one `Action` per
call. `aiShouldAct` is just `actorOf(state) === ai`; `pickAction` dispatches to
`pickMain`/`pickAttacks`/`pickBlocks`/`pickWhipflash`. Candidates come from
`rules.legalActions` — the AI **ranks**, it does not generate, so it cannot emit an action the
reducer rejects and the two legality models cannot drift. `scoreAction` assigns a priority BAND
(land → lethal burn → removal → destroy → topple → creature → token → ramp → heal → buff → draw →
advance, with `never` for legal-but-unwanted moves like wasted burn) plus a within-band tiebreak
(biggest threat first, cheapest card that does the job). The two combinatorial actions —
`declareAttackers` and `declareBlockers` — are still built directly, since enumerating every
subset/assignment is exponential. `pickAttacks`/`pickBlocks` first look for a combat trick scoring
at or above `COMBAT_TRICK_MIN` (removal only), which is what finally makes block-only instants like
Take Counter and Grasp from the Grave live. `pickBlocks` is the strongest routine. The self-play
harness (`ai/__tests__/ai.test.ts`) runs every deck pairing across seeds with a 4000-step cap and
asserts termination, a winner, and that every picked action was one `legalActions` offered.

**Cards — `src/cards`.** A fully data-driven catalog of 41 `CardDef`s (`cards.ts`) plus 8 starter
decks of 30 (`decks.ts`). Effects are a discriminated union of 8 kinds (`types.ts`), **every one
implemented** in the `applyEffect` switch (`reducer.ts:189`). All 3 keywords (haste/flying/defender)
are consumed; `destroy` is a `damage += 9999` sentinel (`reducer.ts:254`) routed through the normal
death path. New cards are almost entirely authoring, not code. The one non-data mechanic is Beast
Blitz, a hardcoded `BLITZ_TARGETS` list in the reducer (`reducer.ts:131`).

**Net — `src/net/match.ts`.** Client-authoritative lockstep over Supabase Realtime broadcast,
relaying only player actions (plus out-of-band chat/liveness/forfeit). Host `createMatch`
(`match.ts:212`) mints a 4-char room code + seed; the join→init handshake shares seed + both deck
ids, then both clients build identical state via `createInitialState` and replay. A single
`appliedCount` counter stamps each action's `seq` (`match.ts` `sendAction`); the inbound handler
dedups (`seq < appliedCount || buffer.has(seq)`), buffers out-of-order actions, and requests gaps
via `resend` with a 1200ms retry. Liveness = 3s ping / 12s watchdog. **This layer assumes the §3
actor invariant** — its correctness comment says "only one player is the legal actor at any moment."

**Store — `src/store/gameStore.ts`.** One Zustand store (`useGame`) is the sole engine↔UI bridge,
holding a single canonical `GameState` (never mirrored) across four modes (menu/ai/hotseat/pvp).
`dispatch` re-reads fresh state via `get()`, runs `applyAction` in try/catch (errors → `error`,
not thrown through React), then forwards to net or re-arms the AI. Telegraphed spells set `charging`
and defer the reducer via `setTimeout` so `BoardFx` can play a lead-in; **telegraphs are disabled
in PvP** to avoid timing desync. `main.tsx` deliberately omits `StrictMode` to avoid double-opening
the realtime channel.

**UI — `src/ui`.** ~24 files. `Board.tsx` (~919 lines) is a god component owning all interaction
state (selection, attackers, blocks, targeting, menus, coach tips) and the layout. `BoardFx.tsx` is
a read-only VFX orchestrator: one big `useEffect` keyed on `game` diffs prev vs next and imperatively
spawns ~15 effect kinds via `getBoundingClientRect` on `data-iid`-tagged nodes. Three visual engines
coexist: framer-motion (declarative card motion), the Web Animations API (combat lunges/shakes, to
avoid fighting framer's transform ownership), and a single lazy-loaded three.js particle overlay
(`Vfx.tsx`). Fx overlays render as siblings of `.board` (not children) because `.board` gets a CSS
transform during shake that would break `position:fixed` descendants.

**Build — root config.** Deliberately minimal: 5 npm scripts, one `vite.config.ts` doubling as the
Vitest config (`environment:'node'`, no DOM). `tsconfig.json` is `strict:true` and the `build`
script runs `tsc --noEmit && vite build`, so type errors fail the build. CI (`.github/workflows/ci.yml`) runs tsc, tests and build on every PR. Secrets hygiene is clean (only the public anon key; `.env*`
gitignored). Assets were the weight problem (17 MB of 4000×4000 PNGs in `public/ui/` plus a 7.5 MB GIF); they are now resized/re-encoded and `public/` is ~8 MB.

---

## 5. Conventions & gotchas

- **Validate-before-clone.** New rules go in `validateAction` (throw a plain `Error`) *and* the
  reducer switch. The validator must never dereference possibly-missing state — guard with
  `findCreature(...)` null checks, don't use `!`.
- **`actorOf` is the single source of truth for "who acts now."** Reuse it; never re-inline the
  `combat_block ? defender : active` ternary.
- **Effects are data.** Prefer adding a `CardDef` in `cards.ts` over engine code. Only touch the
  reducer if you need a genuinely new `Effect` kind (then add it to the `types.ts` union *and* the
  `applyEffect` switch).
- **The store is the only place with side effects** (localStorage, timers, net). The engine and AI
  stay pure.
- **PvP disables telegraphs** and applies actions immediately then broadcasts — keep new UI
  animations out of the PvP action path or they'll desync timing.
- **CI runs tsc + tests + build** on PRs and pushes to `main`; run `npm test` and `npx tsc --noEmit`
  locally before pushing.
- **Two Vitest projects** (`vitest.workspace.ts`): `engine` runs the pure core under node, `ui` runs
  the store and components under jsdom. Prefer the `engine` project — push logic worth testing down
  into a pure module and test it there; `net/lockstep.ts` is the pattern (all the sequencing logic,
  none of the transport). The `ui` project is for code that genuinely needs a DOM.
- **Lint runs in CI** (`npm run lint`, `--max-warnings 0`). Fix findings rather than disabling rules;
  an `eslint-disable` sat inert in this repo for its whole life because ESLint was never installed.
- **The AI ranks, it does not generate.** New card behaviour goes in `legalActions` (so the move
  exists) and `scoreAction` (so the AI knows what it is worth). Never hand-roll candidate moves.

---

## 6. Known risks (ranked)

Ranked by severity. The two High-severity determinism/crash bugs were fixed (see §7) and removed
from this list.

| Sev | Issue | Location | Why it matters |
|-----|-------|----------|----------------|
| **High** | **Trust-the-peer cheat surface.** `validateAction` checks legality but never authenticates the sender; both hands/libraries live in every client's `GameState`. | `rules.ts` `validateAction`; `net/match.ts` | Hidden info isn't hidden; a modified client can act out of turn. Deferral is acknowledged in-code. |
| **Med** | **`Board.tsx` god component.** 919 lines owning every piece of interaction state. | `ui/Board.tsx` | Hard to test and change. **Note: this is a maintainability problem, not a performance one** — see §7(e). |
| **Med** | **AI still ignores buff-style combat tricks** (Iaijutsu Strike, Warding Stance): `COMBAT_TRICK_MIN` admits removal only, because pumping correctly needs block-assignment context. | `ai/ai.ts` | Iron Blossom's identity cards go unused, which is part of why it now sits low in the band. |
| **Med** | **`pickAttacks` swings with everything**, ignoring blockers/lethal crackback. | `ai/ai.ts` `pickAttacks` | Feeds creatures into losing trades. |
| **Med** | **No double-deck-out terminal.** Deck-out is only checked on a forced draw. | `reducer.ts` `drawCard` | A both-empty board has no terminal condition (unlikely at 20 life / 30 cards). |
| **Med** | **Host/join race + multiple-joiner corruption**; unhandled Supabase send/subscribe errors; 4-char room code with no uniqueness/auth; peer deck id trusted with divergent fallbacks. | `net/match.ts` `createMatch`/`joinMatch` | Handshake robustness gaps; a stray joiner can corrupt an in-progress match. |
| **Med** | **Two version sources to keep in sync** (`version.ts` and `package.json`, both `1.0.2`); **no `prefers-reduced-motion`** despite `repeat:Infinity` loops. | `package.json`, `src/version.ts`, `ui/ImpactFx.tsx` | Regressions land unnoticed; accessibility/versioning drift. |
| **Low** | `spellTrigger` loop reads a live-mutated array (`reducer.ts` `castSorcery`); `destroy` isn't truly unconditional (>9999 toughness survives); unbounded net resend history; dead `STARTER_DECKS` export; click-only cards with no keyboard path. | various | Latent hazards + accessibility gaps. |

---

## 7. Recent work

### (a) Two documented-but-absent fixes, made real
An earlier revision of this document described `actorOf`, a PvP actor guard in the store, and a
null-guard in `declareBlockers` validation as *done*. **None of them were in the tree.** Both
underlying bugs were live until they were fixed for real:

- **Seq-collision desync.** The lockstep transport stamps every action with one shared
  `appliedCount` and assumes "one legal actor per phase," but nothing enforced it. The non-actor
  client could originate an action (the active player firing `advance` during `combat_block` while
  the defender blocks), both clients would stamp the same `seq`, and each would drop the other's
  copy as "already applied" → permanent, silent divergence.
  **Fix:** `actorOf(state)` now exists in `src/engine/rules.ts` and is the single source of truth
  for "who acts now" (reused by the validator, the store and the AI). `dispatch` drops any local
  PvP action when `myId !== actorOf(game)`, making the invariant true by construction.
- **`declareBlockers` validation crash.** `validateAction` did `findCreature(state, atkIid)!.card`.
  If the defender's instant killed the tapped attacker mid-`combat_block`, it was still listed in
  `combat.attackers`, so validation reached it and the non-null assertion threw an uncaught
  `TypeError`. **Fix:** null-checked, throwing a clean `Error('attacker no longer in play')`.

Both are covered by tests that fail if the guard is removed.

### (b) PvP reconnect
`leave()` used to tear down with no way back, a >12s stall forfeited, and a reload lost the
in-closure `buffer`/`appliedCount`/`sentHistory` — so any transient blip permanently ended a match.

- The sequencing core moved to **`src/net/lockstep.ts`**: pure, no Supabase, no timers, no DOM, and
  therefore unit-testable under the repo's `environment:'node'` config (16 tests). `match.ts` now
  owns only the wire — channel wiring, liveness, handshakes.
- It keeps the **full applied log** rather than a send-only history. Two payoffs: either client can
  answer a resend for any `seq` (not just ones it originated), and the log doubles as a replayable
  match record.
- **Reconnect is replay.** `{seed, deck ids, log}` goes to `sessionStorage` (`net/resume.ts`); on
  rejoin the store rebuilds `createInitialState` and folds the log forward. No `GameState` is ever
  serialized — determinism does the work.
- A **`rejoin` handshake** pulls whatever the peer applied while we were away. It is reused for
  in-place resync when a stale peer returns, which covers the one gap the resend path cannot see:
  a drop at the *end* of the stream, where nothing newer arrives to reveal it.
- The watchdog is now two-stage: **stale** at 9s (recoverable, shows a banner) and **gone** at 45s
  (forfeits). `createMatch`/`joinMatch` also ignore a second joiner.

### (c) AI consumes `rules.legalActions`
`legalActions` was **dead code** — exported, imported nowhere — while `pickMain` hand-rolled a
parallel legality model. The AI now ranks candidates the rules enumerate instead of generating its
own, so the drift class is gone; `legalActions` itself became actor-aware and now enumerates
instants in the combat steps and whipflash targets.

Measured over 2,240 self-play games (all 56 deck pairings × 40 seeds):

| | errors | stalls | avg steps | win-rate band |
|---|---|---|---|---|
| before | 0 | 0 | 83.8 | 43.0 – 58.6 |
| refactor, tricks off | 0 | 0 | 83.8 | 43.0 – 57.5 |
| refactor, tricks on | 0 | 0 | 86.3 | 38.9 – 65.2 |

The middle row is the control: the scoring rewrite is behaviour-preserving, so the whole spread
comes from the new capability. (At 40 seeds each deck sees only ~560 games, ≈2pp of sampling
error, so these bands are noisier than they look — see §7(d).)

### (d) Balance retune
Teaching the AI to use instants invalidated the old ~44–56% tuning, which had been set against a
pilot that could not cast them. Re-measured at **120 seeds** (~1,680 games per deck, ≈1.2pp error),
the shipped decks spread **43.2 – 60.5** with Grave Tide at 60.5.

Four data-only changes (no engine code) bring it to **44.0 – 55.4**:

| Deck | Change | Why |
|---|---|---|
| Grave Tide | Withering Touch 4→3 damage; Shambling Ghoul 2/3→2/2; one Grasp → Ghoul | 4 damage for 2 at instant speed answered everything |
| Wildblitz | 12→10 lands, +2 Swift Lancer | a 1–3 curve deck was flooding; this was worth ~7pp |
| Pyromancer | 12→11 lands, +1 Pyre Adept | same flood, milder |
| Stonewall | one Storm Drake → Granite Sentinel | best blockers and best finisher was too much |

Two methodology notes worth keeping:
- **Mana flood was the dominant lever**, not card power. Cutting a single land moved Wildblitz
  ~7pp — more than any stat change tested.
- **Tune on one seed set, confirm on another.** Several promising tweaks at 40 seeds reversed sign
  on held-out seeds; they were fitting noise. The rig lives in the scratchpad, not the repo, since
  it is a measurement tool rather than a test.

### (e) The re-render "problem" was measured, and is not one
`Board` subscribes to the whole `game`, nothing is memoized, and a single state change
re-renders every `CardView` on screen. That was previously filed as a High-severity performance
risk ("one spell → dozens of re-renders"). It was measured instead of assumed, and the premise
does not hold.

`React.memo` on `CardView` (with a field-wise comparator, since every action `structuredClone`s
the state and hands each card a fresh object) plus `useEvent`-stabilised handlers in `Board` took
card re-renders from 42 per update to **0**. Chrome CDP `Performance.getMetrics`, 30 updates per
run, 3 runs, 42 cards on screen:

| | card re-renders | script ms/update |
|---|---|---|
| as shipped | 42 | 26.3 / 26.6 / 27.5 |
| memoized | 0 | 26.3 / 26.9 / 27.8 |
| no framer `layout` prop | 42 | 24.3 / 25.3 / 26.6 |

Eliminating **every** card re-render changed script time by less than 1% — inside run-to-run
noise. The work is in framer-motion's per-element machinery (`renderHTML`, `MotionComponent`,
`animateChanges`) and the browser's style/paint, all of which run whether or not React re-renders
the component. Dropping the `layout` prop saves perhaps 1.3ms and costs the card-reorder
animation; not a trade worth making.

**The memoization was therefore reverted rather than shipped**: a custom comparator and an extra
indirection are real stale-UI surface area, and they bought nothing measurable. Re-splitting
`Board` is still worth doing for readability — just not in the name of speed.

Two measurement traps worth remembering, both of which produced convincing wrong answers here:
- Timing `setState` → two `requestAnimationFrame`s measures the **frame rate**, not the render.
  Headless Chromium paces at ~30fps, so every result sat on a flat 33ms floor.
- Timing `setState` → forced layout flush measures **scheduling**, not rendering: React 18 renders
  asynchronously, so the flush happens before any component runs. Sub-millisecond numbers are the
  tell.
  Use `Performance.getMetrics` (ScriptDuration / RecalcStyleDuration / LayoutDuration) and a
  control run.

## 8. Run it

```bash
npm install
npm run dev       # http://localhost:5173 — vs AI / hotseat work with no setup
npm test          # all tests (vitest: `engine` project on node, `ui` project on jsdom)
npm run lint      # eslint, zero warnings tolerated
npx tsc --noEmit  # type-check (the build does NOT do this)
npm run build     # production build into dist/
```

Online PvP needs a free Supabase project — copy `.env.local.example` to `.env.local` and fill in
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (see `README.md`).
