import { getDef } from '../cards/cards';
import type { CardInstance, GameState, PlayerId } from '../engine/types';
import { ATTACK_MS, COMBAT_BANNER_GAP_MS, FS_INTRO_MS, STRIKE_STAGGER_MS } from './fxTiming';

/**
 * How long the board is busy with the combat that `before` -> `after` just resolved: the first-strike
 * cinematic when there is one, then every attacker's strike in turn, plus the gap before the next
 * phase banner. 0 when combat did not just resolve. The phase banner and the AI both wait this long,
 * so the "End phase" banner never lands on top of the clash.
 */
export function combatHoldMs(before: GameState | null, after: GameState): number {
  if (!before || !combatJustResolved(before, after)) return 0;
  const attackers = after.lastCombat?.attackers.length ?? 0;
  if (!attackers) return 0;
  // (no window in the node test environment; reduced motion skips the cinematic, not the strikes)
  const reduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const intro = !reduced && findFirstStrikeClash(before, after) ? FS_INTRO_MS : 0;
  return intro + (attackers - 1) * STRIKE_STAGGER_MS + ATTACK_MS + COMBAT_BANNER_GAP_MS;
}

/** Did combat just resolve (block step -> end) this action? Same test BoardFx and the phase banner use. */
export function combatJustResolved(before: GameState, after: GameState): boolean {
  return before.phase === 'combat_block' && after.phase === 'end' && !!after.lastCombat;
}

/**
 * The first striker in this combat's clashes (a blocked pair where the attacker, else the blocker,
 * has first strike), with the player who owns it. Looked up in `before`, since the dead are gone
 * from `after`. Null when combat did not just resolve or nobody first-struck.
 */
export function findFirstStrikeClash(
  before: GameState,
  after: GameState,
): { card: CardInstance; owner: PlayerId } | null {
  const resolved = after.lastCombat;
  if (!resolved || !combatJustResolved(before, after)) return null;
  const inBefore = (iid: string) =>
    (['A', 'B'] as PlayerId[])
      .map((p) => ({ p, c: before.players[p].battlefield.find((x) => x.iid === iid) }))
      .find((r) => r.c);
  const isFs = (c?: CardInstance) => !!c && (getDef(c.def).keywords ?? []).includes('firstStrike');
  const blockerByAtk: Record<string, string> = {};
  for (const [blk, atk] of Object.entries(resolved.blocks)) blockerByAtk[atk] = blk;
  for (const atk of resolved.attackers) {
    const blk = blockerByAtk[atk];
    if (!blk) continue;
    const a = inBefore(atk);
    const b = inBefore(blk);
    if (a && isFs(a.c)) return { card: a.c!, owner: a.p };
    if (b && isFs(b.c)) return { card: b.c!, owner: b.p };
  }
  return null;
}
