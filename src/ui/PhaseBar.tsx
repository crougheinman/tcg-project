import type { GameState, PlayerId } from '../engine/types';

const STEPS = ['Main', 'Combat', 'End'] as const;

function stepOf(phase: GameState['phase']): number {
  if (phase === 'main1') return 0;
  if (phase === 'end') return 2;
  return 1; // combat_attack / combat_block
}

export function PhaseBar({ game, myId }: { game: GameState; myId: PlayerId }) {
  const yourTurn = game.active === myId;
  const step = stepOf(game.phase);
  return (
    // The owner class tints the lit step, so whose turn it is still reads on a
    // phone, where the "Your turn" label is dropped for space.
    <div className={'phasebar ' + (yourTurn ? 'you' : 'them')}>
      <span className="turn">Turn {game.turn}</span>
      <div className="phase-steps">
        {STEPS.map((s, i) => (
          <span
            key={s}
            className={'pstep' + (i === step ? ' on' : '') + (i < step ? ' done' : '')}
            aria-current={i === step ? 'step' : undefined}
          >
            {s}
          </span>
        ))}
      </div>
      <span className={'active ' + (yourTurn ? 'you' : 'them')}>
        {yourTurn ? 'Your turn' : "Opponent's turn"}
      </span>
    </div>
  );
}
