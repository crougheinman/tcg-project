import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { localRealtimeEnabled, localTransport } from './transport.local';

// The realtime wire, as the game uses it: named channels that relay broadcast events to the OTHER members and share a
// presence list. One small interface, so the match, the matchmaking queue and the ready room can be tested against an
// in-memory implementation (transport.memory.ts) and, in development, driven across two browser tabs (transport.local.ts)
// without a Supabase project. The Supabase implementation below is the only one that ships to players.

export type ChannelStatus = 'SUBSCRIBED' | 'CLOSED' | 'ERROR';

export interface PresenceEntry {
  /** The client's presence key (unique per client). */
  key: string;
  state: Record<string, unknown>;
}

export interface RtChannel {
  /** Listen for a broadcast event. Register before `subscribe`. */
  on(event: string, cb: (payload: any) => void): void; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Send to the OTHER members of the channel; the sender never hears its own message. */
  send(event: string, payload: unknown): void;
  /** Announce this client's presence state (it replaces the previous one). Safe to call before the channel is joined. */
  track(state: Record<string, unknown>): void;
  untrack(): void;
  /** Called with the whole current presence list whenever it changes (a join, a leave, a state change). */
  onPresence(cb: (entries: PresenceEntry[]) => void): void;
  subscribe(cb?: (status: ChannelStatus) => void): void;
  close(): void;
}

export interface Transport {
  channel(name: string, opts?: { presenceKey?: string }): RtChannel;
}

/** The production transport: Supabase Realtime. */
export function supabaseTransport(client: SupabaseClient): Transport {
  return {
    channel(name, opts) {
      const ch = client.channel(name, {
        config: { broadcast: { self: false }, presence: { key: opts?.presenceKey ?? '' } },
      });
      let joined = false;
      let pending: Record<string, unknown> | null | undefined; // a track() / untrack() made before the join finished
      const flush = () => {
        if (!joined || pending === undefined) return;
        const p = pending;
        pending = undefined;
        void (p === null ? ch.untrack() : ch.track(p));
      };
      return {
        on: (event, cb) => {
          ch.on('broadcast', { event }, ({ payload }) => cb(payload));
        },
        send: (event, payload) => {
          void ch.send({ type: 'broadcast', event, payload });
        },
        track: (state) => {
          pending = state;
          flush();
        },
        untrack: () => {
          pending = null;
          flush();
        },
        onPresence: (cb) => {
          const emit = () => {
            const all = ch.presenceState() as Record<string, Record<string, unknown>[]>;
            cb(Object.entries(all).map(([key, metas]) => ({ key, state: stripRef(metas[metas.length - 1] ?? {}) })));
          };
          ch.on('presence', { event: 'sync' }, emit);
        },
        subscribe: (cb) => {
          ch.subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              joined = true;
              flush();
              cb?.('SUBSCRIBED');
            } else if (status === 'CLOSED') cb?.('CLOSED');
            else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') cb?.('ERROR');
          });
        },
        close: () => {
          void client.removeChannel(ch);
        },
      };
    },
  };
}

function stripRef(meta: Record<string, unknown>): Record<string, unknown> {
  const rest = { ...meta };
  delete rest.presence_ref;
  return rest;
}

let override: Transport | null = null;
/** Tests (and nothing else) install their own transport here; `null` goes back to the real one. */
export function setTransport(t: Transport | null): void {
  override = t;
}

/** The transport to use, or null when online play is not configured at all. */
export function getTransport(): Transport | null {
  if (override) return override;
  if (import.meta.env.DEV && localRealtimeEnabled()) return localTransport();
  return supabase ? supabaseTransport(supabase) : null;
}

/** Can the player use online play? (Supabase is configured, or a development transport is on.) */
export const onlineAvailable = (): boolean => getTransport() !== null;
