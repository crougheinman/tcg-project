import { useCallback, useEffect, useRef } from 'react';

/**
 * setTimeout that cleans up after itself.
 *
 * The board's choreography is a web of delayed callbacks (a strike lands 150ms
 * into a lunge, a bolt's burst waits for its flight, ...). Bare setTimeout leaves
 * all of them armed when the board unmounts or a new game replaces the old one,
 * so they fire into a table they no longer describe. `later` tracks every pending
 * timer; `clearAll` drops them, and unmounting drops them automatically.
 *
 * Deliberately NOT cleared when the game state merely advances: an effect queued
 * by one action must still play out after the next action arrives.
 */
export function useTimers() {
  const pending = useRef(new Set<ReturnType<typeof setTimeout>>());

  const later = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      pending.current.delete(id);
      fn();
    }, ms);
    pending.current.add(id);
    return id;
  }, []);

  const clearAll = useCallback(() => {
    pending.current.forEach((id) => clearTimeout(id));
    pending.current.clear();
  }, []);

  useEffect(() => clearAll, [clearAll]);

  return { later, clearAll };
}
