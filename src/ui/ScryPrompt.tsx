import { motion } from 'framer-motion';
import { CardView } from './CardView';
import { HelpLink } from './HelpLink';
import type { CardInstance } from '../engine/types';

// The Scry decision: the card on top of your library, and where it goes. Shown only to the player who is scrying (it is hidden information).
export function ScryPrompt({
  card,
  index,
  total,
  onKeep,
  onBottom,
  onHelp,
}: {
  card: CardInstance;
  index: number; // 0-based position among the cards being looked at
  total: number;
  onKeep: () => void;
  onBottom: () => void;
  onHelp?: () => void;
}) {
  return (
    <div className="zone-overlay scry-overlay" role="dialog" aria-label="Scry">
      <motion.div
        className="zone-modal scry-modal"
        initial={{ opacity: 0, scale: 0.92, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      >
        <div className="zone-head">
          <span className="zone-title">Scry</span>
          <span className="zone-total">
            card {index + 1} of {total}
          </span>
          {onHelp && <HelpLink page="effects" onOpen={onHelp} />}
        </div>
        <div className="scry-body">
          <CardView inst={card} />
          <div className="scry-actions">
            <button className="zone-flash" onClick={onKeep}>
              Keep on top
            </button>
            <button className="zone-flash scry-bottom" onClick={onBottom}>
              Put on the bottom
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
