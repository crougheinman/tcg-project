import type { Effect } from '../engine/types';

/** A short player-facing line for an effect, for the mode list and the preview. */
export function effectText(e: Effect): string {
  switch (e.type) {
    case 'damage': return `Deal ${e.amount} damage to ${e.targets === 'any' ? 'any target' : e.targets === 'creature' ? 'a creature' : 'a player'}`;
    case 'draw': return `Draw ${e.amount} card${e.amount === 1 ? '' : 's'}`;
    case 'heal': return `Gain ${e.amount} life`;
    case 'buff': return `Give a creature +${e.power}/+${e.toughness}`;
    case 'ramp': return `Put up to ${e.amount} lands onto the battlefield`;
    case 'token': return `Create ${e.count} ${e.token.replace(/_token$/, '').replace(/_/g, ' ')} token${e.count === 1 ? '' : 's'}`;
    case 'bounce': return 'Return a creature to its owner\'s hand';
    case 'destroy': return 'Destroy a tapped creature';
    case 'edict': return 'Your opponent sacrifices a creature of their choice';
    case 'rally': return `Your creatures get +${e.power}/+${e.toughness} until end of turn`;
    case 'scry': return `Scry ${e.amount}`;
    case 'loot': return 'Draw a card, then discard a card';
    case 'bite': return 'Your strongest creature deals damage equal to its power to an opposing creature';
    default: return e.type;
  }
}

