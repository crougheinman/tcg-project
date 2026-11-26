import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Lobby } from '../Lobby';
import { ReadyRoomView, SearchingView } from '../MatchmakingViews';
import { useGame } from '../../store/gameStore';
import { COUNTDOWN_MS } from '../../net/matchmaking';
import { joinQueue, type Matched } from '../../net/queue';
import { openRoom, type RoomSnapshot } from '../../net/room';
import { setTransport } from '../../net/transport';
import { createMemoryHub } from '../../net/transport.memory';
import type { MatchConnection } from '../../net/match';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'queueMicrotask'] });
  // jsdom has no matchMedia, which the deck shelf asks for (desktop grid vs phone carousel)
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  setTransport(null);
  // @ts-expect-error remove the stub again
  delete window.matchMedia;
  vi.clearAllTimers();
  vi.useRealTimers();
});
const tick = (ms = 50) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

const snap = (o: Partial<RoomSnapshot> = {}): RoomSnapshot => ({
  roomId: 'ABCD', role: 'A', quick: true, connected: true, meReady: false, peer: { present: true, ready: false },
  countdownEndsAt: null, readyDeadline: null, starting: false, ...o,
});

describe('the search screen', () => {
  it('shows the live count with the right wording, and "connecting" before the first count', () => {
    const { rerender } = render(<SearchingView count={null} startedAt={Date.now()} hintAfterMs={45_000} onCancel={() => {}} onHostInstead={() => {}} />);
    expect(screen.getByTestId('qm-count').textContent).toBe('Connecting…');
    rerender(<SearchingView count={1} startedAt={Date.now()} hintAfterMs={45_000} onCancel={() => {}} onHostInstead={() => {}} />);
    expect(screen.getByTestId('qm-count').textContent).toBe('1 player searching');
    rerender(<SearchingView count={7} startedAt={Date.now()} hintAfterMs={45_000} onCancel={() => {}} onHostInstead={() => {}} />);
    expect(screen.getByTestId('qm-count').textContent).toBe('7 players searching');
  });

  it('suggests hosting a room only after a long wait alone', async () => {
    const hosted: string[] = [];
    render(<SearchingView count={1} startedAt={Date.now()} hintAfterMs={45_000} onCancel={() => {}} onHostInstead={() => hosted.push('host')} />);
    expect(screen.queryByText(/nobody else is searching/i)).toBeNull();
    await tick(46_000);
    expect(screen.getByText(/nobody else is searching/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /host a room/i }));
    expect(hosted).toEqual(['host']);
  });

  it('does not say nobody is searching when others are', async () => {
    render(<SearchingView count={3} startedAt={Date.now()} hintAfterMs={1000} onCancel={() => {}} onHostInstead={() => {}} />);
    await tick(5000);
    expect(screen.queryByText(/nobody else is searching/i)).toBeNull();
  });

  it('cancels', () => {
    const cancelled: string[] = [];
    render(<SearchingView count={2} startedAt={Date.now()} hintAfterMs={45_000} onCancel={() => cancelled.push('x')} onHostInstead={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(cancelled).toEqual(['x']);
  });
});

describe('the ready room screen', () => {
  const view = (s: RoomSnapshot, onReady: (r: boolean) => void = () => {}, onLeave: () => void = () => {}) => render(<ReadyRoomView snap={s} onReady={onReady} onLeave={onLeave} />);

  it('shows both seats and their states', () => {
    const { rerender } = view(snap({ peer: { present: false, ready: false } }));
    expect(screen.getByTestId('seat-me').dataset.state).toBe('waiting');
    expect(screen.getByTestId('seat-foe').dataset.state).toBe('absent');
    rerender(<ReadyRoomView snap={snap({ meReady: true, peer: { present: true, ready: false } })} onReady={() => {}} onLeave={() => {}} />);
    expect(screen.getByTestId('seat-me').dataset.state).toBe('ready');
    expect(screen.getByTestId('seat-foe').dataset.state).toBe('waiting');
    rerender(<ReadyRoomView snap={snap({ meReady: true, peer: { present: true, ready: true } })} onReady={() => {}} onLeave={() => {}} />);
    expect(screen.getByTestId('seat-foe').dataset.state).toBe('ready');
    expect(screen.getByTestId('seat-foe').textContent).toContain('Ready');
  });

  it('the Ready button toggles, and is off until an opponent is there', () => {
    const calls: boolean[] = [];
    const { rerender } = view(snap({ peer: { present: false, ready: false } }), (r) => calls.push(r));
    expect((screen.getByRole('button', { name: /^ready/i }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<ReadyRoomView snap={snap()} onReady={(r) => calls.push(r)} onLeave={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /^ready/i }));
    rerender(<ReadyRoomView snap={snap({ meReady: true })} onReady={(r) => calls.push(r)} onLeave={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /ready ✓/i }));
    expect(calls).toEqual([true, false]);
  });

  it('counts down once both are ready', async () => {
    view(snap({ meReady: true, peer: { present: true, ready: true }, countdownEndsAt: Date.now() + COUNTDOWN_MS }));
    expect(screen.getByTestId('qm-status').textContent).toBe('Both ready. Starting in 3…');
    await tick(1100);
    expect(screen.getByTestId('qm-status').textContent).toBe('Both ready. Starting in 2…');
  });

  it('shows the room code to a host still waiting, and the ready deadline in a matched room', () => {
    view(snap({ quick: false, roomId: 'WXYZ', peer: { present: false, ready: false } }));
    expect(screen.getByLabelText('Room code WXYZ')).toBeTruthy();
    cleanup();
    view(snap({ readyDeadline: Date.now() + 20_000 }));
    expect(screen.getByText(/ready up within 20s/i)).toBeTruthy();
  });

  it('leaves', () => {
    const left: string[] = [];
    view(snap(), () => {}, () => left.push('x'));
    fireEvent.click(screen.getByRole('button', { name: /leave/i }));
    expect(left).toEqual(['x']);
  });
});

describe('the lobby, against a real second player', () => {
  async function pickDeck() {
    // the deck shelf: choose the first deck
    const cards = screen.getAllByRole('button').filter((b) => /emberwood|skyward|pyromancer|wildblitz/i.test(b.textContent ?? ''));
    fireEvent.click(cards[0]);
    await tick(10);
  }

  it('finds a match, shows the count, lets both players ready up, and starts the game for this player', async () => {
    const hub = createMemoryHub();
    setTransport(hub.client());
    const started: MatchConnection[] = [];
    useGame.setState({ startPvp: (c: MatchConnection) => void started.push(c) });
    render(<Lobby onBack={() => {}} />);
    await pickDeck();
    fireEvent.click(screen.getByRole('button', { name: /find a match/i }));
    await tick(100);
    expect(screen.getByTestId('qm-count').textContent).toBe('1 player searching');

    // another player starts searching: both are matched and move to the ready room
    const other = hub.client();
    let matched: Matched | null = null;
    joinQueue({ transport: other, clientId: 'other', onCount: () => {}, onMatched: (m) => (matched = m) });
    await tick(500);
    expect(matched).not.toBeNull();
    await tick(100); // the room channel joins a moment after the match is made
    expect(screen.getByRole('heading', { name: /match found/i })).toBeTruthy();

    let otherSnap: RoomSnapshot | null = null;
    const otherConns: MatchConnection[] = [];
    const m = matched!;
    const otherRoom = openRoom({
      transport: other, roomId: m.roomId, role: m.role, deck: 'skyward', quick: true, clientId: 'other-room',
      onChange: (s) => (otherSnap = s), onStart: (c) => otherConns.push(c), onEnd: () => {},
    });
    await tick(200);
    expect(screen.getByTestId('seat-foe').dataset.state).toBe('waiting'); // present, not ready

    fireEvent.click(screen.getByRole('button', { name: /^ready/i }));
    await tick(100);
    expect(screen.getByTestId('seat-me').dataset.state).toBe('ready');
    expect(otherSnap!.peer.ready).toBe(true); // the other player sees my status

    otherRoom.setReady(true);
    await tick(100);
    expect(screen.getByTestId('seat-foe').dataset.state).toBe('ready');
    expect(screen.getByTestId('qm-status').textContent).toMatch(/starting in/i);

    await tick(COUNTDOWN_MS + 1500);
    expect(started).toHaveLength(1);
    expect(otherConns).toHaveLength(1);
    expect(started[0].seed).toBe(otherConns[0].seed);
    expect(new Set([started[0].role, otherConns[0].role])).toEqual(new Set(['A', 'B']));
  });

  it('cancelling the search leaves the queue', async () => {
    const hub = createMemoryHub();
    setTransport(hub.client());
    render(<Lobby onBack={() => {}} />);
    await pickDeck();
    fireEvent.click(screen.getByRole('button', { name: /find a match/i }));
    await tick(100);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await tick(100);
    const late = hub.client();
    let count = 0;
    joinQueue({ transport: late, clientId: 'late', onCount: (n) => (count = n), onMatched: () => {} });
    await tick(100);
    expect(count).toBe(1); // nobody was left behind in the queue
    expect(screen.getByRole('button', { name: /find a match/i })).toBeTruthy();
  });

  it('goes back to searching when the matched opponent never turns up, and says so', async () => {
    const hub = createMemoryHub();
    setTransport(hub.client());
    render(<Lobby onBack={() => {}} />);
    await pickDeck();
    fireEvent.click(screen.getByRole('button', { name: /find a match/i }));
    await tick(100);
    const other = hub.client();
    joinQueue({ transport: other, clientId: 'other', onCount: () => {}, onMatched: () => {} }); // matched, but never opens the room
    await tick(600);
    await tick(100);
    expect(screen.getByRole('heading', { name: /match found/i })).toBeTruthy();
    await tick(9000);
    expect(screen.getByTestId('qm-count')).toBeTruthy(); // searching again
    expect(screen.getByRole('status').textContent).toMatch(/your opponent left\. searching again/i);
  });

  it('hosting shows a code; a friend joining by code reaches the same ready room', async () => {
    const hub = createMemoryHub();
    setTransport(hub.client());
    render(<Lobby onBack={() => {}} />);
    await pickDeck();
    fireEvent.click(screen.getByRole('button', { name: /host a match/i }));
    await tick(100);
    const code = screen.getByLabelText(/room code [A-Z0-9]{4}/i).textContent!;
    expect(code).toMatch(/^[A-Z0-9]{4}$/);
    let theirs: RoomSnapshot | null = null;
    openRoom({ transport: hub.client(), roomId: code, role: 'B', deck: 'skyward', quick: false, clientId: 'friend', onChange: (s) => (theirs = s), onStart: () => {}, onEnd: () => {} });
    await tick(200);
    expect(screen.getByTestId('seat-foe').dataset.state).toBe('waiting');
    expect(theirs!.peer.present).toBe(true);
  });
});
