import { getDef, isToken } from '../cards/cards';
import { isCreature, isLand } from '../engine/rules';
import type { PlayerState } from '../engine/types';

// The post-game summary numbers, derived from the final state alone.
//
// "Cast" means a card the player actually played. A token is created by an effect, not
// cast, so a Wolf that was conjured (and one still standing) is never counted. Spells
// are sorceries AND instants: both are cards that go to the graveyard when cast.
export interface Tally {
  life: number;
  creaturesCast: number;
  creaturesLost: number;
  spells: number;
  lands: number;
  deck: number;
}

export function tally(p: PlayerState): Tally {
  const realCreature = (c: { def: string }) => isCreature(c as never) && !isToken(c.def);
  const lost = p.graveyard.filter(realCreature).length;
  const standing = p.battlefield.filter(realCreature).length;
  return {
    life: p.life,
    creaturesCast: standing + lost,
    creaturesLost: lost,
    spells: p.graveyard.filter((c) => {
      const t = getDef(c.def).type;
      return t === 'sorcery' || t === 'instant';
    }).length,
    lands: p.battlefield.filter(isLand).length,
    deck: p.library.length,
  };
}
