import { describe, it, expect } from 'vitest';
import { createInitialState } from '../state';
import { applyAction } from '../reducer';
import type { CardDef, CardInstance, GameState } from '../types';
import { DECK_EMBERWOOD, DECK_SKYWARD } from '../../cards/decks';
import { CARDS } from '../../cards/cards';
import { actorOf, availableMana, legalActions } from '../rules';
import { pickAction } from '../../ai/ai';

// Phase 4h: Ninjutsu, on throwaway cards.

let n = 0;
const inst = (def: string, owner: 'A' | 'B' = 'A', over: Partial<CardInstance> = {}): CardInstance => ({
  iid: `n${n++}_${def}`, def, owner, tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false, ...over,
});
function creature(p: number, t: number, extra: Partial<CardDef> = {}) {
  const id = `nj_${n++}`;
  CARDS[id] = { id, name: `N${p}/${t}`, type: 'creature', cost: 2, power: p, toughness: t, ...extra };
  return (owner: 'A' | 'B' = 'A', over: Partial<CardInstance> = {}) => inst(id, owner, over);
}
const lands = (k: number) => Array.from({ length: k }, () => inst('aether_well'));
function base(): GameState {
  const g = createInitialState(11, DECK_EMBERWOOD, DECK_SKYWARD);
  g.phase = 'main1';
  g.active = 'A';
  for (const p of ['A', 'B'] as const) { g.players[p].life = 20; g.players[p].battlefield = []; g.players[p].hand = []; g.players[p].graveyard = []; }
  return g;
}
/** A attacks with `atk`, B blocks as `blocks` says; returns the state right after the blocks are declared. */
function toBlocks(g: GameState, atk: CardInstance[], blocks: Record<string, string> = {}): GameState {
  let a = applyAction(g, { type: 'advance' });
  a = applyAction(a, { type: 'declareAttackers', attackers: atk.map((c) => c.iid) });
  return applyAction(a, { type: 'declareBlockers', blocks });
}
const onBf = (g: GameState, iid: string) => g.players.A.battlefield.find((c) => c.iid === iid);

describe('the ninjutsu window', () => {
  it('opens after blocks when a ninja in hand can be paid for and an attacker is unblocked, and combat waits for the attacker', () => {
    const g = base();
    const atk = creature(1, 1)('A'), ninja = creature(4, 2, { ninjutsu: 1 })('A');
    g.players.A.battlefield = [atk, ...lands(2)];
    g.players.A.hand = [ninja];
    const a = toBlocks(g, [atk]);
    expect(a.pending?.kind).toBe('ninjutsu');
    expect(actorOf(a)).toBe('A');
    expect(a.players.B.life).toBe(20); // damage has not happened yet
    expect(legalActions(a, 'B')).toEqual([]);
    expect(legalActions(a, 'A')).toEqual([{ type: 'ninjutsu', ninja: ninja.iid, attacker: atk.iid }, { type: 'skipNinjutsu' }]);
    expect(() => applyAction(a, { type: 'advance' })).toThrow(/pending/);
    expect(() => applyAction(a, { type: 'resolveTrigger', target: atk.iid })).toThrow(/ninjutsu/i);
  });
  it('does not open (so combat resolves at once, as it always did) without a ninja, mana, or an unblocked attacker', () => {
    const noNinja = base();
    const atk = creature(1, 1)('A');
    noNinja.players.A.battlefield = [atk, ...lands(2)];
    noNinja.players.A.hand = [creature(4, 2)('A')];
    expect(toBlocks(noNinja, [atk]).pending).toBeNull();
    const poor = base();
    poor.players.A.battlefield = [atk, ...lands(1)];
    poor.players.A.hand = [creature(4, 2, { ninjutsu: 2 })('A')];
    expect(toBlocks(poor, [atk]).pending).toBeNull();
    const blocked = base();
    const blk = creature(1, 3)('B');
    blocked.players.A.battlefield = [atk, ...lands(2)];
    blocked.players.B.battlefield = [blk];
    blocked.players.A.hand = [creature(4, 2, { ninjutsu: 1 })('A')];
    expect(toBlocks(blocked, [atk], { [blk.iid]: atk.iid }).pending).toBeNull();
  });
  it('skipping it lets combat damage go ahead unchanged', () => {
    const g = base();
    const atk = creature(2, 2)('A');
    g.players.A.battlefield = [atk, ...lands(2)];
    g.players.A.hand = [creature(4, 2, { ninjutsu: 1 })('A')];
    const a = applyAction(toBlocks(g, [atk]), { type: 'skipNinjutsu' });
    expect(a.pending).toBeNull();
    expect(a.players.B.life).toBe(18);
    expect(a.phase).toBe('end');
  });
});

describe('the swap', () => {
  it('puts the ninja into combat tapped, returns the unblocked attacker to hand, pays the cost, and the ninja hits instead', () => {
    const g = base();
    const atk = creature(1, 1)('A', { buffP: 2 });
    const ninja = creature(4, 2, { ninjutsu: 1 })('A');
    g.players.A.battlefield = [atk, ...lands(2)];
    g.players.A.hand = [ninja];
    let a = toBlocks(g, [atk]);
    a = applyAction(a, { type: 'ninjutsu', ninja: ninja.iid, attacker: atk.iid });
    expect(a.pending).toBeNull();
    expect(onBf(a, ninja.iid)).toBeTruthy();
    expect(onBf(a, ninja.iid)!.tapped).toBe(true); // it comes in tapped and attacking
    expect(onBf(a, atk.iid)).toBeUndefined();
    const home = a.players.A.hand.find((c) => c.iid === atk.iid)!;
    expect(home.buffP).toBe(0); // it left play: its buffs are gone
    expect(a.players.B.life).toBe(16); // the ninja's 4, not the attacker's
    expect(availableMana(a.players.A)).toBe(1);
    expect(a.lastCombat?.attackers).toEqual([ninja.iid]);
    expect(a.log.some((l) => /ninjutsu/.test(l))).toBe(true);
  });
  it('a token attacker that is swapped out just ceases to exist', () => {
    const g = base();
    const tok = inst('wolf_token');
    const ninja = creature(3, 2, { ninjutsu: 0 })('A');
    g.players.A.battlefield = [tok, ...lands(1)];
    g.players.A.hand = [ninja];
    const a = applyAction(toBlocks(g, [tok]), { type: 'ninjutsu', ninja: ninja.iid, attacker: tok.iid });
    expect(a.players.A.hand.some((c) => c.iid === tok.iid)).toBe(false);
  });
  it('only an UNBLOCKED attacker can be swapped, and the blocked one still fights', () => {
    const g = base();
    const free = creature(1, 1)('A'), held = creature(3, 3)('A');
    const blk = creature(1, 1)('B');
    const ninja = creature(4, 2, { ninjutsu: 1 })('A');
    g.players.A.battlefield = [free, held, ...lands(2)];
    g.players.B.battlefield = [blk];
    g.players.A.hand = [ninja];
    const a = toBlocks(g, [free, held], { [blk.iid]: held.iid });
    expect(() => applyAction(a, { type: 'ninjutsu', ninja: ninja.iid, attacker: held.iid })).toThrow(/ninjutsu/);
    const b = applyAction(a, { type: 'ninjutsu', ninja: ninja.iid, attacker: free.iid });
    expect(b.players.B.battlefield).toHaveLength(0); // the 3-power attacker killed its 1/1 blocker as usual
    expect(b.players.B.life).toBe(16);
  });
  it('refuses a card without ninjutsu, one it cannot pay for, and an answer with no window', () => {
    const g = base();
    const atk = creature(1, 1)('A'), plain = creature(4, 2)('A'), dear = creature(4, 2, { ninjutsu: 5 })('A'), ok = creature(4, 2, { ninjutsu: 1 })('A');
    g.players.A.battlefield = [atk, ...lands(2)];
    g.players.A.hand = [plain, dear, ok];
    const a = toBlocks(g, [atk]);
    expect(() => applyAction(a, { type: 'ninjutsu', ninja: plain.iid, attacker: atk.iid })).toThrow();
    expect(() => applyAction(a, { type: 'ninjutsu', ninja: dear.iid, attacker: atk.iid })).toThrow();
    expect(() => applyAction(g, { type: 'ninjutsu', ninja: ok.iid, attacker: atk.iid })).toThrow(/window|trigger/);
    expect(() => applyAction(g, { type: 'skipNinjutsu' })).toThrow();
  });
});

describe('the AI', () => {
  it('swaps in a much bigger ninja for a small unblocked attacker, and skips for a small gain', () => {
    const g = base();
    const atk = creature(1, 1)('A');
    const ninja = creature(4, 2, { ninjutsu: 1 })('A');
    g.players.A.battlefield = [atk, ...lands(2)];
    g.players.A.hand = [ninja];
    expect(pickAction(toBlocks(g, [atk]), 'A')).toEqual({ type: 'ninjutsu', ninja: ninja.iid, attacker: atk.iid });
    const g2 = base();
    const big = creature(3, 3)('A');
    const small = creature(3, 2, { ninjutsu: 1 })('A');
    g2.players.A.battlefield = [big, ...lands(2)];
    g2.players.A.hand = [small];
    expect(pickAction(toBlocks(g2, [big]), 'A')).toEqual({ type: 'skipNinjutsu' });
  });
});

describe('card data', () => {
  it('only creatures have ninjutsu, and a ninja has no enter effect (it is not cast)', () => {
    for (const d of Object.values(CARDS)) {
      if (/^(nj|g2|ch|trig2|kwtest|kw2test|act|stat|co)_/.test(d.id)) continue;
      if (d.ninjutsu !== undefined) {
        expect(d.type, `${d.id}: only creatures have ninjutsu`).toBe('creature');
        expect(d.onEnter, `${d.id}: a ninja is not cast, so it has no enter effect`).toBeUndefined();
      }
    }
  });
});
