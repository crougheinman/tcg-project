import type { CardInstance, GameState, PlayerId, PlayerState } from './types';
import { shuffle } from './rng';

const STARTING_LIFE = 20;
const OPENING_HAND = 7;

function makeInstance(defId: string, owner: PlayerId, iid: number): CardInstance {
  return {
    iid: `c${iid}`,
    def: defId,
    owner,
    tapped: false,
    summoningSick: true,
    damage: 0,
    buffP: 0,
    buffT: 0,
    blitz: false,
  };
}

/**
 * Build a fresh game. Deterministic: same seed + same decks => identical state.
 * Player A is on the play (skips the first-turn draw, per MTG).
 */
export function createInitialState(
  seed: number,
  deckA: string[],
  deckB: string[],
): GameState {
  let iid = 0;
  let rngState = seed | 0;

  function buildPlayer(id: PlayerId, deck: string[]): PlayerState {
    const lib = deck.map((defId) => makeInstance(defId, id, iid++));
    const [shuffled, s] = shuffle(lib, rngState);
    rngState = s;
    const hand = shuffled.slice(0, OPENING_HAND);
    const library = shuffled.slice(OPENING_HAND);
    return {
      id,
      life: STARTING_LIFE,
      library,
      hand,
      battlefield: [],
      graveyard: [],
      landPlayedThisTurn: false,
    };
  }

  const players = {
    A: buildPlayer('A', deckA),
    B: buildPlayer('B', deckB),
  };

  return {
    seed,
    rngState,
    turn: 1,
    active: 'A',
    phase: 'main1', // A is on the play: untap/draw skipped on turn 1
    players,
    combat: null,
    pending: null,
    nextIid: iid,
    winner: null,
    log: ['Game start. A is on the play.'],
  };
}
