-- Match statistics, for balancing the game.
--
-- One row per FINISHED match, written by the browser (src/stats/send.ts) with the project's publishable key.
-- The rows describe the game, never the person: no name, no account, no device id, no chat, no action log.
--
-- Access, by design:
--   * the public (anon / authenticated) may INSERT a row, and only the columns the game supplies (not id / created_at);
--   * nobody but the project owner (the dashboard, the service key) may read, change or delete a row.
--
-- Run it once: Supabase dashboard -> SQL Editor -> paste -> Run (or `supabase db push`). It is safe to run twice.

create table if not exists public.match_stats (
  id             uuid primary key default gen_random_uuid(),
  created_at     timestamptz not null default now(),

  -- Made by the game. For an online match it is the room and seed, so BOTH players' browsers send the same key and the
  -- second insert is refused as a duplicate (unique violation 23505, which the sender treats as success).
  match_key      text not null unique check (char_length(match_key) between 1 and 64),
  schema_version smallint not null check (schema_version between 1 and 1000),
  game_version   text not null check (char_length(game_version) between 1 and 64),
  -- Fingerprint of every card's numbers and every deck list at the time: rows from different balance eras never mix.
  content_hash   text not null check (char_length(content_hash) between 1 and 64),
  env            text not null check (char_length(env) between 1 and 64),   -- 'production' | 'development'
  automated      boolean not null default false,                            -- a scripted browser (the QA harness)

  mode           text not null check (mode in ('ai', 'hotseat', 'pvp')),
  human_a        boolean not null,
  human_b        boolean not null,
  deck_a         text not null check (char_length(deck_a) between 1 and 64),
  deck_b         text not null check (char_length(deck_b) between 1 and 64),
  custom_a       jsonb check (custom_a is null or (jsonb_typeof(custom_a) = 'array' and jsonb_array_length(custom_a) <= 60)),
  custom_b       jsonb check (custom_b is null or (jsonb_typeof(custom_b) = 'array' and jsonb_array_length(custom_b) <= 60)),

  first_player   text not null check (first_player in ('A', 'B')),
  winner         text not null check (winner in ('A', 'B', 'draw')),
  end_reason     text not null check (end_reason in ('life', 'deck', 'draw', 'forfeit', 'disconnect')),
  turns          smallint not null check (turns between 1 and 500),         -- turns taken by BOTH players together
  duration_s     integer check (duration_s is null or duration_s between 0 and 86400),
  mulligans_a    smallint not null check (mulligans_a between 0 and 3),
  mulligans_b    smallint not null check (mulligans_b between 0 and 3),
  life_a         smallint not null check (life_a between -1000 and 1000),
  life_b         smallint not null check (life_b between -1000 and 1000),

  -- { "A": {cast, seen, died, creatures_cast, ...}, "B": {...}, "life_curve": [[lifeA, lifeB], ...] }
  stats          jsonb not null check (jsonb_typeof(stats) = 'object' and pg_column_size(stats) <= 30000)
);

create index if not exists match_stats_created_idx on public.match_stats (created_at);
create index if not exists match_stats_era_idx on public.match_stats (content_hash, env, mode);

-- ---- access -------------------------------------------------------------------------------------------------------
alter table public.match_stats enable row level security;

-- Supabase grants new tables to the public roles by default; start from nothing and add back exactly one thing.
revoke all on public.match_stats from anon, authenticated;
grant insert (
  match_key, schema_version, game_version, content_hash, env, automated, mode, human_a, human_b, deck_a, deck_b,
  custom_a, custom_b, first_player, winner, end_reason, turns, duration_s, mulligans_a, mulligans_b, life_a, life_b, stats
) on public.match_stats to anon, authenticated;

drop policy if exists "anyone may record a finished match" on public.match_stats;
create policy "anyone may record a finished match"
  on public.match_stats for insert to anon, authenticated
  with check (true);
-- No select / update / delete policy exists, so those are denied to everyone except the owner (who bypasses RLS).

-- ---- balance views (read them in the dashboard's SQL editor; the public roles get nothing) ------------------------------
-- They count real play only (env = 'production', not automated) and leave draws out of win rates. Filter `mode` as needed:
-- 'ai' is a person against the AI, 'pvp' two people, 'hotseat' two people on one device.

create or replace view public.balance_deck_winrates with (security_invoker = true) as
select content_hash, mode, deck, count(*) as games, count(*) filter (where won) as wins,
       round(100.0 * count(*) filter (where won) / count(*), 1) as win_pct
from (
  select content_hash, mode, deck_a as deck, winner = 'A' as won from public.match_stats
    where env = 'production' and not automated and winner <> 'draw'
  union all
  select content_hash, mode, deck_b as deck, winner = 'B' as won from public.match_stats
    where env = 'production' and not automated and winner <> 'draw'
) t
group by content_hash, mode, deck;

create or replace view public.balance_first_player with (security_invoker = true) as
select content_hash, mode, count(*) as games,
       round(100.0 * count(*) filter (where winner = first_player) / count(*), 1) as on_the_play_win_pct
from public.match_stats
where env = 'production' and not automated and winner <> 'draw'
group by content_hash, mode;

create or replace view public.balance_card_winrates with (security_invoker = true) as
with sides as (
  select content_hash, mode, stats -> 'A' as s, winner = 'A' as won from public.match_stats
    where env = 'production' and not automated and winner <> 'draw'
  union all
  select content_hash, mode, stats -> 'B', winner = 'B' from public.match_stats
    where env = 'production' and not automated and winner <> 'draw'
)
select content_hash, mode, e.key as card,
       count(*) as games_seen,
       round(100.0 * count(*) filter (where won) / count(*), 1) as win_pct_when_seen,
       count(*) filter (where (s -> 'cast' ->> e.key) is not null) as games_cast,
       round(100.0 * count(*) filter (where won and (s -> 'cast' ->> e.key) is not null)
             / nullif(count(*) filter (where (s -> 'cast' ->> e.key) is not null), 0), 1) as win_pct_when_cast
from sides, jsonb_each_text(s -> 'seen') as e(key, value)
group by content_hash, mode, e.key;

revoke all on public.balance_deck_winrates, public.balance_first_player, public.balance_card_winrates from anon, authenticated;
