import type { PlayerId } from '../engine/types';
import { opponentOf } from '../engine/types';

// Rewrite engine log lines (which use 'A'/'B') from the local player's view.
export function humanize(s: string, myId: PlayerId): string {
  const opp = opponentOf(myId);
  return s
    .replace(new RegExp(`\\b${myId}'s\\b`, 'g'), 'Your')
    .replace(new RegExp(`\\b${opp}'s\\b`, 'g'), "Opponent's")
    .replace(new RegExp(`\\b${myId}\\b`, 'g'), 'You')
    .replace(new RegExp(`\\b${opp}\\b`, 'g'), 'Opponent')
    // first-person verb agreement for the local player
    .replace(/\bYou is\b/g, 'You are')
    .replace(/\bYou (plays|casts|attacks|blocks|decks|creates|ramps|gains|heals)\b/g, (_m, v) => 'You ' + v.slice(0, -1));
}
