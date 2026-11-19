import { describe, expect, it } from 'vitest';
import type { CardInstance, GameState, PlayerId } from '../../engine/types';
import { momentCues } from '../momentCues';

const card = (iid: string, def: string): CardInstance => ({ iid, def }) as CardInstance;
function state(phase: string, bf: Partial<Record<PlayerId, CardInstance[]>>, attackers?: string[]): GameState {
  return {
    phase,
    combat: attackers ? { attackers, blocks: {} } : null,
    players: { A: { battlefield: bf.A ?? [] }, B: { battlefield: bf.B ?? [] } },
  } as unknown as GameState;
}

describe('momentCues', () => {
  const shogun = card('s1', 'iron_shogun');
  const drake = card('d1', 'storm_drake');
  const hulk = card('h1', 'rotting_hulk');

  it('The Charge fires when the Shogun is declared as an attacker, not when he stays home', () => {
    const before = state('combat_attack', { A: [shogun] });
    expect(momentCues(before, state('combat_block', { A: [shogun] }, ['s1'])).map((c) => c.kind)).toEqual(['charge']);
    expect(momentCues(before, state('combat_block', { A: [shogun] }, []))).toEqual([]);
  });

  it('Thunder fires once, when the Drake arrives', () => {
    const before = state('main1', {});
    const after = state('main1', { B: [drake] });
    const cues = momentCues(before, after);
    expect(cues.map((c) => [c.kind, c.ownerId])).toEqual([['thunder', 'B']]);
    expect(momentCues(after, after)).toEqual([]);
  });

  it('Last breath fires when the Hulk leaves the battlefield, and only then', () => {
    const before = state('combat_block', { A: [hulk] });
    expect(momentCues(before, state('end', { A: [] })).map((c) => c.kind)).toEqual(['breath']);
    expect(momentCues(before, state('end', { A: [hulk] }))).toEqual([]);
  });

  it('other creatures never cue', () => {
    expect(momentCues(state('main1', {}), state('main1', { A: [card('x', 'ember_sprite')] }))).toEqual([]);
  });
});
