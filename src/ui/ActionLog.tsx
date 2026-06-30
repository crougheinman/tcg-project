import type { RefObject } from 'react';
import { motion, useDragControls } from 'framer-motion';
import type { PlayerId } from '../engine/types';
import { humanize } from './boardLog';

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
  const recent = log.slice(-40).reverse(); // newest first
  return (
    <motion.div
      className="action-log"
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
      </div>
      <div className="action-log-body">
        {recent.map((line, i) => (
          <div key={log.length - i} className="log-line">
            {humanize(line, myId)}
          </div>
        ))}
      </div>
    </motion.div>
  );
}
