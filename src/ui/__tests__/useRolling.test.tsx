import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useRolling } from '../useRolling';

function mount(initial: number) {
  const seen: number[] = [];
  let latest!: ReturnType<typeof useRolling>;
  function Probe({ v }: { v: number }) {
    latest = useRolling(v, 400);
    seen.push(latest.shown);
    return null;
  }
  const view = render(<Probe v={initial} />);
  return { seen, get: () => latest, set: (v: number) => view.rerender(<Probe v={v} />) };
}

describe('useRolling', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts on the value with no direction', () => {
    const h = mount(20);
    expect(h.get()).toEqual({ shown: 20, dir: null });
  });

  it('counts down through the values in between and lands exactly', () => {
    const h = mount(20);
    h.set(17);
    // One tick per act(): advancing the whole window in a single act() lets React
    // batch every tick into one render, which hides the values in between.
    for (let i = 0; i < 3; i++) act(() => vi.advanceTimersByTime(400 / 3 + 1));
    expect(h.get().shown).toBe(17);
    expect(h.seen).toContain(19);
    expect(h.seen).toContain(18);
    expect(h.get().dir).toBe('down'); // flash still held just after it settles
  });

  it('reports "up" for healing', () => {
    const h = mount(8);
    h.set(13);
    act(() => vi.advanceTimersByTime(400));
    expect(h.get()).toMatchObject({ shown: 13, dir: 'up' });
  });

  it('clears the flash a moment after settling', () => {
    const h = mount(20);
    h.set(18);
    act(() => vi.advanceTimersByTime(400 + 500));
    expect(h.get()).toEqual({ shown: 18, dir: null });
  });

  it('a big swing takes the same time as a small one', () => {
    const h = mount(20);
    h.set(1); // 19 points, capped to 12 ticks over the same 400ms
    act(() => vi.advanceTimersByTime(400));
    expect(h.get().shown).toBe(1);
  });

  it('a second hit mid-count continues from where the count had reached', () => {
    const h = mount(20);
    h.set(10);
    act(() => vi.advanceTimersByTime(200)); // roughly half way
    const mid = h.get().shown;
    expect(mid).toBeLessThan(20);
    expect(mid).toBeGreaterThan(10);
    h.set(4);
    act(() => vi.advanceTimersByTime(400));
    expect(h.get().shown).toBe(4);
    expect(Math.max(...h.seen.slice(h.seen.indexOf(mid)))).toBeLessThanOrEqual(mid); // never jumps back up
  });
});
