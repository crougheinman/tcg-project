import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../engine/state';
import { applyAction } from '../../engine/reducer';
import { DECK_EMBERWOOD, DECK_SKYWARD } from '../../cards/decks';
import type { CardInstance, GameState } from '../../engine/types';
import { combatHoldMs, combatImpactDelays, findFirstStrikeClash } from '../firstStrike';
import { FS_CUTINS, FS_CUTIN_SPOT_MS, FS_SLASH_MS, FS_SPOT_MS, fsIntroMs, fsSpotMs } from '../fxTiming';

const mk = (def: string, owner: 'A' | 'B', iid: string): CardInstance => ({
  iid, def, owner, tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false,
});

/** A attacks with `attacker`; B blocks it with a Stoneback Cub. Returns the state before and after blocks. */
function clash(attacker: string) {
  const s = createInitialState(3, DECK_EMBERWOOD, DECK_SKYWARD);
  s.players.A.battlefield = [mk(attacker, 'A', 'atk')];
  s.players.B.battlefield = [mk('stoneback_cub', 'B', 'blk')];
  s.phase = 'combat_attack';
  s.combat = { attackers: [], blocks: {} };
  const before = applyAction(s, { type: 'declareAttackers', attackers: ['atk'] });
  const after = applyAction(before, { type: 'declareBlockers', blocks: { blk: 'atk' } });
  return { before, after };
}

describe('first-strike cut-in timing', () => {
  it('a first striker with a cut-in holds the spotlight longer; the others keep the short one', () => {
    expect(FS_CUTINS.kensei_duelist).toBe('strike');
    expect(fsSpotMs('kensei_duelist')).toBe(FS_CUTIN_SPOT_MS);
    expect(fsSpotMs('iron_shogun')).toBe(FS_SPOT_MS);
    expect(fsIntroMs('kensei_duelist')).toBe(FS_CUTIN_SPOT_MS + FS_SLASH_MS);
    expect(FS_CUTIN_SPOT_MS).toBeGreaterThan(FS_SPOT_MS);
  });

  it('finds Hana as the first striker of a clash', () => {
    const { before, after } = clash('kensei_duelist');
    expect(findFirstStrikeClash(before, after)).toMatchObject({ card: { def: 'kensei_duelist' }, owner: 'A' });
  });

  it('combat waits for the longer intro: the hold and every impact shift by the extra spotlight time', () => {
    const k = clash('kensei_duelist');
    const s = clash('iron_shogun');
    const extra = FS_CUTIN_SPOT_MS - FS_SPOT_MS;
    expect(combatHoldMs(k.before, k.after)).toBe(combatHoldMs(s.before, s.after) + extra);
    expect(combatImpactDelays(k.before, k.after).atk).toBe(combatImpactDelays(s.before, s.after).atk + extra);
  });

  it('a clash with no first striker has no intro at all', () => {
    const plain = clash('stoneback_cub');
    expect(findFirstStrikeClash(plain.before, plain.after)).toBeNull();
    const base = combatHoldMs(plain.before, plain.after);
    expect(base).toBeLessThan(combatHoldMs(clash('iron_shogun').before, clash('iron_shogun').after));
  });
});

describe('game state used above', () => {
  it('the Kensei clash really resolves with first strike (she kills the cub and is untouched)', () => {
    const { after } = clash('kensei_duelist');
    const hana = after.players.A.battlefield.find((c) => c.iid === 'atk');
    expect(hana).toBeDefined();
    expect(after.players.B.battlefield.some((c: GameState['players']['A']['battlefield'][number]) => c.iid === 'blk')).toBe(false);
  });
});
