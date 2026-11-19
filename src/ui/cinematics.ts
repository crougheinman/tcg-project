import { findCreature } from '../engine/rules';
import type { Action, CardInstance, GameState } from '../engine/types';
import { prefersReducedMotion } from './motionPref';
import { IAIJUTSU, IAIJUTSU_CLIP_URL } from './fxTiming';

/**
 * Is this the Iaijutsu Strike being cast on Hana (the Kensei Duelist)? Then the whole screen goes dark and a
 * short film plays (IaijutsuCinematic) instead of the ordinary floating card. Pure, so it is unit-tested.
 * Reduced motion keeps the ordinary spotlight (a long blackout is exactly what that setting is asking to avoid).
 */
export function isIaijutsuOnHana(g: GameState, action: Action, card: CardInstance): boolean {
  if (action.type !== 'castSorcery' || card.def !== IAIJUTSU.card || action.target?.kind !== 'creature') return false;
  const target = findCreature(g, action.target.iid);
  return !!target && target.card.def === IAIJUTSU.target && !prefersReducedMotion();
}

let warmed = false;
/** Does either deck hold the Iaijutsu Strike? Then fetch the clip early so the film never stutters when it is cast. */
export function warmIaijutsuClip(g: GameState): void {
  if (warmed || typeof fetch === 'undefined') return;
  const has = (['A', 'B'] as const).some((p) => {
    const ps = g.players[p];
    return [ps.library, ps.hand, ps.battlefield, ps.graveyard].some((z) => z.some((c) => c.def === IAIJUTSU.card));
  });
  if (!has) return;
  warmed = true;
  void fetch(IAIJUTSU_CLIP_URL).catch(() => {});
}
