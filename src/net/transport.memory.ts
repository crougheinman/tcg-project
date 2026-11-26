import type { ChannelStatus, PresenceEntry, RtChannel, Transport } from './transport';

// An in-memory realtime, for tests. Several `client()`s share one hub the way several browsers share one Supabase project.
// Delivery is asynchronous (a microtask, or `latencyMs` later), like the network, and can be made to fail on purpose.

interface Member {
  client: number;
  key: string;
  subscribed: boolean;
  closed: boolean;
  handlers: Map<string, ((p: unknown) => void)[]>;
  presenceCbs: ((e: PresenceEntry[]) => void)[];
  tracked: Record<string, unknown> | null;
  statusCb?: (s: ChannelStatus) => void;
}

export interface MemoryHub {
  /** A new client (a browser tab). */
  client(): Transport;
  /** Everything that client had open disappears at once: a closed tab or a dropped connection. */
  disconnect(client: Transport): void;
  /** Drop the next `n` broadcast messages of this event, wherever they go. */
  dropNext(event: string, n?: number): void;
  /** Every broadcast sent, in order (for assertions). */
  sent: { channel: string; event: string; payload: unknown }[];
}

export function createMemoryHub(opts: { latencyMs?: number } = {}): MemoryHub {
  const channels = new Map<string, Member[]>();
  const owners = new Map<Transport, number>();
  const drops = new Map<string, number>();
  const sent: MemoryHub['sent'] = [];
  let nextClient = 1;

  const later = (fn: () => void) => (opts.latencyMs ? void setTimeout(fn, opts.latencyMs) : void queueMicrotask(fn));

  function members(name: string): Member[] {
    let m = channels.get(name);
    if (!m) channels.set(name, (m = []));
    return m;
  }
  function entries(name: string): PresenceEntry[] {
    return members(name)
      .filter((m) => m.tracked && !m.closed)
      .map((m) => ({ key: m.key, state: { ...m.tracked! } }));
  }
  function notifyPresence(name: string) {
    const all = entries(name);
    for (const m of members(name)) if (m.subscribed && !m.closed) for (const cb of m.presenceCbs) later(() => !m.closed && cb(all.map((e) => ({ ...e, state: { ...e.state } }))));
  }

  function make(client: number, name: string, key: string): RtChannel {
    const me: Member = { client, key, subscribed: false, closed: false, handlers: new Map(), presenceCbs: [], tracked: null };
    members(name).push(me);
    const leave = () => {
      if (me.closed) return;
      me.closed = true;
      me.subscribed = false;
      const had = me.tracked;
      me.tracked = null;
      channels.set(name, members(name).filter((m) => m !== me));
      if (had) notifyPresence(name);
    };
    (me as Member & { leave: () => void }).leave = leave;
    return {
      on: (event, cb) => {
        const l = me.handlers.get(event) ?? [];
        l.push(cb as (p: unknown) => void);
        me.handlers.set(event, l);
      },
      send: (event, payload) => {
        if (!me.subscribed || me.closed) return; // a channel that has not joined sends nothing
        sent.push({ channel: name, event, payload });
        const left = drops.get(event) ?? 0;
        if (left > 0) {
          drops.set(event, left - 1);
          return;
        }
        for (const m of members(name)) {
          if (m === me || !m.subscribed || m.closed) continue;
          later(() => {
            if (m.closed) return;
            for (const cb of m.handlers.get(event) ?? []) cb(structuredClone(payload));
          });
        }
      },
      track: (state) => {
        me.tracked = { ...state };
        if (me.subscribed) notifyPresence(name);
      },
      untrack: () => {
        if (!me.tracked) return;
        me.tracked = null;
        if (me.subscribed) notifyPresence(name);
      },
      onPresence: (cb) => {
        me.presenceCbs.push(cb);
      },
      subscribe: (cb) => {
        me.statusCb = cb;
        later(() => {
          if (me.closed) return;
          me.subscribed = true;
          cb?.('SUBSCRIBED');
          notifyPresence(name); // a new member gets the current list, and everyone else hears of it
        });
      },
      close: () => {
        leave();
        me.statusCb?.('CLOSED');
      },
    };
  }

  return {
    sent,
    client() {
      const id = nextClient++;
      const t: Transport = { channel: (name, o) => make(id, name, o?.presenceKey ?? `k${id}-${Math.random().toString(36).slice(2, 7)}`) };
      owners.set(t, id);
      return t;
    },
    disconnect(t) {
      const id = owners.get(t);
      for (const [name, list] of channels) {
        for (const m of [...list]) if (m.client === id) (m as Member & { leave: () => void }).leave();
        void name;
      }
    },
    dropNext(event, n = 1) {
      drops.set(event, (drops.get(event) ?? 0) + n);
    },
  };
}
