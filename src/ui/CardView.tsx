import { useRef } from 'react';
import { motion } from 'framer-motion';
import { getDef } from '../cards/cards';
import { power, toughness } from '../engine/rules';
import type { CardInstance } from '../engine/types';
import { useSetHover } from './hover';

const LONG_PRESS_MS = 320;

interface Props {
  inst: CardInstance;
  faceDown?: boolean;
  selected?: boolean;
  targetable?: boolean;
  dim?: boolean;
  onClick?: () => void;
}

// Framer Motion owns transform (scale/rotate/y) so it can animate enter, exit,
// reorder, tap, and hover. CSS keeps colors, borders, glows (non-transform).
const spring = { type: 'spring' as const, stiffness: 500, damping: 32 };

export function CardView({ inst, faceDown, selected, targetable, dim, onClick }: Props) {
  const setHover = useSetHover();
  const pressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const longPressed = useRef(false);

  // Touch: hold to preview; a long-press suppresses the tap-to-play that follows.
  function onTouchStart() {
    longPressed.current = false;
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      setHover(inst);
    }, LONG_PRESS_MS);
  }
  function endPress() {
    clearTimeout(pressTimer.current);
    if (longPressed.current) setHover(null);
  }
  function handleClick() {
    if (longPressed.current) {
      longPressed.current = false; // consumed by the long-press preview
      return;
    }
    onClick?.();
  }

  if (faceDown) {
    return (
      <motion.div
        className="card card-back"
        layout
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.6 }}
        transition={spring}
      />
    );
  }
  const def = getDef(inst.def);
  const cls = [
    'card',
    `card-${def.type}`,
    inst.tapped ? 'tapped' : '',
    selected ? 'selected' : '',
    targetable ? 'targetable' : '',
    dim ? 'dim' : '',
    onClick ? 'clickable' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const isCreature = def.type === 'creature';
  const pwr = power(inst);
  const tuf = toughness(inst);

  return (
    <motion.div
      className={cls}
      data-iid={inst.iid}
      onClick={handleClick}
      onMouseEnter={() => setHover(inst)}
      onMouseLeave={() => setHover(null)}
      onTouchStart={onTouchStart}
      onTouchEnd={endPress}
      onTouchCancel={endPress}
      onTouchMove={() => clearTimeout(pressTimer.current)}
      title={def.text}
      layout
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1, rotate: inst.tapped ? 90 : 0 }}
      exit={{ opacity: 0, scale: 0.5 }}
      whileHover={onClick ? { y: -6 } : undefined}
      transition={spring}
    >
      <div className="card-top">
        <span className="card-name">{def.name}</span>
        {def.type !== 'land' && <span className="card-cost">{def.cost}</span>}
      </div>
      <div className="card-type">{def.type}</div>
      {def.art && (
        <img
          className="card-art"
          src={def.art}
          alt=""
          onError={(e) => {
            const img = e.currentTarget;
            // PNG missing -> try SVG; SVG missing too -> text frame.
            if (img.src.endsWith('.png')) img.src = img.src.replace(/\.png$/, '.svg');
            else img.style.display = 'none';
          }}
        />
      )}
      {def.text && <div className="card-text">{def.text}</div>}
      <div className="card-bottom">
        {isCreature && (
          <span className={'card-pt' + (inst.damage > 0 ? ' damaged' : '')}>
            {pwr}/{tuf - inst.damage}
          </span>
        )}
        {inst.summoningSick && isCreature && (
          <span className="badge sick" title="Summoning sick">
            zZ
          </span>
        )}
      </div>
    </motion.div>
  );
}
