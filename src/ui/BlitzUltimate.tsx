// Beast Blitz announced: Kunoichi and her pack cut in at the bottom right like an ultimate skill —
// a burst of light, spinning rays, and the cut-out art (public/ui/blitz-ultimate.webp, background
// removed) slamming in with a glow. Rendered by CastSpotlight for the spotlight's whole window.
// Click-through and hidden from assistive tech (the action log announces the skill).
import { motion } from 'framer-motion';

export function BlitzUltimate() {
  return (
    <motion.div
      className="blitz-ult"
      initial={{ opacity: 0, x: 140, y: 60, scale: 0.86 }}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 90, scale: 1.05, transition: { duration: 0.35 } }}
      transition={{ type: 'spring', stiffness: 230, damping: 19 }}
    >
      <i className="bu-flash" />
      <i className="bu-rays" />
      <img className="bu-art" src="/ui/blitz-ultimate.webp" alt="" draggable={false} />
    </motion.div>
  );
}
