// An ultimate skill announced: the caster's face cuts in as a slanted band across the middle of the screen —
// slides in, flashes, speed lines, slow zoom — and slides out when the spotlight ends. Beast Blitz shows
// Kunoichi's battle cry (gold/red), Grave Call the necromancer's grin (green), Pyre Adept's burning glare (orange), Thornwood Brute's Whipflash snarl (thorn green), Bulwark's flash guard (steel and gold), Kensei Duelist's first strike (cold steel-silver). Rendered by CastSpotlight
// for the spotlight's whole window, behind the floating card. Click-through and hidden from assistive tech
// (the action log announces the skill). Styles: .blitz-ult / .bu-* in index.css.
import { motion } from 'framer-motion';
import type { CutInKind } from './fxTiming';

const ART: Record<CutInKind, string> = {
  blitz: '/ui/blitz-face.webp',
  grave: '/ui/grave-grin.webp',
  pyre: '/ui/pyre-glare.webp',
  whip: '/ui/whip-face.webp',
  flash: '/ui/flash-guard.webp',
  rot: '/ui/rot-face.webp',
  charge: '/ui/charge-face.webp',
  thunder: '/ui/thunder-face.webp',
  breath: '/ui/breath-face.webp',
  strike: '/ui/strike-face.webp',
};

export function CutIn({ kind }: { kind: CutInKind }) {
  return (
    <motion.div
      className={'blitz-ult ' + kind}
      initial={{ opacity: 0, x: '-70%' }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: '45%', transition: { duration: 0.3 } }}
      transition={{ type: 'spring', stiffness: 240, damping: 26 }}
    >
      <div className="bu-band">
        <img className="bu-art" src={ART[kind]} alt="" draggable={false} />
        <i className="bu-lines" />
        <i className="bu-flash" />
      </div>
      <i className="bu-edge" />
    </motion.div>
  );
}
