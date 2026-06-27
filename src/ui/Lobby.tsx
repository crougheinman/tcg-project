import { useState } from 'react';
import { useGame } from '../store/gameStore';
import { createMatch, joinMatch } from '../net/match';

export function Lobby({ onBack }: { onBack: () => void }) {
  const startPvp = useGame((s) => s.startPvp);
  const [hostCode, setHostCode] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [status, setStatus] = useState<string>('');

  function host() {
    setStatus('Creating room…');
    const { roomId } = createMatch((conn) => startPvp(conn));
    setHostCode(roomId);
    setStatus('Share this code. Waiting for opponent…');
  }

  function join() {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    setStatus('Joining…');
    joinMatch(code, (conn) => startPvp(conn));
  }

  return (
    <div className="menu">
      <h2>Online PvP</h2>
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
