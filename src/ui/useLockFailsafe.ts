import { useEffect } from 'react';
import { LOCK_FAILSAFE_MS } from './fxTiming';

/**
 * Safety net for the board hold: while `active` (the board is held on its pre-change state and/or its cards are locked
 * for a phase banner) stays continuously true for `ms`, call `release`. PhaseBanner normally releases it as its banner
 * leaves; this is for a banner that never reports back (the limit is long on purpose: ordinary chained banners hold the
 * board for up to ~20 s, see LOCK_FAILSAFE_MS). The timer restarts whenever `active` changes, so a chain of
 * ordinary short locks never trips it; only one unbroken lock does. (It used to cover only a held board, not a locked one:
 * after a combat resolves the board deliberately holds nothing but PhaseBanner still locks the cards.)
 */
export function useLockFailsafe(active: boolean, release: () => void, ms: number = LOCK_FAILSAFE_MS): void {
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(release, ms);
    return () => clearTimeout(t);
  }, [active, release, ms]);
}
