import { getDef } from '../cards/cards';
import type { CardInstance, GameState, PlayerId } from '../engine/types';
import type { CutInKind } from './fxTiming';

// Cards that change zone because of a creature's skill get their own little show, fired from the diff of two
// game states (so it plays alongside the action and never delays it, online included):
//   discard: Plague Priest's Rot sends a card from the victim's hand to their graveyard, at random;
//   raise:   Grave Necromancer's Grave Call returns the most recently fallen creature to its owner's hand.
export interface ZoneCue {
  kind: 'discard' | 'raise';
  card: CardInstance; // the card as it now stands (graveyard for a discard, hand for a raise)
  ownerId: PlayerId; // whose card it is
}

/** The zone moves this action (before -> after) just caused. Pure, so it is unit-tested. */
export function zoneCues(before: GameState, after: GameState): ZoneCue[] {
  const cues: ZoneCue[] = [];
  // The log names what happened, so a spell cast from hand to graveyard is never mistaken for a discard.
  const fresh = after.log.slice(before.log.length);
  for (const pid of ['A', 'B'] as PlayerId[]) {
    const was = before.players[pid];
    const now = after.players[pid];
    const inHand = new Set(now.hand.map((c) => c.iid));
    const inGrave = new Set(now.graveyard.map((c) => c.iid));
    const lines = [...fresh];
    const take = (line: string) => {
      const i = lines.indexOf(line);
      if (i < 0) return false;
      lines.splice(i, 1);
      return true;
    };
    for (const c of was.hand) {
      if (inHand.has(c.iid) || !inGrave.has(c.iid)) continue;
      if (take(`${pid} discards ${getDef(c.def).name}`)) cues.push({ kind: 'discard', card: now.graveyard.find((g) => g.iid === c.iid)!, ownerId: pid });
    }
    const wasGrave = new Set(was.graveyard.map((c) => c.iid));
    for (const c of now.hand) {
      if (!wasGrave.has(c.iid)) continue;
      if (take(`${pid} returns ${getDef(c.def).name} to hand`)) cues.push({ kind: 'raise', card: c, ownerId: pid });
    }
  }
  return cues;
}

/**
 * How long until the cast's cut-in (Rot, Grave Call) has finished? Online the spell applies the moment it is cast and
 * the cut-in plays alongside, so the zone show waits for it; against the AI the store already waited, so this is 0.
 */
export function cutInRemainingMs(
  spots: { cutIn?: CutInKind; ms: number; at: number }[],
  kinds: CutInKind[],
  now: number,
): number {
  let rest = 0;
  for (const s of spots) if (s.cutIn && kinds.includes(s.cutIn)) rest = Math.max(rest, s.at + s.ms - now);
  return Math.max(0, rest);
}
