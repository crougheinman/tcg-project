import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';

// Guided-mode coach: ONE contextual bubble at a time, anchored to the UI element
// the player should look at (hand, creatures, a button). Board computes which tip
// applies; this component only measures the anchor and draws the bubble.

export interface Tip {
  key: string; // stable id — keys the enter/exit animation and the hush set
  sel: string; // CSS selector of the element the bubble points at
  text: string;
  place?: 'above' | 'below'; // bubble position relative to the anchor (default above)
}

export function CoachBubble({ tip, onHush }: { tip: Tip; onHush: (key: string) => void }) {
  const [pos, setPos] = useState<{ x: number; y: number; place: 'above' | 'below' } | null>(null);

  useEffect(() => {
    const measure = () => {
      const el = document.querySelector(tip.sel);
      if (!el) return setPos(null);
      const r = el.getBoundingClientRect();
      const place = tip.place ?? 'above';
      setPos({
        // clamp x so the bubble never leaves the viewport
        x: Math.min(Math.max(r.left + r.width / 2, 130), window.innerWidth - 130),
        y: place === 'above' ? r.top - 10 : r.bottom + 10,
        place,
      });
    };
    measure();
    const settle = setTimeout(measure, 400); // re-measure after enter animations settle
    window.addEventListener('resize', measure);
    return () => {
      clearTimeout(settle);
      window.removeEventListener('resize', measure);
    };
  }, [tip]);

  if (!pos) return null;
  return (
    <motion.div
      className={'coach-bubble ' + pos.place}
      style={{ left: pos.x, top: pos.y }}
      initial={{ opacity: 0, scale: 0.8, y: pos.place === 'above' ? 8 : -8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 26 }}
    >
      <span className="coach-ico" aria-hidden>
        🧙
      </span>
      <span className="coach-text">{tip.text}</span>
      <button className="coach-x" onClick={() => onHush(tip.key)} aria-label="Dismiss tip">
        ×
      </button>
    </motion.div>
  );
}
