import { describe, expect, it } from 'vitest';
import { createLockstep, type LockstepOut } from '../lockstep';
import type { Action } from '../../engine/types';

// A distinguishable action per index, so assertions can tell them apart.
const act = (n: number): Action => ({ type: 'playLand', iid: `c${n}` });

/** Build a lockstep wired to a recording emitter and an applied-action sink. */
function harness(log?: Action[]) {
  const out: LockstepOut[] = [];
  const applied: Action[] = [];
  const ls = createLockstep({ emit: (m) => out.push(m), log });
  ls.onApply((a) => applied.push(a));
  const resends = () => out.filter((m) => m.event === 'resend');
  const sent = () => out.filter((m): m is Extract<LockstepOut, { event: 'action' }> => m.event === 'action');
  return { ls, out, applied, resends, sent };
}

describe('lockstep sequencing', () => {
  it('applies in-order remote actions immediately', () => {
    const h = harness();
    h.ls.receive(0, act(0));
    h.ls.receive(1, act(1));
    expect(h.applied).toEqual([act(0), act(1)]);
    expect(h.ls.applied).toBe(2);
    expect(h.resends()).toHaveLength(0);
  });

  it('ignores duplicates and already-applied seqs', () => {
    const h = harness();
    h.ls.receive(0, act(0));
    h.ls.receive(0, act(0)); // duplicate of applied
    h.ls.receive(0, act(99)); // stale resend arriving late
    expect(h.applied).toEqual([act(0)]);
    expect(h.ls.applied).toBe(1);
  });

  it('buffers a future action, requests the gap, then drains in order', () => {
    const h = harness();
    h.ls.receive(2, act(2)); // arrives first
    expect(h.applied).toEqual([]);
    expect(h.resends()).toEqual([{ event: 'resend', from: 0, to: 2 }]);

    h.ls.receive(1, act(1));
    expect(h.applied).toEqual([]); // still missing 0

    h.ls.receive(0, act(0));
    expect(h.applied).toEqual([act(0), act(1), act(2)]); // whole run drains at once
    expect(h.ls.applied).toBe(3);
  });

  it('does not re-request a gap it already has buffered', () => {
    const h = harness();
    h.ls.receive(2, act(2));
    h.ls.receive(2, act(2)); // duplicate future action
    expect(h.resends()).toHaveLength(1);
  });

  it('local sends and remote receives share one sequence', () => {
    const h = harness();
    expect(h.ls.send(act(0))).toBe(0); // local
    h.ls.receive(1, act(1)); // remote
    expect(h.ls.send(act(2))).toBe(2); // local again
    expect(h.ls.applied).toBe(3);
    expect(h.ls.snapshot()).toEqual([act(0), act(1), act(2)]);
    // Only the local ones go on the wire; the remote one was already there.
    expect(h.sent().map((m) => m.seq)).toEqual([0, 2]);
  });

  it('does not feed locally-originated actions back into the engine', () => {
    const h = harness();
    h.ls.send(act(0)); // the store already applied this one itself
    expect(h.applied).toEqual([]);
  });

  it('serves a resend for actions the PEER originated, not just its own', () => {
    // The whole point of keeping a full log: after a drop, either side can heal
    // the other, even for an action it did not originate.
    const h = harness();
    h.ls.receive(0, act(0)); // remote-originated
    h.ls.send(act(1)); // local-originated
    h.out.length = 0;

    h.ls.serveResend(0, 2);
    expect(h.sent()).toEqual([
      { event: 'action', seq: 0, action: act(0) },
      { event: 'action', seq: 1, action: act(1) },
    ]);
  });

  it('clamps a resend request past the end of the log', () => {
    const h = harness();
    h.ls.send(act(0));
    h.out.length = 0;
    h.ls.serveResend(0, 99); // peer asked for more than exists
    expect(h.sent().map((m) => m.seq)).toEqual([0]);
  });

  it('pokeGap re-requests a stuck gap, and stays quiet when there is none', () => {
    const h = harness();
    expect(h.ls.pokeGap()).toBe(false); // nothing buffered

    h.ls.receive(3, act(3));
    h.out.length = 0;
    expect(h.ls.pokeGap()).toBe(true);
    expect(h.resends()).toEqual([{ event: 'resend', from: 0, to: 3 }]);

    h.ls.receive(0, act(0));
    h.ls.receive(1, act(1));
    h.ls.receive(2, act(2)); // gap closed, everything drains
    expect(h.ls.pokeGap()).toBe(false);
  });

  it('flushes actions that arrived before onApply was wired', () => {
    const out: LockstepOut[] = [];
    const ls = createLockstep({ emit: (m) => out.push(m) });
    ls.receive(0, act(0));
    ls.receive(1, act(1));
    expect(ls.applied).toBe(0); // buffered, not applied

    const applied: Action[] = [];
    ls.onApply((a) => applied.push(a));
    expect(applied).toEqual([act(0), act(1)]);
    expect(ls.applied).toBe(2);
  });
});

describe('lockstep reconnect', () => {
  it('restores from a persisted log and keeps the sequence going', () => {
    const h = harness([act(0), act(1)]);
    expect(h.ls.applied).toBe(2);
    expect(h.applied).toEqual([]); // restored actions are replayed by the store, not re-applied here
    expect(h.ls.send(act(2))).toBe(2); // next seq continues from the restored log
  });

  it('serves resends out of a restored log', () => {
    const h = harness([act(0), act(1)]);
    h.ls.serveResend(0, 2);
    expect(h.sent()).toEqual([
      { event: 'action', seq: 0, action: act(0) },
      { event: 'action', seq: 1, action: act(1) },
    ]);
  });

  it('catchupFor returns exactly what a rejoining peer is missing', () => {
    const h = harness([act(0), act(1), act(2)]);
    expect(h.ls.catchupFor(1)).toEqual({ from: 1, actions: [act(1), act(2)] });
    expect(h.ls.catchupFor(3)).toEqual({ from: 3, actions: [] }); // fully caught up
    expect(h.ls.catchupFor(0)).toEqual({ from: 0, actions: [act(0), act(1), act(2)] });
  });

  it('clamps a catch-up request from a peer claiming more than we have', () => {
    const h = harness([act(0)]);
    expect(h.ls.catchupFor(99)).toEqual({ from: 1, actions: [] });
  });

  it('a reconnecting client catches up through the normal receive path', () => {
    // Peer held 3 actions while we were away with 1; the catch-up run replays
    // through receive(), so dedup and ordering apply exactly as in steady state.
    const h = harness([act(0)]);
    const { from, actions } = createLockstep({ emit: () => {}, log: [act(0), act(1), act(2)] }).catchupFor(1);
    actions.forEach((a, i) => h.ls.receive(from + i, a));
    expect(h.applied).toEqual([act(1), act(2)]);
    expect(h.ls.applied).toBe(3);
  });

  it('snapshot is a copy, so callers cannot mutate the live log', () => {
    const h = harness();
    h.ls.send(act(0));
    const snap = h.ls.snapshot();
    snap.push(act(1));
    expect(h.ls.applied).toBe(1);
  });
});
