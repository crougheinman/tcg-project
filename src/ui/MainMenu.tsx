import { useState } from 'react';
import { useGame } from '../store/gameStore';
import { hasSupabase } from '../net/supabase';
import { Rulebook } from './Rulebook';
import { DeckSelect } from './DeckSelect';

export function MainMenu({ onOnline }: { onOnline: () => void }) {
  const startAI = useGame((s) => s.startAI);
  const startHotseat = useGame((s) => s.startHotseat);
  // After picking a mode, choose a deck before the game starts.
  const [picking, setPicking] = useState<'ai' | 'hotseat' | null>(null);
  const [p1Deck, setP1Deck] = useState<string | null>(null); // hotseat: player 1's deck

  const cancel = () => {
    setPicking(null);
    setP1Deck(null);
  };

  if (picking === 'ai') {
    return (
      <DeckSelect
        title="Choose your deck — vs AI (opponent's deck is random)"
        onPick={(deckId) => startAI(deckId)}
        onBack={cancel}
        confirmStart
      />
    );
  }

  if (picking === 'hotseat') {
    if (!p1Deck) {
      return (
        <DeckSelect title="Player 1 — choose your deck" onPick={setP1Deck} onBack={cancel} />
      );
    }
    return (
      <DeckSelect
        title="Player 2 — choose your deck"
        onPick={(d2) => startHotseat(p1Deck, d2)}
        onBack={() => setP1Deck(null)}
        disabledId={p1Deck}
        confirmStart
      />
    );
  }

  return (
    <div className="menu">
      <div className="home-bg" aria-hidden />
      <h1 className="logo">LEAF WAR</h1>
      <p className="tagline">a tiny trading card game</p>
      <div className="menu-buttons">
        <button onClick={() => setPicking('ai')}>Play vs AI</button>
        <button onClick={() => setPicking('hotseat')}>Hotseat (2 players, 1 device)</button>
        <button onClick={onOnline} disabled={!hasSupabase}>
          Online PvP{!hasSupabase ? ' (set Supabase keys)' : ''}
        </button>
        <Rulebook />
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
