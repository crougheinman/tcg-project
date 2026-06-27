import { describe, it, expect } from 'vitest';
import { createInitialState } from '../state';
import { applyAction } from '../reducer';
import { isLand } from '../rules';
import type { Action, CardInstance, GameState } from '../types';
import { DECK_EMBERWOOD, DECK_SKYWARD } from '../../cards/decks';

let counter = 0;
function inst(def: string, over: Partial<CardInstance> = {}): CardInstance {
  return {
    iid: `t${counter++}`,
    def,
    owner: 'A',
    tapped: false,
    summoningSick: false,
    damage: 0,
    buffP: 0,
    buffT: 0,
    ...over,
  };
}

function fresh(): GameState {
  return createInitialState(123, DECK_EMBERWOOD, DECK_SKYWARD);
}

describe('initial state', () => {
  it('A is on the play, 7-card hands, 20 life', () => {
    const s = fresh();
    expect(s.active).toBe('A');
    expect(s.phase).toBe('main1');
    expect(s.players.A.hand).toHaveLength(7);
    expect(s.players.B.hand).toHaveLength(7);
    expect(s.players.A.life).toBe(20);
  });

  it('is deterministic for a given seed', () => {
    const a = createInitialState(99, DECK_EMBERWOOD, DECK_SKYWARD);
    const b = createInitialState(99, DECK_EMBERWOOD, DECK_SKYWARD);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('lands and mana', () => {
  it('plays one land per turn, second throws', () => {
    const s = fresh();
    s.players.A.hand = [inst('aether_well'), inst('aether_well')];
    const a1 = applyAction(s, { type: 'playLand', iid: s.players.A.hand[0].iid });
    expect(a1.players.A.battlefield.filter(isLand)).toHaveLength(1);
    expect(a1.players.A.landPlayedThisTurn).toBe(true);
    expect(() =>
      applyAction(a1, { type: 'playLand', iid: a1.players.A.hand[0].iid }),
    ).toThrow();
  });

  it('casting a creature taps lands and applies summoning sickness', () => {
    const s = fresh();
    s.players.A.battlefield = [inst('aether_well'), inst('aether_well')];
    s.players.A.hand = [inst('stoneback_cub')]; // cost 2, 2/2, no haste
    const s2 = applyAction(s, { type: 'castCreature', iid: s.players.A.hand[0].iid });
    expect(s2.players.A.battlefield.filter(isLand).every((l) => l.tapped)).toBe(true);
    const cub = s2.players.A.battlefield.find((c) => c.def === 'stoneback_cub')!;
    expect(cub.summoningSick).toBe(true);
  });

  it('casting without mana throws', () => {
    const s = fresh();
    s.players.A.battlefield = [];
    s.players.A.hand = [inst('stoneback_cub')];
    expect(() =>
      applyAction(s, { type: 'castCreature', iid: s.players.A.hand[0].iid }),
    ).toThrow();
  });

  it('haste creature is not summoning sick', () => {
    const s = fresh();
    s.players.A.battlefield = [inst('aether_well')];
    s.players.A.hand = [inst('ember_sprite')]; // cost 1, haste
    const s2 = applyAction(s, { type: 'castCreature', iid: s.players.A.hand[0].iid });
    const sprite = s2.players.A.battlefield.find((c) => c.def === 'ember_sprite')!;
    expect(sprite.summoningSick).toBe(false);
  });
});

describe('combat', () => {
  function attackWith(s: GameState, attackerIids: string[]): GameState {
    let g = applyAction(s, { type: 'advance' }); // main1 -> combat_attack
    g = applyAction(g, { type: 'declareAttackers', attackers: attackerIids });
    return g;
  }

  it('unblocked attacker deals damage to face', () => {
    const s = fresh();
    const cub = inst('stoneback_cub', { summoningSick: false });
    s.players.A.battlefield = [cub];
    let g = attackWith(s, [cub.iid]); // -> combat_block
    g = applyAction(g, { type: 'declareBlockers', blocks: {} });
    expect(g.players.B.life).toBe(18);
    expect(g.phase).toBe('end');
  });

  it('blocking trades damage; lethal creature dies', () => {
    const s = fresh();
    const attacker = inst('thornwood_brute', { summoningSick: false }); // 3/3
    const blocker = inst('stoneback_cub', { owner: 'B' }); // 2/2
    s.players.A.battlefield = [attacker];
    s.players.B.battlefield = [blocker];
    let g = attackWith(s, [attacker.iid]);
    g = applyAction(g, { type: 'declareBlockers', blocks: { [blocker.iid]: attacker.iid } });
    // blocker (2/2) takes 3 -> dies; attacker (3/3) takes 2 -> lives
    expect(g.players.B.battlefield.find((c) => c.iid === blocker.iid)).toBeUndefined();
    expect(g.players.A.battlefield.find((c) => c.iid === attacker.iid)).toBeDefined();
    expect(g.players.B.life).toBe(20); // attack was blocked
  });

  it('only a flyer can block a flyer', () => {
    const s = fresh();
    const flyer = inst('sky_talon', { summoningSick: false }); // 2/2 flying
    const ground = inst('stoneback_cub', { owner: 'B' });
    s.players.A.battlefield = [flyer];
    s.players.B.battlefield = [ground];
    const g = attackWith(s, [flyer.iid]);
    expect(() =>
      applyAction(g, { type: 'declareBlockers', blocks: { [ground.iid]: flyer.iid } }),
    ).toThrow();
  });

  it('summoning-sick creature cannot attack', () => {
    const s = fresh();
    const cub = inst('stoneback_cub', { summoningSick: true });
    s.players.A.battlefield = [cub];
    const g = applyAction(s, { type: 'advance' });
    expect(() =>
      applyAction(g, { type: 'declareAttackers', attackers: [cub.iid] }),
    ).toThrow();
  });
});

describe('spells and win conditions', () => {
  it('cinderbolt kills a creature', () => {
    const s = fresh();
    s.players.A.battlefield = [inst('aether_well')];
    s.players.A.hand = [inst('cinderbolt')];
    const victim = inst('stoneback_cub', { owner: 'B' });
    s.players.B.battlefield = [victim];
    const g = applyAction(s, {
      type: 'castSorcery',
      iid: s.players.A.hand[0].iid,
      target: { kind: 'creature', iid: victim.iid },
    });
    expect(g.players.B.battlefield).toHaveLength(0);
    expect(g.players.B.graveyard.some((c) => c.def === 'stoneback_cub')).toBe(true);
  });

  it('burning a player to 0 wins the game', () => {
    const s = fresh();
    s.players.A.battlefield = [inst('aether_well'), inst('aether_well'), inst('aether_well')];
    s.players.A.hand = [inst('scorch')]; // 5 dmg, cost 3
    s.players.B.life = 4;
    const g = applyAction(s, {
      type: 'castSorcery',
      iid: s.players.A.hand[0].iid,
      target: { kind: 'player', player: 'B' },
    });
    expect(g.players.B.life).toBe(-1);
    expect(g.winner).toBe('A');
  });

  it('wild growth buffs a creature', () => {
    const s = fresh();
    s.players.A.battlefield = [inst('aether_well')];
    const cub = inst('stoneback_cub');
    s.players.A.battlefield.push(cub);
    s.players.A.hand = [inst('wild_growth')];
    const g = applyAction(s, {
      type: 'castSorcery',
      iid: s.players.A.hand[0].iid,
      target: { kind: 'creature', iid: cub.iid },
    });
    const buffed = g.players.A.battlefield.find((c) => c.iid === cub.iid)!;
    expect(buffed.buffP).toBe(2);
    expect(buffed.buffT).toBe(2);
  });
});

describe('determinism / replay', () => {
  it('same seed + same actions => identical state', () => {
    const script: Action[] = [];
    // 6 turns of just passing (advance: main1->combat, combat->end, end->next turn)
    for (let i = 0; i < 18; i++) script.push({ type: 'advance' });

    function run(): GameState {
      let g = createInitialState(2026, DECK_EMBERWOOD, DECK_SKYWARD);
      for (const a of script) g = applyAction(g, a);
      return g;
    }
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
