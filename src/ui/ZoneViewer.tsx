import { motion } from 'framer-motion';
import { getDef } from '../cards/cards';
import { CardView } from './CardView';
import type { CardInstance } from '../engine/types';

// Modal listing every card in a zone (deck / graveyard), grouped with counts.
export function ZoneViewer({
  title,
  cards,
  onClose,
}: {
  title: string;
  cards: CardInstance[];
  onClose: () => void;
}) {
  const groups = new Map<string, { inst: CardInstance; count: number }>();
  for (const c of cards) {
    const g = groups.get(c.def);
    if (g) g.count++;
    else groups.set(c.def, { inst: c, count: 1 });
  }
  const list = [...groups.values()].sort(
    (a, b) =>
      getDef(a.inst.def).cost - getDef(b.inst.def).cost ||
      getDef(a.inst.def).name.localeCompare(getDef(b.inst.def).name),
  );

  return (
    <div className="zone-overlay" onClick={onClose}>
      <motion.div
        className="zone-modal"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.9, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      >
        <div className="zone-head">
          <span className="zone-title">{title}</span>
          <span className="zone-total">{cards.length} cards</span>
          <button className="link zone-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="zone-grid">
          {list.length === 0 && <div className="empty">empty</div>}
          {list.map((g) => (
            <div key={g.inst.def} className="zone-card">
              <CardView inst={g.inst} />
              <span className="zone-x">×{g.count}</span>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
