# CLAUDE.md — Entity Duel (tcg-project)

Browser trading card game: React 18 + Vite + TypeScript, Zustand store (`useGame`), framer-motion v11,
a deterministic rules engine, Supabase PvP, Capacitor wrapper. Deeper docs: [ARCHITECTURE.md](ARCHITECTURE.md)
(data flow, actor model, determinism, known risks), [README.md](README.md), [LORE.md](LORE.md).

## Standing rules (read first)

- **Update this file with every change** you make to the repo: add or amend the relevant section below and a
  line in the Change log. Do it in the same commit as the change.
- **Never credit Claude** in commits or PR bodies (no `Co-Authored-By`, no "Generated with Claude Code"): the
  user is the sole contributor.
- Commit and push only when asked. "push to main" = commit pending work, then `git push origin HEAD:main`.

## Commands

```bash
npm run dev          # vite (preview config: .claude/launch.json, port 5190)
npm test             # vitest run (195 tests)
npx tsc --noEmit -p .  # type check
npm run lint
```

Known environment gaps (not bugs): `jsdom` / `@testing-library/react` are not installed, so the
`ui/__tests__/use*.test.tsx` files and the store tests that need a DOM do not run here, and `tsc` reports 2
`@testing-library/react` import errors. Everything else is green.

## Layout

- `src/engine/` pure rules: `reducer.ts` (applyAction, aura recompute), `rules.ts` (validation, `blitzCue`,
  keywords), `types.ts`, `state.ts`. Deterministic; the same action log replays identically (PvP depends on it).
- `src/cards/` `cards.ts` (all card defs, `BLITZ_BEASTS`), `decks.ts`. Card art: `public/cards/<id>.png`
  auto-wires; any other file needs an explicit `art:` on the card (done for Insight, Grave Necromancer,
  Pyre Adept — optimized WebP, ~420px wide).
- `src/store/gameStore.ts` Zustand store: AI pacing (`scheduleAi`), telegraphs, spotlights, PvP wiring.
- `src/ui/` board and effects. `Board.tsx` is the hub; `BoardFx.tsx` plays combat/spell effects from state diffs.
- `public/ui/` effect art: `blitz-face.webp`, `grave-grin.webp`, `pyre-glare.webp`, `sword.png`, `shield.png`.

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

## Change log (newest first; add a line per change)

- Skill cut-ins for Grave Call (necromancer grin) and Pyre Adept's spell trigger (burning glare); Kunoichi's cut-in
  uses the battle-cry face; new optimized art for Grave Necromancer and Pyre Adept. `BlitzUltimate` → `CutIn`.
- Beast Blitz announces only when Kunoichi and a beast meet; Thornwood Brute and Dread Maw added to the beasts;
  lightning replaces the fangs/flames on empowered beasts.
- Drag a ready creature onto the enemy board in Main to start combat with it as the attacker.
- Phase banners hold the board (pre-change state) and lock the cards until they leave.
- Beast Blitz cut-in (band across the middle); dark backdrops for skills and phase banners.
- Combat death sequence (impact → crack → pulverize), banner/clash spacing, Attack-phase card lock.
- Board UX: move nudges, block lines, haste tag, first-strike cinematic, blitz mark.
