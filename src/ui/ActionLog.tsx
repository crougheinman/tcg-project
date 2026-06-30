import { useState, type RefObject } from 'react';
import { motion, useDragControls } from 'framer-motion';
import type { PlayerId } from '../engine/types';
import { humanize } from './boardLog';

// Collapsed by default on phones so the log doesn't cover the player dock; the
// header chip stays tappable to expand. Open by default on larger screens.
const startCollapsed = () =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches;

export function ActionLog({
  log,
  myId,
  boundsRef,
}: {
  log: string[];
  myId: PlayerId;
  boundsRef: RefObject<HTMLDivElement>;
}) {
  const controls = useDragControls();
  const [open, setOpen] = useState(() => !startCollapsed());
  const recent = log.slice(-40).reverse(); // newest first
  return (
    <motion.div
      className={'action-log' + (open ? '' : ' collapsed')}
      drag
      dragListener={false}
      dragControls={controls}
      dragConstraints={boundsRef}
      dragMomentum={false}
      dragElastic={0.12}
    >
      <div
        className="action-log-head"
        onPointerDown={(e) => controls.start(e)}
        style={{ touchAction: 'none' }}
      >
        <span className="grip" aria-hidden>
          ⠿
        </span>
        Activity
        <button
          className="log-toggle"
          // Don't let the toggle start a drag; just collapse/expand.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? 'Collapse activity log' : 'Expand activity log'}
        >
          {open ? '▾' : '▸'}
        </button>
      </div>
      {open && (
        <div className="action-log-body">
          {recent.map((line, i) => (
            <div key={log.length - i} className="log-line">
              {humanize(line, myId)}
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
