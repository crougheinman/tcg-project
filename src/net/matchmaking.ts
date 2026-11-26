import type { PlayerId } from '../engine/types';
import type { PresenceEntry } from './transport';

// The pure part of finding a match and of the ready room: who pairs with whom, and what a room looks like from one
// player's seat. No network, no timers, so it is unit-tested directly (the wiring is queue.ts and room.ts).

// ---- timings (ms) ---------------------------------------------------------------------------------------------------
/** After both players are in a matched room, how long they have to press Ready before someone is sent back. */
export const READY_TIMEOUT_MS = 30_000;
/** Both ready: the pause before the game starts (long enough to un-ready). */
export const COUNTDOWN_MS = 3_000;
/** Searching alone for this long suggests hosting a room instead. */
export const EMPTY_HINT_MS = 45_000;
/** How often a host repeats an invite its partner has not answered. */
export const INVITE_RETRY_MS = 2_000;
/** A matched room whose other player never turns up is abandoned after this. */
export const ROOM_GRACE_MS = 8_000;
/** A friend's room whose host never appears is given up on after this. */
export const NO_HOST_MS = 15_000;
/** After the countdown, how long the second player waits for the host's start signal. */
export const INIT_WAIT_MS = 8_000;

// ---- the queue ------------------------------------------------------------------------------------------------------
export interface Searcher {
  id: string;
  /** When they joined the queue (their own clock; only used to order people, so skew is harmless). */
  since: number;
}

/** Everyone looking, in a stable order every client agrees on: longest-waiting first, then by id. */
export function orderSearchers(list: readonly Searcher[]): Searcher[] {
  return [...list].sort((a, b) => a.since - b.since || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface Pair {
  host: Searcher;
  guest: Searcher;
}

/** Neighbours in that order pair up (1st with 2nd, 3rd with 4th...). With an odd number the last one waits. */
export function pairUp(list: readonly Searcher[]): { pairs: Pair[]; waiting: Searcher | null } {
  const o = orderSearchers(list);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < o.length; i += 2) pairs.push({ host: o[i], guest: o[i + 1] });
  return { pairs, waiting: o.length % 2 ? o[o.length - 1] : null };
}

/** Where `me` stands: the one who sends the invite, the one who is expected to accept, or the odd one out. */
export function myPlace(list: readonly Searcher[], me: string): { role: 'host' | 'guest' | 'waiting'; partner: Searcher | null } {
  const { pairs } = pairUp(list);
  for (const p of pairs) {
    if (p.host.id === me) return { role: 'host', partner: p.guest };
    if (p.guest.id === me) return { role: 'guest', partner: p.host };
  }
  return { role: 'waiting', partner: null };
}

/** The searchers in a queue presence list (entries that do not look like one are ignored). */
export function searchersOf(entries: readonly PresenceEntry[]): Searcher[] {
  const out: Searcher[] = [];
  for (const e of entries) {
    const since = e.state.since;
    if (typeof since === 'number' && Number.isFinite(since)) out.push({ id: e.key, since });
  }
  return out;
}

export const otherRole = (r: PlayerId): PlayerId => (r === 'A' ? 'B' : 'A');

// ---- the room -------------------------------------------------------------------------------------------------------
export interface RoomMember {
  key: string;
  role: PlayerId;
  ready: boolean;
  since: number;
  deck: string;
}

export function memberOf(e: PresenceEntry): RoomMember | null {
  const s = e.state;
  if ((s.role !== 'A' && s.role !== 'B') || typeof s.ready !== 'boolean' || typeof s.since !== 'number' || typeof s.deck !== 'string') return null;
  return { key: e.key, role: s.role, ready: s.ready, since: s.since, deck: s.deck };
}

export interface RoomView {
  me: RoomMember | null;
  peer: RoomMember | null;
  /** More than two clients are in the room and I am not one of the first two to arrive. */
  full: boolean;
  /** The two seated clients claim the same seat, and I am the later one (two joiners with no host, or two hosts). */
  seatTaken: boolean;
  bothReady: boolean;
}

/** What the room looks like to the client with presence key `myKey`. The first two to arrive hold the seats. */
export function roomView(entries: readonly PresenceEntry[], myKey: string): RoomView {
  const members = entries
    .map(memberOf)
    .filter((m): m is RoomMember => m !== null)
    .sort((a, b) => a.since - b.since || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const seated = members.slice(0, 2);
  const me = members.find((m) => m.key === myKey) ?? null;
  const iAmSeated = !!me && seated.some((m) => m.key === myKey);
  const other = iAmSeated ? seated.find((m) => m.key !== myKey) ?? null : null;
  const full = !!me && !iAmSeated;
  // someone who wants the same seat as me is not an opponent: nobody has the other seat yet
  const clash = !!other && !!me && other.role === me.role;
  const peer = clash ? null : other;
  const seatTaken = clash && seated[1].key === myKey;
  return { me, peer, full, seatTaken, bothReady: !!me && !!peer && me.ready && peer.ready };
}
