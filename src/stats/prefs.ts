// The player's choice to share anonymous match statistics. On by default (the stats are about the game, never the person);
// the game menu has a switch. Persisted; a private window or blocked storage just means "the default".

const KEY = 'shareStats';

export function isSharing(storage: Pick<Storage, 'getItem'> | null = safeStorage()): boolean {
  try {
    return storage?.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function setSharing(v: boolean, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(KEY, v ? '1' : '0');
  } catch {
    /* storage blocked: the choice lasts until reload */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
