import { getDef } from '../cards/cards';
import { blockError, canBlock, findCreature, isCreature } from '../engine/rules';
import type { CardInstance, GameState } from '../engine/types';
import { opponentOf } from '../engine/types';

// The defender's block planning, as pure functions.
//
// The player builds a set of assignments (blocker -> attacker) over several taps and
// only then confirms. All of the rules of that interaction live here, so they can be
// tested without a browser and cannot drift from the engine: legality comes from the
// same `canBlock` the validator uses.
//
// Interaction model (one rule per gesture, nothing hidden):
//   tap an UNASSIGNED blocker  -> assign it at once if there is exactly one live attacker,
//                                 otherwise mark it "pending" to pick a target
//   tap a PENDING blocker      -> cancel the pending choice
//   tap an ASSIGNED blocker    -> remove that one assignment
//   tap an attacker (pending)  -> assign the pending blocker to it, if legal
// Anything refused returns a `hint` explaining why, instead of failing silently or,
// worse, being accepted and then rejected by the engine on Confirm.

export interface BlockSel {
  blocks: Record<string, string>; // blocker iid -> attacker iid
  pending: string | null; // a blocker waiting for the player to pick its attacker
}

export interface TapResult {
  sel: BlockSel;
  hint?: string;
}

/** Attackers in declared order that are still in play. */
export function liveAttackers(game: GameState): CardInstance[] {
  const out: CardInstance[] = [];
  for (const iid of game.combat?.attackers ?? []) {
    const c = findCreature(game, iid)?.card;
    if (c) out.push(c);
  }
  return out;
}

function defenderCreature(game: GameState, iid: string): CardInstance | null {
  const found = findCreature(game, iid);
  if (!found || found.controller !== opponentOf(game.active)) return null;
  return isCreature(found.card) ? found.card : null;
}

/** Which blocker (if any) is already assigned to this attacker. */
function blockerOf(blocks: Record<string, string>, attackerIid: string): string | undefined {
  return Object.entries(blocks).find(([, a]) => a === attackerIid)?.[0];
}

const name = (c: CardInstance) => getDef(c.def).name;

/** Player-facing wording for a refused pairing. */
function reason(why: string, blocker: CardInstance, attacker: CardInstance): string {
  if (why === 'only flyers or reach creatures can block a flyer') {
    return `${name(blocker)} can't block ${name(attacker)} — only flyers or reach creatures can block a flyer`;
  }
  if (why === 'tapped creature cannot block') return `${name(blocker)} is tapped and can't block`;
  return `${name(blocker)} can't block ${name(attacker)}`;
}

export function tapBlocker(sel: BlockSel, game: GameState, blockerIid: string): TapResult {
  const blocker = defenderCreature(game, blockerIid);
  if (!blocker || blocker.tapped) return { sel };

  if (sel.blocks[blockerIid]) {
    // Already assigned: tapping it again takes the assignment back.
    const blocks = { ...sel.blocks };
    delete blocks[blockerIid];
    return { sel: { blocks, pending: null } };
  }
  if (sel.pending === blockerIid) return { sel: { blocks: sel.blocks, pending: null } };

  const attackers = liveAttackers(game);
  if (attackers.length === 0) return { sel };

  if (attackers.length === 1) {
    // No ambiguity, so the tap assigns it directly (the two-step flow here used to
    // leave a selected-but-unassigned blocker that silently let damage through).
    const atk = attackers[0];
    const why = blockError(blocker, atk);
    if (why) return { sel, hint: reason(why, blocker, atk) };
    if (blockerOf(sel.blocks, atk.iid)) {
      return { sel, hint: `${name(atk)} is already blocked — one blocker per attacker` };
    }
    return { sel: { blocks: { ...sel.blocks, [blockerIid]: atk.iid }, pending: null } };
  }

  // Several attackers: the player must pick. Don't even start if nothing is legal.
  if (!attackers.some((a) => canBlock(blocker, a))) {
    return { sel, hint: `${name(blocker)} can't block any of these attackers` };
  }
  return { sel: { blocks: sel.blocks, pending: blockerIid } };
}

export function tapAttacker(sel: BlockSel, game: GameState, attackerIid: string): TapResult {
  if (!sel.pending) return { sel };
  const atk = liveAttackers(game).find((a) => a.iid === attackerIid);
  const blocker = defenderCreature(game, sel.pending);
  if (!blocker) return { sel: { blocks: sel.blocks, pending: null } }; // it left play meanwhile
  if (!atk) return { sel };

  const why = blockError(blocker, atk);
  if (why) return { sel, hint: reason(why, blocker, atk) }; // keep it pending: pick another
  const taken = blockerOf(sel.blocks, atk.iid);
  if (taken && taken !== sel.pending) {
    return { sel, hint: `${name(atk)} is already blocked — tap its blocker to free it first` };
  }
  return { sel: { blocks: { ...sel.blocks, [sel.pending]: atk.iid }, pending: null } };
}

/**
 * Drop anything that is no longer true: a block whose attacker died (an instant can
 * kill one mid-step), a blocker that left play or got tapped, a pending blocker that
 * is gone. Returns the SAME object when nothing changed, so it is safe to call from an
 * effect on every render without causing a loop.
 */
export function prune(sel: BlockSel, game: GameState): { sel: BlockSel; dropped: number } {
  const live = new Set(liveAttackers(game).map((a) => a.iid));
  let dropped = 0;
  const blocks: Record<string, string> = {};
  for (const [b, a] of Object.entries(sel.blocks)) {
    const blocker = defenderCreature(game, b);
    if (blocker && !blocker.tapped && live.has(a)) blocks[b] = a;
    else dropped++;
  }
  const pendingOk = sel.pending === null || (defenderCreature(game, sel.pending)?.tapped === false);
  if (dropped === 0 && pendingOk) return { sel, dropped: 0 };
  return { sel: { blocks, pending: pendingOk ? sel.pending : null }, dropped };
}
