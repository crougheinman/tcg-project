# Plan: more Magic-style mechanics

Status: **proposed, not started.** Written so the work can be picked up cold. Everything here is
grounded in the code as of `main` after the Beast Blitz / cast-spotlight work.

## 1. Where we are

- 3 keywords: `haste`, `flying`, `defender` (`Keyword` in `src/engine/types.ts`).
- Effects are data (`Effect` in `types.ts`): damage, draw, buff, heal, ramp, token, tapAll, destroy.
- One generic mana. No stack, no priority, no counterspells. 20 life. 8 themed 30-card decks.
- Combat is strictly **1 blocker per attacker**, validated by `blockError` / `canBlock`
  (`src/engine/rules.ts`), shared by the validator, the block-planning UI and the tests.
- Combat damage is one simultaneous pass in `resolveCombat` (`src/engine/reducer.ts`).
- Non-data card mechanics are hardcoded in the reducer: Beast Blitz (`BLITZ_TARGETS`, `recomputeAura`),
  Thornwood Brute's Whipflash (a `pending` choice), `spellTrigger` creatures (Pyre Adept...).
- `SKILL_CREATURES` in `src/ui/fxTiming.ts` lists the creatures that get the cast spotlight.

## 2. Hard constraints (apply to every mechanic below)

1. **Deterministic.** All rules live in `applyAction`. No `Math.random`, no clock. Online play replays
   the action log on both clients, so any non-determinism is a desync.
2. **Choices need a `pending` state** (as Whipflash does). No engine rule may wait on the UI.
3. **PvP never delays an action.** Visual lead-ins are store-side telegraphs; in PvP they play
   *alongside* the action. New animations follow the cast-spotlight pattern (visual-only state set
   next to the action, never in front of it).
4. **Keep 1:1 blocking.** Menace and gang-blocks are out of scope (they break the block planner).
5. Each new rule must reach all of: the validator, `legalActions`, the AI (`src/ai/ai.ts`), the
   independent oracle in the engine fuzz, the Rulebook, and the tests.

## 3. Phases

Estimates are rough, for one person with the harness in place.

### Phase 0 - Make the QA harness part of the repo (about half a day)

The checks used for the last changes (engine fuzz with an independent oracle, 20 browser scenarios,
the real-browser match runner, the AI-vs-AI win-rate sim) were written in a **session scratchpad,
outside the repo**. They will not exist next week. Without them every phase below is much slower and
riskier.

- Add `tools/qa/`: `engine-fuzz.ts`, `winrate.ts`, `ui-match.cjs`, `ui-scenarios.cjs`, `pairs.txt`.
- Run them with `vite-node` (fuzz, win rates) and Playwright (browser).
- Decide how Playwright is provided (see open question 5); exclude `tools/` from `tsc` if needed.
- Document the commands in `ARCHITECTURE.md` section 8.
- Define the **smoke batch** in a script: 8 matches (4 desktop, 4 phone), every deck twice.

Done when: a fresh clone can run `fuzz`, `winrate`, the 20 scenarios and the smoke batch.

### Phase 1 - Combat keywords (about 2 days)

Cheap, very visible, and they give decks identity. Order matters: do the independent ones first.

| Keyword | Rule (as implemented here) | Where it goes |
|---|---|---|
| **Reach** | May block a flyer. | `blockError` in `rules.ts`: a flying attacker needs a flying or reach blocker. **Also** replace the two duplicated flying checks in `src/ai/ai.ts` (~lines 253, 288) with `canBlock`, so the AI cannot drift from the validator. |
| **Vigilance** | Attacking does not tap the creature. | `declareAttackers` in the reducer currently does `c.tapped = true` ("no vigilance in MVP"). Audit anything that infers "is attacking" from `tapped` (block UI, auto-skip logic, BoardFx) and make it use `combat.attackers`. |
| **Trample** | Excess damage over the blocker's remaining lethal goes to the player. | `resolveCombat`. Lethal for the blocker = `toughness - damage` already marked. With deathtouch, 1 damage is lethal. |
| **First strike** | Deals combat damage in an earlier step; a creature killed in that step deals none. | Split `resolveCombat` into two passes with `checkDeaths` between them. Unblocked first strikers hit in pass 1. |
| **Double strike** | Deals damage in both passes. | Same two-pass `resolveCombat`. |
| **Lifelink** | Damage dealt (to a creature or the player) also gains that much life. | `resolveCombat`; track damage actually dealt per source. |
| **Deathtouch** | Any damage from it is lethal. | When dealing damage with a deathtouch source and dealt > 0, mark the target lethal (as `destroy` does with its sentinel). |

Cross-effects to test explicitly: first strike + deathtouch, first strike kills the blocker before it
deals damage, trample + first strike, trample + deathtouch (assign 1), lifelink on an unblocked
attacker and on a trade, vigilance + `legalActions` (can still block next turn), reach vs flying,
tapped creatures, and the `lastCombat` snapshot that the UI animates from.

UI/UX for Phase 1:
- Rulebook keyword list (`src/ui/Rulebook.tsx` ~line 53), card text, optionally a small keyword
  badge on `CardView`. The gallery keyword filter already reads `keywords`.
- `BoardFx` choreography: first strike needs two visual beats (`STRIKE_STAGGER_MS`, `LUNGE_MS`,
  `IMPACT_MS` in `fxTiming.ts`). Lifelink and trample need floaters (a "+N life" number, an
  overflow hit on the player).
- Check `cuesFor` in `src/audio/cues.ts` if lifelink should have a sound.

AI: attack/block heuristics must understand each keyword, or the AI will make obviously bad blocks
(blocking a first striker with a smaller creature, blocking a deathtouch creature with its best card).

### Phase 2 - Triggers and timing (about 2-3 days)

These unlock Grave Tide and remove hardcoded special cases.

1. **Data-driven ETB**: add `onEnter?: Effect` to `CardDef`; migrate Kunoichi's log line and
   Thornwood Brute's Whipflash onto it (Whipflash keeps its `pending` choice).
   Then make `SKILL_CREATURES` derive from `onEnter`/`onDeath` instead of a hand-kept list.
2. **Dies triggers**: add `onDeath?: Effect`, fired from `checkDeaths`. Rules to pin down:
   triggers resolve in a deterministic order (active player first, then battlefield order); a death
   trigger can kill more creatures, so loop until stable with a hard iteration cap; tokens *do*
   trigger even though they never reach the graveyard (see the token rule in the reducer).
3. **Prowess**: +1/+1 until end of turn when its controller casts a spell. Needs a temporary buff that
   expires in `toEnd`/`beginTurn`; today `buffP`/`buffT` are permanent. Keep temporary and permanent
   separate (like the `blitz` flag separates the aura).
4. **Flash creatures** (castable during the block step like instants): extend the `castSorcery`
   caster rule and `legalActions`; the AI gets a rule for when to use it.

Each trigger that adds a visible effect should get a cast-spotlight entry for the creature.

### Phase 3 - Optional, as appetite allows

- Graveyard recursion / flashback (the graveyard is tracked and has a viewer).
- Opponent discard and loot (discard needs a `pending` choice).
- +1/+1 counters that survive an aura ending.
- Mulligan (a real rule, small engine change, mostly UI).

### Out of scope for now

The stack, priority and real counterspells; coloured mana; equipment and auras (need an
"attached to" model); menace and gang-blocks.

## 4. Proposed card assignments (a starting point, to be tuned by the win-rate sim)

| Deck | Idea |
|---|---|
| Iron Blossom | Kensei Duelist: first strike. Iron Shogun: double strike (probably drop haste to compensate). |
| Wildwood Titans | Ancient Treant: trample. Granite Sentinel: reach. |
| Stonewall | Bulwark: reach. |
| Skyward | Sky Talon and Storm Drake: vigilance. |
| Grave Tide | Rotting Hulk and Carrion Colossus: lifelink. Shambling Ghoul: deathtouch, and a dies trigger that raises a Zombie. |
| Pyromancer | Ember Sprite or Pyre Adept: prowess. |

New cards are also fine where retuning an old one would hurt it, but every change to a printed card
is a balance change; run the sim.

## 5. Verification protocol (per mechanic)

1. **Red-green unit tests** in `src/engine/__tests__/engine.test.ts`: write the test, see it fail,
   implement, see it pass (prove it by temporarily reverting the fix).
2. **Independent oracle**: teach `engine-fuzz` the new rule *separately from the reducer* and run it,
   including the chaos policy (random legal actions).
3. **Balance**: `winrate.ts` with `N=80` for before/after. Target: every deck stays between 45% and
   58%. Cells have roughly a plus or minus 4 point margin, so only believe larger moves.
4. **Browser**: the 8-match smoke batch plus the 20 scenarios after each mechanic. A **full 56-match
   pass at the end of each phase**, because combat and trigger rules are engine rule changes.
5. **Docs**: `ARCHITECTURE.md`, `LORE.md` (card text and flavour), the in-game Rulebook.

Reminders from earlier runs: never edit `src/` while a browser batch runs (HMR disturbs matches);
check the dev server is up before concluding a batch "crashed"; a single-game win streak is noise.

## 6. Open questions for the owner

1. Are the card assignments in section 4 the direction you want, or should new cards be added instead?
2. Iron Shogun: double strike without haste, or first strike with haste?
3. Should tokens trigger "dies" abilities? (Plan assumes yes.)
4. Is gang-blocking permanently out, or worth a future redesign of the block planner?
5. Phase 0: add Playwright as a dev dependency (CI cost) or keep browser QA as a documented local-only
   tool that expects Playwright to be installed?
6. Should the cast spotlight cover every new trigger, or only creature skills fired on cast?

## 7. Suggested order of work

Phase 0, then Reach and Vigilance (smallest, and Reach removes the AI's duplicated block check), then
First strike and Double strike (the `resolveCombat` split), then Trample, Deathtouch and Lifelink on
top of it. Full-pass checkpoint. Then Phase 2 in the order 1, 2, 3, 4. Full-pass checkpoint.
