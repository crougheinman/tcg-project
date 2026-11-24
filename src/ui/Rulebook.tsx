import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { KEYWORD_INFO } from '../cards/keywords';

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
    title: 'Opening Hand',
    items: [
      'Each player starts with 7 cards and may keep them or take a mulligan.',
      'A mulligan shuffles your hand back and draws one card fewer. You may do it up to 3 times.',
      'You decide first, then your opponent. A hand with 2 to 5 lands is usually a keeper.',
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
      'Sorcery — a one-time effect, cast only in your main phase.',
      'Instant — like a sorcery, but castable any time you can act — during combat, or on defense while blocking.',
    ],
  },
  {
    title: 'Combat',
    items: [
      'Attacking creatures tap (unless they have Vigilance).',
      'Each blocker blocks one attacker; each attacker is blocked by at most one.',
      'Unblocked attackers hit the player; blocked creatures trade damage. With first strike or double strike in the fight, damage is dealt in two steps and creatures destroyed in the first step do not strike back.',
      'A creature with damage equal to or above its toughness is destroyed (unless it is indestructible).',
    ],
  },
  {
    title: 'Keywords',
    items: Object.values(KEYWORD_INFO).map((k) => `${k.label} — ${k.rule}`),
  },
  {
    title: 'Tips',
    items: [
      'Hover a card — or press and hold on mobile — to read its full details.',
      'Watch the activity log (bottom-right) to follow every action.',
      'Flashback: a spell with Flashback can be cast again from your graveyard (tap the graveyard counter), for its flashback cost. It is then exiled.',
      'Landfall triggers when a land enters under your control (played or ramped). An attack trigger fires when its creature attacks, even if it is then blocked. Morbid is true once a creature has died this turn, and a second-spell bonus once you have cast two spells this turn (creature spells count); both are on the card that carries them.',
      'Cycling: in your main phase you may pay a card\'s cycling cost and discard it from your hand to draw a card (tap Cycle, then the card). Edict: the opponent sacrifices a creature of THEIR choice, and a sacrificed creature dies even if indestructible. Bounce sends a creature back to its owner\'s hand (a token just vanishes). Rally gives all your creatures a bonus until end of turn.',
      'Activated abilities: in your main phase tap Ability, then a creature, to use it. {T} needs the creature untapped and not summoning sick, and it stays tapped through your opponent\'s turn (so it cannot block); a mana cost is paid from your lands. {T}: Add one mana puts floating mana in your pool, which empties when the phase ends.',
      'Scry N: look at the top N cards of your library one at a time and keep each on top or put it on the bottom. Loot: draw a card, then discard a card of your choice. Hexproof: your opponent\'s spells and abilities cannot target it (yours can; combat and damage to players are unaffected). Bite: your creature with the greatest power deals damage equal to its power to target opposing creature.',
      'Cast options: a Modal spell ("choose one") asks which effect before it is cast. Kicker: pay the extra cost and the spell does its extra effect too. X: you choose X, pay it on top of the cost, and the effect scales with it. Ward {N}: your opponent\'s spells that target that creature cost N more (a spell at a player is not taxed).',
      'Static abilities (Beast Blitz, Zombie lords, Threshold) are always on while their creature is in play: they lift other creatures, or the creature itself, and end the moment it leaves. Threshold counts the cards in YOUR graveyard (7 or more). Lords stack with each other; Beast Blitz does not.',
      'Last breath triggers when a creature dies (tokens too). Rot makes the opponent discard at random. Grave Call returns your most recently fallen creature.',
    ],
  },
];

export function Rulebook({
  label = true,
  icon = true,
  trigger = true,
  open: openProp,
  onOpenChange,
}: {
  label?: boolean;
  icon?: boolean; // render the 📖 glyph
  trigger?: boolean; // render the 📖 button (false = controlled externally)
  open?: boolean; // controlled open state
  onOpenChange?: (v: boolean) => void;
}) {
  const [openState, setOpenState] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : openState;
  const setOpen = (v: boolean) => (controlled ? onOpenChange?.(v) : setOpenState(v));
  return (
    <>
      {trigger && (
        <button
          className="book-btn"
          onClick={() => setOpen(true)}
          title="Rulebook"
          aria-label="Open rulebook"
        >
          {icon && (
            <span className="book-ico" aria-hidden>
              📖
            </span>
          )}
          {label && <span>Rulebook</span>}
        </button>
      )}

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
                <h2 className="scroll-title">Entity Duel — How to Play</h2>
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
