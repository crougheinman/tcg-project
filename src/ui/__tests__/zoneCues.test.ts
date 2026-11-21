import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../engine/state';
import { applyAction } from '../../engine/reducer';
import { DECK_EMBERWOOD, DECK_SKYWARD } from '../../cards/decks';
import type { CardInstance, GameState } from '../../engine/types';
import { cutInRemainingMs, zoneCues } from '../zoneCues';

let n = 0;
const mk = (def: string, owner: 'A' | 'B', over: Partial<CardInstance> = {}): CardInstance => ({
  iid: `z${n++}_${def}`, def, owner, tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false, ...over,
});

function table(): GameState {
  const g = createInitialState(7, DECK_EMBERWOOD, DECK_SKYWARD);
  g.phase = 'main1';
  g.active = 'A';
  g.pending = null;
  g.players.A.battlefield = Array.from({ length: 5 }, () => mk('aether_well', 'A'));
  g.players.A.hand = [];
  g.players.B.hand = [];
  g.players.A.graveyard = [];
  return g;
}

describe('zone cues (Rot discards, Grave Call returns)', () => {
  it("Plague Priest's Rot: the card the opponent loses from their hand is cued, with its owner", () => {
    const g = table();
    const priest = mk('plague_priest', 'A');
    g.players.A.hand = [priest];
    g.players.B.hand = [mk('scorch', 'B')];
    const after = applyAction(g, { type: 'castCreature', iid: priest.iid });
    const cues = zoneCues(g, after);
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({ kind: 'discard', ownerId: 'B', card: { def: 'scorch' } });
  });

  it('no cue when the opponent has nothing to discard', () => {
    const g = table();
    const priest = mk('plague_priest', 'A');
    g.players.A.hand = [priest];
    const after = applyAction(g, { type: 'castCreature', iid: priest.iid });
    expect(zoneCues(g, after)).toEqual([]);
  });

  it('a sorcery cast from hand to graveyard is not a discard', () => {
    const g = table();
    const spell = mk('insight', 'A');
    g.players.A.hand = [spell];
    const after = applyAction(g, { type: 'castSorcery', iid: spell.iid });
    expect(zoneCues(g, after)).toEqual([]);
  });

  it('Grave Call: the creature that returns to hand is cued for its owner', () => {
    const g = table();
    const necro = mk('grave_necromancer', 'A');
    g.players.A.hand = [necro];
    g.players.A.graveyard = [mk('ashigaru', 'A')];
    const after = applyAction(g, { type: 'castCreature', iid: necro.iid });
    const cues = zoneCues(g, after);
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({ kind: 'raise', ownerId: 'A', card: { def: 'ashigaru' } });
  });

  it('Grave Call with no fallen creature cues nothing', () => {
    const g = table();
    const necro = mk('grave_necromancer', 'A');
    g.players.A.hand = [necro];
    const after = applyAction(g, { type: 'castCreature', iid: necro.iid });
    expect(zoneCues(g, after)).toEqual([]);
  });
});

describe('waiting out the cut-in', () => {
  it('waits for what is left of the matching cut-in, and not at all when there is none', () => {
    const spots = [{ cutIn: 'rot' as const, ms: 2400, at: 1000 }, { cutIn: 'grave' as const, ms: 2400, at: 0 }];
    expect(cutInRemainingMs(spots, ['rot'], 1800)).toBe(1600);
    expect(cutInRemainingMs(spots, ['rot'], 3500)).toBe(0);
    expect(cutInRemainingMs(spots, ['blitz'], 1800)).toBe(0);
    expect(cutInRemainingMs([], ['rot'], 1800)).toBe(0);
  });
});
