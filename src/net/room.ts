import type { PlayerId } from '../engine/types';
import { COUNTDOWN_MS, INIT_WAIT_MS, NO_HOST_MS, READY_TIMEOUT_MS, ROOM_GRACE_MS, roomView } from './matchmaking';
import { makeConnection, type MatchConnection } from './match';
import type { RtChannel, Transport } from './transport';

// The ready room: where two players meet before a game, whether they were matched by the queue or one typed the other's
// room code. Each client announces {seat, deck, ready} in the room channel's presence list and everything else follows
// from that shared list: who is here, who is ready, and when to start. Only the player in seat A starts the game (it
// picks the seed and sends it); seat B starts on receiving it. From then on the SAME channel carries the match (lockstep).

export type RoomEnd =
  | 'full' // a third person tried a room that already has two
  | 'seat-taken' // two joiners with no host, or two hosts
  | 'no-host' // a friend's room that nobody opened
  | 'opponent-left'
  | 'opponent-not-ready' // I was ready and they were not, in time
  | 'ready-timeout' // I was not ready in time
  | 'start-failed' // the host's start signal never came
  | 'failed'; // the connection could not be made

export interface RoomSnapshot {
  roomId: string;
  role: PlayerId;
  /** A room made by the queue (timeouts apply) rather than one a friend opened by code. */
  quick: boolean;
  connected: boolean;
  meReady: boolean;
  peer: { present: boolean; ready: boolean };
  /** Epoch ms at which the game starts, while both are ready; otherwise null. */
  countdownEndsAt: number | null;
  /** Epoch ms at which a not-ready player is sent back (matched rooms only), while someone is not ready. */
  readyDeadline: number | null;
  starting: boolean;
}

export interface Room {
  snapshot(): RoomSnapshot;
  setReady(ready: boolean): void;
  /** Leave the room (before the game starts). */
  leave(): void;
}

export function openRoom(opts: {
  transport: Transport;
  roomId: string;
  role: PlayerId;
  deck: string;
  quick: boolean;
  clientId: string;
  onChange: (s: RoomSnapshot) => void;
  onStart: (conn: MatchConnection) => void;
  onEnd: (reason: RoomEnd) => void;
  now?: () => number;
  random?: () => number;
}): Room {
  const { roomId, role, deck, quick, clientId } = opts;
  const now = opts.now ?? Date.now;
  const random = opts.random ?? Math.random;
  const ch: RtChannel = opts.transport.channel(`match:${roomId}`, { presenceKey: clientId });
  const since = now();

  let ready = false;
  let connected = false;
  let done = false; // the game has started or I have left: nothing more to do
  let starting = false;
  let peerEverSeen = false;
  let peerPresent = false;
  let peerReady = false;
  let peerDeck: string | null = null;
  let countdownEndsAt: number | null = null;
  let readyDeadline: number | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.delete(t);
      if (!done) fn();
    }, ms);
    timers.add(t);
    return t;
  };
  const clearTimers = () => {
    for (const t of timers) clearTimeout(t);
    timers.clear();
  };

  const snapshot = (): RoomSnapshot => ({
    roomId, role, quick, connected, meReady: ready, peer: { present: peerPresent, ready: peerReady },
    countdownEndsAt, readyDeadline, starting,
  });
  const emit = () => opts.onChange(snapshot());
  const announce = () => ch.track({ role, deck, ready, since });

  const end = (reason: RoomEnd) => {
    if (done) return;
    done = true;
    clearTimers();
    ch.untrack();
    ch.close();
    opts.onEnd(reason);
  };

  // ---- starting the game ----
  const begin = (seed: number, deckA: string, deckB: string) => {
    if (done || starting) return;
    starting = true;
    done = true; // the connection owns the channel now
    clearTimers();
    // Presence stays: the player in seat A starts first, and if its presence vanished before its start message reached B
    // (they travel separately), B would take it for "the opponent left". The connection removes the channel when it ends.
    emit();
    opts.onStart(makeConnection(ch, roomId, role, seed, deckA, deckB));
  };

  ch.on('init', (p: { seed?: unknown; deckA?: unknown; deckB?: unknown }) => {
    if (role !== 'B' || done) return;
    if (typeof p.seed !== 'number' || typeof p.deckA !== 'string' || typeof p.deckB !== 'string') return;
    begin(p.seed, p.deckA, p.deckB);
  });

  /** Seat A: the countdown is over, so pick the seed, tell B, and start. */
  const hostStart = () => {
    if (role !== 'A' || done || !peerDeck) return;
    const seed = Math.floor(random() * 0x7fffffff);
    const msg = { seed, deckA: deck, deckB: peerDeck };
    ch.send('init', msg);
    // a lost message must not strand the other player: repeat it a couple of times (B ignores repeats)
    for (const d of [500, 1500]) setTimeout(() => ch.send('init', msg), d);
    begin(seed, deck, peerDeck);
  };

  const startCountdown = () => {
    if (countdownEndsAt !== null) return;
    countdownEndsAt = now() + COUNTDOWN_MS;
    readyDeadline = null;
    clearTimers();
    later(COUNTDOWN_MS, () => {
      if (role === 'A') hostStart();
      else later(INIT_WAIT_MS, () => end('start-failed')); // B starts on the init message, which usually arrives first
    });
  };
  const cancelCountdown = () => {
    if (countdownEndsAt === null) return;
    countdownEndsAt = null;
    clearTimers();
    watchReadyDeadline();
  };

  // A matched room gives each player a limited time to press Ready.
  const watchReadyDeadline = () => {
    if (!quick || !peerPresent || readyDeadline !== null || countdownEndsAt !== null) return;
    readyDeadline = now() + READY_TIMEOUT_MS;
    later(READY_TIMEOUT_MS, () => {
      if (countdownEndsAt !== null) return;
      end(ready ? 'opponent-not-ready' : 'ready-timeout');
    });
  };

  ch.onPresence((entries) => {
    if (done) return;
    const v = roomView(entries, clientId);
    if (v.full) return end('full');
    if (v.seatTaken) return end('seat-taken');
    const wasPresent = peerPresent;
    peerPresent = !!v.peer;
    peerReady = !!v.peer?.ready;
    peerDeck = v.peer?.deck ?? peerDeck;
    if (peerPresent) peerEverSeen = true;

    if (wasPresent && !peerPresent) {
      // If I was the slow one and the ready player has just given up on me, that is my timeout, not "my opponent left"
      // (the two clocks run a moment apart, so either can fire first).
      const slow = quick && !ready && readyDeadline !== null && now() >= readyDeadline - 2000;
      cancelCountdown();
      readyDeadline = null;
      if (slow) return end('ready-timeout');
      // a friend's room keeps waiting for someone else to come in; a matched room, or a guest whose host went, is over
      if (quick || role === 'B') return end('opponent-left');
    }
    if (peerPresent && !wasPresent) watchReadyDeadline();
    if (v.bothReady) startCountdown();
    else if (countdownEndsAt !== null) cancelCountdown();
    emit();
  });

  ch.subscribe((status) => {
    if (done) return;
    if (status === 'SUBSCRIBED') {
      connected = true;
      announce();
      // nobody else turning up is the room's problem, not the player's
      if (quick) later(ROOM_GRACE_MS, () => !peerEverSeen && end('opponent-left'));
      else if (role === 'B') later(NO_HOST_MS, () => !peerEverSeen && end('no-host'));
      emit();
    } else if (status === 'ERROR') end('failed');
  });

  return {
    snapshot,
    setReady(v) {
      if (done || starting || ready === v) return;
      ready = v;
      announce();
      emit();
    },
    leave() {
      if (done) return;
      done = true;
      clearTimers();
      ch.untrack();
      ch.close();
    },
  };
}
