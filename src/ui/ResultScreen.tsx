import { motion } from 'framer-motion';
import type { GameState, PlayerId, PlayerState } from '../engine/types';
import { opponentOf } from '../engine/types';
import { isCreature, isLand } from '../engine/rules';
import { getDef } from '../cards/cards';

// Post-game summary. All metrics derive from the final GameState (no engine
// changes / tracking needed): the graveyard holds every dead creature + cast
// sorcery, the battlefield holds what's still standing.
function tally(p: PlayerState) {
  const graveCreatures = p.graveyard.filter((c) => getDef(c.def).type === 'creature').length;
  const standing = p.battlefield.filter(isCreature).length;
  return {
    life: p.life,
    creaturesCast: standing + graveCreatures,
    creaturesLost: graveCreatures,
    spells: p.graveyard.filter((c) => getDef(c.def).type === 'sorcery').length,
    lands: p.battlefield.filter(isLand).length,
    deck: p.library.length,
  };
}

const listVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08, delayChildren: 0.95 } }, // 0.6 hold + 0.35
};
const rowVariants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: 'spring' as const, stiffness: 380, damping: 26 } },
};

export function ResultScreen({
  game,
  myId,
  reason,
  onMenu,
}: {
  game: GameState;
  myId: PlayerId;
  reason?: string; // set on a forfeit win (opponent left)
  onMenu: () => void;
}) {
  const oppId = opponentOf(myId);
  const outcome: 'win' | 'lose' | 'draw' = reason
    ? 'win'
    : game.winner === 'draw'
      ? 'draw'
      : game.winner === myId
        ? 'win'
        : 'lose';

  const you = tally(game.players[myId]);
  const opp = tally(game.players[oppId]);
  const rows: { icon: string; label: string; you: number; opp: number }[] = [
    { icon: '♥', label: 'Life left', you: you.life, opp: opp.life },
    { icon: '⚔', label: 'Creatures cast', you: you.creaturesCast, opp: opp.creaturesCast },
    { icon: '☠', label: 'Creatures lost', you: you.creaturesLost, opp: opp.creaturesLost },
    { icon: '✦', label: 'Spells cast', you: you.spells, opp: opp.spells },
    { icon: '◈', label: 'Lands played', you: you.lands, opp: opp.lands },
    { icon: '🂠', label: 'Cards in deck', you: you.deck, opp: opp.deck },
  ];

  const title = outcome === 'win' ? 'Victory!' : outcome === 'lose' ? 'Defeat' : 'Draw';

  // Hold a beat (~0.6s) before revealing — let the final blow land and breathe
  // before the verdict slams in (MTG Arena pacing).
  const HOLD = 0.6;
  return (
    <motion.div
      className="overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: HOLD, duration: 0.3 }}
    >
      <motion.div
        className={'result result-stats outcome-' + outcome}
        initial={{ scale: 0.85, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22, delay: HOLD }}
      >
        <motion.h2
          className="result-title"
          initial={{ scale: 0.5, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 14, delay: HOLD + 0.2 }}
        >
          {title}
        </motion.h2>
        {reason && <p className="result-reason">{reason}</p>}
        <p className="result-sub">
          {game.winner === 'draw' ? 'Stalemate' : 'Match'} · {game.turn} turns
        </p>

        <motion.div className="stats-table" variants={listVariants} initial="hidden" animate="show">
          <motion.div className="stats-head" variants={rowVariants}>
            <span className="stat-you">You</span>
            <span />
            <span className="stat-opp">Opponent</span>
          </motion.div>
          {rows.map((r) => {
            const youWins = r.you > r.opp;
            const oppWins = r.opp > r.you;
            return (
              <motion.div key={r.label} className="stat-row" variants={rowVariants}>
                <span className={'stat-you' + (youWins ? ' lead' : '')}>{r.you}</span>
                <span className="stat-label">
                  <span className="stat-ico" aria-hidden>
                    {r.icon}
                  </span>
                  {r.label}
                </span>
                <span className={'stat-opp' + (oppWins ? ' lead' : '')}>{r.opp}</span>
              </motion.div>
            );
          })}
        </motion.div>

        <motion.button
          className="primary"
          onClick={onMenu}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.95 + rows.length * 0.08 + 0.1 }}
        >
          Back to Menu
        </motion.button>
      </motion.div>
    </motion.div>
  );
}
