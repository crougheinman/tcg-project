import { useEffect, useRef, useState } from 'react';
import { useGame } from '../store/gameStore';
import { DeckSelect } from './DeckSelect';
import { deckById } from '../cards/decks';
import { EMPTY_HINT_MS } from '../net/matchmaking';
import { randomRoom } from '../net/match';
import { joinQueue } from '../net/queue';
import { openRoom, type Room, type RoomEnd, type RoomSnapshot } from '../net/room';
import { getTransport } from '../net/transport';
import type { PlayerId } from '../engine/types';
import { ReadyRoomView, SearchingView } from './MatchmakingViews';

// Online PvP: find a match (the queue), or host / join a friend's room by code. Both end in the same ready room.

type Screen =
  | { kind: 'menu' }
  | { kind: 'search'; since: number }
  | { kind: 'room'; roomId: string; role: PlayerId; quick: boolean; n: number };

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `c-${Date.now()}-${Math.random().toString(36).slice(2)}`);

const NOTICE: Record<RoomEnd, string> = {
  full: 'That room already has two players.',
  'seat-taken': 'No one has opened that room.',
  'no-host': 'No one has opened that room.',
  'opponent-left': 'Your opponent left.',
  'opponent-not-ready': 'Your opponent did not ready up in time.',
  'ready-timeout': 'You did not press Ready in time.',
  'start-failed': 'The match could not start. Please try again.',
  failed: 'Could not connect. Check your connection and try again.',
};

export function Lobby({ onBack }: { onBack: () => void }) {
  const startPvp = useGame((s) => s.startPvp);
  const [deck, setDeck] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>({ kind: 'menu' });
  const [joinCode, setJoinCode] = useState('');
  const [notice, setNotice] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [snap, setSnap] = useState<RoomSnapshot | null>(null);
  const roomRef = useRef<Room | null>(null);
  const roomN = useRef(0);

  // ---- searching: join the queue; a match moves us to the ready room ----
  const searching = screen.kind === 'search';
  useEffect(() => {
    if (!searching || !deck) return;
    const transport = getTransport();
    if (!transport) return;
    setCount(null);
    const q = joinQueue({
      transport,
      clientId: newId(),
      onCount: setCount,
      onMatched: ({ roomId, role }) => {
        setNotice('');
        setScreen({ kind: 'room', roomId, role, quick: true, n: ++roomN.current });
      },
      onError: () => {
        setNotice(NOTICE.failed);
        setScreen({ kind: 'menu' });
      },
    });
    return () => q.cancel();
  }, [searching, deck]);

  // ---- the ready room (a matched one or a friend's) ----
  const roomKey = screen.kind === 'room' ? screen.n : 0;
  useEffect(() => {
    if (screen.kind !== 'room' || !deck) return;
    const transport = getTransport();
    if (!transport) return;
    setSnap(null);
    const s = screen;
    const room = openRoom({
      transport,
      roomId: s.roomId,
      role: s.role,
      deck,
      quick: s.quick,
      clientId: newId(),
      onChange: setSnap,
      onStart: (conn) => startPvp(conn),
      onEnd: (reason) => {
        roomRef.current = null;
        // a matched room whose opponent dropped out sends the player straight back to searching
        if (s.quick && (reason === 'opponent-left' || reason === 'opponent-not-ready')) {
          setNotice(`${NOTICE[reason]} Searching again…`);
          setScreen({ kind: 'search', since: Date.now() });
        } else {
          setNotice(NOTICE[reason]);
          setScreen({ kind: 'menu' });
        }
      },
    });
    roomRef.current = room;
    return () => {
      room.leave();
      if (roomRef.current === room) roomRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomKey, deck]);

  // Pick a deck first; it is exchanged in the ready room.
  if (!deck) {
    return <DeckSelect title="Choose your deck — Online PvP" onPick={setDeck} onBack={onBack} customDecks={false} />;
  }

  const leaveToMenu = () => {
    setNotice('');
    setScreen({ kind: 'menu' });
  };

  if (screen.kind === 'search') {
    return (
      <SearchingView
        count={count}
        startedAt={screen.since}
        hintAfterMs={EMPTY_HINT_MS}
        onCancel={leaveToMenu}
        notice={notice}
        onHostInstead={() => setScreen({ kind: 'room', roomId: randomRoom(), role: 'A', quick: false, n: ++roomN.current })}
      />
    );
  }

  if (screen.kind === 'room') {
    return snap ? (
      <ReadyRoomView snap={snap} onReady={(r) => roomRef.current?.setReady(r)} onLeave={leaveToMenu} />
    ) : (
      <div className="menu lobby-screen qm">
        <h2 className="deck-title">Connecting…</h2>
      </div>
    );
  }

  const host = () => {
    setNotice('');
    setScreen({ kind: 'room', roomId: randomRoom(), role: 'A', quick: false, n: ++roomN.current });
  };
  const join = () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) return;
    setNotice('');
    setScreen({ kind: 'room', roomId: code, role: 'B', quick: false, n: ++roomN.current });
  };

  return (
    <div className="menu lobby-screen">
      <button className="lobby-back" onClick={onBack}>
        ← Back
      </button>
      <h2 className="deck-title">Online PvP</h2>
      <p className="hint">
        Deck: <strong>{deckById(deck).name}</strong> ·{' '}
        <button className="link" onClick={() => setDeck(null)}>
          change
        </button>
      </p>
      <button className="primary qm-find" onClick={() => setScreen({ kind: 'search', since: Date.now() })}>
        Find a match
      </button>
      <p className="hint qm-or">or play a friend</p>
      <div className="lobby">
        <div className="lobby-col">
          <button onClick={host}>Host a match</button>
        </div>
        <div className="lobby-col">
          <input
            placeholder="ROOM CODE"
            value={joinCode}
            maxLength={4}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && join()}
            aria-label="Room code"
          />
          <button onClick={join}>Join match</button>
        </div>
      </div>
      {notice && (
        <p className="hint qm-notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}
