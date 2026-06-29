import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Action, PlayerId } from '../engine/types';

// PvP transport over a Supabase Realtime broadcast channel.
// Lockstep: we relay *actions* only; both clients replay them through the same
// deterministic engine starting from the same seed. No server compute.
// ponytail: client-authoritative lockstep; move authority to a Supabase Edge
// Function running the same engine if cheating ever matters.

export interface MatchConnection {
  roomId: string;
  role: PlayerId;
  seed: number;
  deckA: string; // host deck id
  deckB: string; // joiner deck id
  sendAction: (a: Action) => void;
  onAction: (cb: (a: Action) => void) => void;
  leave: () => void;
}

function randomRoom(): string {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += alpha[Math.floor(Math.random() * alpha.length)];
  return s;
}

function makeConnection(
  channel: RealtimeChannel,
  roomId: string,
  role: PlayerId,
  seed: number,
  deckA: string,
  deckB: string,
): MatchConnection {
  let actionCb: ((a: Action) => void) | null = null;
  channel.on('broadcast', { event: 'action' }, ({ payload }) => {
    actionCb?.(payload.action as Action);
  });
  return {
    roomId,
    role,
    seed,
    deckA,
    deckB,
    sendAction: (a) => {
      channel.send({ type: 'broadcast', event: 'action', payload: { action: a } });
    },
    onAction: (cb) => {
      actionCb = cb;
    },
    leave: () => {
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
