import type { CardInstance, GameState, PlayerId } from '../engine/types';
import type { CutInKind } from './fxTiming';

// Creatures with a signature moment that cuts in, with no delay to the action (it plays alongside it, so
// online play is untouched). Keyed by card id; `on` is the moment: declared as an attacker, arriving on the
// battlefield, or dying (Last breath).
export const MOMENT_CUTINS: Record<string, { on: 'attack' | 'enter' | 'death'; kind: CutInKind; label: string }> = {
  iron_shogun: { on: 'attack', kind: 'charge', label: '✦ The Charge' },
  storm_drake: { on: 'enter', kind: 'thunder', label: '✦ Thunder' },
  rotting_hulk: { on: 'death', kind: 'breath', label: '✦ Last breath' },
};

export interface MomentCue {
  on: 'attack' | 'enter' | 'death';
  card: CardInstance;
  ownerId: PlayerId;
  kind: CutInKind;
  label: string;
}

/** The moment cut-ins that this action (before -> after) just triggered. Pure, so it is unit-tested. */
export function momentCues(before: GameState, after: GameState): MomentCue[] {
  const cues: MomentCue[] = [];
  const declared = before.phase === 'combat_attack' && after.phase === 'combat_block' ? after.combat?.attackers ?? [] : [];
  for (const pid of ['A', 'B'] as PlayerId[]) {
    const was = new Set(before.players[pid].battlefield.map((c) => c.iid));
    const now = new Set(after.players[pid].battlefield.map((c) => c.iid));
    for (const c of after.players[pid].battlefield) {
      const m = MOMENT_CUTINS[c.def];
      if (!m) continue;
      if ((m.on === 'enter' && !was.has(c.iid)) || (m.on === 'attack' && declared.includes(c.iid)))
        cues.push({ on: m.on, card: c, ownerId: pid, kind: m.kind, label: m.label });
    }
    for (const c of before.players[pid].battlefield) {
      const m = MOMENT_CUTINS[c.def];
      if (m?.on === 'death' && !now.has(c.iid)) cues.push({ on: m.on, card: c, ownerId: pid, kind: m.kind, label: m.label });
    }
  }
  return cues;
}
