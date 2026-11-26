import type { PlayerId } from '../engine/types';
import { INVITE_RETRY_MS, myPlace, otherRole, searchersOf } from './matchmaking';
import { randomRoom } from './match';
import type { RtChannel, Transport } from './transport';

// Find a match. Everyone searching sits in one shared channel and shows up in its presence list, which is also where
// the live "N searching" count comes from. There is no server deciding who plays whom: every client sees the same list,
// orders it the same way (matchmaking.ts) and pairs neighbours. The first of a pair sends an invite, the second answers
// with an accept, and that exchange is the commit point: both then leave the queue and meet in a private room (room.ts).
// If two clients briefly disagree about the pairs, the unanswered invite is simply retried against the new pairing.

export const QUEUE_CHANNEL = 'queue:v1';

export interface Matched {
  roomId: string;
  /** The seat this player takes. Chosen at random per match (by the inviter), so being on the play is not tied to who clicked first. */
  role: PlayerId;
}

export interface QueueHandle {
  cancel(): void;
}

interface Offer {
  to: string;
  room: string;
  hostRole: PlayerId;
}

export function joinQueue(opts: {
  transport: Transport;
  clientId: string;
  onCount: (searching: number) => void;
  onMatched: (m: Matched) => void;
  onError?: () => void;
  now?: () => number;
  random?: () => number;
}): QueueHandle {
  const { transport, clientId, onCount, onMatched } = opts;
  const now = opts.now ?? Date.now;
  const random = opts.random ?? Math.random;
  const ch: RtChannel = transport.channel(QUEUE_CHANNEL, { presenceKey: clientId });
  const since = now();

  let committed = false;
  let closed = false;
  // Every invite I have sent, by room. A guest's accept can arrive after the presence list has already changed, so an accept is
  // honoured for ANY offer I made; and the active offer is sticky (kept while its partner is still searching) so a change in
  // the list elsewhere cannot make me walk away from a partner who is about to answer.
  const offers = new Map<string, Offer>();
  let active: Offer | null = null;
  let retry: ReturnType<typeof setInterval> | undefined;

  const stop = () => {
    if (retry) clearInterval(retry);
    retry = undefined;
  };
  const close = (delay = 0) => {
    if (closed) return;
    closed = true;
    stop();
    const end = () => {
      ch.untrack();
      ch.close();
    };
    // a message just sent (an accept) needs a moment to leave before the channel goes
    if (delay) setTimeout(end, delay);
    else end();
  };
  const commit = (m: Matched) => {
    committed = true;
    stop();
    ch.untrack(); // leave the queue at once, so nobody else pairs with a player who is already taken
    onMatched(m);
    close(300);
  };
  const sendInvite = () => {
    if (!active || committed) return;
    ch.send('invite', { to: active.to, from: clientId, room: active.room, hostRole: active.hostRole });
  };

  ch.on('invite', (p: { to?: string; from?: string; room?: string; hostRole?: string }) => {
    if (committed || closed || p.to !== clientId || typeof p.from !== 'string' || typeof p.room !== 'string') return;
    if (p.hostRole !== 'A' && p.hostRole !== 'B') return;
    // I already have an invite out: only answer one from the person I invited (they invited me too), and then only the one
    // with the smaller id gives way, so two players inviting each other end up in one room rather than none.
    if (active && !(p.from === active.to && clientId < p.from)) return;
    ch.send('accept', { to: p.from, from: clientId, room: p.room });
    commit({ roomId: p.room, role: otherRole(p.hostRole) });
  });
  ch.on('accept', (p: { to?: string; room?: string }) => {
    if (committed || closed || p.to !== clientId || typeof p.room !== 'string') return;
    const o = offers.get(p.room);
    if (o) commit({ roomId: o.room, role: o.hostRole });
  });

  ch.onPresence((entries) => {
    if (committed || closed) return;
    const list = searchersOf(entries);
    onCount(list.length);
    if (active && !list.some((x) => x.id === active!.to)) {
      active = null; // my partner is gone (taken, or cancelled): free to pair again
      stop();
    }
    if (!active) {
      const place = myPlace(list, clientId);
      if (place.role === 'host' && place.partner) {
        active = { to: place.partner.id, room: randomRoom(8), hostRole: random() < 0.5 ? 'A' : 'B' };
        offers.set(active.room, active);
        sendInvite();
      }
    }
    if (active && !retry) retry = setInterval(sendInvite, INVITE_RETRY_MS);
  });

  ch.subscribe((status) => {
    if (status === 'SUBSCRIBED') ch.track({ since, v: 1 });
    else if (status === 'ERROR' && !committed && !closed) opts.onError?.();
  });

  return { cancel: () => close() };
}
