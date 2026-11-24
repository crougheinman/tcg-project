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
- **In PvP and vs AI, the store enforces this:** `dispatch` drops any local action when
  `myId !== actorOf(game)` (`gameStore.ts` `dispatch`). In PvP, without that guard the non-actor
  client can stamp the same lockstep `seq` as the actor and permanently desync (see §7, Recent
  fixes); vs AI, it stops a stray human action from moving the AI's turn along. Hotseat is exempt
  (one person drives both sides). The AI applies its own moves directly, never through `dispatch`.

---

## 4. Subsystem tour

**Engine — `src/engine`.** The pure reducer `applyAction(state, action) => newState`
(`reducer.ts:21`) short-circuits on a set winner, runs `validateAction` (`rules.ts`) which throws
before cloning, then `structuredClone`s and switches on action type. Combat resolves inside
`declareBlockers` → `resolveCombat` (`reducer.ts:277`), which skips dead attackers with
`findCreature(...)?.card; if (!atk) continue` (`reducer.ts:289`). `checkDeaths` (`reducer.ts:333`)
is the state-based-action engine: damage ≥ toughness dies, life ≤ 0 sets the winner. Static
bonuses (Beast Blitz, Lords, Threshold) live in `auraP` / `auraT`, rebuilt from scratch after every action (`recomputeStatics` / `settle`, see (o)),
so a Wild-Growth-style permanent buff is untouched when an aura ends. Types live in `types.ts` (the `Action` union
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

**Deck building — `src/cards/customDecks.ts` + `ui/DeckBuilder.tsx`.** Players build their own
30-card decks. Because cards are already pure data, this is UI only — the engine never learns a deck
was hand-built. `validateDeck` is pure and tested: exactly 30 cards, at most `MAX_COPIES` (6) of any
non-land, at least one land, no unknown ids, and no tokens. The copy limit is 6 precisely so that
**every starter deck is itself a legal custom deck** (Skyward runs 6 Stoneback Cub), which is
asserted in a test — if the builder could not express a starter, it would not be enforcing the
game's own rules. The token blacklist is derived from the `token` effects that create Wolves and
Zombies, so a new token is excluded the moment something references it. Custom decks are
**local-only (vs AI / hotseat)**: the PvP handshake exchanges deck *ids* and each client resolves
them from its own catalog, so a custom id the peer has never seen would build two different decks
from one seed — a guaranteed desync. Sending the card list over the wire would lift that, but it is
a protocol change that also widens the peer-trust surface. Use `resolveDeck(id)` wherever a
player-chosen deck becomes cards; plain `deckById` knows only starters and silently falls back to
Emberwood.

**Cards — `src/cards`.** A fully data-driven catalog of 41 `CardDef`s (`cards.ts`) plus 8 starter
decks of 30 (`decks.ts`). Effects are a discriminated union of 8 kinds (`types.ts`), **every one
implemented** in the `applyEffect` switch (`reducer.ts:189`). All 12 keywords (haste, flying, defender,
reach, vigilance, first strike, double strike, trample, deathtouch, lifelink, flash, prowess) are consumed; their
player-facing text lives in one table, `cards/keywords.ts`, which the Rulebook and gallery read; `destroy` is a `damage += 9999` sentinel (`reducer.ts:254`) routed through the normal
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
in PvP** to avoid timing desync. Every sorcery/instant, and the creatures whose skill fires on cast
(`SKILL_CREATURES`: Kunoichi, Thornwood Brute), gets a telegraph, because the cast itself has a
visual: the **cast spotlight** (`ui/CastSpotlight.tsx`, driven by `spotlights[]` in the store) floats
the card up in the middle of the table, glowing, for the length of the window. The existing
charge/smoke/heal telegraphs keep their own lead-ins and are spotlit for their whole duration; a
creature's spell-trigger (Pyre Adept) spotlights that creature after the spell. In PvP the
spotlight plays *alongside* the action (local and remote), never delaying it. `main.tsx` deliberately omits `StrictMode` to avoid double-opening
the realtime channel.

**UI — `src/ui`.** ~24 files. `Board.tsx` (~919 lines) is a god component owning all interaction
state (selection, attackers, blocks, targeting, menus, coach tips) and the layout. `BoardFx.tsx` is
a read-only VFX orchestrator: one big `useEffect` keyed on `game` diffs prev vs next and imperatively
spawns ~15 effect kinds via `getBoundingClientRect` on `data-iid`-tagged nodes. Three visual engines
coexist: framer-motion (declarative card motion), the Web Animations API (combat lunges/shakes, to
avoid fighting framer's transform ownership), and a single lazy-loaded three.js particle overlay
(`Vfx.tsx`). Fx overlays render as siblings of `.board` (not children) because `.board` gets a CSS
transform during shake that would break `position:fixed` descendants.

**Depth — the 3D table (`ui/depth.ts`, `.board.depth-3d` in `styles/index.css`).** The battlefields
are tilted back with CSS 3D; the DOM, hit-testing and every effect stay exactly as they were. Each
battlefield carries its **own** `perspective()` and is flattened into its panel. The obvious
alternative — one `perspective` on `.board` with `preserve-3d` down the tree — was tried first and
fails: the far half of each battlefield rotates *behind* its own `.player-zone` panel, which then
hides the cards and swallows their clicks. Effects need no changes because they aim with
`getBoundingClientRect`, which reports the projected box. Two known approximations: the two
battlefields are separate planes matched by a `--seam` scale rather than one true surface, and
`lungeTo` translates in the tilted plane's space, so a lunge's vertical reach is foreshortened by a
few percent. Depth is presentation only and never touches timing, so it is safe in PvP. It defaults
on, except for reduced-motion or low-memory/two-core devices, and the in-game menu toggle overrides
the default either way.

**Block planning — `ui/blockSelection.ts`.** The defender builds blocks over several taps before
confirming, and all of the rules of that interaction are pure functions here (`tapBlocker`,
`tapAttacker`, `prune`), unit-tested without a browser. Legality is not re-derived: it comes from
`rules.canBlock`/`blockError`, the same function `validateAction` enforces, so the UI cannot offer a
pairing the engine would reject. One rule per gesture: tap an unassigned blocker to assign it (at
once if there is a single live attacker, otherwise it becomes *pending*); tap a pending blocker to
cancel; tap an assigned blocker to remove just that block; tap an attacker to give a pending blocker
its target. A refused pairing returns a `hint` that Board shows as a banner, and the attackers a
pending blocker cannot block are dimmed. `prune` runs from an effect in Board and drops any plan
that stopped being true (an instant killed the attacker). A property test (400 random block steps
with random taps and a mid-step kill) asserts the guarantee that matters: **no tap sequence can
produce a `declareBlockers` the reducer throws on.** Engine side of the same fix: `checkDeaths`
removes dead creatures from `combat.attackers`/`combat.blocks`, so `combat` never names a creature
that left play, and a dead **token** simply ceases to exist (`cards.isToken`, derived from the
`token` effects) instead of padding the graveyard.

**HUD — `ui/PlayerBar.tsx`, `ui/PhaseBar.tsx`.** Each player's badge is the shield (`data-player`,
the element every spell and attack aims at — keep that attribute on it), life, mana and, for the
opponent only, the counts a player cannot otherwise see: hand size, deck size and a button that
opens their graveyard. Life counts to its new value (`useRolling`) and flashes the way it moved;
mana is one crystal per land, falling back to a number past ten lands and on the phone's compact
opponent row. The player the game is waiting on (`actorOf`) gets a gold ring, and the lit phase
step is gold on your turn and red on theirs, because phones drop the "Your turn" label. `.mana`
must stay in the DOM: `LandAbsorbFx` anchors its "Mana +1" float to it. One CSS trap worth
knowing: card-size overrides for a zone belong on the **zone**, not on `.card`, because the
battlefield's `min-height` reads `--card-h` too — with the override on `.card` the phone layout
reserved 148px for 108px cards.

Hit areas are part of the HUD's contract. The player's shield and bar rise 24px above the platform,
over the middle of the hand, so `.player-platform .playerbar` is `pointer-events: none` (the shield
takes clicks only while it is a spell target) — when it was not, the centre of the middle hand card
could not be clicked. The click handler for aiming at a face lives on the padded `.shield-hit`
wrapper, not the clip-pathed shield. On touch screens buttons keep their size and gain an invisible
`::after` margin instead (growing them would spend height the short screens lack); remember an
absolutely positioned child's `inset` is measured **inside** the border. `.center` must not shrink
(`flex: 0 0 auto`): squeezed below its content it spilled the wrapped prompt and buttons over the
player's own creatures. The Activity panel sits top-right, never over the hand, and starts collapsed
on any phone, portrait or landscape.

**Effect timing — `ui/fxTiming.ts` and `ui/useTimers.ts`.** Every choreography constant (telegraph
windows, projectile flight, strike stagger, impact point) lives in `fxTiming.ts`; the store reads
its telegraph delays from the same file, so the delay and the visual cannot drift. `BoardFx` queues
every delayed step through `useTimers().later`, which cancels on unmount, and it drops everything
when a different game replaces the current one. Timers are deliberately **not** cancelled when the
state merely advances — an effect queued by one action must still play after the next arrives.

**Audio — `src/audio`.** Synthesized, zero-asset sound, mirroring what `ImpactFx` does for visuals
("pure framer-motion, no spritesheets"): every effect is built at runtime from oscillators and
filtered noise, so the whole system costs no payload — which matters for a game whose `public/` is
already its heaviest part. Split in two: `cues.ts` decides WHICH sound an applied action deserves
(pure, diffing before/after state for deaths and the winner, tested in the `engine` project) and
`sfx.ts` is the synth (browser-only, silent no-op when WebAudio is missing, so jsdom tests and old
webviews need no guards). The `AudioContext` is created on first play, not at import, because
browsers start it suspended until a user gesture. Cues fire from the store's apply path, not the UI,
so local, AI and peer actions all sound identical and `BoardFx` stays purely visual. Mute persists
to `localStorage` and genuinely silences the synth.

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
  animations out of the PvP action path or they'll desync timing. (The cast spotlight is the
  pattern: visual-only state set next to the action, never in front of it.)
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
| **Low** | **Confirm Blocks reaches only 36px on a 320x568 screen** (a 2016 iPhone SE; 44-47px on every other phone tested). The player's creature row sits right under it and the layout has no spare height there. | `styles/index.css` | Only the legacy size. Shrinking that size's creature cards would close it. |
| **Low** | **No audio settings beyond on/off** (no volume slider); `spellTrigger` loop reads a live-mutated array (`reducer.ts` `castSorcery`); `destroy` isn't truly unconditional (>9999 toughness survives); unbounded net resend history; click-only cards with no keyboard path. | various | Latent hazards + accessibility gaps. |

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

### (f) Combat-board test, and what it found
The combat board was tested at three layers: the engine against an independent oracle (11,200 games,
about 100,000 combats, every ordered pairing, under the shipped AI and a random "chaos" policy that
makes the attack/block/instant choices the AI never would); all 56 matchups in a real browser with
the human side played only through real clicks, every resulting state change compared with
`applyAction`; and targeted scenarios for interactions no policy produces. Findings, all fixed:

| # | Finding | Fix |
|---|---|---|
| 1 | A block planned against an attacker that then dies (Take Counter) could not be confirmed: "attacker no longer in play" | `checkDeaths` prunes `combat`; Board prunes its plan |
| 2 | A ground creature could be assigned to block a flyer | one `canBlock` shared by validator and UI |
| 3 | With 2+ attackers a block could never be removed, and the banner promised a cancel that did nothing | toggle-off / cancel semantics in `blockSelection.ts` |
| 4 | A second blocker could be put on one attacker, then Confirm failed | refused with a hint |
| 5 | Result screen: "Spells cast" ignored instants (32 of 112 rows wrong); creatures cast/lost counted tokens | `resultStats.ts` |
| 6 | Dead tokens filled the graveyard (every game) | tokens cease to exist on death |
| 7 | Activity panel covered the last hand card on a 1280px window | moved clear of the hand |
| 8 | The shield covered the centre of the middle hand card — a regression from the versus theme, found only while re-testing | `pointer-events: none` over the hand |
| 9 | Combat controls were 18-34px to tap | invisible hit areas; 44-52px on common phones |
| 10 | Local actor guard existed only for PvP | extended to vs AI |
| 11 | Any screen shake (the pre-cast charge peaks at 10px) widened the page by up to 10px on phones; seen as a rare `H_SCROLL` flag in the phone run, reproduced on demand with one 10px animation on `.board` | `body.in-game #root { overflow: hidden }` |

How it was proven, worth repeating on the next change: every fix has a test that goes **red without
it** (the engine and store tests by temporarily removing the fix; the scenarios by running them on
the unfixed tree, where 13 of 17 failed). The oracle itself was mutation-tested (six injected
reducer bugs, six caught) and the DOM auditor was given nine deliberate sabotages, nine caught — a
checker that cannot fail proves nothing. Three measurement traps cost real time and are worth
knowing:
- A card that dies keeps its **frozen last render** (selection ring, ATK tag, sword overlay) for its
  1.8s exit animation, so any "stale selection" check must count only cards still in the game state.
- Overlay labels read right after a click can still be the **exiting** element; wait for the spring.
- Playwright's click targets the element's centre and fails when something intercepts it, which
  makes it a free hit-test — but only if the test asserts its preconditions. An earlier scenario
  "passed" because its own click silently missed.

### (g) Combat keywords
Combat damage is two steps (`resolveCombat`): creatures with first strike or double strike deal damage in
step 1, deaths resolve, then everything without first strike (and double strikers again) deals damage in
step 2. Helpers shared by the reducer and the AI live in `rules.ts` (`strikesIn`, `lethalFor`, `markDamage`,
`splitDamage`). A blocked attacker stays *blocked* even if its blocker dies in step 1 (only trample sends
the damage to the player). Deathtouch makes any damage lethal (the `damage` field is raised to toughness, as
`destroy` does); lifelink gains the damage actually dealt, in the same step; vigilance skips the attack tap,
which also means Take Counter ("destroy target tapped creature") cannot hit a vigilant attacker.

The AI judges blocks with `duel(attacker, blocker)` (pure, in `rules.ts`) instead of comparing power and
toughness, and uses `canBlock` instead of its own flying check. A property test holds `duel` equal to the real
resolution over 3,000 random keyword/stat mixes, and the fuzz oracle (`tools/qa/engine-fuzz.ts`) re-derives
combat independently and also runs a "keyword stress" mode that sprinkles the new keywords over every deck's
creatures at random. Card assignments were tuned with the win-rate sim (all decks 44.6%-56.1% at N=80, against
45.9%-53.8% before): the first draft gave Gravetide 76% (five deathtouch Ghouls plus lifelink on both big
creatures), so deathtouch is held back for a rarer card and only the Colossus has lifelink.

### (h) Board readability: phase banner, seat colours, damage readout
Cyan is **you** and red is **the enemy** everywhere on the board (tokens `--me` / `--foe` in `index.css`: the
HUD rings, zone borders, phase bar, action buttons, result-screen stats). Whose turn it is also glows: an edge
glow over the whole screen (`.turn-glow`) and on the zone of the player whose turn it is.

`PhaseBanner` shows a click-through banner dead centre of the screen on every phase or turn change: the turn
owner in small letters ("Your turn" / "Enemy's turn"), the phase in big ones (Main, Attack, Block, End) and a
hint of what to do. What it says is a pure function (`phaseInfo.ts`; in the block step the hint follows the
*defender*, who is the actor). It replaces the old "Turn N" splash. To give it time to be read, the AI waits
`PHASE_PAUSE_MS` longer after a phase or turn change (vs AI and hotseat only; online play never delays an
action, same rule as the cast spotlight).

`combatTally.ts` computes the combined damage readout: while attacking, what the chosen attackers could deal;
while defending, incoming / blocked / you take / life after, with a lethal warning. It uses `duel` and the
keyword rules (double strike hits twice, trample goes over), and a test holds "you take" equal to the life
really lost over 1,500 random fights. On short phones the readout collapses to one slim line of icons so the
Confirm and No Blocks buttons stay clear of the creature rows (320x568 scenario).

### (i) Triggers: enter, dies, prowess, flash
Creature triggers are card data now, not reducer special cases. `CardDef.onEnter` resolves as the creature enters
(`castCreature`); an effect that needs a creature target (Thornwood Brute's Whipflash: damage to a creature) waits
on `state.pending` (`kind: 'enter'`, with the creature's card, and its **controller**, who is the one that picks) and is
resolved by the `resolveTrigger` action (formerly `whipflash`). Everything else resolves at once (damage aimed at the
player goes to the opponent without asking). `needsCreatureChoice` (types.ts) is the one definition of "needs a
pick", and a test fixes what card data may use it. `CardDef.skill` names a skill that fires on entering and drives the
cast spotlight, so `SKILL_CREATURES` is derived from the data instead of a hand-kept list. (Beast Blitz was a hardcoded aura at that point;
it is a data-driven static ability since Phase 4d, see (o).)

`CardDef.onDeath` runs from `checkDeaths`: deaths resolve in rounds (a trigger may change the board), simultaneous
deaths go **active player first, then the other player, each in battlefield order**, and **tokens trigger too** (they
die like any creature and just leave no card in the graveyard). Dies triggers may only be targetless (a token, a draw,
a heal, damage to the opponent), so they can never need a human choice mid-resolution; a round cap is the safety net.

Prowess is a `+1/+1 until end of turn` for each spell the controller casts, kept in `tempP`/`tempT` (optional fields, so
old fixtures need nothing), counted by `power()`/`toughness()` and cleared as the next turn begins and when a creature
dies. Flash creatures can be cast in the attack step and, as a surprise blocker, by the **defender** in the block step
(`actorOf` is the caster there, and the pending trigger's controller picks a flash creature's target). The AI holds a
flash creature while the enemy has creatures that could attack, flashes one in when it wins the fight or prevents a
lethal attack (`pickFlashBlocker`), and plays it normally when there is nothing to ambush.

Checks: `triggers.test.ts` (21 tests, mutation-tested: six injected bugs, six caught); the fuzz oracle re-derives prowess,
temp expiry, flash timing and dies-trigger token counts independently, and its keyword-stress mode now also sprinkles
flash, prowess and token dies-triggers over every deck's creatures (22,400 games clean). Cards: Thornwood Brute
(Whipflash) and Pyre Adept (prowess) as before-and-after data, Rotting Hulk raises a Zombie when it dies, Bulwark has flash.
The first draft put the dies trigger on the five Shambling Ghouls, which took Gravetide to 58.9%; moved to the two Hulks.

### (j) The graveyard: discard, recall, flashback
Two more effect types resolve from a trigger like any other (`onEnter`): `discard` (the opponent discards N cards **at
random**, drawn from the game's own rng, so it is deterministic) and `recall` (the controller returns the creature that
died **most recently** from the graveyard to their hand; no choice to make, so no UI is needed, and tokens never are
in a graveyard). Flashback is data on a spell (`flashback: <cost>`): `castSorcery` may name a card in the caster's
graveyard, it is paid at the flashback cost, resolves, and is **exiled** (`PlayerState.exile`, an optional zone the fuzz
oracle counts for card conservation). `legalActions` enumerates it, the AI scores it like any spell, the spotlight
shows it, and the graveyard viewer offers a Flashback button when it is castable. Only untargeted spells may have it
(a test fixes that). Cards: Plague Priest (Rot: discard), Grave Necromancer (Grave Call: recall), Raise Horde
(Flashback 5). They moved Gravetide to 62.7% as drafted; the final list (13 lands, 6 Ghouls, 1 Hulk, 1 Colossus,
otherwise as before) is 55.7%, with every deck between 46.6% and 55.9% at N=80.

### (k) The mulligan
A game created with `{ mulligan: true }` (the store does this for vs AI, hotseat and online) opens in a `mulligan`
phase: player A (on the play) chooses `keepHand` or `mulligan`, then B does, then the game starts on A's turn. A
mulligan shuffles the hand back into the library with the game's rng and draws one card fewer (limit 3, so no one
goes below 4). `actorOf` is the deciding player, so the online transport's one-actor-at-a-time rule holds and the
decisions are ordinary logged actions that replay on reconnect. Without the option games start in the main phase as
before, so every older fixture and test is untouched. The AI keeps 2 to all-but-2 lands and otherwise mulligans.
Saved online matches from before this change cannot be replayed (their logs lack the decisions); the restore path
already reports that and returns to the menu.

### (l) Combat keywords II: Skulk, Bushido, Indestructible (Phase 4a)
Three more keywords on the shared combat code. **Skulk** is one rule in `blockError`: a creature with greater power than the
skulker cannot block it (current power, so a pump counts), and the block planner explains the refusal. **Bushido** gives a creature
that blocks or is blocked +1/+1 until end of turn (`tempP`/`tempT`, the prowess mechanism) when blocks are declared, before damage;
`duel` applies the same bonus to its throwaway copies so the AI and the damage readout still match the real fight (a 3000-fight
property test holds them equal with the new keywords mixed in). **Indestructible** goes through `isLethal`: marked damage (deathtouch
included) and `destroy` do not kill it, only a toughness of 0 does. The independent fuzz oracle models all three from the rule text and
the keyword-stress mode sprinkles them over every deck; breaking each rule in the engine on purpose makes the oracle report
findings. What it found: the fuzz's own chaos policy built blocks with its own copy of the legality rules and tried a skulk block
(fixed in the tool), and its Beast Blitz list was still the original four beasts (`BLITZ_FLAG` on every run since the owner added
Thornwood Brute and Dread Maw; fixed, so the fuzz is back to zero findings). Cards: Kunoichi has Skulk and Ashigaru is now a 1/2 with
Bushido (as a 2/1 it pushed Iron Blossom to 61%). **Indestructible is on no printed card yet**: on Granite Sentinel (Stonewall 46% ->
49%) or Storm Drake it pushed Pyromancer to 43%, below the 45% floor, because burn cannot answer it. It waits for a one-turn trick
spell instead (a later part). Win rates at N=80: 45.5%-54.6%.

### (m) Triggers II: Landfall, Morbid, second spell, Battle cry, Exalted, attack triggers (Phase 4b)
New trigger families are data on `CardDef`, each resolved by one small reducer helper: `landfall` (after `playLand` and once per land a ramp effect moved),
`attackTriggers` (Battle cry, Exalted and `onAttack`, in declaration order, as `tempP`/`tempT` so the pumps exist before blocks), and `resolveBonus` (a card's Morbid or
second-spell bonus). Morbid and second spell read two per-turn counters on the game state (`diedThisTurn`, set by `checkDeaths`; `spellsThisTurn`, counted at cast, creature
spells included), both reset in `beginTurn`; a bonus sees only what happened before its own action. Choices stay out of it: every new trigger takes an untargeted effect, so
no new `pending` kind was needed. The fuzz oracle tracks the same two counters independently from observed transitions and checks every trigger's life effect and the attack
pumps; the stress mode puts the triggers on random creatures and spells. What the sim decided: Landfall on the Sentinel, Morbid on the Cub, second spell on Cinderbolt, Exalted
on Sky Talon, an attack heal on Storm Drake and Battle cry on Iron Shogun balance (45.7%-54.5%); an attack ping on Ember Sprite and Battle cry on Swift Lancer did not.

### (n) Spells II: Bounce, Edict, Rally, Cycling (Phase 4c)
Three effects and one action, all through the existing seams. **Edict** is the first decision made by the player who did NOT cause it: it uses the same `pending` + `resolveTrigger` +
`actorOf` machinery as Whipflash with a new kind (`'sacrifice'`, controller = the victim), so the lockstep rule "one actor at a time" holds without a new mechanism; `legalActions` lists the
victim's own creatures, `validateAction` refuses anyone else's, and the card behind the choice is named by `pending.def` (set after the cast resolves). A sacrificed creature is marked `doomed`
and dies at the next death check even if indestructible; a creature with exactly one candidate is sacrificed without asking. **Bounce** reuses `needsTarget` (so a creature's enter-bounce waits for
a pick like Whipflash) and removes the creature from combat the way a death does, but is not a death: no dies trigger, no Morbid (the fuzz oracle exempts bounced creatures from its own
died-this-turn counter). **Rally** is an untargeted `tempP`/`tempT` effect, so triggers can use it as well as spells. **Cycling** is a `cycle` action (main phase, `CardDef.cycling`), kept out of
the cast path on purpose: no spell trigger, no prowess, no spell count, and a log line that does not say "discards". The sim kept an Edict Colossus, a cycling Treant and a rallying Shogun and
rejected a bouncing Storm Drake and a cycling Dread Maw (burn decks cannot answer a tempo creature that also replays itself): the spell versions of Bounce and Rally wait for new card art.

### (o) Static abilities as data (Phase 4d)
The old Beast Blitz was an incremental aura: `recomputeAura` added +1/+1 to `buffP`/`buffT` when Kunoichi arrived and subtracted it when she left, with a `blitz` flag as the memory. That works for
one aura and fails for several (two lords, a Threshold that flips with the graveyard, a lord that is itself buffed). The replacement keeps no memory: `staticBonus(player, creature)` (pure, in `rules.ts`) sums
every static on the battlefield that applies to the creature, and `recomputeStatics` writes the result to `auraP`/`auraT` (and the derived `blitz` display flag) after each action. The one subtle part
is the loop in `settle`: statics and deaths feed each other (a lord that dies can take the toughness that kept a neighbour alive), so it recomputes, checks deaths, and recomputes again until stable.
Recomputing BEFORE the first death check matters: a creature kept alive by a static must not be judged without it (the fuzz stress mode and a unit test both cover it). `unique` exists because the
old behaviour (a second Kunoichi adds nothing) is a design choice we kept: the differential trace between the old and new engines found the difference at once. Lords, by contrast, stack.
The fuzz oracle recomputes the expected aura itself, from card data only, and compares after every action.

## 8. Run it

```bash
npm install
npm run dev       # http://localhost:5173 — vs AI / hotseat work with no setup
npm test          # all tests (vitest: `engine` project on node, `ui` project on jsdom)
npm run lint      # eslint, zero warnings tolerated
npx tsc --noEmit  # type-check (the build does NOT do this)
npm run build     # production build into dist/

# QA harness beyond `npm test` (see tools/qa/README.md for when to run which)
npm run qa:fuzz       # every deck pairing vs an independent oracle (SEEDS=100 for the full pass)
N=80 npm run qa:winrate   # AI-vs-AI deck win rates, for balance changes
npm run qa:scenarios  # 20 real-browser scenarios (needs `npm run dev` + Playwright)
npm run qa:smoke      # 8 real matches, every deck twice: the check for small changes
```

Online PvP needs a free Supabase project — copy `.env.local.example` to `.env.local` and fill in
`VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` (the legacy `VITE_SUPABASE_ANON_KEY` is still read as a fallback; `net/keys.ts` picks the key and refuses a secret one) (see `README.md`).
