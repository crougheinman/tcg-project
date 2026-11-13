import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from './motionPref';

/**
 * A number that counts to its new value instead of snapping to it.
 *
 * Used for life totals: "20" silently becoming "13" is easy to miss, while a
 * count that visibly runs down is not. `dir` says which way it last moved, and
 * stays set briefly after it settles so a colour flash can outlast the count.
 *
 * At most MAX_STEPS ticks, so a 19-point swing takes the same time as a 3-point
 * one. With reduced motion it jumps in a single step (the flash still shows).
 */
const MAX_STEPS = 12;
const FLASH_HOLD_MS = 450;

export function useRolling(value: number, ms = 420): { shown: number; dir: 'up' | 'down' | null } {
  const [shown, setShown] = useState(value);
  const [dir, setDir] = useState<'up' | 'down' | null>(null);
  const current = useRef(value); // what is on screen right now, mid-roll included

  useEffect(() => {
    const from = current.current;
    const delta = value - from;
    if (delta === 0) return;

    setDir(delta > 0 ? 'up' : 'down');
    const steps = prefersReducedMotion() ? 1 : Math.min(Math.abs(delta), MAX_STEPS);
    let i = 0;
    let hold: ReturnType<typeof setTimeout> | undefined;
    const id = setInterval(() => {
      i++;
      const next = i >= steps ? value : Math.round(from + (delta * i) / steps);
      current.current = next;
      setShown(next);
      if (i >= steps) {
        clearInterval(id);
        hold = setTimeout(() => setDir(null), FLASH_HOLD_MS);
      }
    }, ms / steps);

    // A new value mid-roll restarts from wherever the count has reached.
    return () => {
      clearInterval(id);
      clearTimeout(hold);
    };
  }, [value, ms]);

  return { shown, dir };
}
