// Beast Blitz announced: the fierce-eyes art (public/ui/blitz-eyes.webp) cuts in as a slanted band across
// the middle of the screen like an ultimate skill — slides in, flashes, speed lines, slow zoom — and
// slides out when the spotlight ends. Rendered by CastSpotlight for the spotlight's whole window, behind
// the floating card. Click-through and hidden from assistive tech (the action log announces the skill).
import { motion } from 'framer-motion';

export function BlitzUltimate() {
  return (
    <motion.div
      className="blitz-ult"
      initial={{ opacity: 0, x: '-70%' }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: '45%', transition: { duration: 0.3 } }}
      transition={{ type: 'spring', stiffness: 240, damping: 26 }}
    >
      <div className="bu-band">
        <img className="bu-art" src="/ui/blitz-eyes.webp" alt="" draggable={false} />
        <i className="bu-lines" />
        <i className="bu-flash" />
      </div>
      <i className="bu-edge" />
    </motion.div>
  );
}
