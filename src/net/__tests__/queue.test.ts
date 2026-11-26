import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INVITE_RETRY_MS } from '../matchmaking';
import { QUEUE_CHANNEL, joinQueue, type Matched } from '../queue';
import { createMemoryHub, type MemoryHub } from '../transport.memory';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});
const tick = (ms = 50) => vi.advanceTimersByTimeAsync(ms);

function search(hub: MemoryHub, id: string, random = () => 0.1) {
  const t = hub.client();
  const out = { transport: t, matched: [] as Matched[], counts: [] as number[], q: null as ReturnType<typeof joinQueue> | null };
  out.q = joinQueue({ transport: t, clientId: id, onCount: (n) => out.counts.push(n), onMatched: (m) => out.matched.push(m), random });
  return out;
}

describe('finding a match', () => {
  it('a lone searcher sees a count of one and is never matched', async () => {
    const hub = createMemoryHub();
    const a = search(hub, 'a');
    await tick(10_000);
    expect(a.counts[a.counts.length - 1]).toBe(1);
    expect(a.matched).toEqual([]);
  });

  it('two searchers are matched into the same room, in opposite seats', async () => {
    const hub = createMemoryHub();
    const a = search(hub, 'a');
    await tick(5);
    const b = search(hub, 'b');
    await tick(200);
    expect(a.matched).toHaveLength(1);
    expect(b.matched).toHaveLength(1);
    expect(a.matched[0].roomId).toBe(b.matched[0].roomId);
    expect(a.matched[0].roomId.length).toBe(8);
    expect(new Set([a.matched[0].role, b.matched[0].role])).toEqual(new Set(['A', 'B']));
    expect(a.counts).toContain(2); // they saw each other before leaving the queue
  });

  it('the inviter\'s seat is random, not always the one on the play', async () => {
    const seatOfInviter = async (random: number) => {
      const hub = createMemoryHub();
      const a = search(hub, 'a', () => random);
      await tick(5);
      const b = search(hub, 'b', () => random);
      await tick(200);
      void b;
      return a.matched[0].role; // 'a' waited longest, so it is the inviter
    };
    expect(await seatOfInviter(0.1)).toBe('A');
    expect(await seatOfInviter(0.9)).toBe('B');
  });

  it('three searchers make one match and the third keeps waiting', async () => {
    const hub = createMemoryHub();
    const [a, b, c] = ['a', 'b', 'c'].map((id) => {
      const x = search(hub, id);
      return x;
    });
    await tick(5000);
    const matched = [a, b, c].filter((x) => x.matched.length);
    expect(matched).toHaveLength(2);
    expect(c.matched).toEqual([]);
    expect(c.counts[c.counts.length - 1]).toBe(1); // the count falls as the pair leaves the queue
  });

  it('six searchers make three distinct rooms of two', async () => {
    const hub = createMemoryHub();
    const all = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => search(hub, id));
    await tick(5000);
    const rooms = new Map<string, string[]>();
    all.forEach((x, i) => {
      expect(x.matched, `searcher ${i}`).toHaveLength(1);
      const l = rooms.get(x.matched[0].roomId) ?? [];
      l.push(x.matched[0].role);
      rooms.set(x.matched[0].roomId, l);
    });
    expect(rooms.size).toBe(3);
    for (const roles of rooms.values()) expect([...roles].sort()).toEqual(['A', 'B']);
  });

  it('shows the live count as people come and go, and cancelling leaves the queue', async () => {
    const hub = createMemoryHub();
    const a = search(hub, 'a');
    await tick(5);
    const b = search(hub, 'b');
    const c = search(hub, 'c');
    await tick(5);
    // b and c are the pair; only a waits... a is first by time, so a & b pair — whatever: cancel the one still waiting
    const waiting = [a, b, c].find((x) => !x.matched.length)!;
    const others = [a, b, c].filter((x) => x !== waiting);
    expect(others.every((x) => x.matched.length === 1)).toBe(true);
    waiting.q!.cancel();
    await tick(100);
    const d = search(hub, 'd');
    await tick(5);
    expect(d.counts[d.counts.length - 1]).toBe(1); // the cancelled searcher is gone
  });

  it('retries an invite that was lost', async () => {
    const hub = createMemoryHub();
    hub.dropNext('invite', 1);
    const a = search(hub, 'a');
    await tick(5);
    const b = search(hub, 'b');
    await tick(100);
    expect(a.matched).toEqual([]); // the first invite never arrived
    await tick(INVITE_RETRY_MS + 100);
    expect(a.matched).toHaveLength(1);
    expect(b.matched).toHaveLength(1);
  });

  it('is matched only once, however many invites or accepts arrive', async () => {
    const hub = createMemoryHub();
    const a = search(hub, 'a');
    await tick(5);
    const b = search(hub, 'b');
    await tick(5000);
    expect(a.matched).toHaveLength(1);
    expect(b.matched).toHaveLength(1);
  });

  it('ignores invites meant for someone else and junk messages', async () => {
    const hub = createMemoryHub();
    const a = search(hub, 'a');
    await tick(20);
    const intruder = hub.client().channel(QUEUE_CHANNEL, { presenceKey: 'zz' });
    intruder.subscribe();
    await tick(20);
    intruder.send('invite', { to: 'someone-else', from: 'zz', room: 'ROOM1234', hostRole: 'A' });
    intruder.send('invite', { to: 'a', from: 'zz', room: 42, hostRole: 'A' });
    intruder.send('invite', { to: 'a', from: 'zz', room: 'ROOM1234', hostRole: 'X' });
    intruder.send('accept', { to: 'a', room: 'ROOM1234' });
    await tick(100);
    expect(a.matched).toEqual([]);
  });

  it('takes the invite addressed to it', async () => {
    const hub = createMemoryHub();
    const a = search(hub, 'a');
    await tick(20);
    const inviter = hub.client().channel(QUEUE_CHANNEL, { presenceKey: 'zz' });
    inviter.subscribe();
    await tick(20);
    inviter.send('invite', { to: 'a', from: 'zz', room: 'ROOM1234', hostRole: 'A' });
    await tick(100);
    expect(a.matched).toEqual([{ roomId: 'ROOM1234', role: 'B' }]);
  });

  it('honours an accept that arrives late, after the partner has left the list and the host has moved on', async () => {
    const hub = createMemoryHub();
    const h = search(hub, 'h');
    await tick(5);
    // two raw searchers that never answer on their own
    const g = hub.client().channel(QUEUE_CHANNEL, { presenceKey: 'g' });
    const invites: { room: string }[] = [];
    g.on('invite', (p) => invites.push(p));
    g.subscribe(() => g.track({ since: Date.now() + 1, v: 1 }));
    await tick(5);
    const x = hub.client().channel(QUEUE_CHANNEL, { presenceKey: 'x' });
    x.subscribe(() => x.track({ since: Date.now() + 2, v: 1 }));
    await tick(100);
    expect(invites).toHaveLength(1); // h (first) invited g (second)
    g.untrack(); // g is taken elsewhere: h sees it leave and turns to x
    await tick(100);
    g.send('accept', { to: 'h', from: 'g', room: invites[0].room }); // ...but g's accept was still on its way
    await tick(100);
    expect(h.matched).toHaveLength(1);
    expect(h.matched[0].roomId).toBe(invites[0].room);
  });

  it('does not take someone else\'s invite while its own is out (it would strand the player it invited)', async () => {
    const hub = createMemoryHub();
    hub.dropNext('invite', 1); // b's own invite to c is lost for now, so it stays pending
    const [p0, p1, b, c] = ['p0', 'p1', 'b', 'c'].map((id) => search(hub, id));
    void p0;
    void p1;
    await tick(5);
    const z = hub.client().channel(QUEUE_CHANNEL, { presenceKey: 'zz' });
    z.subscribe();
    await tick(5);
    z.send('invite', { to: 'b', from: 'zz', room: 'ZROOM123', hostRole: 'A' });
    await tick(100);
    expect(b.matched).toEqual([]); // b is busy inviting c
    await tick(INVITE_RETRY_MS + 200);
    expect(b.matched).toHaveLength(1);
    expect(b.matched[0].roomId).not.toBe('ZROOM123');
    expect(c.matched[0].roomId).toBe(b.matched[0].roomId);
  });

  it('a searcher who closes the tab disappears from everyone\'s count', async () => {
    const hub = createMemoryHub();
    hub.dropNext('invite', 1000); // keep them unmatched so the queue stays populated
    const a = search(hub, 'a');
    await tick(5);
    const b = search(hub, 'b');
    await tick(100);
    expect(a.counts[a.counts.length - 1]).toBe(2);
    hub.disconnect(b.transport);
    await tick(100);
    expect(a.counts[a.counts.length - 1]).toBe(1);
  });

  it('a crowd of people joining, cancelling and vanishing never puts anyone in two matches or two on the same seat', async () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let round = 0; round < 25; round++) {
      const hub = createMemoryHub();
      const people: ReturnType<typeof search>[] = [];
      for (let i = 0; i < 14; i++) {
        people.push(search(hub, 'p' + String(i).padStart(2, '0'), rnd));
        await tick(Math.floor(rnd() * 40));
        const victim = people[Math.floor(rnd() * people.length)];
        const r = rnd();
        if (r < 0.12) victim.q!.cancel();
        else if (r < 0.18) hub.disconnect(victim.transport);
      }
      await tick(20_000);
      const seats = new Map<string, string[]>();
      for (const p of people) {
        expect(p.matched.length, 'matched at most once').toBeLessThanOrEqual(1);
        for (const m of p.matched) seats.set(m.roomId, [...(seats.get(m.roomId) ?? []), m.role]);
      }
      for (const [room, roles] of seats) {
        expect(roles.length, `room ${room}`).toBeLessThanOrEqual(2);
        expect(new Set(roles).size, `room ${room} seats`).toBe(roles.length);
      }
    }
  });
});
