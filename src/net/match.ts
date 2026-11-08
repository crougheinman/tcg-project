import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Action, PlayerId } from '../engine/types';
import { createLockstep, type LockstepOut } from './lockstep';
import { clearMatch, saveMatch, type SavedMatch } from './resume';

// PvP transport over a Supabase Realtime broadcast channel.
// Lockstep: we relay *actions* only; both clients replay them through the same
// deterministic engine starting from the same seed. No server compute.
//
// This file owns only the wire: channel wiring, liveness and the handshakes.
// All sequencing/dedup/gap logic lives in the pure `lockstep.ts` core, which is
// unit-tested. ponytail: client-authoritative lockstep; move authority to a
// Supabase Edge Function running the same engine if cheating ever matters.

/** An in-match chat message. Cosmetic only — never part of game state. */
export interface ChatMessage {
  from: PlayerId;
  text: string;
  id: string;
}

/** Max characters per chat message (defensive cap; the dock also enforces it). */
export const MAX_CHAT_LEN = 120;

/** Peer liveness as the UI should present it. */
export type PeerStatus = 'ok' | 'stale';

export interface MatchConnection {
  roomId: string;
  role: PlayerId;
  seed: number;
  deckA: string; // host deck id
  deckB: string; // joiner deck id
  /**
   * Actions already applied before this connection existed. Empty for a fresh
   * match; on a rejoin the store replays these to rebuild the exact GameState.
   */
  initialLog: Action[];
  sendAction: (a: Action) => void;
  onAction: (cb: (a: Action) => void) => void;
  // Chat rides a *separate* broadcast event, outside the lockstep action stream —
  // it never touches the sequence counter or the deterministic engine. Best-effort:
  // a dropped chat packet is fine (unlike actions, which are sequenced + resent).
  sendChat: (text: string) => void;
  onChat: (cb: (m: ChatMessage) => void) => void;
  // Meta signals (outside the lockstep action stream): tell the peer we forfeited,
  // and learn when the peer left — either by aborting (explicit) or dropping off
  // (no heartbeat for a long while). The remaining player is declared the winner.
  sendAbort: () => void;
  onGone: (cb: (reason: 'aborted' | 'disconnected') => void) => void;
  /** Transient liveness, for a "reconnecting…" banner. Recoverable, unlike onGone. */
  onPeerStatus: (cb: (s: PeerStatus) => void) => void;
  leave: () => void;
}

function randomRoom(): string {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += alpha[Math.floor(Math.random() * alpha.length)];
  return s;
}

// How often to re-ask for a missing action while a gap persists (ms).
const RESEND_INTERVAL_MS = 1200;

// Liveness. Each client pings on PING_MS. Silence past PEER_STALE_MS shows a
// recoverable "reconnecting" banner; only silence past PEER_GONE_MS ends the
// match. The long gone-timeout is deliberate: a transient blip (tunnel, tab
// backgrounded, wifi handoff) must not forfeit a game that can simply resync.
const PING_MS = 3000;
const PEER_STALE_MS = 9000;
const PEER_GONE_MS = 45000;

function makeConnection(
  channel: RealtimeChannel,
  roomId: string,
  role: PlayerId,
  seed: number,
  deckA: string,
  deckB: string,
  restoreLog?: Action[],
): MatchConnection {
  let chatCb: ((m: ChatMessage) => void) | null = null;
  let goneCb: ((reason: 'aborted' | 'disconnected') => void) | null = null;
  let statusCb: ((s: PeerStatus) => void) | null = null;

  const send = (event: string, payload: unknown) =>
    channel.send({ type: 'broadcast', event, payload });

  // The pure sequencing core. Its outbound messages map 1:1 onto broadcast events.
  const ls = createLockstep({
    log: restoreLog,
    emit: (m: LockstepOut) =>
      m.event === 'action'
        ? send('action', { seq: m.seq, action: m.action })
        : send('resend', { from: m.from, to: m.to }),
  });

  /** Snapshot the match so a reload can rejoin rather than forfeit. */
  function persist(): void {
    saveMatch({ roomId, role, seed, deckA, deckB, log: ls.snapshot() });
  }
  if (restoreLog?.length) persist(); // keep the record fresh across a rejoin

  // Peer liveness. `lastSeen` updates on any inbound peer message. `ended` makes
  // the terminal signal fire exactly once.
  let ended = false;
  let status: PeerStatus = restoreLog ? 'stale' : 'ok'; // a rejoin starts out of contact
  let lastSeen = Date.now();

  const setStatus = (s: PeerStatus) => {
    if (status === s || ended) return;
    status = s;
    statusCb?.(s);
  };

  const touch = () => {
    const wasStale = status === 'stale';
    lastSeen = Date.now();
    setStatus('ok');
    // The peer just came back. We may have missed the tail of the stream while
    // out of contact, and a pure gap at the END is invisible to the resend path
    // (nothing newer arrived to reveal it), so ask explicitly.
    if (wasStale) send('rejoin', { have: ls.applied });
  };

  const declareGone = (reason: 'aborted' | 'disconnected') => {
    if (ended) return;
    ended = true;
    clearMatch(); // the match is over — don't offer to reconnect to it
    goneCb?.(reason);
  };

  channel.on('broadcast', { event: 'action' }, ({ payload }) => {
    touch();
    ls.receive(payload.seq as number, payload.action as Action);
  });

  // Peer is missing [from, to); rebroadcast any of those we hold. Because the
  // core keeps the FULL log (not just what we originated), either client can
  // heal the other.
  channel.on('broadcast', { event: 'resend' }, ({ payload }) => {
    touch();
    ls.serveResend(payload.from as number, payload.to as number);
  });

  // A peer (re)appeared and told us how much it has. Send it the tail it is
  // missing; if it is somehow ahead of us, ask for ours through the resend path
  // (which cannot loop, unlike answering a rejoin with another rejoin).
  channel.on('broadcast', { event: 'rejoin' }, ({ payload }) => {
    touch();
    const have = payload.have as number;
    const { from, actions } = ls.catchupFor(have);
    if (actions.length) send('catchup', { from, actions });
    if (have > ls.applied) send('resend', { from: ls.applied, to: have });
  });

  // A contiguous run of actions after a reconnect. Replayed through the normal
  // receive path so dedup/ordering behave exactly as in steady state.
  channel.on('broadcast', { event: 'catchup' }, ({ payload }) => {
    touch();
    const from = payload.from as number;
    const actions = (payload.actions ?? []) as Action[];
    actions.forEach((a, i) => ls.receive(from + i, a));
  });

  // Chat: deliver straight through, no ordering/dedup needed (cosmetic, best-effort).
  channel.on('broadcast', { event: 'chat' }, ({ payload }) => {
    touch();
    chatCb?.({
      from: payload.from as PlayerId,
      text: payload.text as string,
      id: payload.id as string,
    });
  });

  // Liveness ping (keeps lastSeen fresh even when the peer isn't acting).
  channel.on('broadcast', { event: 'ping' }, () => touch());
  // Peer explicitly forfeited (aborted the match).
  channel.on('broadcast', { event: 'forfeit' }, () => {
    touch();
    declareGone('aborted');
  });

  // Re-request a stuck gap in case the resend itself was dropped.
  const retry = setInterval(() => ls.pokeGap(), RESEND_INTERVAL_MS);

  // Heartbeat out, plus a two-stage watchdog: stale (recoverable) then gone.
  // ponytail: heartbeat over broadcast — simpler than Presence given the
  // post-subscribe .on() wiring here; swap to Presence if it ever matters.
  const ping = setInterval(() => send('ping', {}), PING_MS);
  const watchdog = setInterval(() => {
    if (ended) return;
    const silent = Date.now() - lastSeen;
    if (silent > PEER_GONE_MS) declareGone('disconnected');
    else if (silent > PEER_STALE_MS) setStatus('stale');
  }, PING_MS);

  return {
    roomId,
    role,
    seed,
    deckA,
    deckB,
    initialLog: restoreLog ? [...restoreLog] : [],
    sendAction: (a) => {
      // The store applies the local action synchronously before calling this.
      ls.send(a);
      persist();
    },
    onAction: (cb) => {
      ls.onApply((a) => {
        cb(a);
        persist();
      });
    },
    sendChat: (text) => {
      const clean = text.trim().slice(0, MAX_CHAT_LEN);
      if (!clean) return;
      // self:false means we won't hear this back — the store shows our own bubble.
      const msg: ChatMessage = {
        from: role,
        text: clean,
        id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      };
      send('chat', msg);
    },
    onChat: (cb) => {
      chatCb = cb;
    },
    sendAbort: () => {
      clearMatch();
      send('forfeit', { from: role });
    },
    onGone: (cb) => {
      goneCb = cb;
    },
    onPeerStatus: (cb) => {
      statusCb = cb;
      if (status !== 'ok') cb(status); // report a rejoin's initial out-of-contact state
    },
    leave: () => {
      clearInterval(retry);
      clearInterval(ping);
      clearInterval(watchdog);
      supabase?.removeChannel(channel);
    },
  };
}

/** Host a match. Resolves once an opponent joins; A goes first. */
export function createMatch(
  hostDeck: string,
  onStart: (conn: MatchConnection) => void,
): { roomId: string; cancel: () => void } {
  if (!supabase) throw new Error('Supabase not configured');
  const roomId = randomRoom();
  const seed = Math.floor(Math.random() * 0x7fffffff);
  const channel = supabase.channel(`match:${roomId}`, {
    config: { broadcast: { self: false } },
  });

  // Only the first joiner starts the match. A second 'join' (a stray client on the
  // same 4-char code, or a retried packet) would otherwise build a second engine
  // over the same channel and corrupt the match in progress.
  let started = false;
  channel.on('broadcast', { event: 'join' }, ({ payload }) => {
    if (started) return;
    started = true;
    const joinDeck = (payload.deck as string) ?? 'skyward';
    // Share seed + host deck so both build the identical game.
    channel.send({ type: 'broadcast', event: 'init', payload: { seed, deck: hostDeck } });
    onStart(makeConnection(channel, roomId, 'A', seed, hostDeck, joinDeck));
  });
  channel.subscribe();

  return { roomId, cancel: () => supabase?.removeChannel(channel) };
}

/** Join an existing match by room code; B acts second. */
export function joinMatch(
  roomId: string,
  joinDeck: string,
  onStart: (conn: MatchConnection) => void,
): void {
  if (!supabase) throw new Error('Supabase not configured');
  const channel = supabase.channel(`match:${roomId}`, {
    config: { broadcast: { self: false } },
  });

  let started = false;
  channel.on('broadcast', { event: 'init' }, ({ payload }) => {
    if (started) return; // ignore a duplicate/retried init
    started = true;
    const hostDeck = (payload.deck as string) ?? 'emberwood';
    onStart(makeConnection(channel, roomId, 'B', payload.seed as number, hostDeck, joinDeck));
  });
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      channel.send({ type: 'broadcast', event: 'join', payload: { deck: joinDeck } });
    }
  });
}

/**
 * Rejoin a match this tab was already playing (after a reload or a long stall).
 * Nothing is re-negotiated: the saved seed and deck ids rebuild the same initial
 * state, the saved log replays it forward, and the `rejoin` handshake pulls
 * whatever the peer applied while we were away.
 */
export function rejoinMatch(saved: SavedMatch, onStart: (conn: MatchConnection) => void): void {
  if (!supabase) throw new Error('Supabase not configured');
  const channel = supabase.channel(`match:${saved.roomId}`, {
    config: { broadcast: { self: false } },
  });

  onStart(
    makeConnection(
      channel,
      saved.roomId,
      saved.role,
      saved.seed,
      saved.deckA,
      saved.deckB,
      saved.log,
    ),
  );

  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      channel.send({ type: 'broadcast', event: 'rejoin', payload: { have: saved.log.length } });
    }
  });
}
