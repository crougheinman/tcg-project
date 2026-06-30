import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Action, PlayerId } from '../engine/types';

// PvP transport over a Supabase Realtime broadcast channel.
// Lockstep: we relay *actions* only; both clients replay them through the same
// deterministic engine starting from the same seed. No server compute.
// ponytail: client-authoritative lockstep; move authority to a Supabase Edge
// Function running the same engine if cheating ever matters.

/** An in-match chat message. Cosmetic only — never part of game state. */
export interface ChatMessage {
  from: PlayerId;
  text: string;
  id: string;
}

/** Max characters per chat message (defensive cap; the dock also enforces it). */
export const MAX_CHAT_LEN = 120;

export interface MatchConnection {
  roomId: string;
  role: PlayerId;
  seed: number;
  deckA: string; // host deck id
  deckB: string; // joiner deck id
  sendAction: (a: Action) => void;
  onAction: (cb: (a: Action) => void) => void;
  // Chat rides a *separate* broadcast event, outside the lockstep action stream —
  // it never touches the sequence counter or the deterministic engine. Best-effort:
  // a dropped chat packet is fine (unlike actions, which are sequenced + resent).
  sendChat: (text: string) => void;
  onChat: (cb: (m: ChatMessage) => void) => void;
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

/**
 * Reliable, ordered, exactly-once delivery on top of Supabase broadcast (which is
 * best-effort: messages can be dropped, duplicated, or reordered).
 *
 * The game is turn-based — only one player is the legal actor at any moment, so
 * every applied action has a single global position in the combined stream. We
 * stamp each action with that position (`seq`) and have both clients apply the
 * stream strictly in order:
 *   - in-order action  -> apply immediately
 *   - future action    -> buffer it and request the missing range (a gap)
 *   - past/duplicate   -> ignore
 * The originator keeps a history of what it sent so it can answer resend requests.
 * Net result: the store only ever sees remote actions in order, exactly once, so
 * the deterministic engine can never desync from dropped/reordered packets.
 */
function makeConnection(
  channel: RealtimeChannel,
  roomId: string,
  role: PlayerId,
  seed: number,
  deckA: string,
  deckB: string,
): MatchConnection {
  let actionCb: ((a: Action) => void) | null = null;
  let chatCb: ((m: ChatMessage) => void) | null = null;
  let appliedCount = 0; // actions applied to the shared engine so far (local + remote)
  const sentHistory = new Map<number, Action>(); // seqs this client originated
  const buffer = new Map<number, Action>(); // received but not yet applicable (seq >= appliedCount)

  // Apply every buffered action that is now next in sequence.
  function drain(): void {
    if (!actionCb) return; // not wired up yet — keep buffering
    while (buffer.has(appliedCount)) {
      const a = buffer.get(appliedCount)!;
      buffer.delete(appliedCount);
      actionCb(a);
      appliedCount++;
    }
  }

  function requestResend(from: number, to: number): void {
    channel.send({ type: 'broadcast', event: 'resend', payload: { from, to } });
  }

  channel.on('broadcast', { event: 'action' }, ({ payload }) => {
    const seq = payload.seq as number;
    if (seq < appliedCount || buffer.has(seq)) return; // already applied or already queued
    buffer.set(seq, payload.action as Action);
    if (seq > appliedCount) requestResend(appliedCount, seq); // gap: ask for what's missing
    drain();
  });

  // Chat: deliver straight through, no ordering/dedup needed (cosmetic, best-effort).
  channel.on('broadcast', { event: 'chat' }, ({ payload }) => {
    chatCb?.({
      from: payload.from as PlayerId,
      text: payload.text as string,
      id: payload.id as string,
    });
  });

  // Peer is missing [from, to); rebroadcast any of those we originated.
  channel.on('broadcast', { event: 'resend' }, ({ payload }) => {
    const from = payload.from as number;
    const to = payload.to as number;
    for (let s = from; s < to; s++) {
      const a = sentHistory.get(s);
      if (a) channel.send({ type: 'broadcast', event: 'action', payload: { seq: s, action: a } });
    }
  });

  // Re-request a stuck gap in case the resend itself was dropped.
  const retry = setInterval(() => {
    if (!actionCb || buffer.size === 0) return;
    const lowest = Math.min(...buffer.keys());
    if (lowest > appliedCount) requestResend(appliedCount, lowest);
  }, RESEND_INTERVAL_MS);

  return {
    roomId,
    role,
    seed,
    deckA,
    deckB,
    sendAction: (a) => {
      // The store applies the local action synchronously before calling this, so
      // its position is the current count. Record it (for resends) and advance.
      const seq = appliedCount;
      sentHistory.set(seq, a);
      appliedCount++;
      channel.send({ type: 'broadcast', event: 'action', payload: { seq, action: a } });
    },
    onAction: (cb) => {
      actionCb = cb;
      drain(); // flush anything that arrived before we were wired up
    },
    sendChat: (text) => {
      const clean = text.trim().slice(0, MAX_CHAT_LEN);
      if (!clean) return;
      // self:false means we won't hear this back — the store shows our own bubble.
      const msg: ChatMessage = { from: role, text: clean, id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` };
      channel.send({ type: 'broadcast', event: 'chat', payload: msg });
    },
    onChat: (cb) => {
      chatCb = cb;
    },
    leave: () => {
      clearInterval(retry);
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

  channel.on('broadcast', { event: 'join' }, ({ payload }) => {
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

  channel.on('broadcast', { event: 'init' }, ({ payload }) => {
    const hostDeck = (payload.deck as string) ?? 'emberwood';
    onStart(makeConnection(channel, roomId, 'B', payload.seed as number, hostDeck, joinDeck));
  });
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      channel.send({ type: 'broadcast', event: 'join', payload: { deck: joinDeck } });
    }
  });
}
