import { useEffect, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGame } from '../store/gameStore';
import { hasSupabase } from '../net/supabase';
import { loadMatch } from '../net/resume';
import { DECK_LIST, randomDeck } from '../cards/decks';
import { CARDS } from '../cards/cards';
import type { CardDef } from '../engine/types';
import { artFallback } from './artFallback';
import { Rulebook } from './Rulebook';
import { DeckSelect } from './DeckSelect';
import { CardGallery } from './CardGallery';
import { DeckBuilder } from './DeckBuilder';
import { APP_VERSION } from '../version';

// Home-page patch notes. Balance pass tuned across ~5,000 simulated AI-vs-AI duels
// so every deck lands in a ~44–56% win band with real strengths and weaknesses.
// Shown as the scrolling ticker along the bottom of the home screen.
const PATCH_NOTES: { deck: string; kind: 'buff' | 'nerf'; change: string; why: string }[] = [
  {
    deck: 'Grave Tide',
    kind: 'nerf',
    change: 'Withering Touch hits for 3 (was 4), Shambling Ghoul is 2/2 (was 2/3), and one Grasp from the Grave became a Ghoul.',
    why: 'The AI learned to hold removal for the block step, and Grave Tide ran away with the format.',
  },
  {
    deck: 'Wildblitz',
    kind: 'buff',
    change: 'Two lands became two more Swift Lancers — down to 10 lands.',
    why: 'A deck that tops out at three mana was drowning in lands it could not spend.',
  },
  {
    deck: 'Pyromancer',
    kind: 'buff',
    change: 'One land became a fourth Pyre Adept.',
    why: 'Same story, milder: it flooded out instead of applying pressure.',
  },
  {
    deck: 'Stonewall',
    kind: 'nerf',
    change: 'One Storm Drake became a fourth Granite Sentinel.',
    why: 'Great blockers AND the best finisher was too much of both.',
  },
];

// The two duellists on the home page: random creatures from the eight decks, swapped on a slow timer
// (the sides take turns, never showing the same card twice at once). Cosmetic only, so Math.random is fine.
const DUELIST_MS = 9000;
const DUELIST_POOL = (() => {
  const seen = new Set<string>();
  const out: { def: CardDef; deck: string }[] = [];
  for (const d of DECK_LIST) {
    for (const id of d.cards) {
      const def = CARDS[id];
      if (def.type !== 'creature' || seen.has(id)) continue;
      seen.add(id);
      out.push({ def, deck: d.name });
    }
  }
  return out;
})();

const pickDuelist = (not: (CardDef | undefined)[]) => {
  const pool = DUELIST_POOL.filter((p) => !not.includes(p.def));
  return pool[Math.floor(Math.random() * pool.length)];
};

function useDuelists() {
  const [pair, setPair] = useState(() => {
    const l = pickDuelist([]);
    return { l, r: pickDuelist([l.def]) };
  });
  useEffect(() => {
    const swap = (side: 'l' | 'r') => () =>
      setPair((p) => ({ ...p, [side]: pickDuelist([p.l.def, p.r.def]) }));
    const a = setInterval(swap('l'), DUELIST_MS);
    let b = 0;
    const t = setTimeout(() => (b = window.setInterval(swap('r'), DUELIST_MS)), DUELIST_MS / 2);
    return () => {
      clearInterval(a);
      clearTimeout(t);
      clearInterval(b);
    };
  }, []);
  return pair;
}

// Arrow keys walk the home menu like a game menu. Only the row buttons count —
// the rulebook's own overlay buttons live inside the list too, and must be left alone.
const ROW_BUTTONS = ':scope > li > button:not(:disabled)';

function menuKeys(e: KeyboardEvent<HTMLUListElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  const rows = [...e.currentTarget.querySelectorAll<HTMLButtonElement>(ROW_BUTTONS)];
  const at = rows.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  e.preventDefault();
  const step = e.key === 'ArrowDown' ? 1 : -1;
  rows[(at + step + rows.length) % rows.length].focus();
}

// Hovering a row makes it the hot one, so mouse and keyboard share one highlight.
function menuHover(e: MouseEvent<HTMLUListElement>) {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.vs-menu > li > button');
  if (btn && !btn.disabled && btn !== document.activeElement) btn.focus({ preventScroll: true });
}

export function MainMenu({ onOnline }: { onOnline: () => void }) {
  const startAI = useGame((s) => s.startAI);
  const startHotseat = useGame((s) => s.startHotseat);
  const resumePvp = useGame((s) => s.resumePvp);
  // An unfinished PvP match from this tab (reload / crash). Read once on mount so
  // the button doesn't vanish mid-render once the record is cleared.
  const [resumable] = useState(() => loadMatch());
  // After picking a mode, choose a deck before the game starts.
  const [picking, setPicking] = useState<'ai' | 'hotseat' | null>(null);
  const [p1Deck, setP1Deck] = useState<string | null>(null); // hotseat: player 1's deck
  const [aiDeck, setAiDeck] = useState<string | null>(null); // vs AI: opponent deck, pre-picked for the face-off
  const [showGallery, setShowGallery] = useState(false); // browse every card in the game
  const [showBuilder, setShowBuilder] = useState(false);
  const duel = useDuelists();

  const cancel = () => {
    setPicking(null);
    setP1Deck(null);
    setAiDeck(null);
  };

  // Resolve the current screen (keyed so it can animate in/out).
  let screen: string;
  let content: ReactNode;
  if (showBuilder) {
    screen = 'builder';
    content = <DeckBuilder onBack={() => setShowBuilder(false)} />;
  } else if (showGallery) {
    screen = 'gallery';
    content = <CardGallery onBack={() => setShowGallery(false)} />;
  } else if (picking === 'ai') {
    screen = 'ai';
    content = (
      <DeckSelect
        title="Choose your deck — vs AI (opponent's deck is random)"
        onPick={(deckId) => startAI(deckId, aiDeck ?? undefined)}
        onBack={cancel}
        confirmStart
        vsDeckId={aiDeck ?? undefined}
      />
    );
  } else if (picking === 'hotseat' && !p1Deck) {
    screen = 'hs1';
    content = <DeckSelect title="Player 1 — choose your deck" onPick={setP1Deck} onBack={cancel} />;
  } else if (picking === 'hotseat') {
    screen = 'hs2';
    content = (
      <DeckSelect
        title="Player 2 — choose your deck"
        onPick={(d2) => startHotseat(p1Deck!, d2)}
        onBack={() => setP1Deck(null)}
        disabledId={p1Deck!}
        confirmStart
        vsDeckId={p1Deck!}
      />
    );
  } else {
    screen = 'home';
    // The ticker runs as two identical sets so the loop is seamless; only the first is read aloud.
    const notes = (hidden: boolean) => (
      <div className="vs-run-set" aria-hidden={hidden || undefined}>
        {PATCH_NOTES.map((n) => (
          <span key={n.deck} className={n.kind}>
            <b>{n.kind === 'buff' ? '▲ BUFF' : '▼ NERF'}</b> {n.deck} — {n.change}
          </span>
        ))}
      </div>
    );
    content = (
      <div className="vs-home">
        <div className="vs-side vs-left" aria-hidden>
          <img key={duel.l.def.id} src={duel.l.def.art} alt="" draggable={false} onError={artFallback} />
          <div className="vs-tag" key={'t' + duel.l.def.id}>
            {duel.l.def.name}
            <small>{duel.l.deck.toUpperCase()}</small>
          </div>
        </div>
        <div className="vs-side vs-right" aria-hidden>
          <img key={duel.r.def.id} src={duel.r.def.art} alt="" draggable={false} onError={artFallback} />
          <div className="vs-tag" key={'t' + duel.r.def.id}>
            {duel.r.def.name}
            <small>{duel.r.deck.toUpperCase()}</small>
          </div>
        </div>
        <div className="vs-seam" aria-hidden />

        <main className="vs-center">
          <h1 className="vs-logo" aria-label="Entity Duel">
            <span className="e" aria-hidden>Entity</span>
            <i aria-hidden>
              <b>VS</b>
            </i>
            <span className="d" aria-hidden>Duel</span>
          </h1>
          <p className="vs-sub">
            A TINY TRADING CARD GAME
            <br />
            <b aria-hidden>▶</b> CHOOSE YOUR MATCH
          </p>

          <ul className="vs-menu" onKeyDown={menuKeys} onMouseOver={menuHover}>
            <li className="main">
              <button
                autoFocus
                onClick={() => {
                  setAiDeck(randomDeck().id); // pick now so the face-off can show it
                  setPicking('ai');
                }}
              >
                Play vs AI <small>SOLO</small>
              </button>
            </li>
            <li>
              <button onClick={() => setPicking('hotseat')}>
                Hotseat <small>2 PLAYERS</small>
              </button>
            </li>
            <li>
              <button onClick={onOnline} disabled={!hasSupabase}>
                Online PvP <small>{hasSupabase ? 'ROOM CODE' : 'SET KEYS'}</small>
              </button>
            </li>
            {resumable && hasSupabase && (
              <li>
                <button onClick={resumePvp}>
                  Reconnect <small>{resumable.roomId}</small>
                </button>
              </li>
            )}
            <li>
              <button onClick={() => setShowGallery(true)}>
                Card Codex <small>BROWSE</small>
              </button>
            </li>
            <li>
              <button onClick={() => setShowBuilder(true)}>
                Deck Builder <small>30 CARDS</small>
              </button>
            </li>
            <li>
              <Rulebook icon={false} />
            </li>
          </ul>
          <div className="vs-keys" aria-hidden>
            <kbd>↑</kbd> <kbd>↓</kbd> SELECT &nbsp; <kbd>ENTER</kbd> CONFIRM
          </div>

          {!hasSupabase && (
            <p className="hint vs-hint">
              Online needs a free Supabase project. Copy <code>.env.local.example</code> to{' '}
              <code>.env.local</code> and add your URL + anon key.
            </p>
          )}
        </main>

        <div className="vs-ticker" role="region" aria-label={`Balance update v${APP_VERSION}`}>
          <div className="vs-lab">PATCH {APP_VERSION}</div>
          <div className="vs-run">
            {notes(false)}
            {notes(true)}
          </div>
        </div>
      </div>
    );
  }

  // Crossfade + slide between home and the deck-select screens.
  return (
    <div className="screen-stack">
      <AnimatePresence initial={false}>
        <motion.div
          key={screen}
          className="screen"
          initial={{ opacity: 0, x: 60 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -60 }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
          {content}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
