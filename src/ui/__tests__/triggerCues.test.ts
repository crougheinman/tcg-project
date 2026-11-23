import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../engine/state';
import { applyAction } from '../../engine/reducer';
import { DECK_EMBERWOOD, DECK_SKYWARD } from '../../cards/decks';
import type { CardInstance, GameState } from '../../engine/types';
import { triggerCues } from '../triggerCues';

let n = 0;
const mk = (def: string, owner: 'A' | 'B' = 'A', over: Partial<CardInstance> = {}): CardInstance => ({
  iid: `c${n++}_${def}`, def, owner, tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false, ...over,
});
function table(): GameState {
  const g = createInitialState(9, DECK_EMBERWOOD, DECK_SKYWARD);
  g.phase = 'main1';
  g.active = 'A';
  g.players.A.battlefield = [];
  g.players.B.battlefield = [];
  g.players.A.hand = [];
  g.players.B.hand = [];
  return g;
}

describe('trigger cues (labels over the creature that fired)', () => {
  it('Landfall: each Granite Sentinel gets its own label, one per creature', () => {
    const g = table();
    const s1 = mk('granite_sentinel'), s2 = mk('granite_sentinel');
    const land = mk('aether_well');
    g.players.A.battlefield = [s1, s2];
    g.players.A.hand = [land];
    const after = applyAction(g, { type: 'playLand', iid: land.iid });
    const cues = triggerCues(g, after);
    expect(cues.map((c) => c.label)).toEqual(['Landfall', 'Landfall']);
    expect(new Set(cues.map((c) => c.iid))).toEqual(new Set([s1.iid, s2.iid]));
  });
  it('Battle cry and Exalted: labelled on the creature that has them', () => {
    const g = table();
    const shogun = mk('iron_shogun'), ash = mk('ashigaru');
    g.players.A.battlefield = [shogun, ash];
    g.phase = 'combat_attack';
    g.combat = { attackers: [], blocks: {} };
    const after = applyAction(g, { type: 'declareAttackers', attackers: [shogun.iid, ash.iid] });
    expect(triggerCues(g, after)).toEqual([{ iid: shogun.iid, label: 'Battle cry!' }]);
    const talon = mk('sky_talon');
    const g2 = table();
    g2.players.A.battlefield = [talon];
    g2.phase = 'combat_attack';
    g2.combat = { attackers: [], blocks: {} };
    const a2 = applyAction(g2, { type: 'declareAttackers', attackers: [talon.iid] });
    expect(triggerCues(g2, a2)).toEqual([{ iid: talon.iid, label: 'Exalted' }]);
  });
  it('an attack trigger is labelled "On attack"', () => {
    const drake = mk('storm_drake');
    const g = table();
    g.players.A.battlefield = [drake];
    g.phase = 'combat_attack';
    g.combat = { attackers: [], blocks: {} };
    const after = applyAction(g, { type: 'declareAttackers', attackers: [drake.iid] });
    expect(triggerCues(g, after)).toEqual([{ iid: drake.iid, label: 'On attack' }]);
  });
  it('a spell bonus names no creature on the board, so it gets no label; an unrelated action gives none', () => {
    const g = table();
    g.players.A.battlefield = [mk('aether_well'), mk('aether_well'), mk('aether_well')];
    g.diedThisTurn = true;
    const bolt = mk('cinderbolt');
    g.players.A.hand = [bolt];
    g.spellsThisTurn = { A: 1, B: 0 }; // this is the second spell
    const after = applyAction(g, { type: 'castSorcery', iid: bolt.iid, target: { kind: 'player', player: 'B' } });
    expect(after.log.some((l) => /second spell/.test(l))).toBe(true);
    expect(triggerCues(g, after)).toEqual([]);
    expect(triggerCues(g, g)).toEqual([]);
  });
});
