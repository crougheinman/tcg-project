import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGame } from '../store/gameStore';
import { hasSupabase } from '../net/supabase';
import { randomDeck } from '../cards/decks';
import { Rulebook } from './Rulebook';
import { DeckSelect } from './DeckSelect';
import { APP_VERSION } from '../version';

// Home-page patch notes. Balance pass tuned across ~5,000 simulated AI-vs-AI duels
// so every deck lands in a ~44–56% win band with real strengths and weaknesses.
const PATCH_NOTES: { deck: string; kind: 'buff' | 'nerf'; change: string; why: string }[] = [
  {
    deck: 'Skyward',
    kind: 'nerf',
    change: 'Sky Talon is now 2/1, with fewer flyers — traded card draw and burn for ground troops.',
    why: 'It ruled the skies with almost no counterplay.',
  },
  {
    deck: 'Iron Blossom',
    kind: 'nerf',
    change: 'Iaijutsu Strike now grants +1/+1 (was +2/+1).',
    why: 'Its instant tricks won every fight and closed games too fast.',
  },
  {
    deck: 'Pyromancer',
    kind: 'buff',
    change: 'Added Dread Maw finishers and more early blockers.',
    why: 'Too fragile to survive aggro — or to actually finish the job.',
  },
  {
    deck: 'Stonewall',
    kind: 'buff',
    change: 'New win conditions — two Storm Drakes and Dread Maw — plus extra burn for big or flying threats.',
    why: 'It could stall forever but never actually win.',
  },
  {
    deck: 'Grave Tide',
    kind: 'buff',
    change: 'Sturdier Ghouls (2/3), Withering Touch hits for 4, and the Necromancer now raises the dead on ANY spell.',
    why: 'Its bodies were too flimsy and it lacked reach.',
  },
];

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
          <Rulebook icon={false} />
          </div>

          <details className="changelog" open>
            <summary>
              <span className="changelog-badge">⚖ Balance Update</span>
              <span className="changelog-ver">v{APP_VERSION}</span>
            </summary>
            <div className="changelog-scroll">
              <p className="changelog-intro">
                Tuned across thousands of simulated duels so every deck has real strengths — and
                real weaknesses.
              </p>
              <ul className="changelog-list">
                {PATCH_NOTES.map((n) => (
                  <li key={n.deck} className={'changelog-item ' + n.kind}>
                    <span className={'chip ' + n.kind}>
                      {n.kind === 'buff' ? '▲ BUFF' : '▼ NERF'}
                    </span>
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
