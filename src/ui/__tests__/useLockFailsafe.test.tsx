import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useLockFailsafe } from '../useLockFailsafe';
import { LOCK_FAILSAFE_MS } from '../fxTiming';

describe('the board lock failsafe', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('releases a lock that never lets go, after LOCK_FAILSAFE_MS', () => {
    const release = vi.fn();
    renderHook(() => useLockFailsafe(true, release));
    vi.advanceTimersByTime(LOCK_FAILSAFE_MS - 1);
    expect(release).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('does nothing while nothing is locked', () => {
    const release = vi.fn();
    renderHook(() => useLockFailsafe(false, release));
    vi.advanceTimersByTime(LOCK_FAILSAFE_MS * 3);
    expect(release).not.toHaveBeenCalled();
  });

  it('restarts when the lock lets go and comes back, so a chain of ordinary locks never trips it', () => {
    const release = vi.fn();
    const { rerender } = renderHook(({ on }) => useLockFailsafe(on, release), { initialProps: { on: true } });
    vi.advanceTimersByTime(LOCK_FAILSAFE_MS - 1000);
    rerender({ on: false });
    vi.advanceTimersByTime(500);
    rerender({ on: true });
    vi.advanceTimersByTime(LOCK_FAILSAFE_MS - 1000);
    expect(release).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
