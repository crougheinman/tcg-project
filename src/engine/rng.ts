// Deterministic PRNG (mulberry32). The rng state lives inside GameState and is
// threaded explicitly so the same seed + same actions always produce the same
// game — required for lockstep PvP and replay tests.

/** Advance the PRNG. Returns [float in [0,1), nextState]. */
export function nextRandom(state: number): [number, number] {
  let a = state | 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [r, a];
}

/** Fisher-Yates shuffle. Returns [shuffledCopy, nextState]; input untouched. */
export function shuffle<T>(arr: T[], state: number): [T[], number] {
  const out = arr.slice();
  let s = state;
  for (let i = out.length - 1; i > 0; i--) {
    let r: number;
    [r, s] = nextRandom(s);
    const j = Math.floor(r * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return [out, s];
}
