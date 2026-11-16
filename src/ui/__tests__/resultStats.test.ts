import { describe, expect, it } from 'vitest';
import { tally } from '../resultStats';
import type { CardInstance, PlayerState } from '../../engine/types';

let n = 0;
const c = (def: string): CardInstance => ({ iid: `r${n++}`, def, owner: 'A', tapped: false, summoningSick: false, damage: 0, buffP: 0, buffT: 0, blitz: false });
const player = (over: Partial<PlayerState>): PlayerState => ({ id: 'A', life: 20, library: [], hand: [], battlefield: [], graveyard: [], landPlayedThisTurn: false, ...over });

describe('result screen tally', () => {
  it('counts instants as spells, not just sorceries', () => {
    // Soothe and Take Counter are instants; Cinderbolt is a sorcery.
    const t = tally(player({ graveyard: [c('cinderbolt'), c('soothe'), c('take_counter')] }));
    expect(t.spells).toBe(3);
  });

  it('does not count tokens as creatures cast, whether standing or dead', () => {
    const t = tally(player({
      battlefield: [c('stoneback_cub'), c('wolf_token'), c('wolf_token')],
      graveyard: [c('ashigaru'), c('zombie_token')], // a token in a graveyard is defensive: the engine no longer puts them there
    }));
    expect(t.creaturesCast).toBe(2); // the Cub and the Ashigaru
    expect(t.creaturesLost).toBe(1); // the Ashigaru only
  });

  it('cast = still standing + lost, for real cards', () => {
    const t = tally(player({ battlefield: [c('dread_maw'), c('aether_well')], graveyard: [c('ashigaru'), c('ronin_blade')] }));
    expect(t).toMatchObject({ creaturesCast: 3, creaturesLost: 2, lands: 1 });
  });

  it('reports life, lands and deck size', () => {
    const t = tally(player({ life: -2, library: [c('aether_well'), c('aether_well')], battlefield: [c('aether_well'), c('aether_well'), c('aether_well')] }));
    expect(t).toMatchObject({ life: -2, deck: 2, lands: 3, creaturesCast: 0, spells: 0 });
  });
});
