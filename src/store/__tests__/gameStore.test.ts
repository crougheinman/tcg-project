import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    forfeit: null, charging: null, spotlights: [], peerStale: false,
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
    // startHotseat seeds from Math.random, so the opening hand may hold no land.
    // Put one there rather than depend on the shuffle.
    const g = structuredClone(useGame.getState().game!);
    const land = {
      iid: 'hotseat-land', def: 'aether_well', owner: 'A' as const, tapped: false,
      summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false,
    };
    g.players.A.hand.push(land);
    g.players.A.battlefield = [];
    useGame.setState({ game: g });
    useGame.getState().dispatch({ type: 'playLand', iid: land.iid });
    expect(useGame.getState().game!.players.A.battlefield).toHaveLength(1);
  });
});

describe('vs AI actor guard', () => {
  /** An AI game parked in a given phase, with no AI timer left running. */
  function aiGame(active: 'A' | 'B', phase: 'main1' | 'combat_attack') {
    vi.useFakeTimers();
    useGame.getState().startAI(DECK_A, DECK_B);
    const g = structuredClone(useGame.getState().game!);
    g.active = active;
    g.phase = phase;
    useGame.setState({ game: g, error: null });
  }
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('drops a human action while it is the AI\'s turn to act', () => {
    // This is how a stray double-tap could have skipped the AI's whole main phase.
    aiGame('B', 'main1');
    useGame.getState().dispatch({ type: 'advance' });
    expect(useGame.getState().game!.phase).toBe('main1'); // untouched
    expect(useGame.getState().error).toBeNull(); // dropped quietly, not an error toast
  });

  it('still applies the human\'s own actions', () => {
    aiGame('A', 'main1');
    useGame.getState().dispatch({ type: 'advance' });
    expect(useGame.getState().game!.phase).toBe('combat_attack');
  });

  it('hands the defender priority during combat_block (the actor is the human, not the active player)', () => {
    aiGame('B', 'main1');
    const g = structuredClone(useGame.getState().game!);
    g.phase = 'combat_block';
    g.combat = { attackers: [], blocks: {} };
    useGame.setState({ game: g });
    useGame.getState().dispatch({ type: 'declareBlockers', blocks: {} });
    expect(useGame.getState().game!.phase).toBe('end');
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

describe('cast spotlight', () => {
  let n = 0;
  const card = (def: string, owner: 'A' | 'B') => ({
    iid: `t${n++}_${def}`, def, owner, tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false,
  });
  /** The current game parked in main1 for A, with A holding exactly `hand` and six untapped lands. */
  function park(hand: string[]) {
    const g = structuredClone(useGame.getState().game!);
    g.active = 'A';
    g.phase = 'main1';
    g.pending = null;
    g.players.A.hand = hand.map((d) => card(d, 'A'));
    g.players.A.battlefield = Array.from({ length: 6 }, () => card('aether_well', 'A'));
    g.players.B.battlefield = [];
    useGame.setState({ game: g, error: null, charging: null, spotlights: [] });
    return g.players.A.hand[0].iid;
  }
  const inHand = (def: string) => useGame.getState().game!.players.A.hand.some((c) => c.def === def);
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('vs AI / hotseat (the effect waits for the card)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      useGame.getState().startAI(DECK_A, DECK_B);
    });

    it('gives an ordinary sorcery a spotlight window before it resolves', () => {
      const iid = park(['insight']);
      useGame.getState().dispatch({ type: 'castSorcery', iid });
      const s = useGame.getState();
      expect(s.charging?.kind).toBe('cast');
      expect(s.spotlights.map((x) => x.card.def)).toEqual(['insight']);
      expect(inHand('insight')).toBe(true); // not resolved yet: the card is the show
      vi.advanceTimersByTime(1299);
      expect(inHand('insight')).toBe(true);
      vi.advanceTimersByTime(1);
      expect(inHand('insight')).toBe(false);
      expect(useGame.getState().charging).toBeNull();
      expect(useGame.getState().spotlights).toEqual([]); // and the card floats away
    });

    it('spotlights the card for the whole of an existing charge-up too', () => {
      const iid = park(['cinderbolt']);
      useGame.getState().dispatch({ type: 'castSorcery', iid, target: { kind: 'player', player: 'B' } });
      expect(useGame.getState().charging?.kind).toBe('charge');
      expect(useGame.getState().spotlights[0]?.ms).toBe(useGame.getState().charging!.ms);
    });

    it('gives a creature skill (Kunoichi, Beast Blitz) a window; a plain creature gets none', () => {
      const k = park(['kunoichi', 'ember_sprite']);
      useGame.getState().dispatch({ type: 'castCreature', iid: k });
      expect(useGame.getState().charging?.kind).toBe('cast');
      expect(useGame.getState().spotlights[0].label).toBe('✦ Beast Blitz');
      vi.advanceTimersByTime(1300);
      expect(inHand('kunoichi')).toBe(false);

      const plain = park(['ember_sprite']);
      useGame.getState().dispatch({ type: 'castCreature', iid: plain });
      expect(useGame.getState().charging).toBeNull(); // no skill -> no delay, no spotlight
      expect(useGame.getState().spotlights).toEqual([]);
      expect(inHand('ember_sprite')).toBe(false); // resolved at once
    });

    it('still ignores input while the card is on show', () => {
      const iid = park(['insight']);
      useGame.getState().dispatch({ type: 'castSorcery', iid });
      useGame.getState().dispatch({ type: 'advance' });
      expect(useGame.getState().game!.phase).toBe('main1');
    });

    it('an older spotlight timer cannot clear a newer one', () => {
      const iid = park(['insight']);
      useGame.getState().dispatch({ type: 'castSorcery', iid });
      vi.advanceTimersByTime(1000);
      useGame.getState().pushSpotlight({ card: useGame.getState().spotlights[0].card, ownerId: 'A', label: 'x', ms: 5000 });
      vi.advanceTimersByTime(400); // the first one's timer fires now
      expect(useGame.getState().spotlights.map((s) => s.label)).toEqual(['x']);
    });
  });

  describe('PvP (lockstep: no delay, the card floats alongside)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    it('applies my cast at once and still shows the card', () => {
      const conn = fakeConn();
      useGame.getState().startPvp(conn);
      const iid = park(['insight']);
      useGame.getState().dispatch({ type: 'castSorcery', iid });
      expect(useGame.getState().charging).toBeNull();
      expect(inHand('insight')).toBe(false); // applied immediately
      expect(conn.sent).toHaveLength(1); // and sent to the peer straight away
      expect(useGame.getState().spotlights.map((s) => s.card.def)).toEqual(['insight']);
    });

    it("shows the opponent's cast when it arrives", () => {
      const conn = fakeConn({ role: 'B' });
      useGame.getState().startPvp(conn);
      const g = structuredClone(useGame.getState().game!);
      g.active = 'A';
      g.phase = 'main1';
      g.players.A.hand = [card('insight', 'A')];
      g.players.A.battlefield = Array.from({ length: 6 }, () => card('aether_well', 'A'));
      useGame.setState({ game: g, spotlights: [] });
      conn.fireAction!({ type: 'castSorcery', iid: g.players.A.hand[0].iid });
      expect(useGame.getState().spotlights).toHaveLength(1);
      expect(useGame.getState().spotlights[0].ownerId).toBe('A');
    });
  });
});
