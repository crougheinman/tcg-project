import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGame } from '../store/gameStore';
import { hasSupabase } from '../net/supabase';
import { randomDeck } from '../cards/decks';
import { Rulebook } from './Rulebook';
import { DeckSelect } from './DeckSelect';

export function MainMenu({ onOnline }: { onOnline: () => void }) {
  const startAI = useGame((s) => s.startAI);
  const startHotseat = useGame((s) => s.startHotseat);
  // After picking a mode, choose a deck before the game starts.
  const [picking, setPicking] = useState<'ai' | 'hotseat' | null>(null);
  const [p1Deck, setP1Deck] = useState<string | null>(null); // hotseat: player 1's deck
  const [aiDeck, setAiDeck] = useState<string | null>(null); // vs AI: opponent deck, pre-picked for the face-off

  const cancel = () => {
    setPicking(null);
    setP1Deck(null);
    setAiDeck(null);
  };

  // Resolve the current screen (keyed so it can animate in/out).
  let screen: string;
  let content: ReactNode;
  if (picking === 'ai') {
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
    content = (
      <div className="menu">
        <div className="home-bg" aria-hidden />
        <h1 className="logo">ENTITY DUEL</h1>
        <p className="tagline">a tiny trading card game</p>
        <div className="menu-buttons">
          <button
            onClick={() => {
              setAiDeck(randomDeck().id); // pick now so the face-off can show it
              setPicking('ai');
            }}
          >
            Play vs AI
          </button>
          <button onClick={() => setPicking('hotseat')}>Hotseat (2 players, 1 device)</button>
          <button onClick={onOnline} disabled={!hasSupabase}>
            Online PvP{!hasSupabase ? ' (set Supabase keys)' : ''}
          </button>
          <Rulebook icon={false} />
        </div>
        {!hasSupabase && (
          <p className="hint">
            Online needs a free Supabase project. Copy <code>.env.local.example</code> to{' '}
            <code>.env.local</code> and add your URL + anon key.
          </p>
        )}
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
