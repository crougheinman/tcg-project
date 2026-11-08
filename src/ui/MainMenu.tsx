import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGame } from '../store/gameStore';
import { hasSupabase } from '../net/supabase';
import { loadMatch } from '../net/resume';
import { randomDeck } from '../cards/decks';
import { Rulebook } from './Rulebook';
import { DeckSelect } from './DeckSelect';
import { CardGallery } from './CardGallery';
import { APP_VERSION } from '../version';

// Home-page patch notes. Balance pass tuned across ~5,000 simulated AI-vs-AI duels
// so every deck lands in a ~44–56% win band with real strengths and weaknesses.
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

  const cancel = () => {
    setPicking(null);
    setP1Deck(null);
    setAiDeck(null);
  };

  // Resolve the current screen (keyed so it can animate in/out).
  let screen: string;
  let content: ReactNode;
  if (showGallery) {
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
    content = (
      <div className="menu home">
        <div className="home-bg" aria-hidden />
        <h1 className="logo">ENTITY DUEL</h1>
        <p className="tagline">a tiny trading card game</p>
        <div className="menu-row">
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
            {resumable && hasSupabase && (
              <button className="resume-btn" onClick={resumePvp}>
                ⟳ Reconnect to match {resumable.roomId}
              </button>
            )}
            <button onClick={() => setShowGallery(true)}>Card Codex</button>
            <Rulebook icon={false} />
          </div>

          <details className="changelog" open>
            <summary>
              <span className="changelog-badge">⚖ Balance Update</span>
              <span className="changelog-ver">v{APP_VERSION}</span>
            </summary>
            <div className="changelog-scroll">
              <p className="changelog-intro">
                Tuned across thousands of simulated duels so every deck has real strengths — and real
                weaknesses.
              </p>
              <ul className="changelog-list">
                {PATCH_NOTES.map((n) => (
                  <li key={n.deck} className={'changelog-item ' + n.kind}>
                    <span className={'chip ' + n.kind}>{n.kind === 'buff' ? '▲ BUFF' : '▼ NERF'}</span>
                    <div className="changelog-body">
                      <b>{n.deck}</b> — {n.change}
                      <span className="changelog-why">{n.why}</span>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="changelog-foot">
                Emberwood, Wildblitz &amp; Wildwood Titans are unchanged.
              </p>
            </div>
          </details>
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
