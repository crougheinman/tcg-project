import { useEffect, useState } from 'react';
import type { RoomSnapshot } from '../net/room';

// The two screens of finding a match, as plain components of their props (the lobby owns the network): the searching
// screen with its live count, and the ready room with both players' status. Seat colours as everywhere: you are cyan,
// your opponent red.

/** The current time, refreshed while a countdown or a timer is on screen. */
function useNow(active: boolean, every = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [active, every]);
  return now;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function SearchingView({
  count,
  startedAt,
  hintAfterMs,
  onCancel,
  onHostInstead,
  notice,
}: {
  /** Players searching right now, you included; null until the first count arrives. */
  count: number | null;
  startedAt: number;
  hintAfterMs: number;
  onCancel: () => void;
  onHostInstead: () => void;
  /** Why the search restarted (the opponent left, did not ready up...). */
  notice?: string;
}) {
  const now = useNow(true, 1000);
  const waited = Math.max(0, now - startedAt);
  const alone = count !== null && count <= 1;
  return (
    <div className="menu lobby-screen qm">
      <h2 className="deck-title">Finding an opponent…</h2>
      <div className="qm-pulse" aria-hidden>
        <span />
        <span />
        <span />
        <i>⚔</i>
      </div>
      <p className="qm-count" aria-live="polite" data-testid="qm-count">
        {count === null ? (
          'Connecting…'
        ) : (
          <>
            <b>{count}</b> {count === 1 ? 'player' : 'players'} searching
          </>
        )}
      </p>
      {notice && (
        <p className="hint qm-notice" role="status">
          {notice}
        </p>
      )}
      <p className="hint">Searching for {mmss(Math.floor(waited / 1000))}</p>
      {alone && waited >= hintAfterMs && (
        <p className="hint qm-empty">
          Nobody else is searching right now. Keep waiting, or{' '}
          <button className="link" onClick={onHostInstead}>
            host a room
          </button>{' '}
          and send the code to a friend.
        </p>
      )}
      <button className="qm-leave" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

function Seat({ side, name, state }: { side: 'me' | 'foe'; name: string; state: 'absent' | 'waiting' | 'ready' }) {
  const label = state === 'absent' ? 'Waiting…' : state === 'ready' ? 'Ready ✓' : 'Not ready';
  return (
    <div className={`qm-seat ${side} ${state}`} data-testid={`seat-${side}`} data-state={state}>
      <div className="qm-avatar" aria-hidden>
        {state === 'absent' ? '…' : '☺'}
      </div>
      <div className="qm-name">{name}</div>
      <div className="qm-chip">{label}</div>
    </div>
  );
}

export function ReadyRoomView({
  snap,
  onReady,
  onLeave,
}: {
  snap: RoomSnapshot;
  onReady: (ready: boolean) => void;
  onLeave: () => void;
}) {
  const counting = snap.countdownEndsAt !== null;
  const timing = snap.readyDeadline !== null;
  const now = useNow(counting || timing);
  const countdown = counting ? Math.max(1, Math.ceil((snap.countdownEndsAt! - now) / 1000)) : null;
  const deadline = timing ? Math.max(0, Math.ceil((snap.readyDeadline! - now) / 1000)) : null;
  const peer = snap.peer.present ? (snap.peer.ready ? 'ready' : 'waiting') : 'absent';
  const me = snap.meReady ? 'ready' : 'waiting';

  let status: string;
  if (snap.starting) status = 'Starting…';
  else if (countdown !== null) status = `Both ready. Starting in ${countdown}…`;
  else if (!snap.connected) status = 'Connecting…';
  else if (!snap.peer.present) status = snap.quick ? 'Waiting for your opponent to arrive…' : 'Waiting for your opponent to join…';
  else if (!snap.meReady) status = 'Press Ready when you are set.';
  else status = 'Waiting for your opponent to press Ready…';

  return (
    <div className="menu lobby-screen qm">
      <h2 className="deck-title">{snap.quick ? 'Match found' : `Room ${snap.roomId}`}</h2>
      {!snap.quick && !snap.peer.present && (
        <div className="roomcode" aria-label={`Room code ${snap.roomId}`}>
          {snap.roomId}
        </div>
      )}
      <div className="qm-versus">
        <Seat side="me" name="You" state={me} />
        <div className="qm-vs" aria-hidden>
          VS
        </div>
        <Seat side="foe" name="Opponent" state={peer} />
      </div>
      <p className="qm-status" aria-live="polite" data-testid="qm-status">
        {status}
      </p>
      {deadline !== null && countdown === null && <p className="hint qm-deadline">Ready up within {deadline}s</p>}
      <button
        className="primary qm-ready"
        onClick={() => onReady(!snap.meReady)}
        disabled={!snap.peer.present || snap.starting}
        aria-pressed={snap.meReady}
      >
        {snap.meReady ? 'Ready ✓ (undo)' : 'Ready'}
      </button>
      <button className="qm-leave" onClick={onLeave} disabled={snap.starting}>
        Leave
      </button>
    </div>
  );
}
