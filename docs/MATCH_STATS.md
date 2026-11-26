# Match statistics

Every finished match sends one anonymous record to Supabase, so game balance can be judged from real play instead of the AI-vs-AI
simulation alone (`N=80 npm run qa:winrate`). This page says what is recorded, how to set it up, and how to read it.

## What is recorded

One row per **finished** match in `public.match_stats` (`supabase/migrations/20261126000000_match_stats.sql`):

| Column | Meaning |
|---|---|
| `match_key` | Unique per match. For an online match it is `pvp-<room>-<seed>`, so both players' browsers send the same key and the database keeps one row. |
| `mode`, `human_a`, `human_b` | `ai` (a person against the AI), `hotseat` (two people, one device), `pvp` (online). Who was a person. |
| `deck_a`, `deck_b`, `custom_a`, `custom_b` | Deck ids; the card list too when a deck is a custom one. A is the player on the play. |
| `winner`, `end_reason` | `A` / `B` / `draw`; `life`, `deck` (drew from an empty library), `draw`, `forfeit` (the opponent aborted online), `disconnect`. |
| `first_player`, `turns` | Who was on the play. `turns` counts BOTH players' turns together. |
| `mulligans_a/b`, `life_a/b`, `duration_s` | Mulligans taken, final life, seconds played (null for a rejoined match). |
| `content_hash` | Fingerprint of every card's numbers and every deck list when the match was played. **Rows with different hashes were played under different balance; never mix them.** Text, flavour and art are not part of it. |
| `game_version`, `env`, `automated` | App version; `production` / `development`; a scripted browser (the QA harness sets `navigator.webdriver`). |
| `stats` (json) | Per player: `cast` (card id -> times cast), `seen` (card id -> copies that left the library, i.e. drawn), `died`, counts of creatures / spells / equipment cast, lands played, attackers, blockers, abilities, equips, ninjutsu, unearths, cycles, `damage_taken`, `life_gained`; plus `life_curve`, both players' life at the end of each turn. |

**Not recorded**: names, accounts, device or browser ids, chat, the action log, anything typed. The browser sends the row straight to
Supabase, which (like any web host) sees the request's IP address in its own infrastructure logs; the table does not store it.

Matches left before the end record nothing. Both a person quitting to the menu and an aborted online match leave the quitter unrecorded;
the player who stayed is recorded as the winner (`forfeit` / `disconnect`).

## Player control

The game menu has **Share Stats** (on by default, remembered in `localStorage` as `shareStats`). Off means nothing is sent or queued.

## Setting it up (once)

1. Supabase dashboard -> **SQL Editor** -> paste `supabase/migrations/20261126000000_match_stats.sql` -> **Run** (it is safe to run twice;
   or `supabase db push` if you use the CLI).
2. Make sure the site has `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (see `README.md`). Online play already needs them.
3. Finish a match, then open **Table Editor -> match_stats**. If nothing appears, the record waits in the browser's outbox (see below);
   the usual cause is step 1 not having been run.

## Who can read and write

* The public (`anon`, `authenticated`) may **insert** only the columns the game supplies. They cannot read, change or delete a row, and
  cannot set `id` or `created_at` (so no backdating). The migration revokes Supabase's default grants first, then grants exactly that.
* Only the project owner (the dashboard, the service key) reads. The balance views below are readable only by them too.
* The columns carry CHECK limits (turn count, durations, JSON size, allowed words). `src/stats/validate.ts` applies the same limits in
  the browser; `stats.test.ts` compares the two and the column list against the migration.
* **Limitation**: the publishable key is public, so anyone can insert rows that look real. Filter by `env`, `automated` and `mode`, and treat the
  data as indicative. If it is ever abused, put an Edge Function (rate limit, plausibility checks) in front of the insert. Online (`pvp`)
  results are also client-reported, the same trust the game already places in its lockstep.

## Reading it

Three views are in the migration (run them in the SQL editor; they count real play: `env = 'production'`, not `automated`, no draws):

```sql
select * from balance_deck_winrates   where mode = 'ai'  order by win_pct desc;   -- per deck, per balance era (content_hash)
select * from balance_first_player;                                               -- how much being on the play is worth
select * from balance_card_winrates   where mode = 'ai'  order by win_pct_when_seen desc;  -- per card: win rate when drawn / when cast
```

Hints: judge only one `content_hash` at a time; `ai` is a person against the AI (the AI's own play is the same for every deck, so decks are
comparable), `pvp` is people against each other. A deck needs a few dozen games before its win rate means anything (margin is about +/-10
points at 50 games). `seen` is a card that left the library, so "win rate when seen" is the usual "games where I drew it" measure.

## If a record cannot be sent

`src/stats/send.ts` is fire-and-forget: the game never waits on it and never shows an error for it. A record that fails for a temporary reason
(offline, the table not created yet) waits in `localStorage` (`matchStatsOutbox`, newest 25) and is sent with the next finished match or
shortly after the next page load. A record the database would refuse for good (a limit broken) is dropped, not retried for ever. A duplicate
(the other online player got there first) counts as sent.

## Changing what is recorded

1. Add the field in `src/stats/tracker.ts` (and `validate.ts` if it is a column), a column and CHECK in a **new** migration file (never edit one that
   has run), and bump `STATS_SCHEMA_VERSION`.
2. `stats.test.ts` checks every count against the engine's own log, and that the record's keys equal the migration's grant list, so a forgotten
   piece fails a test.
3. Re-run the migration test described in `ARCHITECTURE.md` (a real Postgres in WASM) if you change policies.
