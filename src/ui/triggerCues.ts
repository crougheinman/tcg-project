import { getDef } from '../cards/cards';
import { isCreature } from '../engine/rules';
import type { CardInstance, GameState } from '../engine/types';
import { opponentOf } from '../engine/types';

// The creature triggers of Phase 4b (Landfall, attack triggers, Battle cry, Exalted, Morbid / second-spell bonuses) each write a log
// line naming the creature. This turns the new lines of one action into a short label to float over the creature, so the player can
// see WHICH creature did something. Pure and unit-tested; BoardFx draws the labels (visual only, so online play is untouched).
export interface TriggerCue {
  iid: string;
  label: string;
}

const LABELS: Record<string, string> = {
  landfall: 'Landfall',
  'attack trigger': 'On attack',
  'battle cry': 'Battle cry!',
  morbid: 'Morbid',
  'second spell': 'Second spell',
};

export function triggerCues(before: GameState, after: GameState): TriggerCue[] {
  const fresh = after.log.slice(before.log.length);
  const out: TriggerCue[] = [];
  const nth = new Map<string, number>(); // how many lines of this name + kind so far: the k-th goes to the k-th creature of that name
  // the active player's creatures first: these triggers fire for the creatures of whoever just attacked or played a land
  const mine = (name: string): CardInstance[] =>
    [...after.players[after.active].battlefield, ...after.players[opponentOf(after.active)].battlefield].filter(
      (c) => isCreature(c) && getDef(c.def).name === name,
    );
  for (const line of fresh) {
    const m = /^✦ (.+) — (landfall|attack trigger|battle cry|morbid|second spell)$/.exec(line);
    const ex = /^✦ Exalted — (.+) attacks alone: /.exec(line);
    const name = m?.[1] ?? ex?.[1];
    if (!name) continue;
    const label = m ? LABELS[m[2]] : 'Exalted';
    const key = `${name}|${label}`;
    const k = nth.get(key) ?? 0;
    nth.set(key, k + 1);
    const pool = mine(name);
    const c = pool[Math.min(k, pool.length - 1)];
    if (c) out.push({ iid: c.iid, label }); // a spell's bonus names no creature on the board: nothing to label
  }
  return out;
}
