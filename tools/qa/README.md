# QA harness

Checks that go beyond `npm test`. They were written to find the combat-board bugs fixed in PRs #8/#9
and are meant to be re-run after any rules, combat, store or layout change. Nothing here runs in CI.

| Command | What it does | Time | Needs |
|---|---|---|---|
| `npm run qa:fuzz` | Plays AI-vs-AI and random-legal-action games over every ordered deck pairing and checks **every transition against an independent oracle** (life, deaths, phase, zones, combat bookkeeping, and every creature's static-ability bonus: `AURA_WRONG`, and each activated ability: `ACTIVATE_*`, `POOL_*`, and what each spell costs with its modes, X, kicker and ward: `SPELL_COST`, and Undying / Unearth: `UNDYING_*`, `UNEARTH_*`, and the Ninjutsu window: `NINJUTSU_*`). `SEEDS=4` is a quick pass, the default `12` takes about 10s, `SEEDS=100` (~11,000 games) is the full pass. | 3s - 90s | nothing |
| `N=80 npm run qa:winrate` | AI-vs-AI win rate of each deck against every other, seats alternating. Margin is about +/-4 points at N=80, so use `N>=40` for anything you act on. | ~1 min at N=80 | nothing |
| `npm run qa:scenarios` | Targeted real-browser scenarios (block planning, hit areas, HUD layout, cast window, keywords, board UX, triggers...). Each checks its own preconditions so a click that silently missed cannot read as a pass. | ~2 min | dev server + Playwright |
| `npm run qa:smoke` | **The smoke batch**: 8 real matches (4 desktop, 4 phone), every deck played twice, 4 at a time, played through real clicks. Exits non-zero on any anomaly, crash, stuck game or failed gesture. | ~3-4 min | dev server + Playwright |
| `node tools/qa/smoke.cjs --quick` | 2 matches. A check that the tooling works, **not** a smoke test. | ~1.5 min | dev server + Playwright |
| `node tools/qa/ui-match.cjs --pairs a:b:idx,... --viewport desktop\|phone --out f.jsonl` | The match runner itself. All 56 pairings are in `pairs.txt`; running them all is the **full pass**. | ~15 min+ | dev server + Playwright |

## When to run what

- **Small change** (a card, a style, a text, one UI component): `lint`, `tsc`, `npm test`, `qa:smoke`.
- **Rules, combat, store or whole-board layout change**: also `qa:fuzz` with `SEEDS=100`,
  `qa:scenarios`, and a **full 56-match pass** at the end of the piece of work.
- **Balance-affecting change** (card stats, keywords, deck lists): `qa:winrate` before and after, with
  the same `N`. Aim to keep every deck between 45% and 58%.

## Requirements and gotchas

- **Dev server:** `npm run dev` in another terminal. The browser tools play against
  `http://localhost:5173/` (`--base` to change). If it is down, matches "crash" in 0s; check that first.
- **Playwright** is not a project dependency (it would add a browser download to every CI install). Install
  it where you run the browser tools (`npm i --no-save playwright && npx playwright install chromium`), or
  use an environment that has it.
- **Do not edit `src/` while a browser batch runs.** Hot reload disturbs the matches and causes false alarms.
- **The board hold.** On every phase change the board keeps drawing the state from before the change and locks its cards until the
  phase banner has left (see CLAUDE.md, "Phase banners"); chained banners hold it 10-23 s (a turn change; after the player's own
  attack, clash plus several banners). The match runner therefore waits for `.board.cards-locked` / `.phase-banner` to clear before it
  acts, skips its DOM-vs-state checks while the board is held, and freezes a target's infinite animations (attackers bob forever, and
  Playwright will not click an element that is "not stable") just for the click. `LOCK_STUCK` fires if the board stays held for 36 s
  (the app's own failsafe releases at 40 s). Every result carries `maxHeldMs` and `longHolds` (each hold over 6 s, with where it
  started and ended), which is how a long chain of banners is told from a lock that never releases. Before these fixes the batch
  failed on every match with HUD / acting-ring / tapped / ATK-tag / gesture anomalies that were the harness, not the game.
- **One lone anomaly is not proof.** Under heavy load (4+ browsers) a rare `HUD_LIFE` or a missed tap can
  appear and then not reproduce. Replay the same pairing a few times before changing code, and compare against
  the same run on the code without your change.
- A single game's winner (7 straight wins for one deck) is noise. Only the win-rate sim at `N>=40` says anything.
- Outputs go to the OS temp dir by default (`--out`, `--shots`, `OUT=` to change). Screenshots of anomalies are
  saved next to the results.

## How the match runner works

Player A ("human") takes every decision from the shipped AI policy but **executes it through real clicks** on
the real board (hand cards, creatures, shields, buttons); player B is the game's own AI. Every UI-driven state
change is compared against `applyAction` on the previous state, and a DOM auditor runs every 400ms checking the
board and HUD against the game state, including that a card that died keeps no stale selection ring or tag. The
auditor itself was verified with deliberate sabotage (`CANARY=1 node tools/qa/ui-match.cjs`): it must catch all
nine injected faults, because a checker that cannot fail proves nothing.
