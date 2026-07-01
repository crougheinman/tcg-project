import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { circle } from './ImpactFx';

// Destruction sequence on a dying card — pure framer motion (no spritesheets):
// shockwave + white-hot flash, embers flung outward that fall as they fade,
// then dark smoke curling up. ~2.3s total, matching the card's slow exit fade.
const TOTAL_MS = 2300;

export function DestroyFx({ x, y, onDone }: { x: number; y: number; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, TOTAL_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Random ember spread, computed once per mount (cosmetic only — not game state).
  const embers = useRef(
    Array.from({ length: 12 }, (_, i) => {
      const ang = (i / 12) * Math.PI * 2 + Math.random() * 0.6;
      const dist = 44 + Math.random() * 46;
      return {
        dx: Math.cos(ang) * dist,
        dy: Math.sin(ang) * dist * 0.8,
        size: 4 + Math.random() * 5,
        dur: 0.8 + Math.random() * 0.5,
        delay: Math.random() * 0.12,
      };
    }),
  ).current;

  return (
    <div className="fx-point fx-destroy" style={{ left: x, top: y }}>
      {/* shockwave */}
      <motion.div
        className="fx-circle"
        style={{ ...circle(100), border: '3px solid #ff8a4a' }}
        initial={{ scale: 0.2, opacity: 0.95 }}
        animate={{ scale: 2.6, opacity: 0 }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
      />
      {/* white-hot core */}
      <motion.div
        className="fx-circle"
        style={{
          ...circle(96),
          background: 'radial-gradient(circle, #fff6dd 0%, #ffb061 40%, #e0392b 65%, transparent 78%)',
          filter: 'drop-shadow(0 0 30px rgba(255, 140, 60, 0.9))',
        }}
        initial={{ scale: 0, opacity: 1 }}
        animate={{ scale: [0, 1.35, 0.5], opacity: [1, 1, 0] }}
        transition={{ duration: 0.5, times: [0, 0.45, 1], ease: 'easeOut' }}
      />
      {/* embers fling out, then drop and die */}
      {embers.map((e, i) => (
        <motion.div
          key={i}
          className="fx-ember"
          style={{ width: e.size, height: e.size, marginLeft: -e.size / 2, marginTop: -e.size / 2 }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          animate={{
            x: [0, e.dx, e.dx * 1.15],
            y: [0, e.dy * 0.7, e.dy + 30],
            opacity: [1, 1, 0],
            scale: [1, 0.9, 0.3],
          }}
          transition={{ duration: e.dur, delay: 0.08 + e.delay, times: [0, 0.55, 1], ease: 'easeOut' }}
        />
      ))}
      {/* smoke curls up after the blast */}
      {[0.25, 0.45, 0.68].map((delay, i) => (
        <motion.div
          key={i}
          className="fx-smoke"
          style={{ left: (i - 1) * 18 }}
          initial={{ y: 6, scale: 0.5, opacity: 0 }}
          animate={{ y: -44 - i * 10, scale: 1.7, opacity: [0, 0.5, 0] }}
          transition={{ duration: 1.5, delay, times: [0, 0.3, 1], ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}
