import { describe, expect, it } from 'vitest';
import { cuesFor } from '../cues';
import { createInitialState } from '../../engine/state';
import { applyAction } from '../../engine/reducer';
import { DECK_EMBERWOOD, DECK_SKYWARD } from '../../cards/decks';
import type { Action, CardInstance, GameState } from '../../engine/types';

let n = 0;
const inst = (def: string, over: Partial<CardInstance> = {}): CardInstance => ({
  iid: `s${n++}`, def, owner: 'A', tapped: false, summoningSick: false,
  damage: 0, buffP: 0, buffT: 0, blitz: false, ...over,
});

const fresh = (): GameState => createInitialState(77, DECK_EMBERWOOD, DECK_SKYWARD);

/** Apply for real, then ask what it should have sounded like. */
function cuesOf(g: GameState, a: Action, me: 'A' | 'B' = 'A') {
  return cuesFor(a, g, applyAction(g, a), me);
}

describe('sound cues', () => {
  it('maps the basic plays', () => {
    const g = fresh();
    const land = g.players.A.hand.find((c) => c.def === 'aether_well')!;
    expect(cuesOf(g, { type: 'playLand', iid: land.iid })).toEqual(['land']);
  });

  it('picks the sound from a spell’s EFFECT, not its card type', () => {
    const g = fresh();
    g.players.A.battlefield = [inst('aether_well'), inst('aether_well'), inst('aether_well')];
    g.players.A.hand = [inst('cinderbolt'), inst('soothe'), inst('insight')];
    const [burnC, healC, drawC] = g.players.A.hand;

    expect(cuesOf(g, { type: 'castSorcery', iid: burnC.iid, target: { kind: 'player', player: 'B' } }))
      .toContain('burn');
    expect(cuesOf(g, { type: 'castSorcery', iid: healC.iid })).toEqual(['heal']);
    expect(cuesOf(g, { type: 'castSorcery', iid: drawC.iid })).toEqual(['spell']);
  });

  it('stays silent on a pass, and sounds on a real declaration', () => {
    const g = fresh();
    const atk = inst('dread_maw', { summoningSick: false });
    g.players.A.battlefield = [atk];
    const inCombat = applyAction(g, { type: 'advance' });

    // Declaring no attackers is a pass, not a charge.
    expect(cuesFor({ type: 'declareAttackers', attackers: [] }, inCombat,
      applyAction(inCombat, { type: 'declareAttackers', attackers: [] }), 'A')).toEqual([]);

    expect(cuesOf(inCombat, { type: 'declareAttackers', attackers: [atk.iid] })).toEqual(['attack']);
  });

  it('only marks the handover between turns, not every phase step', () => {
    const g = fresh();
    expect(cuesOf(g, { type: 'advance' })).toEqual([]); // main1 -> combat, same turn

    // Walk to the end step, where advance starts the next turn. Declaring no
    // attackers skips the block step entirely, landing straight on `end`.
    let e = applyAction(g, { type: 'advance' });
    e = applyAction(e, { type: 'declareAttackers', attackers: [] });
    expect(e.phase).toBe('end');
    expect(cuesOf(e, { type: 'advance' })).toEqual(['turn']);
  });

  it('adds a death thud when a creature leaves the battlefield', () => {
    const g = fresh();
    g.players.A.battlefield = [inst('aether_well')];
    g.players.A.hand = [inst('cinderbolt')];
    g.players.B.battlefield = [inst('ember_sprite', { owner: 'B' })]; // 1/1, dies to 3
    const bolt = g.players.A.hand[0];
    const victim = g.players.B.battlefield[0];

    const cues = cuesOf(g, {
      type: 'castSorcery', iid: bolt.iid, target: { kind: 'creature', iid: victim.iid },
    });
    expect(cues).toContain('burn');
    expect(cues).toContain('death');
  });

  it('thuds once however many die at the same moment', () => {
    // Mutual destruction in combat is where multiple creatures really die at
    // once: two 1/1s trade with two 1/1s, so four leave at the same instant.
    const g = fresh();
    const a1 = inst('ember_sprite', { summoningSick: false });
    const a2 = inst('ember_sprite', { summoningSick: false });
    g.players.A.battlefield = [a1, a2];
    g.players.B.battlefield = [
      inst('ember_sprite', { owner: 'B' }),
      inst('ember_sprite', { owner: 'B' }),
    ];
    let c = applyAction(g, { type: 'advance' });
    c = applyAction(c, { type: 'declareAttackers', attackers: [a1.iid, a2.iid] });
    const [b1, b2] = c.players.B.battlefield;

    const blocks: Action = {
      type: 'declareBlockers', blocks: { [b1.iid]: a1.iid, [b2.iid]: a2.iid },
    };
    const after = applyAction(c, blocks);
    expect(after.players.A.battlefield).toHaveLength(0); // all four really died
    expect(after.players.B.battlefield).toHaveLength(0);

    const cues = cuesFor(blocks, c, after, 'A');
    expect(cues).toContain('block');
    expect(cues.filter((x) => x === 'death')).toHaveLength(1);
  });

  it('ends on win or lose depending on who is listening', () => {
    const g = fresh();
    g.players.A.battlefield = [inst('aether_well')];
    g.players.A.hand = [inst('cinderbolt')];
    g.players.B.life = 1;
    const bolt = g.players.A.hand[0];
    const kill: Action = {
      type: 'castSorcery', iid: bolt.iid, target: { kind: 'player', player: 'B' },
    };
    expect(cuesOf(g, kill, 'A')).toContain('win');
    expect(cuesOf(g, kill, 'B')).toContain('lose');
  });
});
