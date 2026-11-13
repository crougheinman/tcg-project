import { useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import type { PlayerId } from '../engine/types';
import { useGame } from '../store/gameStore';
import { ChatBubble } from './ChatBubble';
import { useRolling } from './useRolling';

/** Life at or below this pulses as a warning (starting life is 20). */
const LOW_LIFE = 5;
/** Past this many lands the crystals stop fitting; fall back to "7/12". */
const MAX_PIPS = 10;

// One player's badge: the shield (the thing spells and attacks aim at), life,
// mana, and — for the opponent — the counts you cannot otherwise see.
export function PlayerBar({
  p,
  side,
  mana,
  onFace,
  targetable,
  self,
  acting,
  onGraveyard,
}: {
  p: { life: number; hand: unknown[]; library: unknown[]; graveyard: unknown[] };
  side: PlayerId;
  mana: { avail: number; total: number };
  onFace: () => void;
  targetable?: boolean;
  self?: boolean;
  /** This player is the one the game is waiting on right now. */
  acting?: boolean;
  /** Opponent only: open their graveyard (public information). */
  onGraveyard?: () => void;
}) {
  // Pulse the mana readout for 2s whenever it changes (cast / land / untap).
  const [manaPulse, setManaPulse] = useState(false);
  const prevAvail = useRef(mana.avail);
  useEffect(() => {
    if (prevAvail.current === mana.avail) return;
    prevAvail.current = mana.avail;
    setManaPulse(true);
    const t = setTimeout(() => setManaPulse(false), 2000);
    return () => clearTimeout(t);
  }, [mana.avail]);

  // Life counts to its new value and flashes red (hurt) or green (healed).
  const life = useRolling(p.life);

  // Current chat bubble for this side (PvP only; null otherwise).
  const bubble = useGame((s) => s.chat[side]);
  const who = self ? 'You' : 'Opponent';
  const usePips = mana.total > 0 && mana.total <= MAX_PIPS;

  return (
    <div className={'playerbar' + (self ? ' me' : '') + (acting ? ' acting' : '')}>
      <AnimatePresence>
        {bubble && <ChatBubble key={bubble.id} text={bubble.text} self={self} />}
      </AnimatePresence>
      <span
        className={'shield-avatar ' + (targetable ? 'targetable' : '')}
        data-player={side}
        onClick={onFace}
        title={who + (targetable ? ' — target' : acting ? ' — to act' : '')}
      >
        <svg className="user-ico" viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="8" r="3.6" />
          <path d="M5 20c0-4 3.5-6 7-6s7 2 7 6" />
        </svg>
      </span>
      <div className="pstats">
        <span
          className={
            'life' + (life.dir ? ' ' + life.dir : '') + (p.life <= LOW_LIFE ? ' low' : '')
          }
          title="Life — you lose when this hits 0"
          aria-label={`${who}: ${p.life} life`}
        >
          <span aria-hidden>♥</span> {life.shown}
        </span>
        {/* Mana and the opponent's counts share a wrapper so a phone can lay them
            out as ONE row under the shield. Stacked on desktop. */}
        <span className="pmeta">
          <span
            className={'mana' + (usePips ? ' pips' : '') + (manaPulse ? ' pulse' : '')}
            title={`Mana — ${mana.avail} of ${mana.total} available. Lands tap to pay card costs`}
            aria-label={`${who}: ${mana.avail} of ${mana.total} mana available`}
          >
            {/* One crystal per land: lit while it can still pay, hollow once spent. */}
            {usePips &&
              Array.from({ length: mana.total }, (_, i) => (
                <i key={i} className={'pip' + (i < mana.avail ? ' full' : '')} aria-hidden />
              ))}
            {/* The same reading as a number. Shown instead of crystals when there
                are too many lands to fit, and on the phone's compact opponent row. */}
            <span className="mana-num" aria-hidden>
              ◈ {mana.avail}/{mana.total}
            </span>
          </span>
          {!self && (
            // Your own hand, deck and graveyard are on the table in front of you. The
            // opponent's are not, and hand size in particular is half of every decision.
            <span className="counts">
              <span className="count-chip" title="Cards in their hand" aria-label={`${p.hand.length} cards in hand`}>
                <span aria-hidden>✋</span> {p.hand.length}
              </span>
              <span
                className={'count-chip' + (p.library.length <= 5 ? ' low' : '')}
                title="Cards left in their deck"
                aria-label={`${p.library.length} cards in deck`}
              >
                <span aria-hidden>🂠</span> {p.library.length}
              </span>
              <button
                className="count-chip"
                onClick={onGraveyard}
                title="View their graveyard"
                aria-label={`Opponent graveyard: ${p.graveyard.length} cards. View`}
              >
                <span aria-hidden>⚰</span> {p.graveyard.length}
              </button>
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
