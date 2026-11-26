import { describe, expect, it } from 'vitest';
import { myPlace, orderSearchers, pairUp, roomView, searchersOf, type Searcher } from '../matchmaking';
import type { PresenceEntry } from '../transport';

const s = (id: string, since: number): Searcher => ({ id, since });

describe('pairing searchers', () => {
  it('orders longest-waiting first, then by id, whatever order they arrive in', () => {
    const a = [s('c', 5), s('a', 5), s('b', 1)];
    expect(orderSearchers(a).map((x) => x.id)).toEqual(['b', 'a', 'c']);
    expect(orderSearchers([...a].reverse()).map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });

  it('pairs neighbours and leaves the odd one waiting', () => {
    expect(pairUp([])).toEqual({ pairs: [], waiting: null });
    expect(pairUp([s('a', 1)])).toEqual({ pairs: [], waiting: s('a', 1) });
    const five = pairUp([s('e', 5), s('b', 2), s('a', 1), s('d', 4), s('c', 3)]);
    expect(five.pairs.map((p) => [p.host.id, p.guest.id])).toEqual([['a', 'b'], ['c', 'd']]);
    expect(five.waiting?.id).toBe('e');
  });

  it('tells each player where they stand', () => {
    const all = [s('a', 1), s('b', 2), s('c', 3)];
    expect(myPlace(all, 'a')).toEqual({ role: 'host', partner: s('b', 2) });
    expect(myPlace(all, 'b')).toEqual({ role: 'guest', partner: s('a', 1) });
    expect(myPlace(all, 'c')).toEqual({ role: 'waiting', partner: null });
    expect(myPlace(all, 'nobody').role).toBe('waiting');
  });

  it('gives every client the same pairs from the same people, in any order (no two hosts claim one guest)', () => {
    const people = Array.from({ length: 9 }, (_, i) => s('p' + i, i % 3)); // ties on `since` on purpose
    const reference = pairUp(people).pairs.map((p) => `${p.host.id}>${p.guest.id}`);
    for (let k = 0; k < 20; k++) {
      const shuffled = [...people].sort(() => Math.random() - 0.5);
      expect(pairUp(shuffled).pairs.map((p) => `${p.host.id}>${p.guest.id}`)).toEqual(reference);
    }
    const invited = new Set<string>();
    for (const p of people) {
      const place = myPlace(people, p.id);
      if (place.role === 'host') {
        expect(invited.has(place.partner!.id)).toBe(false);
        invited.add(place.partner!.id);
      }
    }
  });

  it('ignores presence entries that are not searchers', () => {
    const entries: PresenceEntry[] = [
      { key: 'a', state: { since: 10, v: 1 } },
      { key: 'b', state: {} },
      { key: 'c', state: { since: 'soon' } },
      { key: 'd', state: { since: NaN } },
    ];
    expect(searchersOf(entries)).toEqual([s('a', 10)]);
  });
});

describe('the ready room as one player sees it', () => {
  const e = (key: string, role: 'A' | 'B', since: number, ready = false, deck = 'emberwood'): PresenceEntry => ({ key, state: { role, since, ready, deck } });

  it('sees itself and its opponent', () => {
    const v = roomView([e('x', 'A', 1), e('y', 'B', 2, true)], 'x');
    expect(v.me?.key).toBe('x');
    expect(v.peer?.key).toBe('y');
    expect(v.peer?.ready).toBe(true);
    expect(v.bothReady).toBe(false);
    expect(roomView([e('x', 'A', 1, true), e('y', 'B', 2, true)], 'y').bothReady).toBe(true);
  });

  it('is alone until someone arrives', () => {
    const v = roomView([e('x', 'A', 1)], 'x');
    expect(v.peer).toBeNull();
    expect(v.full).toBe(false);
  });

  it('turns a third arrival away, and only the third', () => {
    const all = [e('x', 'A', 1), e('y', 'B', 2), e('z', 'B', 3)];
    expect(roomView(all, 'z').full).toBe(true);
    expect(roomView(all, 'x').full).toBe(false);
    expect(roomView(all, 'x').peer?.key).toBe('y');
    expect(roomView(all, 'y').full).toBe(false);
  });

  it('flags a seat that is claimed twice, for the later arrival only', () => {
    const all = [e('x', 'B', 1), e('y', 'B', 2)];
    expect(roomView(all, 'y').seatTaken).toBe(true);
    expect(roomView(all, 'x').seatTaken).toBe(false);
    expect(roomView(all, 'y').bothReady).toBe(false);
    expect(roomView(all, 'x').peer).toBeNull(); // someone wanting the same seat is not an opponent
    expect(roomView(all, 'y').peer).toBeNull();
  });

  it('ignores a malformed presence entry', () => {
    const v = roomView([e('x', 'A', 1), { key: 'bad', state: { role: 'C', ready: 'yes' } }], 'x');
    expect(v.peer).toBeNull();
  });
});
