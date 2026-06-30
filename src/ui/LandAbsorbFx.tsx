import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { PlayerId } from '../engine/types';

// A land entering the battlefield "vaporizes" into a blue mana orb that flies to
// its controller's avatar (the land is then hidden — the mana readout represents it).
// As the orb merges in, a blue "Mana +1" floats near the mana readout, drifts down and fades.
export interface LandAbsorb {
  id: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  art?: string;
  pid: PlayerId;
}

const TRAVEL_MS = 1800; // orb travel (vaporize -> fly -> consumed)
const TEXT_AT_MS = 1450; // "Mana +1" appears as the orb reaches the avatar
const TEXT_DUR_MS = 1100; // then it falls + fades over this

export function LandAbsorbFx({ fx, onDone }: { fx: LandAbsorb; onDone: (id: number) => void }) {
  const [manaPos, setManaPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const av = document.querySelector(`[data-player="${fx.pid}"]`) as HTMLElement | null;

    // Anchor the "Mana +1" text to this player's mana readout.
    const manaEl = av?.closest('.playerbar')?.querySelector('.mana');
    if (manaEl) {
      const r = manaEl.getBoundingClientRect();
      setManaPos({ x: r.left + r.width / 2, y: r.top });
    }

    // Glow the avatar blue once, just as the orb arrives (imperative — the mana
    // readout pulses on its own via the mana change).
    const glow = setTimeout(() => {
      av?.animate(
        [
          { filter: 'drop-shadow(0 0 0px rgba(106, 169, 255, 0))' },
          { filter: 'drop-shadow(0 0 16px rgba(106, 169, 255, 0.95))' },
          { filter: 'drop-shadow(0 0 0px rgba(106, 169, 255, 0))' },
        ],
        { duration: 720, easing: 'ease-out' },
      );
    }, TRAVEL_MS - 360);
    const done = setTimeout(() => onDone(fx.id), TEXT_AT_MS + TEXT_DUR_MS + 150);
    return () => {
      clearTimeout(glow);
      clearTimeout(done);
    };
  }, [fx, onDone]);

  return (
    <>
      {fx.art && (
        <motion.div
          className="land-vapor"
          style={{ left: fx.fromX, top: fx.fromY, backgroundImage: `url(${fx.art})` }}
          // x/y stay -50% (centering) so framer's transform doesn't fight CSS.
          initial={{ opacity: 0.95, scale: 1, x: '-50%', y: '-50%' }}
          animate={{ opacity: 0, scale: 1.4, x: '-50%', y: '-50%' }}
          transition={{ duration: 0.55, ease: 'easeOut' }}
        />
      )}
      <motion.div
        className="mana-orb"
        initial={{ left: fx.fromX, top: fx.fromY, x: '-50%', y: '-50%', scale: 0.4, opacity: 0 }}
        animate={{
          left: fx.toX,
          top: fx.toY,
          x: '-50%',
          y: '-50%',
          scale: [0.5, 1.1, 1, 0.55],
          opacity: [0, 1, 1, 0],
        }}
        transition={{ duration: TRAVEL_MS / 1000, ease: 'easeInOut', times: [0, 0.2, 0.78, 1] }}
      />
      {manaPos && (
        <motion.div
          className="mana-float"
          style={{ left: manaPos.x, top: manaPos.y }}
          // appears as the orb merges in, then drifts down and fades (x stays -50% to center).
          initial={{ opacity: 0, y: -6, x: '-50%' }}
          animate={{ opacity: [0, 1, 1, 0], y: [-6, 2, 24, 40], x: '-50%' }}
          transition={{
            delay: TEXT_AT_MS / 1000,
            duration: TEXT_DUR_MS / 1000,
            times: [0, 0.18, 0.7, 1],
            ease: 'easeIn',
          }}
        >
          Mana +1
        </motion.div>
      )}
    </>
  );
}
