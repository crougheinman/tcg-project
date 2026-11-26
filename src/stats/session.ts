import type { Action, GameState, PlayerId } from '../engine/types';
import { submitMatch, flushOutbox, type KV, type StatsClient } from './send';
import { finish, newTracker, track, type MatchMeta, type Mode, type Tracker } from './tracker';

// The glue between the game store and the statistics: the store calls `begin` when a match starts, `step` after every applied
// action (its own, the AI's and the opponent's alike) and `forfeit` / `stop` when the match is left. Everything outside the
// match (the clock, storage, the network client, the on/off switch) is passed in, so this runs, and is tested, without a browser.

export interface SessionDeps {
  /** The Supabase client, or null when the project is not configured (then nothing is recorded or queued). */
  client: StatsClient | null;
  kv: KV | null;
  /** The player's sharing switch, read each time a match ends. */
  sharing: () => boolean;
  now: () => number;
  gameVersion: string;
  contentHash: () => string;
  env: string;
  automated: boolean;
  newKey: () => string;
}

export interface BeginInfo {
  mode: Mode;
  humanA: boolean;
  humanB: boolean;
  deckA: string;
  deckB: string;
  customA?: string[] | null;
  customB?: string[] | null;
  /** Both players' browsers must agree on this for an online match, so the database keeps one row. */
  matchKey?: string;
  /** A match picked up again after a drop: its early part was replayed, so the clock is unknown. */
  rejoined?: boolean;
}

export function createStatsSession(deps: SessionDeps) {
  let tracker: Tracker | null = null;

  const report = (rec: ReturnType<typeof finish>) => {
    if (!deps.client || !deps.kv || !deps.sharing()) return;
    submitMatch(rec, deps.client, deps.kv).catch(() => {});
  };

  return {
    begin(info: BeginInfo): void {
      const meta: MatchMeta = {
        matchKey: info.matchKey ?? deps.newKey(),
        mode: info.mode,
        humanA: info.humanA,
        humanB: info.humanB,
        deckA: info.deckA,
        deckB: info.deckB,
        customA: info.customA ?? null,
        customB: info.customB ?? null,
        gameVersion: deps.gameVersion,
        contentHash: deps.contentHash(),
        env: deps.env,
        automated: deps.automated,
        startedAt: info.rejoined ? null : deps.now(),
      };
      tracker = newTracker(meta);
    },

    /** One applied action. Reports the match once, when this action ends it. */
    step(action: Action, before: GameState, after: GameState): void {
      const t = tracker;
      if (!t || t.done) return;
      track(t, before, action, after);
      if (after.winner) report(finish(t, after, undefined, deps.now()));
    },

    /** The opponent left an online match, so the player who stayed wins. */
    forfeit(game: GameState, winner: PlayerId, reason: 'forfeit' | 'disconnect'): void {
      const t = tracker;
      if (!t || t.done || game.winner) return;
      report(finish(t, game, { winner, reason }, deps.now()));
    },

    /** The match was left without finishing (a quit to the menu): nothing is recorded. */
    stop(): void {
      tracker = null;
    },

    /** Send anything left over from an earlier failure. */
    flush(): void {
      if (deps.client && deps.kv && deps.sharing()) flushOutbox(deps.client, deps.kv).catch(() => {});
    },
  };
}

export type StatsSession = ReturnType<typeof createStatsSession>;
