import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { GameState, PlayerId } from '../engine/types';
import { PHASE_BANNER_MS, PHASE_GAP_MS } from './fxTiming';
import { combatHoldMs } from './firstStrike';
import { phaseBannerInfo, type PhaseBannerInfo } from './phaseInfo';

// A banner in the middle of the screen every time the phase (or the turn) changes:
// whose turn it is in small letters on top, the phase in big letters under it.
// Cyan = your turn, red = the enemy's. Click-through, so it never blocks play, and the AI waits a
// beat on a phase change (see PHASE_PAUSE_MS in the store) so it can be read.
const spring = { type: 'spring' as const, stiffness: 340, damping: 26 };
const EXIT_MS = 280; // the banner's exit transition below

export function PhaseBanner({
  game,
  localId,
  guided,
  onLock,
}: {
  game: GameState;
  localId: PlayerId;
  guided: boolean;
  /** true from the moment the phase changes until its banner has fully left; the board holds and locks its cards. */
  onLock?: (locked: boolean) => void;
}) {
  const info = phaseBannerInfo(game, localId);
  const lockT = useRef<ReturnType<typeof setTimeout>>();
  const onLockRef = useRef(onLock);
  onLockRef.current = onLock;
  const [shown, setShown] = useState<PhaseBannerInfo | null>(null);
  const lastKey = useRef('');
  const prevGame = useRef<GameState | null>(null);
  const showT = useRef<ReturnType<typeof setTimeout>>();
  const hideT = useRef<ReturnType<typeof setTimeout>>();
  const freeAt = useRef(0); // when the next banner may start (previous one's end + the gap)
  const guidedRef = useRef(guided);
  guidedRef.current = guided;
  const over = !!game.winner;

  useEffect(() => {
    if (over) {
      clearTimeout(showT.current);
      clearTimeout(hideT.current);
      clearTimeout(lockT.current);
      onLockRef.current?.(false);
      setShown(null);
      return;
    }
    if (info.key === lastKey.current) return;
    lastKey.current = info.key;
    const now = Date.now();
    // From the moment the phase changes until its banner (which may wait for the gap before it) has
    // played and left, the cards are locked and the board holds still (Board.tsx).
    clearTimeout(lockT.current);
    onLockRef.current?.(true);
    // Combat just resolved: its clash (first-strike cinematic, then each attacker's strike) plays out
    // first; the banner for the phase that follows waits for it plus a beat, instead of landing on top.
    const hold = combatHoldMs(prevGame.current, game);
    if (hold) {
      clearTimeout(hideT.current);
      setShown(null); // clear the previous phase's banner while the clash plays
    }
    // Banners never touch: this one starts at the later of (clash over) and (previous banner gone +
    // PHASE_GAP_MS). If a newer phase arrives while this one is still waiting, it takes the slot.
    const startAt = Math.max(now + hold, freeAt.current);
    const show = () => {
      const dur = PHASE_BANNER_MS * (guidedRef.current ? 1.4 : 1);
      freeAt.current = Date.now() + dur + EXIT_MS + PHASE_GAP_MS; // the gap is counted from the banner leaving
      clearTimeout(hideT.current);
      setShown(info);
      hideT.current = setTimeout(() => setShown((cur) => (cur?.key === info.key ? null : cur)), dur);
      lockT.current = setTimeout(() => onLockRef.current?.(false), dur + EXIT_MS);
    };
    clearTimeout(showT.current);
    if (startAt > now) showT.current = setTimeout(show, startAt - now);
    else show();
    // `info` is rebuilt every render; its key is what identifies a phase change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.key, over]);

  useEffect(
    () => () => {
      clearTimeout(showT.current);
      clearTimeout(hideT.current);
      clearTimeout(lockT.current);
    },
    [],
  );

  // Last render's game, so the effect above can tell what the action that changed the phase was.
  useEffect(() => {
    prevGame.current = game;
  });

  return (
    <div className="phase-banner-wrap" role="status" aria-live="polite">
      {/* a dark backdrop while a banner is up, so the phase is what you read */}
      <AnimatePresence>
        {shown && (
          <motion.div
            key="pb-dim"
            className="pb-dim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: EXIT_MS / 1000 } }}
            transition={{ duration: 0.25 }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {shown && (
          <motion.div
            key={shown.key}
            className={'phase-banner ' + (shown.mine ? 'me' : 'foe')}
            initial={{ opacity: 0, scaleX: 0.55, scaleY: 0.9 }}
            animate={{ opacity: 1, scaleX: 1, scaleY: 1 }}
            exit={{ opacity: 0, scaleX: 1.12, transition: { duration: EXIT_MS / 1000 } }}
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
