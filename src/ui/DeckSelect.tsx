import { useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { DECK_LIST, deckById, type DeckMeta } from '../cards/decks';
import { getDef } from '../cards/cards';

// Pick a deck before a game. Shows name, battle style, description, art.
// `confirmStart`: glow the choice + a face-off transition before invoking onPick.
// `disabledId`: a deck that can't be picked (e.g. already taken by player 1).
// `vsDeckId`: the opponent's deck, when known up-front — enables the VS face-off
// (fly-in with wind streaks, then a slow drift to center) during the transition.
// Desktop: a staggered grid. Mobile: a swipeable carousel (arrows + drag).
export function DeckSelect({
  title = 'Choose your deck',
  onPick,
  onBack,
  confirmStart,
  disabledId,
  vsDeckId,
}: {
  title?: string;
  onPick: (deckId: string) => void;
  onBack: () => void;
  confirmStart?: boolean;
  disabledId?: string;
  vsDeckId?: string;
}) {
  const [chosen, setChosen] = useState<string | null>(null);

  function choose(id: string) {
    if (chosen || id === disabledId) return;
    if (confirmStart) {
      setChosen(id); // glow it, face-off, then start
      setTimeout(() => onPick(id), 3000);
    } else {
      onPick(id);
    }
  }

  // Shared card face (art + name + style chip + desc + tag).
  const deckInner = (d: DeckMeta): ReactNode => {
    const art = getDef(d.emblem).art;
    const taken = d.id === disabledId;
    return (
      <>
        {art && <img className="deck-art" src={art} alt="" draggable={false} />}
        <div className="deck-name">{d.name}</div>
        <div className={'deck-style ' + styleClass(d.style)}>{d.style}</div>
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
            transition={{ duration: 0.8, ease: 'easeInOut' }}
          >
            {vsDeckId ? (
              <div className="fade-inner">
                <div className="faceoff">
                  <FaceOffCard deck={deckById(chosen)} from="left" />
                  <motion.span
                    className="vs-badge"
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: [0, 1.4, 1], opacity: 1 }}
                    transition={{ delay: 0.6, duration: 0.45, times: [0, 0.55, 1], ease: 'easeOut' }}
                  >
                    VS
                  </motion.span>
                  <FaceOffCard deck={deckById(vsDeckId)} from="right" />
                </div>
                <motion.div
                  className="deck-fade-text"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 1.1, duration: 0.5 }}
                >
                  Entering the battlefield…
                </motion.div>
              </div>
            ) : (
              <div className="deck-fade-text">Entering the battlefield…</div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Playstyle -> chip color (first word of the style line).
function styleClass(style: string): string {
  const k = style.split('·')[0].trim().toLowerCase();
  if (k.startsWith('aggro')) return 'chip-aggro';
  if (k.startsWith('control')) return 'chip-control';
  if (k.startsWith('spell')) return 'chip-spell';
  if (k.startsWith('swarm')) return 'chip-swarm';
  if (k.startsWith('ramp')) return 'chip-ramp';
  return 'chip-neutral';
}

// One side of the VS face-off: the deck box flies in fast (with wind streaks +
// motion blur), brakes near the middle, then drifts slowly into place.
// Two chained tweens (fly -> drift) rather than one segmented keyframe timeline.
function FaceOffCard({ deck, from }: { deck: DeckMeta; from: 'left' | 'right' }) {
  const art = getDef(deck.emblem).art;
  const dir = from === 'left' ? -1 : 1;
  const off = typeof window !== 'undefined' ? Math.max(window.innerWidth * 0.65, 340) : 420;
  const [stage, setStage] = useState<'fly' | 'drift'>('fly');
  return (
    <div className="faceoff-side">
      <motion.div
        className="faceoff-card"
        initial={{ x: dir * off, opacity: 0, filter: 'blur(7px)' }}
        animate={
          stage === 'fly'
            ? { x: dir * 30, opacity: 1, filter: 'blur(0px)' } // fast approach
            : { x: 0 } // slow creep into the middle
        }
        transition={
          stage === 'fly'
            ? { duration: 0.55, ease: 'easeOut' }
            : { duration: 1.9, ease: 'linear' }
        }
        onAnimationComplete={() => stage === 'fly' && setStage('drift')}
      >
        {art && <img src={art} alt="" draggable={false} />}
        <span className="faceoff-name">{deck.name}</span>
      </motion.div>
      {/* wind streaks trailing the fly-in */}
      {[0, 1, 2, 3].map((i) => (
        <motion.span
          key={i}
          className="wind-streak"
          style={{ top: `${18 + i * 20}%` }}
          initial={{ x: dir * off * 0.6, opacity: 0, scaleX: 0.5 }}
          animate={{
            x: dir * -60,
            opacity: [0, 0.85, 0],
            scaleX: [0.6, 1.5, 0.7],
          }}
          transition={{ duration: 0.85, delay: 0.04 + i * 0.08, ease: 'easeOut', times: [0, 0.3, 1] }}
        />
      ))}
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
      <motion.div
        className="deck-list"
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.07 } } }}
      >
        {DECK_LIST.map((d) => {
          const taken = d.id === disabledId;
          const selected = chosen === d.id;
          return (
            <motion.button
              key={d.id}
              variants={{
                hidden: { opacity: 0, y: 26, scale: 0.94 },
                show: {
                  opacity: 1,
                  y: 0,
                  scale: 1,
                  transition: { type: 'spring', stiffness: 340, damping: 26 },
                },
              }}
              className={'deck-card' + (selected ? ' selected' : '') + (taken ? ' taken' : '')}
              disabled={taken || !!chosen}
              onClick={() => onChoose(d.id)}
            >
              {renderInner(d)}
            </motion.button>
          );
        })}
      </motion.div>
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
