import { describe, it, expect } from 'vitest';
import { createInitialState } from '../state';
import { applyAction } from '../reducer';
import { legalActions } from '../rules';
import type { CardInstance, GameState } from '../types';
import { needsTarget } from '../types';
import { DECK_EMBERWOOD, DECK_SKYWARD } from '../../cards/decks';
import { CARDS } from '../../cards/cards';

// Discard, recall and flashback: cards leaving and re-entering the graveyard.

let n = 0;
const card = (def: string, owner: 'A' | 'B' = 'A'): CardInstance => ({
  iid: `q${n++}`, def, owner, tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false,
});
const lands = (k: number, owner: 'A' | 'B' = 'A') => Array.from({ length: k }, () => card('aether_well', owner));

function base(): GameState {
  const g = createInitialState(21, DECK_EMBERWOOD, DECK_SKYWARD);
  for (const pid of ['A', 'B'] as const) {
    g.players[pid].hand = [];
    g.players[pid].battlefield = [];
    g.players[pid].graveyard = [];
    g.players[pid].life = 20;
  }
  return g;
}
const cast = (g: GameState, c: CardInstance) => applyAction(g, { type: 'castCreature', iid: c.iid });
const names = (cs: CardInstance[]) => cs.map((c) => c.def);

describe('discard (Plague Priest: Rot)', () => {
  function priestGame(handDefs: string[]) {
    const priest = card('plague_priest');
    const g = base();
    g.players.A.battlefield = lands(2);
    g.players.A.hand = [priest];
    g.players.B.hand = handDefs.map((d) => card(d, 'B'));
    return { g, priest };
  }

  it('makes the opponent discard one card at random into their graveyard', () => {
    const { g, priest } = priestGame(['cinderbolt', 'insight', 'scorch', 'topple']);
    const r = cast(g, priest);
    expect(r.players.B.hand).toHaveLength(3);
    expect(r.players.B.graveyard).toHaveLength(1);
    expect(r.players.A.hand).toHaveLength(0); // the caster discards nothing
    expect(r.log.some((l) => /^B discards /.test(l))).toBe(true);
    expect(r.rngState).not.toBe(g.rngState); // it drew from the game's own rng
  });

  it('is deterministic (same state, same discard), and varies with the seed', () => {
    const { g, priest } = priestGame(['cinderbolt', 'insight', 'scorch', 'topple', 'soothe', 'pyroblast']);
    expect(JSON.stringify(cast(g, priest))).toBe(JSON.stringify(cast(g, priest)));
    const picked = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const h = structuredClone(g);
      h.rngState = seed * 7919;
      picked.add(names(cast(h, priest).players.B.graveyard)[0]);
    }
    expect(picked.size).toBeGreaterThan(2); // genuinely random across seeds, not always the first card
  });

  it('does nothing (and does not throw) against an empty hand', () => {
    const { g, priest } = priestGame([]);
    const r = cast(g, priest);
    expect(r.players.B.graveyard).toHaveLength(0);
    expect(r.pending).toBeNull();
  });
});

describe('recall (Grave Necromancer: Grave Call)', () => {
  function necroGame(graveDefs: string[]) {
    const necro = card('grave_necromancer');
    const g = base();
    g.players.A.battlefield = lands(3);
    g.players.A.hand = [necro];
    g.players.A.graveyard = graveDefs.map((d) => card(d));
    return { g, necro };
  }

  it('returns the creature that died most recently, not an older one', () => {
    const { g, necro } = necroGame(['dread_maw', 'stoneback_cub']); // the cub is the later arrival
    const r = cast(g, necro);
    expect(names(r.players.A.hand)).toEqual(['stoneback_cub']);
    expect(names(r.players.A.graveyard)).toEqual(['dread_maw']);
  });

  it('skips spells on top of the graveyard', () => {
    const { g, necro } = necroGame(['dread_maw', 'cinderbolt', 'insight']);
    const r = cast(g, necro);
    expect(names(r.players.A.hand)).toEqual(['dread_maw']);
    expect(names(r.players.A.graveyard)).toEqual(['cinderbolt', 'insight']);
  });

  it('fizzles with no creature to return', () => {
    const { g, necro } = necroGame(['cinderbolt']);
    const r = cast(g, necro);
    expect(r.players.A.hand).toHaveLength(0);
    expect(r.log.some((l) => /no creature to return/.test(l))).toBe(true);
  });
});

describe('flashback (Raise Horde)', () => {
  const horde = () => card('raise_horde');
  const zombies = (g: GameState) => g.players.A.battlefield.filter((c) => c.def === 'zombie_token').length;

  it('can be cast from the graveyard for its flashback cost, then it is exiled', () => {
    const h = horde();
    const g = base();
    g.players.A.battlefield = lands(5);
    g.players.A.graveyard = [h];
    expect(legalActions(g, 'A').some((a) => a.type === 'castSorcery' && a.iid === h.iid)).toBe(true);
    const r = applyAction(g, { type: 'castSorcery', iid: h.iid });
    expect(zombies(r)).toBe(2);
    expect(r.players.A.graveyard).toHaveLength(0);
    expect(names(r.players.A.exile ?? [])).toEqual(['raise_horde']);
    expect(r.players.A.battlefield.filter((c) => c.def === 'aether_well' && c.tapped)).toHaveLength(5); // paid 5, not 3
    expect(r.log.some((l) => /Raise Horde \(flashback\)/.test(l))).toBe(true);
    // gone for good: not castable again
    expect(legalActions(r, 'A').some((a) => a.type === 'castSorcery')).toBe(false);
  });

  it('needs the flashback mana, and only works on the main phase for a sorcery', () => {
    const h = horde();
    const g = base();
    g.players.A.battlefield = lands(4); // 3 is the hand cost, 5 the flashback cost
    g.players.A.graveyard = [h];
    expect(legalActions(g, 'A').some((a) => a.type === 'castSorcery')).toBe(false);
    expect(() => applyAction(g, { type: 'castSorcery', iid: h.iid })).toThrow(/mana/);
    g.players.A.battlefield = lands(5);
    const atk = { ...structuredClone(g), phase: 'combat_attack' as const, combat: { attackers: [], blocks: {} } };
    expect(legalActions(atk, 'A').some((a) => a.type === 'castSorcery')).toBe(false); // a sorcery
  });

  it('is cast from hand first (to the graveyard), and THEN has flashback', () => {
    const h = horde();
    const g = base();
    g.players.A.battlefield = lands(8);
    g.players.A.hand = [h];
    const first = applyAction(g, { type: 'castSorcery', iid: h.iid });
    expect(names(first.players.A.graveyard)).toEqual(['raise_horde']);
    expect(zombies(first)).toBe(2);
    const second = applyAction(first, { type: 'castSorcery', iid: h.iid });
    expect(zombies(second)).toBe(4);
    expect(second.players.A.graveyard).toHaveLength(0);
    expect(names(second.players.A.exile ?? [])).toEqual(['raise_horde']);
  });

  it('a graveyard card without flashback cannot be cast', () => {
    const bolt = card('cinderbolt');
    const g = base();
    g.players.A.battlefield = lands(5);
    g.players.A.graveyard = [bolt];
    expect(() => applyAction(g, { type: 'castSorcery', iid: bolt.iid, target: { kind: 'player', player: 'B' } })).toThrow();
    expect(legalActions(g, 'A').some((a) => a.type === 'castSorcery')).toBe(false);
  });
});

describe('card data for these mechanics', () => {
  it('flashback only appears on untargeted sorceries and instants', () => {
    for (const def of Object.values(CARDS)) {
      if (def.flashback === undefined) continue;
      expect(['sorcery', 'instant'], def.id).toContain(def.type);
      expect(def.effect && needsTarget(def.effect), `${def.id}: a flashback spell cannot need a target`).toBeFalsy();
      expect(def.flashback, def.id).toBeGreaterThan(0);
    }
  });
});
