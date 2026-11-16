import { describe, expect, it } from 'vitest';
import { createInitialState } from '../../engine/state';
import { applyAction } from '../../engine/reducer';
import { canBlock } from '../../engine/rules';
import { DECK_EMBERWOOD, DECK_SKYWARD } from '../../cards/decks';
import { CARDS } from '../../cards/cards';
import type { CardInstance, Keyword } from '../../engine/types';
import { attackTally, blockTally, strikeDamage } from '../combatTally';

let n = 0;
function creature(p: number, t: number, kws: Keyword[] = [], owner: 'A' | 'B' = 'A'): CardInstance {
  const id = `tallytest_${n++}`;
  CARDS[id] = { id, name: id, type: 'creature', cost: 1, power: p, toughness: t, keywords: kws };
  return { iid: `y${n++}`, def: id, owner, tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false };
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

describe('combat damage tally', () => {
  it('an attack tally sums the chosen attackers, counting double strike twice', () => {
    const g = createInitialState(3, DECK_EMBERWOOD, DECK_SKYWARD);
    const a = creature(3, 3);
    const b = creature(2, 2, ['doubleStrike']);
    const c = creature(9, 9);
    g.players.A.battlefield = [a, b, c];
    const t = attackTally(g, [a.iid, b.iid])!;
    expect(t).toMatchObject({ mode: 'attack', total: 7, taking: 7, attackers: 2, life: 20, after: 13, lethal: false });
    expect(attackTally(g, [a.iid, b.iid, c.iid])!.lethal).toBe(false); // 16 of 20
    expect(attackTally(g, [])).toBeNull();
    expect(strikeDamage(b)).toBe(4);
  });

  it('flags lethal', () => {
    const g = createInitialState(3, DECK_EMBERWOOD, DECK_SKYWARD);
    g.players.B.life = 6;
    const a = creature(4, 4);
    const b = creature(2, 2);
    g.players.A.battlefield = [a, b];
    expect(attackTally(g, [a.iid, b.iid])!.lethal).toBe(true);
    expect(attackTally(g, [b.iid])!.lethal).toBe(false);
  });

  // The readout must be what combat really does, or it is worse than no readout.
  it('"you take N" equals the life actually lost, over 1500 random fights (keywords included)', () => {
    const KW: Keyword[] = ['firstStrike', 'doubleStrike', 'trample', 'deathtouch', 'flying', 'reach'];
    const r = rng(77);
    const pick = (max: number) => Math.floor(r() * (max + 1));
    for (let i = 0; i < 1500; i++) {
      const kws = (): Keyword[] => KW.filter(() => r() < 0.25);
      const atks = Array.from({ length: 1 + pick(2) }, () => creature(pick(6), 1 + pick(5), kws()));
      const blks = Array.from({ length: pick(3) }, () => creature(pick(6), 1 + pick(5), kws(), 'B'));
      const s = createInitialState(7, DECK_EMBERWOOD, DECK_SKYWARD);
      s.players.A.life = 40;
      s.players.B.life = 40;
      s.players.A.battlefield = atks;
      s.players.B.battlefield = blks;
      s.phase = 'combat_attack';
      s.combat = { attackers: [], blocks: {} };
      const g = applyAction(s, { type: 'declareAttackers', attackers: atks.map((a) => a.iid) });
      // a random LEGAL 1:1 assignment
      const blocks: Record<string, string> = {};
      const used = new Set<string>();
      for (const atk of atks) {
        if (r() < 0.4) continue;
        const b = blks.find((x) => !used.has(x.iid) && canBlock(x, atk));
        if (b) { blocks[b.iid] = atk.iid; used.add(b.iid); }
      }
      const shown = blockTally(g, blocks)!;
      const after = applyAction(g, { type: 'declareBlockers', blocks });
      const lost = 40 - after.players.B.life;
      expect([i, 'taking', shown.taking]).toEqual([i, 'taking', lost]);
      expect(shown.taking + shown.blocked).toBe(shown.total);
    }
  });

  it('with no blocks planned, everything comes through; each block reduces it', () => {
    const g = createInitialState(3, DECK_EMBERWOOD, DECK_SKYWARD);
    const a = creature(5, 5);
    const b = creature(3, 3);
    const wall = creature(1, 6, [], 'B');
    g.players.A.battlefield = [a, b];
    g.players.B.battlefield = [wall];
    g.phase = 'combat_block';
    g.combat = { attackers: [a.iid, b.iid], blocks: {} };
    expect(blockTally(g, {})).toMatchObject({ total: 8, taking: 8, blocked: 0, after: 12 });
    expect(blockTally(g, { [wall.iid]: a.iid })).toMatchObject({ total: 8, taking: 3, blocked: 5, after: 17 });
  });
});
