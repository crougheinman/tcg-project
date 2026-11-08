import type { Action } from '../engine/types';

// Pure lockstep sequencing core — no Supabase, no timers, no DOM.
//
// The game is turn-based and exactly one player may originate an action at any
// moment (see `actorOf` in engine/rules.ts), so every applied action has a single
// global position in the combined stream. We stamp each action with that position
// (`seq`) and both clients apply the stream strictly in order:
//   - in-order action -> apply immediately
//   - future action   -> buffer it and request the missing range (a gap)
//   - past/duplicate  -> ignore
//
// Unlike a send-only history, this keeps the FULL applied log (local + remote),
// which buys two things:
//   1. either client can answer a resend for any seq, not just ones it originated;
//   2. the log is a complete, replayable match record — combined with the seed it
//      reconstructs the exact game state, which is what makes reconnect possible.
//
// Everything here is deterministic and side-effect free apart from `emit`, so it
// is unit-testable under the repo's node-env vitest config.

/** Wire messages the core emits. The transport delivers them verbatim. */
export type LockstepOut =
  | { event: 'action'; seq: number; action: Action }
  | { event: 'resend'; from: number; to: number };

export interface Lockstep {
  /** Number of actions applied so far — also the seq of the next one. */
  readonly applied: number;
  /** Full ordered log of applied actions (index === seq). Safe to persist. */
  snapshot(): Action[];
  /** Register the apply callback; flushes anything that arrived before wiring. */
  onApply(cb: (a: Action) => void): void;
  /** Originate a LOCAL action (already applied to the engine). Returns its seq. */
  send(a: Action): number;
  /** Inbound remote action. */
  receive(seq: number, action: Action): void;
  /** Peer is missing [from, to) — rebroadcast whatever we hold. */
  serveResend(from: number, to: number): void;
  /** What a peer who has `have` actions is missing (reconnect catch-up). */
  catchupFor(have: number): { from: number; actions: Action[] };
  /** Re-ask for a stuck gap. True if a request was emitted. */
  pokeGap(): boolean;
}

export function createLockstep(opts: {
  emit: (msg: LockstepOut) => void;
  /** Restored log from a previous session (reconnect); defaults to empty. */
  log?: Action[];
}): Lockstep {
  const emit = opts.emit;
  const log: Action[] = opts.log ? [...opts.log] : [];
  const buffer = new Map<number, Action>(); // received but not yet applicable
  let applyCb: ((a: Action) => void) | null = null;

  // Apply every buffered action that is now next in sequence.
  function drain(): void {
    if (!applyCb) return; // not wired up yet — keep buffering
    for (;;) {
      const next = buffer.get(log.length);
      if (!next) return;
      buffer.delete(log.length);
      log.push(next); // push BEFORE the callback so `applied` stays monotonic
      applyCb(next);
    }
  }

  return {
    get applied() {
      return log.length;
    },
    snapshot: () => [...log],
    onApply: (cb) => {
      applyCb = cb;
      drain();
    },
    send: (a) => {
      // The store applies the local action synchronously before calling this, so
      // its position is the current count.
      const seq = log.length;
      log.push(a);
      emit({ event: 'action', seq, action: a });
      return seq;
    },
    receive: (seq, action) => {
      if (seq < log.length || buffer.has(seq)) return; // applied or already queued
      buffer.set(seq, action);
      if (seq > log.length) emit({ event: 'resend', from: log.length, to: seq }); // gap
      drain();
    },
    serveResend: (from, to) => {
      for (let s = from; s < to && s < log.length; s++) {
        if (s >= 0) emit({ event: 'action', seq: s, action: log[s] });
      }
    },
    catchupFor: (have) => {
      const from = Math.max(0, Math.min(have, log.length));
      return { from, actions: log.slice(from) };
    },
    pokeGap: () => {
      if (buffer.size === 0) return false;
      let lowest = Infinity;
      for (const k of buffer.keys()) if (k < lowest) lowest = k;
      if (lowest <= log.length) return false;
      emit({ event: 'resend', from: log.length, to: lowest });
      return true;
    },
  };
}
