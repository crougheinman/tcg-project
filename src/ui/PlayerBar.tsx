import { useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import type { PlayerId } from '../engine/types';
import { useGame } from '../store/gameStore';
import { ChatBubble } from './ChatBubble';

export function PlayerBar({
  p,
  side,
  mana,
  onFace,
  targetable,
  self,
}: {
  p: { life: number; hand: unknown[]; library: unknown[] };
  side: PlayerId;
  mana: { avail: number; total: number };
  onFace: () => void;
  targetable?: boolean;
  self?: boolean;
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
  // Current chat bubble for this side (PvP only; null otherwise).
  const bubble = useGame((s) => s.chat[side]);
  return (
    <div className={'playerbar' + (self ? ' me' : '')}>
      <AnimatePresence>
        {bubble && <ChatBubble key={bubble.id} text={bubble.text} self={self} />}
      </AnimatePresence>
      <span
        className={'shield-avatar ' + (targetable ? 'targetable' : '')}
        data-player={side}
        onClick={onFace}
        title={(self ? 'You' : 'Opponent') + (targetable ? ' — target' : '')}
      >
        <svg className="user-ico" viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="8" r="3.6" />
          <path d="M5 20c0-4 3.5-6 7-6s7 2 7 6" />
        </svg>
      </span>
      <div className="pstats">
        <span className="life" title="Life — you lose when this hits 0">
          ♥ {p.life}
        </span>
        <span
          className={'mana' + (manaPulse ? ' pulse' : '')}
          title="Mana — untapped lands / total. Lands tap to pay card costs"
        >
          ◈ {mana.avail}/{mana.total}
        </span>
        <span className="counts" title="Cards in hand · cards left in deck">
          {p.hand.length} ✋ · {p.library.length} 🂠
        </span>
      </div>
    </div>
  );
}
