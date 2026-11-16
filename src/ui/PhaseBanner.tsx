import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { GameState, PlayerId } from '../engine/types';
import { PHASE_BANNER_MS } from './fxTiming';
import { phaseBannerInfo, type PhaseBannerInfo } from './phaseInfo';

// A banner in the middle of the screen every time the phase (or the turn) changes:
// whose turn it is in small letters on top, the phase in big letters under it.
// Cyan = your turn, red = the enemy's. Click-through, so it never blocks play, and the AI waits a
// beat on a phase change (see PHASE_PAUSE_MS in the store) so it can be read.
const spring = { type: 'spring' as const, stiffness: 340, damping: 26 };

export function PhaseBanner({ game, localId, guided }: { game: GameState; localId: PlayerId; guided: boolean }) {
  const info = phaseBannerInfo(game, localId);
  const [shown, setShown] = useState<PhaseBannerInfo | null>(null);
  const lastKey = useRef('');
  const guidedRef = useRef(guided);
  guidedRef.current = guided;
  const over = !!game.winner;

  useEffect(() => {
    if (over) {
      setShown(null);
      return;
    }
    if (info.key === lastKey.current) return;
    lastKey.current = info.key;
    setShown(info);
    const t = setTimeout(
      () => setShown((cur) => (cur?.key === info.key ? null : cur)),
      PHASE_BANNER_MS * (guidedRef.current ? 1.4 : 1),
    );
    return () => clearTimeout(t);
    // `info` is rebuilt every render; its key is what identifies a phase change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.key, over]);

  return (
    <div className="phase-banner-wrap" role="status" aria-live="polite">
      <AnimatePresence>
        {shown && (
          <motion.div
            key={shown.key}
            className={'phase-banner ' + (shown.mine ? 'me' : 'foe')}
            initial={{ opacity: 0, scaleX: 0.55, scaleY: 0.9 }}
            animate={{ opacity: 1, scaleX: 1, scaleY: 1 }}
            exit={{ opacity: 0, scaleX: 1.12, transition: { duration: 0.28 } }}
            transition={spring}
          >
            <div className="pb-slab">
              <span className="pb-turn">{shown.turnLabel}</span>
              <span className="pb-phase">{shown.title}</span>
              <span className="pb-hint">{shown.hint}</span>
              <i className="pb-sweep" aria-hidden />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
