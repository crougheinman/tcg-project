import { describe, it, expect } from 'vitest';
import { createInitialState, MAX_DECK_SIZE } from '../state';
import { applyAction } from '../reducer';
import { isLand, isCreature, canAttack, availableMana, power, toughness } from '../rules';
import type { Action, CardInstance, GameState } from '../types';
import { DECK_EMBERWOOD, DECK_SKYWARD, DECK_LIST, DECK_IRONBLOSSOM, DECK_GRAVETIDE } from '../../cards/decks';
import { getDef } from '../../cards/cards';

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
    blitz: false,
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

describe('Beast Blitz aura (Kunoichi)', () => {
  it('summoning Kunoichi gives allied targets +1/+1, not others or enemies', () => {
    const s = fresh();
    const myCub = inst('stoneback_cub');
    const myBrute = inst('thornwood_brute'); // not a target
    const enemyCub = inst('stoneback_cub', { owner: 'B' });
    s.players.A.battlefield = [inst('aether_well'), inst('aether_well'), myCub, myBrute];
    s.players.B.battlefield = [enemyCub];
    s.players.A.hand = [inst('kunoichi')];

    const g = applyAction(s, { type: 'castCreature', iid: s.players.A.hand[0].iid });
    const cub = g.players.A.battlefield.find((c) => c.iid === myCub.iid)!;
    expect([power(cub), toughness(cub)]).toEqual([3, 3]);
    expect(cub.blitz).toBe(true);
    const brute = g.players.A.battlefield.find((c) => c.iid === myBrute.iid)!;
    expect([power(brute), toughness(brute)]).toEqual([3, 3]); // unaffected
    const eCub = g.players.B.battlefield.find((c) => c.iid === enemyCub.iid)!;
    expect([power(eCub), toughness(eCub)]).toEqual([2, 2]); // enemy unaffected
  });

  it('a target entering after Kunoichi also gets the buff', () => {
    const s = fresh();
    s.players.A.battlefield = [inst('aether_well'), inst('aether_well'), inst('kunoichi')];
    const lancer = inst('swift_lancer');
    s.players.A.battlefield.push(lancer); // added while Kunoichi present
    const g = applyAction(s, { type: 'advance' }); // any action triggers recompute
    const l = g.players.A.battlefield.find((c) => c.iid === lancer.iid)!;
    expect([power(l), toughness(l)]).toEqual([3, 2]); // base 2/1 +1/+1
  });

  it('removing Kunoichi deactivates the buff', () => {
    const s = fresh();
    const cub = inst('stoneback_cub');
    const k = inst('kunoichi');
    s.players.A.battlefield = [inst('aether_well'), cub, k];
    s.players.A.hand = [inst('aether_well'), inst('cinderbolt')];
    let g = applyAction(s, { type: 'playLand', iid: s.players.A.hand[0].iid }); // aura on
    expect(toughness(g.players.A.battlefield.find((c) => c.iid === cub.iid)!)).toBe(3);
    const bolt = g.players.A.hand.find((c) => c.def === 'cinderbolt')!;
    g = applyAction(g, { type: 'castSorcery', iid: bolt.iid, target: { kind: 'creature', iid: k.iid } });
    expect(g.players.A.battlefield.some((c) => c.iid === k.iid)).toBe(false); // Kunoichi dead
    const c2 = g.players.A.battlefield.find((c) => c.iid === cub.iid)!;
    expect([power(c2), toughness(c2)]).toEqual([2, 2]);
    expect(c2.blitz).toBe(false);
  });

  it('Wild Growth buff survives after Beast Blitz ends', () => {
    const s = fresh();
    const cub = inst('stoneback_cub', { buffP: 2, buffT: 2 }); // already pumped to 4/4
    const k = inst('kunoichi');
    s.players.A.battlefield = [inst('aether_well'), cub, k];
    s.players.A.hand = [inst('aether_well'), inst('cinderbolt')];
    let g = applyAction(s, { type: 'playLand', iid: s.players.A.hand[0].iid }); // aura on -> 5/5
    expect(toughness(g.players.A.battlefield.find((c) => c.iid === cub.iid)!)).toBe(5);
    const bolt = g.players.A.hand.find((c) => c.def === 'cinderbolt')!;
    g = applyAction(g, { type: 'castSorcery', iid: bolt.iid, target: { kind: 'creature', iid: k.iid } });
    const c2 = g.players.A.battlefield.find((c) => c.iid === cub.iid)!;
    expect([power(c2), toughness(c2)]).toEqual([4, 4]); // Wild Growth kept, aura removed
  });
});

describe('Whipflash (Thornwood Brute ETB)', () => {
  function withLands() {
    const s = fresh();
    s.players.A.battlefield = [inst('aether_well'), inst('aether_well'), inst('aether_well')];
    s.players.A.hand = [inst('thornwood_brute')];
    return s;
  }

  it('summoning sets a pending trigger; resolving deals 1 damage', () => {
    const s = withLands();
    const enemy = inst('ember_sprite', { owner: 'B' }); // 1/1
    s.players.B.battlefield = [enemy];
    const g = applyAction(s, { type: 'castCreature', iid: s.players.A.hand[0].iid });
    expect(g.pending?.kind).toBe('whipflash');
    const g2 = applyAction(g, { type: 'whipflash', target: enemy.iid });
    expect(g2.pending).toBeNull();
    expect(g2.players.B.battlefield.find((c) => c.iid === enemy.iid)).toBeUndefined(); // 1/1 died
  });

  it('fizzles with no other creature on the board', () => {
    const s = withLands(); // B empty; only Thornwood will be on field
    const g = applyAction(s, { type: 'castCreature', iid: s.players.A.hand[0].iid });
    expect(g.pending).toBeNull();
    expect(g.log.some((l) => l.includes('fizzles'))).toBe(true);
  });

  it('blocks other actions until resolved', () => {
    const s = withLands();
    s.players.B.battlefield = [inst('stoneback_cub', { owner: 'B' })];
    const g = applyAction(s, { type: 'castCreature', iid: s.players.A.hand[0].iid });
    expect(g.pending?.kind).toBe('whipflash');
    expect(() => applyAction(g, { type: 'advance' })).toThrow();
    expect(() => applyAction(g, { type: 'whipflash', target: g.pending!.source })).toThrow(); // not self
  });
});

describe('new mechanics (heal / ramp / token / defender / spell-trigger)', () => {
  it('Soothe gains 6 life', () => {
    const s = fresh();
    s.players.A.battlefield = [inst('aether_well'), inst('aether_well')];
    s.players.A.hand = [inst('soothe')];
    s.players.A.life = 14;
    const g = applyAction(s, { type: 'castSorcery', iid: s.players.A.hand[0].iid });
    expect(g.players.A.life).toBe(20);
  });

  it('Overgrowth ramps up to two lands from hand onto the battlefield', () => {
    const s = fresh();
    s.players.A.battlefield = [inst('aether_well'), inst('aether_well')]; // pay cost 2
    const l1 = inst('aether_well');
    const l2 = inst('aether_well');
    s.players.A.hand = [inst('overgrowth'), l1, l2];
    const g = applyAction(s, { type: 'castSorcery', iid: s.players.A.hand[0].iid });
    expect(g.players.A.battlefield.filter(isLand)).toHaveLength(4); // 2 + 2 ramped
    expect(availableMana(g.players.A)).toBe(2); // the 2 ramped lands are untapped
    expect(g.players.A.hand.filter(isLand)).toHaveLength(0);
  });

  it('Call Wolves creates two 1/1 Wolf tokens', () => {
    const s = fresh();
    s.players.A.battlefield = [inst('aether_well'), inst('aether_well')];
    s.players.A.hand = [inst('call_wolves')];
    const g = applyAction(s, { type: 'castSorcery', iid: s.players.A.hand[0].iid });
    const wolves = g.players.A.battlefield.filter((c) => c.def === 'wolf_token');
    expect(wolves).toHaveLength(2);
    expect(wolves.every((w) => w.summoningSick && power(w) === 1 && toughness(w) === 1)).toBe(true);
  });

  it('Defender cannot attack', () => {
    const s = fresh();
    const wall = inst('bulwark', { summoningSick: false });
    s.players.A.battlefield = [wall];
    expect(canAttack(wall)).toBe(false);
    const g = applyAction(s, { type: 'advance' }); // -> combat_attack
    expect(() => applyAction(g, { type: 'declareAttackers', attackers: [wall.iid] })).toThrow();
  });

  it('Pyre Adept deals 1 to the opponent on each sorcery cast', () => {
    const s = fresh();
    s.players.A.battlefield = [inst('aether_well'), inst('pyre_adept')];
    s.players.A.hand = [inst('cinderbolt')];
    s.players.B.life = 20;
    const g = applyAction(s, {
      type: 'castSorcery',
      iid: s.players.A.hand[0].iid,
      target: { kind: 'player', player: 'B' },
    });
    expect(g.players.B.life).toBe(16); // 3 (Cinderbolt) + 1 (Pyre Adept trigger)
  });

  it('Topple taps opponent creatures with toughness <= 2, leaves bigger ones', () => {
    const s = fresh();
    s.players.A.battlefield = [inst('aether_well'), inst('aether_well')];
    s.players.A.hand = [inst('topple')];
    const small = inst('ember_sprite', { owner: 'B' }); // 1/1
    const cub = inst('stoneback_cub', { owner: 'B' }); // 2/2
    const big = inst('granite_sentinel', { owner: 'B' }); // 3/5
    s.players.B.battlefield = [small, cub, big];
    const g = applyAction(s, { type: 'castSorcery', iid: s.players.A.hand[0].iid });
    const bf = g.players.B.battlefield;
    expect(bf.find((c) => c.iid === small.iid)!.tapped).toBe(true);
    expect(bf.find((c) => c.iid === cub.iid)!.tapped).toBe(true);
    expect(bf.find((c) => c.iid === big.iid)!.tapped).toBe(false); // toughness 5 > 2
  });

  it('Take Counter is block-only: throws if cast in your main phase', () => {
    const s = fresh();
    s.players.A.battlefield = [inst('aether_well'), inst('aether_well')];
    s.players.A.hand = [inst('take_counter')];
    const tappedFoe = inst('stoneback_cub', { owner: 'B', tapped: true });
    s.players.B.battlefield = [tappedFoe];
    expect(() =>
      applyAction(s, {
        type: 'castSorcery',
        iid: s.players.A.hand[0].iid,
        target: { kind: 'creature', iid: tappedFoe.iid },
      }),
    ).toThrow();
  });

  it('Take Counter during combat_block destroys a tapped attacker but rejects an untapped creature', () => {
    const s = fresh();
    const attacker = inst('dread_maw', { summoningSick: false }); // A's — will attack, becomes tapped
    const untappedFoe = inst('stoneback_cub', { owner: 'B' }); // B's own, untapped
    s.players.A.battlefield = [attacker];
    s.players.B.battlefield = [
      inst('aether_well', { owner: 'B' }),
      inst('aether_well', { owner: 'B' }),
      untappedFoe,
    ];
    s.players.B.hand = [inst('take_counter', { owner: 'B' })];
    let g = applyAction(s, { type: 'advance' }); // -> combat_attack
    g = applyAction(g, { type: 'declareAttackers', attackers: [attacker.iid] }); // -> combat_block
    const tc = g.players.B.hand.find((c) => c.def === 'take_counter')!;
    // untapped target -> rejected (destroy needs a tapped creature)
    expect(() =>
      applyAction(g, { type: 'castSorcery', iid: tc.iid, target: { kind: 'creature', iid: untappedFoe.iid } }),
    ).toThrow();
    // tapped attacker -> destroyed
    const g2 = applyAction(g, {
      type: 'castSorcery',
      iid: tc.iid,
      target: { kind: 'creature', iid: attacker.iid },
    });
    expect(g2.players.A.battlefield.some((c) => c.iid === attacker.iid)).toBe(false);
    expect(g2.players.A.graveyard.some((c) => c.def === 'dread_maw')).toBe(true);
  });

  it('token / heal / ramp are valid without a target', () => {
    const s = fresh();
    s.players.A.battlefield = [inst('aether_well'), inst('aether_well')];
    s.players.A.hand = [inst('soothe')];
    // no target supplied -> must not throw
    expect(() => applyAction(s, { type: 'castSorcery', iid: s.players.A.hand[0].iid })).not.toThrow();
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

describe('instants (flexible-timing spells)', () => {
  // Give B two untapped lands + an instant in hand, then have A attack.
  function combatWithBInstant(instantDef: string): GameState {
    const s = fresh();
    const attacker = inst('dread_maw', { summoningSick: false }); // 5/4
    s.players.A.battlefield = [attacker];
    s.players.B.battlefield = [inst('aether_well', { owner: 'B' }), inst('aether_well', { owner: 'B' })];
    s.players.B.hand = [inst(instantDef, { owner: 'B' })];
    let g = applyAction(s, { type: 'advance' }); // main1 -> combat_attack
    g = applyAction(g, { type: 'declareAttackers', attackers: [attacker.iid] }); // -> combat_block
    return g;
  }

  it('defender casts Take Counter during combat_block to kill a tapped attacker (no face damage)', () => {
    let g = combatWithBInstant('take_counter');
    expect(g.phase).toBe('combat_block');
    const attackerIid = g.combat!.attackers[0];
    const tc = g.players.B.hand.find((c) => c.def === 'take_counter')!;
    g = applyAction(g, { type: 'castSorcery', iid: tc.iid, target: { kind: 'creature', iid: attackerIid } });
    expect(g.players.A.battlefield.some((c) => c.iid === attackerIid)).toBe(false); // destroyed
    expect(g.players.A.graveyard.some((c) => c.def === 'dread_maw')).toBe(true);
    g = applyAction(g, { type: 'declareBlockers', blocks: {} }); // resolve — dead attacker deals nothing
    expect(g.players.B.life).toBe(20);
  });

  it('defender casts Soothe during combat_block to gain life off-turn', () => {
    let g = combatWithBInstant('soothe');
    g.players.B.life = 14;
    const so = g.players.B.hand.find((c) => c.def === 'soothe')!;
    g = applyAction(g, { type: 'castSorcery', iid: so.iid });
    expect(g.players.B.life).toBe(20); // 14 + 6
    expect(g.phase).toBe('combat_block'); // still choosing blocks
  });

  it('the active player can cast an instant during combat_attack', () => {
    const s = fresh();
    s.players.A.battlefield = [inst('aether_well'), inst('aether_well')];
    s.players.A.hand = [inst('soothe')];
    s.players.A.life = 10;
    const g = applyAction(s, { type: 'advance' }); // -> combat_attack
    const g2 = applyAction(g, { type: 'castSorcery', iid: g.players.A.hand[0].iid });
    expect(g2.players.A.life).toBe(16);
    expect(g2.phase).toBe('combat_attack');
  });

  it('a sorcery still cannot be cast outside your main phase', () => {
    const s = fresh();
    s.players.A.battlefield = [inst('aether_well'), inst('aether_well')];
    s.players.A.hand = [inst('insight')]; // sorcery
    const g = applyAction(s, { type: 'advance' }); // -> combat_attack
    expect(() => applyAction(g, { type: 'castSorcery', iid: g.players.A.hand[0].iid })).toThrow();
  });
});

describe('deck size limit', () => {
  it('rejects a deck larger than MAX_DECK_SIZE', () => {
    const tooBig = Array.from({ length: MAX_DECK_SIZE + 1 }, () => 'aether_well');
    expect(() => createInitialState(1, tooBig, DECK_SKYWARD)).toThrow();
  });
  it('every starter deck is within the limit', () => {
    for (const d of DECK_LIST) expect(d.cards.length).toBeLessThanOrEqual(MAX_DECK_SIZE);
  });
});

describe('new decks (Iron Blossom / Grave Tide)', () => {
  it('every deck lists only known cards and boots without throwing', () => {
    for (const d of DECK_LIST) {
      for (const id of d.cards) expect(() => getDef(id)).not.toThrow();
      expect(() => createInitialState(7, d.cards, d.cards)).not.toThrow();
    }
  });

  it('both new decks are present and exactly 30 cards', () => {
    expect(DECK_IRONBLOSSOM).toHaveLength(30);
    expect(DECK_GRAVETIDE).toHaveLength(30);
    expect(DECK_LIST.map((d) => d.id)).toEqual(
      expect.arrayContaining(['ironblossom', 'gravetide']),
    );
  });

  it('Grave Necromancer raises an extra Zombie whenever you cast a sorcery', () => {
    const s = fresh();
    s.players.A.battlefield = [
      inst('aether_well'),
      inst('aether_well'),
      inst('aether_well'),
      inst('grave_necromancer'),
    ];
    s.players.A.hand = [inst('raise_horde')]; // sorcery, cost 3
    const g = applyAction(s, { type: 'castSorcery', iid: s.players.A.hand[0].iid });
    const zombies = g.players.A.battlefield.filter((c) => c.def === 'zombie_token');
    expect(zombies).toHaveLength(3); // 2 from the spell + 1 from the trigger
  });

  it('Grave Necromancer also raises a Zombie when you cast an instant', () => {
    const s = fresh();
    s.players.A.battlefield = [inst('aether_well'), inst('aether_well'), inst('grave_necromancer')];
    s.players.A.hand = [inst('withering_touch')]; // instant, cost 2, damage 3
    const g = applyAction(s, {
      type: 'castSorcery',
      iid: s.players.A.hand[0].iid,
      target: { kind: 'player', player: 'B' },
    });
    const zombies = g.players.A.battlefield.filter((c) => c.def === 'zombie_token');
    expect(zombies).toHaveLength(1); // the instant fired the trigger
  });

  it('Plague Priest still does NOT trigger on an instant cast', () => {
    const s = fresh();
    s.players.A.battlefield = [inst('aether_well'), inst('aether_well'), inst('plague_priest')];
    s.players.A.hand = [inst('soothe')]; // instant (heal), not a sorcery
    s.players.B.life = 20;
    const g = applyAction(s, { type: 'castSorcery', iid: s.players.A.hand[0].iid });
    expect(g.players.B.life).toBe(20); // Plague Priest only fires on sorceries
  });

  it('Plague Priest drains 1 life on a (non-damage) sorcery cast', () => {
    const s = fresh();
    s.players.A.battlefield = [inst('aether_well'), inst('aether_well'), inst('plague_priest')];
    s.players.A.hand = [inst('insight')]; // sorcery, no face damage of its own
    s.players.B.life = 20;
    const g = applyAction(s, { type: 'castSorcery', iid: s.players.A.hand[0].iid });
    expect(g.players.B.life).toBe(19); // only the Plague Priest trigger
  });

  it('Iaijutsu Strike is an instant: buffs +2/+1 at instant speed (combat_attack)', () => {
    const s = fresh();
    s.players.A.battlefield = [inst('aether_well'), inst('kensei_duelist', { summoningSick: false })];
    s.players.A.hand = [inst('iaijutsu_strike')]; // instant, cost 1
    const g = applyAction(s, { type: 'advance' }); // -> combat_attack
    const target = g.players.A.battlefield.find((c) => c.def === 'kensei_duelist')!;
    const g2 = applyAction(g, {
      type: 'castSorcery',
      iid: g.players.A.hand[0].iid,
      target: { kind: 'creature', iid: target.iid },
    });
    const buffed = g2.players.A.battlefield.find((c) => c.def === 'kensei_duelist')!;
    expect(power(buffed)).toBe(5); // 3 + 2
    expect(toughness(buffed)).toBe(3); // 2 + 1
    expect(g2.phase).toBe('combat_attack'); // instant doesn't advance the phase
  });

  it('Grasp from the Grave is block-only: throws if cast in your main phase', () => {
    const s = fresh();
    s.players.A.battlefield = [inst('aether_well'), inst('aether_well')];
    s.players.A.hand = [inst('grasp_from_grave')];
    const tappedFoe = inst('stoneback_cub', { owner: 'B', tapped: true });
    s.players.B.battlefield = [tappedFoe];
    expect(() =>
      applyAction(s, {
        type: 'castSorcery',
        iid: s.players.A.hand[0].iid,
        target: { kind: 'creature', iid: tappedFoe.iid },
      }),
    ).toThrow();
  });
});
