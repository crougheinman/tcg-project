import { describe, it, expect } from 'vitest';
import { createInitialState } from '../state';
import { applyAction } from '../reducer';
import { power } from '../rules';
import type { CardInstance, GameState } from '../types';
import { DECK_EMBERWOOD, DECK_SKYWARD } from '../../cards/decks';

// The real Windrush, War Drums and Grave Toll cards, cast through applyAction.

let n = 0;
const inst = (def: string, owner: 'A' | 'B' = 'A'): CardInstance => ({
  iid: `ns${n++}_${def}`, def, owner, tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false,
});
function base(): GameState {
  const g = createInitialState(5, DECK_EMBERWOOD, DECK_SKYWARD);
  g.phase = 'main1';
  g.active = 'A';
  for (const p of ['A', 'B'] as const) {
    g.players[p].battlefield = [];
    g.players[p].hand = [];
    g.players[p].graveyard = [];
  }
  g.players.A.battlefield = Array.from({ length: 4 }, () => inst('aether_well'));
  return g;
}

describe('Windrush, War Drums, Grave Toll', () => {
  it('Windrush returns the target creature to its owner\'s hand', () => {
    const g = base();
    const foe = inst('stoneback_cub', 'B');
    const sp = inst('windrush');
    g.players.B.battlefield = [foe];
    g.players.A.hand = [sp];
    const r = applyAction(g, { type: 'castSorcery', iid: sp.iid, target: { kind: 'creature', iid: foe.iid } });
    expect(r.players.B.battlefield).toHaveLength(0);
    expect(r.players.B.hand.map((c) => c.iid)).toContain(foe.iid);
  });

  it('War Drums gives your creatures +1/+0 this turn, and not theirs', () => {
    const g = base();
    const mine = inst('ashigaru');
    const theirs = inst('ashigaru', 'B');
    const sp = inst('war_drums');
    g.players.A.battlefield.push(mine);
    g.players.B.battlefield = [theirs];
    g.players.A.hand = [sp];
    const r = applyAction(g, { type: 'castSorcery', iid: sp.iid });
    const m = r.players.A.battlefield.find((c) => c.iid === mine.iid)!;
    const t = r.players.B.battlefield.find((c) => c.iid === theirs.iid)!;
    expect(power(m)).toBe(power(t) + 1);
  });

  it('Grave Toll makes a lone creature die at once, and a choice of two wait for the victim', () => {
    const g = base();
    const sp = inst('grave_toll');
    g.players.A.hand = [sp];
    g.players.B.battlefield = [inst('stoneback_cub', 'B')];
    const one = applyAction(g, { type: 'castSorcery', iid: sp.iid });
    expect(one.players.B.battlefield).toHaveLength(0);

    const g2 = base();
    const sp2 = inst('grave_toll');
    g2.players.A.hand = [sp2];
    g2.players.B.battlefield = [inst('stoneback_cub', 'B'), inst('sky_talon', 'B')];
    const two = applyAction(g2, { type: 'castSorcery', iid: sp2.iid });
    expect(two.pending?.kind).toBe('sacrifice');
    expect(two.players.B.battlefield).toHaveLength(2);
  });
});
