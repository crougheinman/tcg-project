import { useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { useGame } from './store/gameStore';
import { MainMenu } from './ui/MainMenu';
import { Lobby } from './ui/Lobby';
import { Board } from './ui/Board';
import { APP_VERSION } from './version';

export default function App() {
  const mode = useGame((s) => s.mode);
  const game = useGame((s) => s.game);
  const [showLobby, setShowLobby] = useState(false);

  useEffect(() => {
    if (mode === 'menu') setShowLobby(false);
  }, [mode]);

  if (mode !== 'menu' && game) return wrap(<Board />);

  // Slide/fade between the menu and the online lobby (same transition as home <-> deck).
  return wrap(
    <div className="screen-stack">
      <AnimatePresence initial={false}>
        <motion.div
          key={showLobby ? 'lobby' : 'menu'}
          className="screen"
          initial={{ opacity: 0, x: 60 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -60 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          {showLobby ? (
            <Lobby onBack={() => setShowLobby(false)} />
          ) : (
            <MainMenu onOnline={() => setShowLobby(true)} />
          )}
        </motion.div>
      </AnimatePresence>
      {/* tiny build tag — intentionally faint; only devs should really notice it */}
      <span className="build-tag" aria-hidden>v{APP_VERSION}</span>
    </div>,
  );
}

/**
 * One switch for every framer-motion animation in the app: with
 * `reducedMotion="user"` framer drops transform and layout animation for anyone
 * whose OS asks for reduced motion, while keeping opacity so state changes stay
 * legible. CSS animations are handled separately, in styles/index.css.
 */
function wrap(children: React.ReactNode) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
