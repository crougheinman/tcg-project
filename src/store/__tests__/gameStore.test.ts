import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGame } from '../gameStore';
import { createInitialState } from '../../engine/state';
import { applyAction } from '../../engine/reducer';
import { deckById } from '../../cards/decks';
import { actorOf } from '../../engine/rules';
import { loadMatch } from '../../net/resume';
import type { Action, GameState } from '../../engine/types';
import type { MatchConnection } from '../../net/match';

// These tests exist because the store could not previously be imported at all
// under the node-only vitest config — it reads localStorage at module scope. The
// PvP actor guard and reconnect replay were shipped with no coverage as a result.

const SEED = 4242;
const DECK_A = 'emberwood';
const DECK_B = 'skyward';

/** A MatchConnection that records what the store sends instead of hitting the wire. */
function fakeConn(over: Partial<MatchConnection> = {}) {
  const sent: Action[] = [];
  const conn: MatchConnection & { sent: Action[]; fireAction?: (a: Action) => void } = {
    roomId: 'TEST',
    role: 'A',
    seed: SEED,
    deckA: DECK_A,
    deckB: DECK_B,
    initialLog: [],
    sent,
    sendAction: (a) => sent.push(a),
    onAction: (cb) => {
      conn.fireAction = cb;
    },
    sendChat: () => {},
    onChat: () => {},
    sendAbort: () => {},
    onGone: () => {},
    onPeerStatus: () => {},
    leave: () => {},
    ...over,
  };
  return conn;
}

function freshGame(): GameState {
  return createInitialState(SEED, deckById(DECK_A).cards, deckById(DECK_B).cards);
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  useGame.setState({
    mode: 'menu', game: null, net: null, aiId: null, error: null,
    forfeit: null, charging: null, peerStale: false,
  });
});

describe('PvP actor guard', () => {
  it('sends a local action when this client is the legal actor', () => {
    const conn = fakeConn({ role: 'A' });
    useGame.getState().startPvp(conn);
    const g = useGame.getState().game!;
    expect(actorOf(g)).toBe('A'); // our turn

    const land = g.players.A.hand.find((c) => c.def === 'aether_well')!;
    useGame.getState().dispatch({ type: 'playLand', iid: land.iid });

    expect(conn.sent).toHaveLength(1);
    expect(useGame.getState().game!.players.A.battlefield).toHaveLength(1);
  });

  it('DROPS a local action when this client is not the actor', () => {
    // The whole point: the lockstep transport stamps one shared seq counter, so
    // if the non-actor also originates an action both clients stamp the same seq
    // and each discards the other's copy -> permanent silent divergence.
    const conn = fakeConn({ role: 'A' });
    useGame.getState().startPvp(conn);

    // Hand priority to the defender: during combat_block, B acts, not A.
    const g = { ...useGame.getState().game!, phase: 'combat_block' as const, active: 'A' as const };
    useGame.setState({ game: g });
    expect(actorOf(g)).toBe('B');
    expect(useGame.getState().myId).toBe('A');

    useGame.getState().dispatch({ type: 'advance' });

    expect(conn.sent).toHaveLength(0); // nothing went on the wire
    expect(useGame.getState().game!.phase).toBe('combat_block'); // and nothing applied
  });

  it('does not guard hotseat, where one client legitimately drives both sides', () => {
    useGame.getState().startHotseat(DECK_A, DECK_B);
    const g = useGame.getState().game!;
    const land = g.players.A.hand.find((c) => c.def === 'aether_well')!;
    useGame.getState().dispatch({ type: 'playLand', iid: land.iid });
    expect(useGame.getState().game!.players.A.battlefield).toHaveLength(1);
  });
});

describe('PvP reconnect', () => {
  /** Play a few legal actions and return both the log and the resulting state. */
  function recordedMatch(): { log: Action[]; expected: GameState } {
    let g = freshGame();
    const log: Action[] = [];
    const play = (a: Action) => {
      g = applyAction(g, a);
      log.push(a);
    };
    play({ type: 'playLand', iid: g.players.A.hand.find((c) => c.def === 'aether_well')!.iid });
    play({ type: 'advance' }); // -> combat_attack
    play({ type: 'declareAttackers', attackers: [] });
    return { log, expected: g };
  }

  it('replays a saved log into the exact state it left off at', () => {
    const { log, expected } = recordedMatch();
    useGame.getState().startPvp(fakeConn({ initialLog: log }));
    // Determinism is the whole reconnect design: seed + log reproduces the state
    // byte for byte, so nothing of GameState ever has to be serialized.
    expect(useGame.getState().game).toEqual(expected);
  });

  it('starts a fresh match when there is no log to replay', () => {
    useGame.getState().startPvp(fakeConn({ initialLog: [] }));
    expect(useGame.getState().game).toEqual(freshGame());
  });

  it('bails to the menu on a log that will not replay, instead of half-restoring', () => {
    const bogus: Action[] = [{ type: 'playLand', iid: 'no-such-card' }];
    const left = vi.fn();
    useGame.getState().startPvp(fakeConn({ initialLog: bogus, leave: left }));

    const s = useGame.getState();
    expect(s.mode).toBe('menu');
    expect(s.game).toBeNull();
    expect(s.error).toMatch(/could not restore match/i);
    expect(left).toHaveBeenCalled(); // the channel is torn down, not leaked
    expect(loadMatch()).toBeNull(); // and the corrupt record is cleared
  });

  it('surfaces peer staleness without touching the game', () => {
    let emit: ((s: 'ok' | 'stale') => void) | undefined;
    useGame.getState().startPvp(fakeConn({ onPeerStatus: (cb) => { emit = cb; } }));
    const before = useGame.getState().game;

    emit!('stale');
    expect(useGame.getState().peerStale).toBe(true);
    expect(useGame.getState().game).toBe(before); // engine untouched — presentation only

    emit!('ok');
    expect(useGame.getState().peerStale).toBe(false);
  });

  it('applies an inbound peer action through the same reducer', () => {
    const conn = fakeConn();
    useGame.getState().startPvp(conn);
    const land = useGame.getState().game!.players.A.hand.find((c) => c.def === 'aether_well')!;
    conn.fireAction!({ type: 'playLand', iid: land.iid });
    expect(useGame.getState().game!.players.A.battlefield).toHaveLength(1);
    expect(conn.sent).toHaveLength(0); // inbound actions are never echoed back
  });

  it('reports a desync rather than throwing out of the reducer', () => {
    const conn = fakeConn();
    useGame.getState().startPvp(conn);
    expect(() => conn.fireAction!({ type: 'playLand', iid: 'nope' })).not.toThrow();
    expect(useGame.getState().error).toMatch(/desync/i);
  });
});

describe('match persistence', () => {
  it('leaving for the menu clears the saved match so it is not offered again', () => {
    useGame.getState().startPvp(fakeConn());
    useGame.getState().toMenu();
    expect(loadMatch()).toBeNull();
    expect(useGame.getState().peerStale).toBe(false);
  });

  it('a finished game clears the saved match', () => {
    const conn = fakeConn();
    useGame.getState().startPvp(conn);
    // Drop B to lethal, then let any action run the state-based checks.
    const g = structuredClone(useGame.getState().game!);
    g.players.B.life = 1;
    g.players.A.hand.push({
      iid: 'burn1', def: 'cinderbolt', owner: 'A', tapped: false,
      summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false,
    });
    g.players.A.battlefield.push({
      iid: 'landX', def: 'aether_well', owner: 'A', tapped: false,
      summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false,
    });
    useGame.setState({ game: g });

    useGame.getState().dispatch({
      type: 'castSorcery', iid: 'burn1', target: { kind: 'player', player: 'B' },
    });

    expect(useGame.getState().game!.winner).toBe('A');
    expect(loadMatch()).toBeNull();
  });
});

describe('guided mode', () => {
  it('defaults on and persists the player’s choice', () => {
    expect(useGame.getState().guided).toBe(true);
    useGame.getState().setGuided(false);
    expect(localStorage.getItem('guided')).toBe('0');
    useGame.getState().setGuided(true);
    expect(localStorage.getItem('guided')).toBe('1');
  });
});
