import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useTimers } from '../useTimers';

type Api = ReturnType<typeof useTimers>;

/** Mount the hook and hand its API back out. */
function mount() {
  let api!: Api;
  function Probe() {
    api = useTimers();
    return null;
  }
  const view = render(<Probe />);
  return { api: () => api, unmount: view.unmount };
}

describe('useTimers', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs a callback after its delay', () => {
    const { api } = mount();
    const fn = vi.fn();
    api().later(fn, 150);
    vi.advanceTimersByTime(149);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('clearAll drops everything still pending, and only that', () => {
    const { api } = mount();
    const early = vi.fn();
    const late = vi.fn();
    api().later(early, 100);
    api().later(late, 500);
    vi.advanceTimersByTime(100);
    act(() => api().clearAll());
    vi.advanceTimersByTime(1000);
    expect(early).toHaveBeenCalledTimes(1); // already fired: unaffected
    expect(late).not.toHaveBeenCalled(); // was pending: dropped
  });

  it('unmounting cancels pending callbacks', () => {
    // The actual bug: a strike or explosion queued for a board that is gone.
    const { api, unmount } = mount();
    const fn = vi.fn();
    api().later(fn, 300);
    unmount();
    vi.advanceTimersByTime(1000);
    expect(fn).not.toHaveBeenCalled();
  });

  it('keeps working after a clearAll', () => {
    const { api } = mount();
    act(() => api().clearAll());
    const fn = vi.fn();
    api().later(fn, 50);
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
