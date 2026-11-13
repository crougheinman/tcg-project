// The 3D table switch.
//
// Depth is presentation only: it never changes what a card does or when. It
// defaults ON, except where the device or the person has told us otherwise, and
// an explicit choice in the game menu always wins over the default.

const KEY = 'depth';

export interface DepthEnv {
  reducedMotion: boolean;
  deviceMemory?: number; // GB, Chromium only
  cores?: number;
}

/** Should the table be 3D when the player has not chosen? Pure, so it is tested. */
export function defaultDepth(env: DepthEnv): boolean {
  if (env.reducedMotion) return false; // asked for less motion: keep the calm, flat table
  if (env.deviceMemory !== undefined && env.deviceMemory <= 2) return false;
  if (env.cores !== undefined && env.cores <= 2) return false;
  return true;
}

function readEnv(): DepthEnv {
  const nav = (typeof navigator !== 'undefined' ? navigator : {}) as Navigator & {
    deviceMemory?: number;
  };
  let reducedMotion = false;
  try {
    // matchMedia is missing in some test and embedded environments
    reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  } catch {
    reducedMotion = false;
  }
  return { reducedMotion, deviceMemory: nav.deviceMemory, cores: nav.hardwareConcurrency };
}

/** The saved choice if there is one, else the default for this device. */
export function readDepth(): boolean {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === '1') return true;
    if (saved === '0') return false;
  } catch {
    /* storage unavailable: fall through to the default */
  }
  return defaultDepth(readEnv());
}

export function saveDepth(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}
