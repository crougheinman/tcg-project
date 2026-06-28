import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Reusable rulebook. Renders its own book button + an animated parchment scroll
// that unrolls open. Drop <Rulebook /> anywhere (home menu, battle topbar).

const SECTIONS: { title: string; items: string[] }[] = [
  {
    title: 'Goal',
    items: [
      'Reduce your opponent from 20 life to 0 to win.',
      'If a player must draw from an empty deck, they lose.',
    ],
  },
  {
    title: 'Your Turn',
    items: [
      'Untap and draw a card (automatic).',
      'Main phase: play one land, cast creatures and sorceries.',
      'Combat: declare attackers, the opponent blocks, then damage is dealt.',
      'End: pass the turn to your opponent.',
    ],
  },
  {
    title: 'Mana',
    items: [
      'Each land taps for 1 mana.',
      'You may play at most one land per turn.',
      "A card's cost is the number on its orb — you need that many untapped lands.",
    ],
  },
  {
    title: 'Card Types',
    items: [
      'Land — taps for mana.',
      'Creature — has power / toughness; can attack and block.',
      'Sorcery — a one-time effect, then goes to the graveyard.',
    ],
  },
  {
    title: 'Combat',
    items: [
      'Attacking creatures tap.',
      'Each blocker blocks one attacker; each attacker is blocked by at most one.',
      'Unblocked attackers hit the player; blocked creatures trade damage.',
      'A creature with damage equal to or above its toughness is destroyed.',
    ],
  },
  {
    title: 'Keywords',
    items: [
      'Haste — can attack the turn it enters play.',
      'Flying — can only be blocked by creatures with Flying.',
    ],
  },
  {
    title: 'Tips',
    items: [
      'Hover a card — or press and hold on mobile — to read its full details.',
      'Watch the activity log (bottom-right) to follow every action.',
    ],
  },
];

export function Rulebook({ label = true }: { label?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="book-btn"
        onClick={() => setOpen(true)}
        title="Rulebook"
        aria-label="Open rulebook"
      >
        <span className="book-ico" aria-hidden>
          📖
        </span>
        {label && <span>Rulebook</span>}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="book-backdrop"
            onClick={() => setOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="scroll"
              onClick={(e) => e.stopPropagation()}
              initial={{ scaleY: 0, opacity: 0 }}
              animate={{ scaleY: 1, opacity: 1 }}
              exit={{ scaleY: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 240, damping: 26 }}
              style={{ transformOrigin: 'top' }}
            >
              <div className="scroll-rod" />
              <motion.div
                className="scroll-body"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.18 }}
              >
                <h2 className="scroll-title">Leaf War — How to Play</h2>
                {SECTIONS.map((s) => (
                  <section key={s.title} className="scroll-sec">
                    <h3>{s.title}</h3>
                    <ul>
                      {s.items.map((it, i) => (
                        <li key={i}>{it}</li>
                      ))}
                    </ul>
                  </section>
                ))}
                <button className="primary scroll-close" onClick={() => setOpen(false)}>
                  Close
                </button>
              </motion.div>
              <div className="scroll-rod" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
