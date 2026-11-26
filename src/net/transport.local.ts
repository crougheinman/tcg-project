import type { ChannelStatus, PresenceEntry, RtChannel, Transport } from './transport';

// DEVELOPMENT ONLY: a realtime that works between tabs of one browser through BroadcastChannel, so online play (the queue, the
// ready room, a whole match) can be tried and tested with two tabs and no Supabase project. Turn it on in a tab with
// `localStorage.setItem('rt', 'local')` on the dev server. It is behind `import.meta.env.DEV` in transport.ts, so production
// builds never use it.

export const localRealtimeEnabled = (): boolean => {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('rt') === 'local';
  } catch {
    return false;
  }
};

const HEARTBEAT_MS = 1500;
const EXPIRE_MS = 5000;

type Wire =
  | { t: 'msg'; event: string; payload: unknown; from: string }
  | { t: 'presence'; key: string; state: Record<string, unknown> | null; from: string }
  | { t: 'hello'; from: string };

export function localTransport(): Transport {
  return {
    channel(name, opts) {
      const id = `${Math.random().toString(36).slice(2)}`;
      const key = opts?.presenceKey ?? id;
      const bc = new BroadcastChannel(`rt:${name}`);
      const handlers = new Map<string, ((p: unknown) => void)[]>();
      const presenceCbs: ((e: PresenceEntry[]) => void)[] = [];
      const others = new Map<string, { state: Record<string, unknown>; seen: number }>();
      let mine: Record<string, unknown> | null = null;
      let timer: ReturnType<typeof setInterval> | undefined;
      let closed = false;

      const post = (m: Wire) => !closed && bc.postMessage(m);
      const emit = () => {
        const list: PresenceEntry[] = [...others].map(([k, v]) => ({ key: k, state: { ...v.state } }));
        if (mine) list.push({ key, state: { ...mine } });
        for (const cb of presenceCbs) cb(list);
      };
      bc.onmessage = (ev: MessageEvent<Wire>) => {
        const m = ev.data;
        if (m.from === id) return;
        if (m.t === 'msg') for (const cb of handlers.get(m.event) ?? []) cb(m.payload);
        else if (m.t === 'presence') {
          if (m.state) others.set(m.key, { state: m.state, seen: Date.now() });
          else others.delete(m.key);
          emit();
        } else if (m.t === 'hello' && mine) post({ t: 'presence', key, state: mine, from: id });
      };

      const ch: RtChannel = {
        on: (event, cb) => {
          const l = handlers.get(event) ?? [];
          l.push(cb as (p: unknown) => void);
          handlers.set(event, l);
        },
        send: (event, payload) => post({ t: 'msg', event, payload, from: id }),
        track: (state) => {
          mine = { ...state };
          post({ t: 'presence', key, state: mine, from: id });
          emit();
        },
        untrack: () => {
          if (!mine) return;
          mine = null;
          post({ t: 'presence', key, state: null, from: id });
          emit();
        },
        onPresence: (cb) => {
          presenceCbs.push(cb);
        },
        subscribe: (cb) => {
          // like the real thing: joined a moment later, then ask who is here, and keep saying "still here"
          setTimeout(() => {
            if (closed) return;
            post({ t: 'hello', from: id });
            timer = setInterval(() => {
              if (mine) post({ t: 'presence', key, state: mine, from: id });
              const now = Date.now();
              let changed = false;
              for (const [k, v] of others) {
                if (now - v.seen > EXPIRE_MS) {
                  others.delete(k);
                  changed = true;
                }
              }
              if (changed) emit();
            }, HEARTBEAT_MS);
            (cb as ((s: ChannelStatus) => void) | undefined)?.('SUBSCRIBED');
            emit();
          }, 30);
        },
        close: () => {
          if (closed) return;
          if (mine) post({ t: 'presence', key, state: null, from: id });
          closed = true;
          if (timer) clearInterval(timer);
          bc.close();
        },
      };
      // a closed or navigated-away tab says goodbye (the heartbeat expiry covers a crash)
      if (typeof window !== 'undefined') window.addEventListener('pagehide', () => ch.close());
      return ch;
    },
  };
}
