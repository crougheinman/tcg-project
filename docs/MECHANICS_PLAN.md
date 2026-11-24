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
- Non-data card mechanics were hardcoded in the reducer (Beast Blitz's `BLITZ_TARGETS` / `recomputeAura`, now data: Part 4d);
  Thornwood Brute's Whipflash (a `pending` choice) and `spellTrigger` creatures (Pyre Adept...) are the rest.
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

### Phase 0 - Make the QA harness part of the repo (about half a day) - DONE

Done: the harness lives in `tools/qa/` with `npm run qa:fuzz | qa:winrate | qa:scenarios | qa:smoke` and a
README saying when to run which (smoke for small changes, full 56-match pass at phase ends). Playwright
stays a local-only requirement (open question 5 resolved that way, easy to revisit). The text below is the
original scope, kept for reference.

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

### Phase 1 - Combat keywords (about 2 days) - DONE

Done: reach, vigilance, first strike, double strike, trample, deathtouch and lifelink are implemented
(`rules.ts`, `reducer.ts`, `cards/keywords.ts`), the AI judges blocks with the real rules (`duel`), the fuzz
oracle models them independently (including a keyword-stress mode), and 10+ cards carry them. Deviations from
the plan below, all driven by the win-rate sim (all decks 44.6%-56.1% at N=80):

- Iron Shogun got **first strike and lost haste** (double strike put Iron Blossom at 60%).
- **Deathtouch is on no printed card yet** (five deathtouch Ghouls plus lifelink took Gravetide to 76%).
  Only Carrion Colossus has lifelink. Both are fully implemented and tested, waiting for a card.
- Added trample to **Dread Maw** and vigilance to **Swift Lancer** to keep Pyromancer, Emberwood and
  Wildblitz from sliding. Pyromancer is still near the bottom (44.6%); prowess (Phase 2) is meant for it.
- Not done: keyword badges on the board cards (they show in card text and the preview only), and a
  two-beat first-strike animation (the existing strike choreography plays; lifelink shows a green +N).
- Not run: the full 56-match browser pass (the owner asked to skip the long runs). Engine fuzz ran the full
  22,400 games with zero findings, the 23 browser scenarios and the 8-match smoke batch pass.

Original scope, kept for reference:

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

### Phase 2 - Triggers and timing (about 2-3 days) - DONE

Done: data-driven `onEnter` (Whipflash migrated; `resolveTrigger` replaces `whipflash`; `SKILL_CREATURES` derived),
`onDeath` (active player first; tokens trigger, as decided), prowess (`tempP`/`tempT`, expires as the next turn begins)
and flash creatures (attack step and block step; AI holds and ambushes). Cards, tuned with the win-rate sim (all decks
46.8%-55.5% at N=80): Rotting Hulk raises a Zombie when it dies (the plan's Shambling Ghoul took Gravetide to 58.9%),
Pyre Adept has prowess, Bulwark has flash. Beast Blitz was still the hardcoded `BLITZ_TARGETS` then (data since Part 4d); no keyword badges on board cards; no full 56-match browser pass (skipped on
request: fuzz 22,400 games, 36 scenarios and the 8-match smoke batch are clean).

Original scope, kept for reference:

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

### Phase 3 - Optional, as appetite allows - DONE (counters skipped on purpose)

Done: discard (random, deterministic), recall (the most recently fallen creature), flashback with an exile zone,
and the mulligan (opt-in at the engine, on in every real game mode). Cards: Plague Priest discards, Grave Necromancer
recalls, Raise Horde has Flashback 5. Skipped: **+1/+1 counters**: the engine already keeps a creature's permanent
buff (`buffP`/`buffT`, e.g. Wild Growth) separate from an aura's (`blitz`), and a test already proves the permanent
buff survives the aura ending, so there was nothing to add. Not done: no full 56-match browser pass (skipped on
request); the discard and recall have no dedicated animation beyond the log and the cast spotlight.

Original scope, kept for reference:

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

## 4. Phase 4: more Magic mechanics, built in parts

Status: **in progress.** Phases 0-3 are done. Phase 4 is built one part at a time; each part ends green (lint, tsc, tests, the fuzz oracle
extended for the new rules, a win-rate check, the smoke batch) and is committed before the next starts. The order puts the cheap,
visible keywords first and the two engine keystones (statics, activated abilities) before the showpiece (ninjutsu).

| Part | What | Size | Status |
|---|---|---|---|
| 4a | **Combat keywords II**: Skulk (cannot be blocked by a creature with greater power), Bushido (+1/+1 when it blocks or is blocked), Indestructible | S | **done** (see below) |
| 4b | **More triggers**: Landfall, Morbid / spells-this-turn conditions, attack triggers (Battle cry, Exalted, "whenever it attacks") | M | **done** (see below) |
| 4c | **Spells**: Bounce, Edict (opponent sacrifices a creature of their choice), Rally (team buff), Cycling | S-M | **done** (see below) |
| 4d | **Data-driven static abilities**: Beast Blitz moves onto data; Lords ("other Wolves +1/+1"); Threshold ("7+ cards in your graveyard") | M | **done** (see below) |
| 4e | **Activated abilities** (`{T}: ...`): mana creatures, pingers, a Treasure token | M-L | **done** (see below; targeted abilities and a Treasure token wait) |
| 4f | **Choices I**: Scry, Loot, Fight / bite, Hexproof | M | **done** (see below) |
| 4f2 | **Choices II**: Modal ("choose one"), X spells, Kicker, Ward (extra fields on the cast action and a UI to fill them; Buyback not done) | M | **done** (see below) |
| 4g | **Graveyard**: Undying, Unearth | M | planned |
| 4h | **Showpiece**: Ninjutsu for Kunoichi / Hana (a short window between blocks and damage), later Equipment | L | planned |

Still out of scope: the stack and counterspells, steal effects (controller is tied to owner), hidden-information mechanics, coloured mana.

### Part 4a: done

Skulk, Bushido and Indestructible are implemented (`rules.ts` `blockError` / `isLethal` / `duel`, `reducer.ts` `declareBlockers` / `checkDeaths` /
`destroy`, `cards/keywords.ts`, the Rulebook, the block planner's refusal text), tested (`keywords2.test.ts`, each rule mutation-checked; the
3000-fight `duel` property test now includes bushido and indestructible), and modelled by the fuzz oracle (22,400 games, zero findings; breaking
each rule on purpose makes it report). Deviations from the plan, driven by the win-rate sim (N=80, all decks 45.5%-54.6%):

- **Ashigaru is now a 1/2 with Bushido** (as a 2/1 with Bushido Iron Blossom reached 61%).
- **Kunoichi has Skulk** (neutral: Wildblitz 48.9% -> 49.6%).
- **Indestructible is on no printed card yet.** On Granite Sentinel or Storm Drake it dropped Pyromancer to about 43%: burn cannot answer it. It is waiting for a
  one-turn "gains indestructible until end of turn" trick spell (part 4c/4f, needs temporary keywords) rather than a permanent body. Same precedent as
  deathtouch in Phase 1.
- Fixed in the QA tooling on the way: the fuzz policy did not know the skulk block rule, and its Beast Blitz list had the original four beasts (so every run
  reported `BLITZ_FLAG`).

### Part 4b: done

New data fields on `CardDef`: `landTrigger` (Landfall: once per land that enters under its controller's control, played or ramped), `onAttack` (when the
creature attacks, even if it is then blocked) and `bonus: { when: 'morbid' | 'secondSpell', effect }` (a creature's bonus on entering, a spell's after its effect).
All three take untargeted effects only (damage only at the player), enforced by a card-data test. Two keywords: **Battle cry** (each other attacker gets +1/+0)
and **Exalted** (a lone attacker gets +1/+1 per exalted creature its controller has). Per-turn counters `diedThisTurn` and `spellsThisTurn` live in the game state
(optional, reset in `beginTurn`); creature spells count as spells, and a bonus sees only deaths and spells from BEFORE its own action (state-based deaths resolve after
the action, as in the rules text). Attack pumps are `tempP`/`tempT`, so they are in place before blocks. Tested on throwaway cards (`triggers2.test.ts`, each of eight
mechanics mutation-checked); the fuzz oracle keeps its OWN Morbid / second-spell counters from observed transitions, checks life for every trigger and the attack pumps,
and the keyword-stress mode sprinkles the new keywords and trigger data over every deck (22,400 games, zero findings; breaking each rule makes it report).

Cards (all decks 45.7%-54.5% at N=80 / N=120, tighter than before): **Granite Sentinel** Landfall (gain 1 life), **Stoneback Cub** Morbid (draw a card), **Cinderbolt**
second spell (1 damage to the opponent), **Sky Talon** Exalted, **Storm Drake** "whenever it attacks, gain 1 life", **Iron Shogun** Battle cry. Rejected by the sim: an
Ember Sprite attack trigger (1 damage: Emberwood 58.9%, Skyward 42.5%) and a Swift Lancer Battle cry (Wildblitz 60.9%, Skyward 42.1%): a hasty swarm plus a free pump is too much.
The UI floats a small label ("Landfall", "On attack", "Battle cry!", "Exalted", "Morbid", "Second spell") over the creature that fired, from the new log lines (`triggerCues`).

### Part 4c: done

Three new `Effect`s and one new action. **Bounce** (`{ type: 'bounce' }`, targeted like Whipflash, so as a creature's enter effect it waits on a `pending` choice): the creature goes to its OWNER's
hand with every buff, mark and aura gone and summoning sick (a token just ceases to exist), and it leaves combat; it is not a death (no dies trigger, no Morbid) and it works on an indestructible
creature. **Edict** (`{ type: 'edict' }`, untargeted): the opponent sacrifices a creature of THEIR choice. With none nothing happens, with exactly one it is sacrificed at once, with more a
`pending` `{ kind: 'sacrifice', controller: victim }` is set: `actorOf` hands the turn to the victim, `resolveTrigger` carries their pick, and a sacrificed creature (`doomed`) dies even if
indestructible. **Rally** (`{ type: 'rally', power, toughness }`, untargeted): every creature the controller has NOW gets +P/+T until end of turn (`tempP`/`tempT`). **Cycling**
(`CardDef.cycling` + the `cycle` action): in your main phase pay the cost, discard the card from hand and draw one; it is not a cast (no prowess, no spell count) and logs "cycles", not
"discards", so Rot's discard animation does not fire for it. The AI scores bounce, edict and rally as spells, chooses what to bounce or sacrifice (the enemy's dearest creature; a token first),
and cycles a card it cannot cast within a turn. The Board has a sacrifice prompt (your own creatures glow) and a Cycle mode (tap Cycle, then the card). Tested (`spells2.test.ts`, nine rules
mutation-checked); the fuzz oracle tracks bounced and sacrificed creatures separately from deaths, checks every rule from the rule text and stress-sprinkles all four mechanics (22,400 games).
What the fuzz found: after a bounce the oracle still counted the bounced creature's spell trigger (the engine was right: a creature that left play does not trigger).

Cards (all decks 45.7%-54.6% at N=80, 46.5%-55.5% at N=120): **Carrion Colossus** Edict on entering, **Ancient Treant** Cycling 2, **Iron Shogun** Rally (+1/+0) on entering. Rejected by the sim: a Storm
Drake that bounces on entering (Skyward 57.5%, Pyromancer 43.8%, Wildblitz 44.8%) and a Dread Maw with Cycling (Pyromancer 42.7%, Wildwood 57.3%). Bounce, Rally and Edict as SPELLS arrived with their art: **Windrush** (Skyward, 2 copies), **War Drums** (Iron Blossom, 1 copy) and **Grave Toll** (Grave Tide, 1 copy). Win rates N=80 with all three: 46.4%-53.8%. War Drums was the hard one: two copies at the cost of Insight and a Ronin Blade dropped Iron Blossom to 39.8%, so it runs one copy in place of a Shuriken Volley (51.1%).


### Part 4d: done

Static abilities are data: `CardDef.static` (a `StaticAbility`: `affects` = `ids` / `others` / `self`, `power`, `toughness`, optional `when: 'threshold'` (7 or more cards in the
controller's OWN graveyard), optional `unique` (several copies do not stack: Beast Blitz) and `mark: 'blitz'` (the lightning and the "Beast Blitz activated" announcement)). Every creature's
bonus lives in two new instance fields, `auraP` / `auraT`, which `power()` / `toughness()` add and the engine REBUILDS FROM SCRATCH after every action (`staticBonus` in `rules.ts`,
`recomputeStatics` and `settle` in `reducer.ts`), instead of the old add-and-remove bookkeeping: idempotent, so any number of statics stack and none can leak. `settle` recomputes first
(so a creature a static is keeping alive is not judged without it), then alternates death checks and recomputes until nothing moves: a lord dying takes its bonus away, which can kill the
creature it was keeping alive; a death trigger can make a creature a static lifts. The `blitz` flag stays as a derived display flag, `BLITZ_BEASTS` is read from Kunoichi's static, and
"Beast Blitz fades." is now logged from the card's `skill`. Aura fields are cleared when a creature dies or is bounced. The board's buff crown shows for aura bonuses too.
Verified without changing behaviour: a step-by-step differential trace of 56,000 AI-vs-AI steps (old engine vs new) came out identical after `unique` was added (it found that two Kunoichi
would otherwise have stacked).

Tested (`statics.test.ts`, 13 tests, each rule mutation-checked: Threshold ignored, `others` including itself, no stacking, no settle loop, no initial recompute); the fuzz oracle works out the
expected bonus of every creature on its own (own loop, own threshold literal 7, own `unique` handling) after every action (`AURA_WRONG`), and the stress mode sprinkles lords, self-buffs and
Threshold statics over random creatures (breaking Threshold to 6 or letting `others` include itself makes it report thousands of findings).

Cards (all decks 45.0%-54.6% at N=80, 46.7%-55.4% at N=120): **Pyre Adept** Threshold (+1/+1; Pyromancer 46.1% -> 48.2%; +2/+2 made it 50.7% but pushed Wildblitz to 44.5%) and **Rotting Hulk**
"your Zombies get +1/+1" (a tiny effect: Gravetide +0.3). Not used: a Kensei Duelist Ashigaru lord (her text and flavour are Hana's alone).

### Part 4e: done

`CardDef.activated` (`ActivatedAbility`: `cost: { tap?, mana? }`, an UNTARGETED `effect`) and the `activate` action: in your main phase, with nothing pending, a creature you control pays its cost
and the effect resolves at once (`validateAction`, `legalActions`, the shared `activateError`, `reducer.ts` `activate`). `tap` needs the creature untapped and not summoning sick, and it stays tapped
through the opponent's turn (untap is at the start of its owner's turn), so using it costs the creature its blocking job; a `mana` cost is paid from lands and pool. It is not a cast: no spell trigger,
no prowess, no spell count, and the log reads "adds N mana" / "✦ X — ability". A new effect `mana` adds to `PlayerState.pool` (floating mana): `availableMana` counts it, `payMana` spends it before
lands, and it empties whenever the phase changes (`applyAction`). Card-data tests: an activated effect must be untargeted, every ability must cost something (a free one would repeat without limit), and a
mana ability must tap. The AI (`scoreActivate`) taps a mana creature only when the mana lets it cast something it could not afford, and uses any other tap ability only with a 1-power body or a
defender (a real attacker attacks). The Board has an Ability mode like Cycle (tap Ability, then the creature; legal creatures glow). Tested (`activated.test.ts`, 14 tests, eight rules mutation-checked, three
for the AI); the fuzz oracle re-derives tap / mana / effect / not-a-spell for every activation, checks the pool is never negative and empty after a phase change, accounts for mana by what was SPENT (lands
tapped plus pool used, so a ramp spell does not confuse it), and stress-sprinkles abilities over random creatures (breaking pool clearing, tapping, mana payment or summoning sickness each makes it report;
a missing tap makes it hang, since the ability repeats forever).

Card (all decks 46.1%-53.3% at N=120, 45.7%-52.9% at N=80): **Kunoichi** gains "{T}: Add one mana". Rejected / moved by the sim: the same ability on Ember Sprite (Pyromancer 54.2% and Wildblitz 53.9%
but Skyward 45.0%, Iron Blossom 46.1%) and on Ashigaru (Iron Blossom 57.3% at N=80, too near the ceiling). Not done: targeted abilities (a pinger that picks its victim; needs a target in the action and a UI
mode), instant-speed use, a sacrifice cost and a Treasure token (the battlefield only holds creatures and lands, so a Treasure would be a 0/1 creature); non-mana abilities (ping, heal, draw, token) are
engine-ready and stress-tested but have no printed card yet.

### Part 4f: done (Scry, Loot, Bite, Hexproof)

Part 4f was split: this half is everything that fits the existing seams (a `pending` choice, or a targeting rule); Modal, X, Kicker / Buyback and Ward need new fields on the cast action and a UI to fill them, so they are **4f2**.
Three effects and one keyword. **Scry N** (`{ type: 'scry', amount }`): sets `pending` `{ kind: 'scry', left, seen }` for the controller (`actorOf` hands them the move) and a new `scry` action answers it for the NEXT
card (`bottom: true` moves it to the end of the library, `bottom: false` keeps it and advances the `seen` cursor); `left` counts decisions, so it never looks at more cards than the library has and never at a card twice; the log
never names the card (both clients hold both libraries, so the secret is only ever the UI's). **Loot** (`{ type: 'loot' }`): draw a card, then `pending` `{ kind: 'discard' }`: `resolveTrigger` with a card of the controller's hand
sends it to the graveyard, logged as "loots away", NOT "discards" (that exact line is Rot's discard show in `zoneCues`). **Bite** (`{ type: 'bite' }`, a targeted spell effect): the controller's creature with the greatest power
(first on the battlefield on a tie) deals damage equal to its power to target OPPOSING creature, one-way (the victim cannot hit back; a deathtouch biter kills it); it needs a creature of yours and is a spell effect only (a card-data
test forbids it, scry and loot as triggers or abilities, which cannot wait on a choice safely). **Hexproof** (keyword; `canTargetCreature` in `rules.ts`): the opponent's spells and enter effects cannot target it; its controller
can, combat and damage at players are unaffected. It is enforced in `validateTarget`, `legalTargets`, every targeted spell's validation and `legalActions`, the pending enter-effect pick, and the Board's cues; a creature whose
enter effect has only hexproof targets left fizzles instead of leaving an unanswerable `pending` (the one deadlock this opened). The AI scries lands it needs and spells it can nearly cast, loots away a spare land or its dearest
uncastable card, and bites only when the biter's power kills. The Board shows a Scry modal (the card, Keep on top / Put on the bottom) to the scrying player only, a "tap a card in your hand" Loot prompt, and hexproof creatures are
not marked targetable. Tested (`choices.test.ts`, 18 tests, 11 rules mutation-checked); the fuzz oracle re-derives hexproof targeting, the scry library permutation and cursor, the loot draw / discard / log line and the
bite damage independently, and stress-sprinkles scry, loot, bite and hexproof (each of six rule breaks makes it report).

Cards (all decks 46.5%-55.6% at N=120, 46.6%-55.4% at N=80): **Sky Talon** "when it enters, scry 1", **Shambling Ghoul** "when it enters, draw a card, then discard a card" (Gravetide 53.2% -> 55.4%), **Storm Drake**
Hexproof (Pyromancer 50.9% -> 46.8%: burn no longer answers it). Rejected: a hexproof Kunoichi (Wildblitz +5.5 points but Skyward 44.6%, Stonewall 45.0% against the burn decks). Bite waits for art: `card-art.md` has a
prompt for **Savage Bite**; once it exists the sim decides its numbers. Not done: Ward, and Modal / X / Kicker (4f2).

### Part 4f2: done (Modal, X, Kicker, Ward)

All four are cast options, so they share one seam in `rules.ts`: `spellEffect(def, { x, mode })` (the chosen mode of a modal spell, with X applied to a damage / heal / draw amount) and `castCost(state, caster, def, { x, kicked, target }, fromGrave)` (cost or flashback cost, plus X,
plus the kicker if paid, plus the ward of an opposing creature the spell targets). Validation, `legalActions`, payment in the reducer, the AI and the UI all call these two functions, so no side can disagree about what a cast does or costs. The `castSorcery` action gained
optional `x`, `kicked` and `mode`; a card must offer an option for the action to name it, X is REQUIRED on an X spell, a missing mode means the first (so saved casts from before a card became modal still replay), and a flashback cast takes none. New `CardDef` data: `x: true` (amount * X, X paid on top), `kicker: { cost, effect }`
(the effect is untargeted and resolves after the main effect), `modes: Effect[]` (`effect` must equal `modes[0]`, so everything that still reads `effect` stays right), and `ward: N` on creatures (spells only; enter effects and a spell at a player are not taxed). `legalActions` enumerates every
mode x kicker x X (from 1: an X of 0 is legal but a blank) x target that the mana covers. The AI scores the chosen effect, pays a kicker when it can (a tie-break), picks the smallest X that kills or finishes, and the biggest draw / heal X. The Board opens a
`CastOptions` modal (mode radios, a kicker checkbox, an X stepper, the total cost, Cast / Cancel) before the target is chosen, and says up front when a ward makes the cast too dear. Tested (`castoptions.test.ts`, 15 tests, ten rules mutation-checked; one mutant, skipping the
cost check in validation, is equivalent because the reducer's payment refuses it too); the fuzz oracle re-derives the chosen effect and every spell's cost (`SPELL_COST`, including ward) independently and stress-sprinkles modes, X, kickers and ward (six rule breaks each detected). It also found
its own imprecision once more: a kicker that draws makes a Loot draw two cards, so that check skips such casts. An earlier "zero findings" mutation run proved nothing because the oracle edit had never been saved to disk; the real mutation run is what is recorded here.

Cards (all decks 46.0%-55.5% at N=120, 45.9%-55.7% at N=80): **Soothe** modal (gain 6 life, or draw 2: Stonewall 47.5% -> 53.8%), **Pyroblast** Kicker {3} (also 3 damage to the opponent) and **Pyre Adept** Ward {1} (Pyromancer 46.8% -> 48.2%). Rejected by the sim: a Cinderbolt kicker
(draw: no effect; 2 damage: Pyromancer 44.3%, because every burn deck gets it). No X spell is printed (an X Pyroblast is strictly worse than the 4-mana 6 damage at its sizes); the mechanic is engine-ready and stress-tested. Not done: Buyback.
