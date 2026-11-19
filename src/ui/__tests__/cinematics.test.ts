import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialState } from '../../engine/state';
import { DECK_EMBERWOOD, DECK_SKYWARD } from '../../cards/decks';
import type { Action, CardInstance, GameState } from '../../engine/types';
import { isIaijutsuOnHana } from '../cinematics';
import { IAIJUTSU_CLIP_MS, IAIJUTSU_CLIP_START_MS, IAIJUTSU_MS } from '../fxTiming';

const mk = (def: string, owner: 'A' | 'B', iid: string): CardInstance => ({
  iid, def, owner, tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false,
});

function board(): { g: GameState; strike: CardInstance } {
  const g = createInitialState(3, DECK_EMBERWOOD, DECK_SKYWARD);
  g.players.A.battlefield = [mk('kensei_duelist', 'A', 'hana'), mk('ashigaru', 'A', 'ash')];
  const strike = mk('iaijutsu_strike', 'A', 'iai');
  g.players.A.hand = [strike];
  return { g, strike };
}
const cast = (iid: string, target?: string): Action => ({
  type: 'castSorcery', iid: 'iai', ...(target ? { target: { kind: 'creature' as const, iid: target } } : {}),
}) as Action;

describe('Iaijutsu on Hana detection', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is true only for Iaijutsu Strike targeting a Kensei Duelist', () => {
    const { g, strike } = board();
    expect(isIaijutsuOnHana(g, cast('iai', 'hana'), strike)).toBe(true);
    expect(isIaijutsuOnHana(g, cast('iai', 'ash'), strike)).toBe(false); // someone else
    expect(isIaijutsuOnHana(g, cast('iai'), strike)).toBe(false); // no target
    expect(isIaijutsuOnHana(g, cast('iai', 'gone'), strike)).toBe(false); // target not on the board
    expect(isIaijutsuOnHana(g, cast('iai', 'hana'), mk('warding_stance', 'A', 'iai'))).toBe(false); // another spell
  });

  it("is also true when Hana is the opponent's (the film is for whoever sees it)", () => {
    const { g, strike } = board();
    g.players.B.battlefield = [mk('kensei_duelist', 'B', 'hanaB')];
    expect(isIaijutsuOnHana(g, cast('iai', 'hanaB'), strike)).toBe(true);
  });

  it('is off under reduced motion (the ordinary spotlight stays)', () => {
    const { g, strike } = board();
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    expect(isIaijutsuOnHana(g, cast('iai', 'hana'), strike)).toBe(false);
  });

  it('the clip (played once) fits inside the sequence with room for the title and the cut', () => {
    expect(IAIJUTSU_CLIP_START_MS + IAIJUTSU_CLIP_MS).toBeLessThan(IAIJUTSU_MS * 0.7); // done before the title lands
  });
});
