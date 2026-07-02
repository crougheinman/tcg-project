import { useLayoutEffect, useRef, useState } from 'react';
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

const GAP = 14; // clearance between the bubble and its anchor

export function CoachBubble({ tip, onHush }: { tip: Tip; onHush: (key: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; top: number; place: 'above' | 'below' } | null>(null);

  // Position the bubble by computing an explicit top from its OWN measured height,
  // rather than lifting it with a CSS translate (-100%) that has to compose with
  // framer-motion's animated transform — that composition is fragile across browsers
  // and was dropping the bubble onto the hand. offsetHeight is the layout height, so
  // it's correct even while framer is mid-scale.
  useLayoutEffect(() => {
    const measure = () => {
      const el = document.querySelector(tip.sel);
      const bubble = ref.current;
      if (!el || !bubble) return setPos(null);
      const r = el.getBoundingClientRect();
      const place = tip.place ?? 'above';
      const bh = bubble.offsetHeight;
      const top = place === 'above' ? r.top - GAP - bh : r.bottom + GAP;
      setPos({
        // clamp x so the bubble never leaves the viewport
        x: Math.min(Math.max(r.left + r.width / 2, 140), window.innerWidth - 140),
        top: Math.max(6, top), // never run off the top edge
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

  return (
    <motion.div
      ref={ref}
      className={'coach-bubble ' + (pos?.place ?? 'above')}
      // Rendered (hidden) even before positioning so its height can be measured;
      // only horizontal centering rides on the CSS translate (composes safely).
      style={{
        left: pos ? pos.x : -9999,
        top: pos ? pos.top : -9999,
        visibility: pos ? 'visible' : 'hidden',
      }}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
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
