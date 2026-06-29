import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DECK_LIST } from '../cards/decks';
import { getDef } from '../cards/cards';

// Pick a deck before a game. Shows name, battle style, description, art.
// `confirmStart`: glow the choice + 3s fade transition before invoking onPick.
// `disabledId`: a deck that can't be picked (e.g. already taken by player 1).
export function DeckSelect({
  title = 'Choose your deck',
  onPick,
  onBack,
  confirmStart,
  disabledId,
}: {
  title?: string;
  onPick: (deckId: string) => void;
  onBack: () => void;
  confirmStart?: boolean;
  disabledId?: string;
}) {
  const [chosen, setChosen] = useState<string | null>(null);

  function choose(id: string) {
    if (chosen || id === disabledId) return;
    if (confirmStart) {
      setChosen(id); // glow it, fade, then start
      setTimeout(() => onPick(id), 3000);
    } else {
      onPick(id);
    }
  }

  return (
    <div className="menu">
      <h2 className="deck-title">{title}</h2>
      <div className="deck-list">
        {DECK_LIST.map((d) => {
          const art = getDef(d.emblem).art;
          const taken = d.id === disabledId;
          const selected = chosen === d.id;
          return (
            <button
              key={d.id}
              className={'deck-card' + (selected ? ' selected' : '') + (taken ? ' taken' : '')}
              disabled={taken || !!chosen}
              onClick={() => choose(d.id)}
            >
              {art && <img className="deck-art" src={art} alt="" draggable={false} />}
              <div className="deck-name">{d.name}</div>
              <div className="deck-style">{d.style}</div>
              <div className="deck-desc">{d.desc}</div>
              {taken ? (
                <span className="deck-taken-tag">Taken</span>
              ) : (
                <span className="deck-go">Play ▸</span>
              )}
            </button>
          );
        })}
      </div>
      <button className="link" onClick={onBack} disabled={!!chosen}>
        ← Back
      </button>

      <AnimatePresence>
        {chosen && confirmStart && (
          <motion.div
            className="deck-fade"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.4, ease: 'easeInOut' }}
          >
            <div className="deck-fade-text">Entering the battlefield…</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
