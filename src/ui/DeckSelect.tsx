import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DECK_LIST, type DeckMeta } from '../cards/decks';
import { getDef } from '../cards/cards';

// Pick a deck before a game. Shows name, battle style, description, art.
// `confirmStart`: glow the choice + 3s fade transition before invoking onPick.
// `disabledId`: a deck that can't be picked (e.g. already taken by player 1).
// Desktop: a grid of all decks. Mobile: a swipeable carousel (arrows + drag),
// each card sliding/fading in as you browse.
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

  // Shared card face (art + name + style + desc + tag).
  const deckInner = (d: DeckMeta): ReactNode => {
    const art = getDef(d.emblem).art;
    const taken = d.id === disabledId;
    return (
      <>
        {art && <img className="deck-art" src={art} alt="" draggable={false} />}
        <div className="deck-name">{d.name}</div>
        <div className="deck-style">{d.style}</div>
        <div className="deck-desc">{d.desc}</div>
        {taken ? (
          <span className="deck-taken-tag">Taken</span>
        ) : (
          <span className="deck-go">Play ▸</span>
        )}
      </>
    );
  };

  return (
    <div className="menu deck-select">
      <button className="book-btn deck-back" onClick={onBack} disabled={!!chosen}>
        ← Back
      </button>
      <h2 className="deck-title">{title}</h2>

      <DeckPicker
        chosen={chosen}
        disabledId={disabledId}
        onChoose={choose}
        renderInner={deckInner}
      />

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

// Grid on desktop, swipe/arrow carousel on mobile (≤640px).
function DeckPicker({
  chosen,
  disabledId,
  onChoose,
  renderInner,
}: {
  chosen: string | null;
  disabledId?: string;
  onChoose: (id: string) => void;
  renderInner: (d: DeckMeta) => ReactNode;
}) {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const on = () => setIsMobile(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(0);
  const swiped = useRef(false);
  const go = (delta: number) => {
    if (chosen) return;
    setDir(delta);
    setIndex((i) => (i + delta + DECK_LIST.length) % DECK_LIST.length);
  };

  if (!isMobile) {
    return (
      <div className="deck-list">
        {DECK_LIST.map((d) => {
          const taken = d.id === disabledId;
          const selected = chosen === d.id;
          return (
            <button
              key={d.id}
              className={'deck-card' + (selected ? ' selected' : '') + (taken ? ' taken' : '')}
              disabled={taken || !!chosen}
              onClick={() => onChoose(d.id)}
            >
              {renderInner(d)}
            </button>
          );
        })}
      </div>
    );
  }

  const d = DECK_LIST[index];
  const taken = d.id === disabledId;
  const selected = chosen === d.id;
  const variants = {
    enter: (dir: number) => ({ x: dir >= 0 ? 240 : -240, opacity: 0, scale: 0.9 }),
    center: { x: 0, opacity: 1, scale: 1 },
    exit: (dir: number) => ({ x: dir >= 0 ? -240 : 240, opacity: 0, scale: 0.9 }),
  };

  return (
    <>
      <div className="deck-carousel">
        <button
          className="carousel-arrow"
          onClick={() => go(-1)}
          disabled={!!chosen}
          aria-label="Previous deck"
        >
          ‹
        </button>

        <div className="carousel-stage">
          <AnimatePresence custom={dir} initial={false}>
            <motion.div
              key={d.id}
              className={
                'deck-card carousel-card' + (selected ? ' selected' : '') + (taken ? ' taken' : '')
              }
              custom={dir}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.35}
              onDragEnd={(_e, info) => {
                swiped.current = Math.abs(info.offset.x) > 60;
                if (info.offset.x < -60) go(1);
                else if (info.offset.x > 60) go(-1);
              }}
              onClick={() => {
                if (swiped.current) {
                  swiped.current = false;
                  return; // that was a swipe, not a tap
                }
                onChoose(d.id);
              }}
            >
              {renderInner(d)}
            </motion.div>
          </AnimatePresence>
        </div>

        <button
          className="carousel-arrow"
          onClick={() => go(1)}
          disabled={!!chosen}
          aria-label="Next deck"
        >
          ›
        </button>
      </div>

      <div className="carousel-dots">
        {DECK_LIST.map((x, i) => (
          <span key={x.id} className={'dot' + (i === index ? ' on' : '')} />
        ))}
      </div>
    </>
  );
}
