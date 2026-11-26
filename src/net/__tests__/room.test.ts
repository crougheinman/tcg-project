import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Action, PlayerId } from '../../engine/types';
import type { MatchConnection } from '../match';
import { COUNTDOWN_MS, INIT_WAIT_MS, NO_HOST_MS, READY_TIMEOUT_MS, ROOM_GRACE_MS } from '../matchmaking';
import { openRoom, type Room, type RoomEnd, type RoomSnapshot } from '../room';
import { createMemoryHub, type MemoryHub } from '../transport.memory';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
const tick = (ms = 50) => vi.advanceTimersByTimeAsync(ms);

function enter(hub: MemoryHub, o: { role: PlayerId; deck: string; quick?: boolean; roomId?: string; random?: () => number }) {
  const transport = hub.client();
  const out = {
    transport,
    snap: null as RoomSnapshot | null,
    conn: null as MatchConnection | null,
    ended: null as RoomEnd | null,
    room: null as unknown as Room,
  };
  out.room = openRoom({
    transport, roomId: o.roomId ?? 'ROOM', role: o.role, deck: o.deck, quick: o.quick ?? false, clientId: `${o.role}-${o.deck}-${Math.random()}`,
    onChange: (s) => (out.snap = s), onStart: (c) => (out.conn = c), onEnd: (r) => (out.ended = r), random: o.random,
  });
  return out;
}

describe('the ready room', () => {
  it('shows each player the other arriving and pressing Ready', async () => {
    const hub = createMemoryHub();
    const a = enter(hub, { role: 'A', deck: 'emberwood' });
    await tick();
    expect(a.snap).toMatchObject({ connected: true, meReady: false, peer: { present: false, ready: false } });
    const b = enter(hub, { role: 'B', deck: 'skyward' });
    await tick();
    expect(a.snap!.peer).toEqual({ present: true, ready: false });
    expect(b.snap!.peer).toEqual({ present: true, ready: false });
    b.room.setReady(true);
    await tick();
    expect(a.snap!.peer.ready).toBe(true);
    expect(b.snap!.meReady).toBe(true);
    expect(a.snap!.meReady).toBe(false);
    b.room.setReady(false);
    await tick();
    expect(a.snap!.peer.ready).toBe(false);
  });

  it('starts the game for both when both are ready: same seed, the right seats, each player\'s own deck', async () => {
    const hub = createMemoryHub();
    const a = enter(hub, { role: 'A', deck: 'emberwood', random: () => 0.25 });
    const b = enter(hub, { role: 'B', deck: 'skyward' });
    await tick();
    a.room.setReady(true);
    await tick();
    expect(a.conn).toBeNull(); // one ready is not enough
    b.room.setReady(true);
    await tick();
    expect(a.snap!.countdownEndsAt).not.toBeNull();
    expect(b.snap!.countdownEndsAt).not.toBeNull();
    await tick(COUNTDOWN_MS - 100);
    expect(a.conn).toBeNull(); // the countdown is still running
    await tick(300);
    expect(a.conn).not.toBeNull();
    expect(b.conn).not.toBeNull();
    expect(a.conn).toMatchObject({ role: 'A', seed: Math.floor(0.25 * 0x7fffffff), deckA: 'emberwood', deckB: 'skyward' });
    expect(b.conn).toMatchObject({ role: 'B', seed: a.conn!.seed, deckA: 'emberwood', deckB: 'skyward' });
    expect(a.ended).toBeNull();
    expect(b.ended).toBeNull();
  });

  it('the game that starts is playable: an action from one side reaches the other over the same channel', async () => {
    const hub = createMemoryHub();
    const a = enter(hub, { role: 'A', deck: 'emberwood' });
    const b = enter(hub, { role: 'B', deck: 'skyward' });
    await tick();
    a.room.setReady(true);
    b.room.setReady(true);
    await tick(COUNTDOWN_MS + 500);
    const got: Action[] = [];
    b.conn!.onAction((x) => got.push(x));
    a.conn!.sendAction({ type: 'keepHand' });
    await tick(100);
    expect(got).toEqual([{ type: 'keepHand' }]);
  });

  it('un-readying during the countdown cancels it, and nothing starts', async () => {
    const hub = createMemoryHub();
    const a = enter(hub, { role: 'A', deck: 'emberwood' });
    const b = enter(hub, { role: 'B', deck: 'skyward' });
    await tick();
    a.room.setReady(true);
    b.room.setReady(true);
    await tick(1500);
    expect(a.snap!.countdownEndsAt).not.toBeNull();
    b.room.setReady(false);
    await tick(100);
    expect(a.snap!.countdownEndsAt).toBeNull();
    expect(b.snap!.countdownEndsAt).toBeNull();
    await tick(COUNTDOWN_MS * 3);
    expect(a.conn).toBeNull();
    expect(b.conn).toBeNull();
    b.room.setReady(true); // ready again: a fresh countdown, then it starts
    await tick(COUNTDOWN_MS + 500);
    expect(a.conn).not.toBeNull();
    expect(b.conn).not.toBeNull();
  });

  it('survives a lost start message (it is repeated), and the second player gives up if it never comes', async () => {
    const hub = createMemoryHub();
    hub.dropNext('init', 1);
    const a = enter(hub, { role: 'A', deck: 'emberwood' });
    const b = enter(hub, { role: 'B', deck: 'skyward' });
    await tick();
    a.room.setReady(true);
    b.room.setReady(true);
    await tick(COUNTDOWN_MS + 2000);
    expect(b.conn).not.toBeNull(); // the first init was lost; the repeat got through

    const hub2 = createMemoryHub();
    hub2.dropNext('init', 99);
    const a2 = enter(hub2, { role: 'A', deck: 'emberwood' });
    const b2 = enter(hub2, { role: 'B', deck: 'skyward' });
    await tick();
    a2.room.setReady(true);
    b2.room.setReady(true);
    await tick(COUNTDOWN_MS + INIT_WAIT_MS + 500);
    expect(b2.conn).toBeNull();
    expect(b2.ended).toBe('start-failed');
  });

  it('a third person is turned away and the pair carry on', async () => {
    const hub = createMemoryHub();
    const a = enter(hub, { role: 'A', deck: 'emberwood' });
    const b = enter(hub, { role: 'B', deck: 'skyward' });
    await tick();
    const c = enter(hub, { role: 'B', deck: 'pyromancer' });
    await tick(100);
    expect(c.ended).toBe('full');
    expect(a.ended).toBeNull();
    expect(b.ended).toBeNull();
    expect(a.snap!.peer.present).toBe(true);
  });

  it('two joiners with no host: the later one is told, and a lone joiner gives up after a while', async () => {
    const hub = createMemoryHub();
    const x = enter(hub, { role: 'B', deck: 'emberwood' });
    await tick();
    const y = enter(hub, { role: 'B', deck: 'skyward' });
    await tick(100);
    expect(y.ended).toBe('seat-taken');
    expect(x.ended).toBeNull();
    await tick(NO_HOST_MS + 500);
    expect(x.ended).toBe('no-host');
  });

  describe('when the other player leaves', () => {
    it('a matched room is over for the one left behind', async () => {
      const hub = createMemoryHub();
      const a = enter(hub, { role: 'A', deck: 'emberwood', quick: true });
      const b = enter(hub, { role: 'B', deck: 'skyward', quick: true });
      await tick();
      hub.disconnect(b.transport);
      await tick(100);
      expect(a.ended).toBe('opponent-left');
    });

    it('a friend\'s room keeps waiting for the host, but a guest whose host left is told', async () => {
      const hub = createMemoryHub();
      const host = enter(hub, { role: 'A', deck: 'emberwood' });
      const guest = enter(hub, { role: 'B', deck: 'skyward' });
      await tick();
      hub.disconnect(guest.transport);
      await tick(100);
      expect(host.ended).toBeNull();
      expect(host.snap!.peer.present).toBe(false);
      const guest2 = enter(hub, { role: 'B', deck: 'pyromancer' }); // someone else can take the seat
      await tick(100);
      expect(host.snap!.peer.present).toBe(true);
      hub.disconnect(host.transport);
      await tick(100);
      expect(guest2.ended).toBe('opponent-left');
    });

    it('leaving by choice does not raise an end, and the other side sees the seat empty', async () => {
      const hub = createMemoryHub();
      const a = enter(hub, { role: 'A', deck: 'emberwood' });
      const b = enter(hub, { role: 'B', deck: 'skyward' });
      await tick();
      b.room.leave();
      await tick(100);
      expect(b.ended).toBeNull();
      expect(a.snap!.peer.present).toBe(false);
    });

    it('leaving during the countdown stops the game from starting', async () => {
      const hub = createMemoryHub();
      const a = enter(hub, { role: 'A', deck: 'emberwood' });
      const b = enter(hub, { role: 'B', deck: 'skyward' });
      await tick();
      a.room.setReady(true);
      b.room.setReady(true);
      await tick(1000);
      b.room.leave();
      await tick(COUNTDOWN_MS * 2);
      expect(a.conn).toBeNull();
    });
  });

  describe('a matched room (the queue)', () => {
    it('is given up if the other player never arrives', async () => {
      const hub = createMemoryHub();
      const a = enter(hub, { role: 'A', deck: 'emberwood', quick: true });
      await tick(ROOM_GRACE_MS - 500);
      expect(a.ended).toBeNull();
      await tick(1000);
      expect(a.ended).toBe('opponent-left');
    });

    it('sends the slow player to the menu and the ready one back to searching when time runs out', async () => {
      const hub = createMemoryHub();
      const a = enter(hub, { role: 'A', deck: 'emberwood', quick: true });
      const b = enter(hub, { role: 'B', deck: 'skyward', quick: true });
      await tick();
      expect(a.snap!.readyDeadline).not.toBeNull();
      a.room.setReady(true);
      await tick(READY_TIMEOUT_MS + 500);
      expect(a.ended).toBe('opponent-not-ready');
      expect(b.ended).toBe('ready-timeout');
    });

    it('does not time out once both are ready', async () => {
      const hub = createMemoryHub();
      const a = enter(hub, { role: 'A', deck: 'emberwood', quick: true });
      const b = enter(hub, { role: 'B', deck: 'skyward', quick: true });
      await tick();
      a.room.setReady(true);
      b.room.setReady(true);
      await tick(READY_TIMEOUT_MS + 5000);
      expect(a.ended).toBeNull();
      expect(a.conn).not.toBeNull();
      expect(b.conn).not.toBeNull();
    });

    it('a friend\'s room has no ready deadline', async () => {
      const hub = createMemoryHub();
      const a = enter(hub, { role: 'A', deck: 'emberwood' });
      enter(hub, { role: 'B', deck: 'skyward' });
      await tick(READY_TIMEOUT_MS * 3);
      expect(a.snap!.readyDeadline).toBeNull();
      expect(a.ended).toBeNull();
    });
  });

  it('ignores Ready once the game is starting, and a second start signal', async () => {
    const hub = createMemoryHub();
    const a = enter(hub, { role: 'A', deck: 'emberwood' });
    const b = enter(hub, { role: 'B', deck: 'skyward' });
    await tick();
    a.room.setReady(true);
    b.room.setReady(true);
    await tick(COUNTDOWN_MS + 3000); // the repeated init messages land after the game began
    const conn = b.conn;
    await tick(5000);
    expect(b.conn).toBe(conn);
    expect(() => b.room.setReady(false)).not.toThrow();
  });
});
