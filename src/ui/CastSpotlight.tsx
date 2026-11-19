import { AnimatePresence, motion } from 'framer-motion';
import { getDef } from '../cards/cards';
import { useGame } from '../store/gameStore';
import { PCard } from './CardPreview';
import { BlitzUltimate } from './BlitzUltimate';

// While a sorcery, instant or creature skill is being cast, its card floats up in the middle
// of the table and glows, so the player can see WHAT is being cast and WHO is casting it.
// The effect itself waits for this window (see the store's telegraphs); in PvP it plays alongside.
// Purely visual: click-through, hidden from assistive tech (the action log announces the cast).
const spring = { type: 'spring' as const, stiffness: 260, damping: 24 };

export function CastSpotlight() {
  const spots = useGame((s) => s.spotlights);
  const myId = useGame((s) => s.myId);
  return (
    <div className="cast-stage" aria-hidden>
      <AnimatePresence>
        {spots.map((sp) => {
          const type = getDef(sp.card.def).type;
          const tone = sp.label.startsWith('✦') ? 'skill' : type === 'instant' ? 'instant' : 'spell';
          return (
            <motion.div
              key={sp.id}
              className={`cast-spot ${tone} ${sp.ownerId === myId ? 'mine' : 'theirs'}`}
              data-cast={sp.card.def}
              initial={{ opacity: 0, scale: 0.45, y: sp.ownerId === myId ? 150 : -150 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 1.18, y: -24, transition: { duration: 0.28 } }}
              transition={spring}
            >
              <div className="cast-float">
                <div className="cast-aura" />
                <div className="cast-card">
                  <PCard inst={sp.card} />
                </div>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <i key={i} className="cast-spark" style={{ ['--i' as string]: i }} />
                ))}
              </div>
              <div className="cast-label">{sp.label}</div>
            </motion.div>
          );
        })}
      </AnimatePresence>
      {/* Beast Blitz is an ultimate: the art cuts in across the middle for the whole window */}
      <AnimatePresence>
        {spots
          .filter((sp) => sp.blitz)
          .flatMap((sp) => [
            // a dim backdrop so the skill is the only thing to look at
            <motion.div
              key={'dim' + sp.id}
              className="bu-dim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.4 } }}
              transition={{ duration: 0.3 }}
            />,
            <BlitzUltimate key={'ult' + sp.id} />,
          ])}
      </AnimatePresence>
    </div>
  );
}
