# Entity Duel (Arcanum TCG)

A tiny Magic-inspired trading card game. Web + mobile (Capacitor), **Player vs AI** and
**Player vs Player**. 100% free stack.

- **React + Vite + TypeScript** — UI / build
- **Pure-TS deterministic engine** (`src/engine`) — the single source of truth for the rules,
  reused by the AI, by PvP, and by the tests
- **Heuristic AI** (`src/ai`) — runs in-browser, offline, zero cost
- **Supabase Realtime** — PvP transport (lockstep: relay actions only, both clients replay
  through the same engine; no server compute)
- **Zustand** — UI state
- **Capacitor** — Android/iOS wrapper

## Run it

```bash
npm install
npm run dev      # http://localhost:5173  — Play vs AI / Hotseat work with no setup
npm test         # engine + AI tests
npx tsc --noEmit # type-check (also runs as part of `npm run build`)
npm run build    # type-check + production build into dist/
```

## Online PvP (optional, free)

1. Create a free project at https://supabase.com
2. `cp .env.local.example .env.local` and fill in **Project Settings → API**:
   ```
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   ```
3. Restart `npm run dev`. The "Online PvP" button is now enabled.
4. One player **Hosts** (gets a 4-letter room code), the other **Joins** with that code.

No tables or auth setup needed for MVP — PvP uses Realtime broadcast channels only.

## Mobile (Capacitor)

Requires Android Studio + SDK (free).

```bash
npm run build
npx cap add android   # once
npx cap sync
npx cap run android
```

## How it works

`applyAction(state, action) => newState` is the whole rules engine — a pure reducer. Shuffles
use a seeded PRNG threaded through the state, so the same seed + same actions always produce the
same game. That determinism is what makes PvP free: clients agree on a seed and exchange only
actions.

### Cards & rules

Single mana resource (lands tap for one mana). Card types: **land**, **creature**,
**sorcery** and **instant**. Phases: Main → Combat (attack → block → damage) → End. Keywords:
**haste**, **flying**, **defender**. Instants can be cast in the attack and block steps (during
the block step only the defender acts). Win by reducing the opponent to 0 life (or decking them
out). Card data lives in `src/cards/cards.ts`; effects are data-driven (`damage`, `draw`, `buff`,
`heal`, `ramp`, `token`, `tapAll`, `destroy`), so most new cards are data, not code. See
`ARCHITECTURE.md` for the engine deep-dive.

### Not implemented (deliberate)

A full priority stack, multicolor mana, deck builder UI, accounts, server-authoritative
anti-cheat. PvP is client-authoritative lockstep with per-client validation; the upgrade path is
a Supabase Edge Function running the same engine unchanged.
