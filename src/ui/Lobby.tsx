import { useState } from 'react';
import { useGame } from '../store/gameStore';
import { createMatch, joinMatch } from '../net/match';
import { DeckSelect } from './DeckSelect';
import { deckById } from '../cards/decks';

export function Lobby({ onBack }: { onBack: () => void }) {
  const startPvp = useGame((s) => s.startPvp);
  const [deck, setDeck] = useState<string | null>(null);
  const [hostCode, setHostCode] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [status, setStatus] = useState<string>('');

  // Pick a deck first; it's exchanged in the handshake.
  if (!deck) {
    return <DeckSelect title="Choose your deck — Online PvP" onPick={setDeck} onBack={onBack} />;
  }

  function host() {
    setStatus('Creating room…');
    const { roomId } = createMatch(deck!, (conn) => startPvp(conn));
    setHostCode(roomId);
    setStatus('Share this code. Waiting for opponent…');
  }

  function join() {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    setStatus('Joining…');
    joinMatch(code, deck!, (conn) => startPvp(conn));
  }

  return (
    <div className="menu">
      <h2>Online PvP</h2>
      <p className="hint">
        Deck: <strong>{deckById(deck).name}</strong> ·{' '}
        <button className="link" onClick={() => setDeck(null)}>
          change
        </button>
      </p>
      <div className="lobby">
        <div className="lobby-col">
          <button onClick={host} disabled={!!hostCode}>
            Host a match
          </button>
          {hostCode && <div className="roomcode">{hostCode}</div>}
        </div>
        <div className="lobby-col">
          <input
            placeholder="ROOM CODE"
            value={joinCode}
            maxLength={4}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
          />
          <button onClick={join}>Join match</button>
        </div>
      </div>
      {status && <p className="hint">{status}</p>}
      <button className="link" onClick={onBack}>
        ← Back
      </button>
    </div>
  );
}
