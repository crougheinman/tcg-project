# Arcanum TCG — Architecture

Onboarding deep-dive for anyone (human or model) picking up this codebase. Read this
first, then the code. Every claim is anchored to `file:line`.

---

## 1. What it is

Arcanum TCG (labeled "Entity Duel" in some UI) is a Magic-inspired trading card game.
~8,500 LOC, ~44 source files. Modes: **vs AI** (heuristic, in-browser, offline), **local
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
call. `aiShouldAct` gates on whose turn/phase it is; `pickAction` dispatches to
`pickMain`/`pickAttacks`/`pickBlocks`/`pickWhipflash`. `pickMain` hand-rolls an 11-rung priority
ladder (land → lethal burn → removal → destroy → topple → best creature → tokens → ramp → heal →
buff → draw → advance) — note it does **not** consume `rules.legalActions`, so the two can drift
(a known gap, §6). `pickBlocks` is the strongest routine. The self-play harness
(`ai/__tests__/ai.test.ts`) runs every deck pairing across seeds with a 4000-step cap and asserts
termination + a winner.

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
Vitest config (`environment:'node'`, no DOM). `tsconfig.json` is `strict:true` but the `build`
script is `vite build` alone with **no `tsc` step** — type errors do not fail the build (run
`npx tsc --noEmit` manually). Secrets hygiene is clean (only the public anon key; `.env*`
gitignored). Assets are the weight problem: ~17 MB of uncompressed PNGs in `public/ui/`.

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
- **No `tsc` in the build.** CI/pre-commit does not exist yet; run `npm test` and `npx tsc --noEmit`
  before pushing.
- **The store is not unit-testable** under the current `environment:'node'` Vitest config (it touches
  `localStorage` / `import.meta.env`). Push logic worth testing down into the pure engine and test it
  there.

---

## 6. Known risks (ranked)

Ranked by severity. The two High-severity determinism/crash bugs were fixed (see §7) and removed
from this list.

| Sev | Issue | Location | Why it matters |
|-----|-------|----------|----------------|
| **High** | **No reconnect / no state resync.** `leave()` tears down with no rejoin; a >12s stall forfeits; a reload loses `buffer`/`appliedCount`/`sentHistory`. | `net/match.ts` `leave`, watchdog | Any transient blip permanently ends a match. |
| **High** | **Trust-the-peer cheat surface.** `validateAction` checks legality but never authenticates the sender; both hands/libraries live in every client's `GameState`. | `rules.ts` `validateAction`; `net/match.ts` | Hidden info isn't hidden; a modified client can act out of turn. Deferral is acknowledged in-code. |
| **High** | **Type-checking never runs at build.** `build` is `vite build` alone; strict TS is editor-only. | `package.json` scripts | A type error ships silently. Fix: `"build": "tsc --noEmit && vite build"`. |
| **High** | **~17 MB uncompressed PNGs shipped.** `shield.png` 13.9 MB + `sword.png` 3.4 MB, no image pipeline. | `public/ui/` | Severe payload for mobile + web first load. |
| **High** | **`Board.tsx` god component + whole-`game` subscription.** 919 lines; effects depend on `[game]` so any change re-renders the whole tree; no memoization on `CardView`/`PlayerBar`. | `ui/Board.tsx`, `ui/BoardFx.tsx` | One spell → dozens of re-renders; hard to test/change. |
| **Med** | **AI never casts instants / combat tricks**, and duplicates the engine's legality model instead of using `rules.legalActions`. | `ai/ai.ts` | Biggest play-strength gap; AI can emit actions the reducer rejects when the two drift. |
| **Med** | **`pickAttacks` swings with everything**, ignoring blockers/lethal crackback. | `ai/ai.ts` `pickAttacks` | Feeds creatures into losing trades. |
| **Med** | **No double-deck-out terminal.** Deck-out is only checked on a forced draw. | `reducer.ts` `drawCard` | A both-empty board has no terminal condition (unlikely at 20 life / 30 cards). |
| **Med** | **Host/join race + multiple-joiner corruption**; unhandled Supabase send/subscribe errors; 4-char room code with no uniqueness/auth; peer deck id trusted with divergent fallbacks. | `net/match.ts` `createMatch`/`joinMatch` | Handshake robustness gaps; a stray joiner can corrupt an in-progress match. |
| **Med** | **No CI, no lint** (an `eslint-disable` in `Vfx.tsx` is inert — ESLint isn't installed); **two unsynced version sources** (`version.ts` `1.0.2` vs `package.json` `0.1.0`); **no `prefers-reduced-motion`** despite `repeat:Infinity` loops. | `package.json`, `src/version.ts`, `ui/ImpactFx.tsx` | Regressions land unnoticed; accessibility/versioning drift. |
| **Low** | `spellTrigger` loop reads a live-mutated array (`reducer.ts` `castSorcery`); `destroy` isn't truly unconditional (>9999 toughness survives); unbounded net resend history; dead `STARTER_DECKS` export; click-only cards with no keyboard path. | various | Latent hazards + accessibility gaps. |

---

## 7. Recent fixes

Two High-severity PvP-integrity bugs were fixed. Both were rooted in the §3 actor model.

### (a) Seq-collision desync — fixed by a store actor-guard
The lockstep transport stamps every action with a single shared `appliedCount` counter and
assumes "one legal actor per phase." Nothing enforced that: the store's `dispatch` never checked
turn ownership and `advance` has no engine-level actor guard, so in PvP the *non-actor* client
could originate an action (e.g. the active player firing `advance` during `combat_block` while the
defender blocks), both clients would stamp the same `seq`, and each would drop the other's copy as
"already applied" → permanent, silent divergence.

**Fix:** make the invariant true by construction. `dispatch` now drops any local PvP action when
`myId !== actorOf(game)` (`src/store/gameStore.ts` `dispatch`). The transport is unchanged.

### (b) `declareBlockers` validation crash — fixed by a null-guard
`validateAction`'s `declareBlockers` case did `findCreature(state, atkIid)!.card`. If the attacker
left the battlefield mid-`combat_block` (the defender's instant killed the tapped attacker), it is
still listed in `combat.attackers`, so validation reached it and the non-null assertion threw an
uncaught `TypeError`.

**Fix:** `findCreature(...)` is null-checked and throws a clean `Error('attacker no longer in play')`
(`src/engine/rules.ts` `declareBlockers` case), mirroring the reducer's existing
`?.card; if (!atk) continue` guard in `resolveCombat`.

**Supporting change:** the `combat_block ? defender : active` expression, previously copy-pasted in
three files, is now the exported `actorOf(state)` helper in `src/engine/rules.ts`, reused by the
reducer, the validator, and the store.

**Tests** (`src/engine/__tests__/engine.test.ts`): `actorOf` returns the right player per phase; a
block declared for an attacker that died mid-`combat_block` throws a clean `Error`, not a
`TypeError`. Full suite: 49 tests green; `npx tsc --noEmit` clean.

---

## 8. Run it

```bash
npm install
npm run dev       # http://localhost:5173 — vs AI / hotseat work with no setup
npm test          # engine + AI tests (vitest, node env)
npx tsc --noEmit  # type-check (the build does NOT do this)
npm run build     # production build into dist/
```

Online PvP needs a free Supabase project — copy `.env.local.example` to `.env.local` and fill in
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` (see `README.md`).
