import type { Action, PlayerId } from '../engine/types';

// Persisted match record, so a reload / backgrounded tab can rejoin instead of
// forfeiting. Determinism is what makes this cheap: seed + deck ids + the ordered
// action log reconstruct the exact GameState by replay, so we never serialize the
// state itself (which would be large, and would drift from the engine's shape).
//
// sessionStorage, not localStorage: a match belongs to the tab that is playing it,
// and a stale record should not outlive the browsing session.

const KEY = 'pvp-match';
const TTL_MS = 30 * 60 * 1000; // a record older than this is junk, not a match

export interface SavedMatch {
  roomId: string;
  role: PlayerId;
  seed: number;
  deckA: string;
  deckB: string;
  log: Action[];
  savedAt: number;
}

/** Storage can throw (Safari private mode, disabled cookies) — never let it break a match. */
function store(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function saveMatch(m: Omit<SavedMatch, 'savedAt'>): void {
  try {
    store()?.setItem(KEY, JSON.stringify({ ...m, savedAt: Date.now() }));
  } catch {
    /* quota or unavailable — reconnect is a bonus, not a requirement */
  }
}

export function loadMatch(): SavedMatch | null {
  try {
    const raw = store()?.getItem(KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as SavedMatch;
    if (!m?.roomId || !Array.isArray(m.log)) return null;
    if (Date.now() - (m.savedAt ?? 0) > TTL_MS) {
      clearMatch();
      return null;
    }
    return m;
  } catch {
    return null;
  }
}

export function clearMatch(): void {
  try {
    store()?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
