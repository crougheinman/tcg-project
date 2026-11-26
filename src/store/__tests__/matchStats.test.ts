import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The store reports every finished match to Supabase (src/stats). Real matches are driven through the real store, against a fake client.

const inserted = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('../../net/supabase', () => ({
  hasSupabase: true,
  supabase: { from: () => ({ insert: async (row: Record<string, unknown>) => { inserted.push(row); return { error: null }; } }) },
}));

import { useGame } from '../gameStore';
import { pickAction } from '../../ai/ai';
import { actorOf } from '../../engine/rules';
import type { Action } from '../../engine/types';
import type { MatchConnection } from '../../net/match';

beforeEach(() => {
  vi.useFakeTimers();
  inserted.length = 0;
  sessionStorage.clear();
  localStorage.clear();
  useGame.setState({ mode: 'menu', game: null, net: null, aiId: null, error: null, forfeit: null, charging: null, spotlights: [], peerStale: false, shareStats: true });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

const flush = async () => {
  await vi.advanceTimersByTimeAsync(10);
};

/** Play the current match to its end by driving the store the way the UI does; `until` stops early. */
async function playOut(until: () => boolean = () => false) {
  for (let i = 0; i < 20_000; i++) {
    const s = useGame.getState();
    if (!s.game || s.game.winner || until()) return;
    const actor = actorOf(s.game);
    if (s.mode === 'ai' && actor === s.aiId) await vi.advanceTimersByTimeAsync(4000); // the AI moves itself
    else {
      s.dispatch(pickAction(s.game, actor));
      await vi.advanceTimersByTimeAsync(4000); // let any cast telegraph resolve
    }
  }
  throw new Error('the match did not finish');
}

function fakeConn(over: Partial<MatchConnection> = {}) {
  const conn: MatchConnection & { fire?: (a: Action) => void; gone?: (r: 'aborted' | 'disconnected') => void } = {
    roomId: 'ROOM', role: 'A', seed: 4242, deckA: 'emberwood', deckB: 'skyward', initialLog: [],
    sendAction: () => {}, onAction: (cb) => { conn.fire = cb; }, sendChat: () => {}, onChat: () => {}, sendAbort: () => {},
    onGone: (cb) => { conn.gone = cb; }, onPeerStatus: () => {}, leave: () => {}, ...over,
  };
  return conn;
}

describe('the store reports finished matches', () => {
  it('a hotseat match: one record, with the decks, the winner and real counts', async () => {
    useGame.getState().startHotseat('emberwood', 'skyward');
    await playOut();
    await flush();
    const g = useGame.getState().game!;
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ mode: 'hotseat', human_a: true, human_b: true, deck_a: 'emberwood', deck_b: 'skyward', winner: g.winner, turns: g.turn, life_a: g.players.A.life, life_b: g.players.B.life });
    const stats = inserted[0].stats as { A: { lands_played: number } };
    expect(stats.A.lands_played).toBeGreaterThan(0);
  });

  it('a match against the AI counts the AI\'s moves too, and marks who was human', async () => {
    useGame.getState().startAI('gravetide', 'wildblitz');
    await playOut();
    await flush();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ mode: 'ai', human_a: true, human_b: false, deck_a: 'gravetide', deck_b: 'wildblitz' });
    const st = inserted[0].stats as { B: { lands_played: number; creatures_cast: number } };
    expect(st.B.lands_played).toBeGreaterThan(0); // B is the AI: its actions went through the AI apply path
  });

  it('an online match counts the opponent\'s actions (the peer path), keyed by room and seed', async () => {
    const conn = fakeConn({ role: 'B' });
    useGame.getState().startPvp(conn);
    // B plays its own actions through dispatch and receives A's through the peer path, until the end
    for (let i = 0; i < 20_000; i++) {
      const s = useGame.getState();
      if (s.game!.winner) break;
      const a = pickAction(s.game!, actorOf(s.game!));
      if (actorOf(s.game!) === 'B') s.dispatch(a);
      else conn.fire!(a);
      await vi.advanceTimersByTimeAsync(10);
    }
    await flush();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ mode: 'pvp', match_key: 'pvp-ROOM-4242', human_a: true, human_b: true });
    const st = inserted[0].stats as { A: { lands_played: number } };
    expect(st.A.lands_played).toBeGreaterThan(0); // A's actions arrived through the peer path
  });

  it('when the online opponent leaves, the player who stayed is recorded as the winner', async () => {
    const conn = fakeConn({ role: 'A' });
    useGame.getState().startPvp(conn);
    conn.gone!('disconnected');
    await flush();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ mode: 'pvp', winner: 'A', end_reason: 'disconnect' });
    conn.gone!('aborted'); // a second signal changes nothing
    await flush();
    expect(inserted).toHaveLength(1);
  });

  it('an aborted online match reads as a forfeit', async () => {
    const conn = fakeConn({ role: 'B' });
    useGame.getState().startPvp(conn);
    conn.gone!('aborted');
    await flush();
    expect(inserted[0]).toMatchObject({ winner: 'B', end_reason: 'forfeit' });
  });

  it('a match left before the end records nothing', async () => {
    useGame.getState().startHotseat('emberwood', 'skyward');
    let n = 0;
    await playOut(() => ++n > 40);
    useGame.getState().toMenu();
    await playOut();
    await flush();
    expect(inserted).toHaveLength(0);
  });

  it('records nothing once the player turns sharing off', async () => {
    useGame.getState().setShareStats(false);
    expect(localStorage.getItem('shareStats')).toBe('0');
    useGame.getState().startHotseat('emberwood', 'skyward');
    await playOut();
    await flush();
    expect(inserted).toHaveLength(0);
  });

  it('a rematch is a new match with its own record', async () => {
    useGame.getState().startAI('emberwood', 'skyward');
    await playOut();
    await flush();
    useGame.getState().playAgain();
    await playOut();
    await flush();
    expect(inserted).toHaveLength(2);
    expect(inserted[0].match_key).not.toBe(inserted[1].match_key);
  });
});
