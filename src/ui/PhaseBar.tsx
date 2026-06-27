import type { GameState, PlayerId } from '../engine/types';

const PHASE_LABEL: Record<GameState['phase'], string> = {
  main1: 'Main',
  combat_attack: 'Declare Attackers',
  combat_block: 'Declare Blockers',
  end: 'End',
};

export function PhaseBar({ game, myId }: { game: GameState; myId: PlayerId }) {
  const yourTurn = game.active === myId;
  return (
    <div className="phasebar">
      <span className="turn">Turn {game.turn}</span>
      <span className={'active ' + (yourTurn ? 'you' : 'them')}>
        {yourTurn ? 'Your turn' : "Opponent's turn"}
      </span>
      <span className="phase">{PHASE_LABEL[game.phase]}</span>
    </div>
  );
}
