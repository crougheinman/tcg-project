import { useEffect, useState } from 'react';
import { useGame } from '../store/gameStore';
import { getDef } from '../cards/cards';
import { canAttack, isCreature, isLand } from '../engine/rules';
import type { CardInstance, PlayerId } from '../engine/types';
import { opponentOf } from '../engine/types';
import { CardView } from './CardView';
import { PhaseBar } from './PhaseBar';

export function Board() {
  const game = useGame((s) => s.game)!;
  const mode = useGame((s) => s.mode);
  const myId = useGame((s) => s.myId);
  const dispatch = useGame((s) => s.dispatch);
  const toMenu = useGame((s) => s.toMenu);
  const error = useGame((s) => s.error);
  const clearError = useGame((s) => s.clearError);

  const [sorceryIid, setSorceryIid] = useState<string | null>(null);
  const [attackers, setAttackers] = useState<Set<string>>(new Set());
  const [blocks, setBlocks] = useState<Record<string, string>>({});
  const [pendingBlocker, setPendingBlocker] = useState<string | null>(null);

  // Clear transient selection whenever the situation changes.
  useEffect(() => {
    setSorceryIid(null);
    setAttackers(new Set());
    setBlocks({});
    setPendingBlocker(null);
  }, [game.phase, game.turn, game.active]);

  const actor: PlayerId = game.phase === 'combat_block' ? opponentOf(game.active) : game.active;
  const localId: PlayerId = mode === 'hotseat' ? actor : myId;
  const oppId = opponentOf(localId);
  const canAct = !game.winner && (mode === 'hotseat' || actor === myId);
  const myTurnToAct = canAct && actor === localId;

  const me = game.players[localId];
  const opp = game.players[oppId];
  const attackingIids = new Set(game.combat?.attackers ?? []);

  // ---- click handlers ----

  function handHclick(c: CardInstance) {
    if (!myTurnToAct || game.phase !== 'main1') return;
    const def = getDef(c.def);
    if (def.type === 'land') dispatch({ type: 'playLand', iid: c.iid });
    else if (def.type === 'creature') dispatch({ type: 'castCreature', iid: c.iid });
    else if (def.type === 'sorcery') {
      if (def.effect?.type === 'draw') dispatch({ type: 'castSorcery', iid: c.iid });
      else setSorceryIid(c.iid);
    }
  }

  function creatureClick(c: CardInstance, side: PlayerId) {
    // Targeting a spell takes priority.
    if (sorceryIid) {
      dispatch({ type: 'castSorcery', iid: sorceryIid, target: { kind: 'creature', iid: c.iid } });
      setSorceryIid(null);
      return;
    }
    if (!myTurnToAct) return;

    if (game.phase === 'combat_attack' && side === localId) {
      if (!canAttack(c)) return;
      setAttackers((prev) => {
        const next = new Set(prev);
        next.has(c.iid) ? next.delete(c.iid) : next.add(c.iid);
        return next;
      });
    } else if (game.phase === 'combat_block') {
      if (side === localId) {
        if (isCreature(c) && !c.tapped) setPendingBlocker(c.iid);
      } else if (pendingBlocker && attackingIids.has(c.iid)) {
        setBlocks((prev) => ({ ...prev, [pendingBlocker]: c.iid }));
        setPendingBlocker(null);
      }
    }
  }

  function faceClick(side: PlayerId) {
    if (sorceryIid) {
      dispatch({ type: 'castSorcery', iid: sorceryIid, target: { kind: 'player', player: side } });
      setSorceryIid(null);
    }
  }

  // ---- render helpers ----

  function permanents(pid: PlayerId, side: PlayerId) {
    const p = game.players[pid];
    const lands = p.battlefield.filter(isLand);
    const creatures = p.battlefield.filter(isCreature);
    const blockerOf = (atkIid: string) =>
      Object.entries(blocks).find(([, a]) => a === atkIid)?.[0];
    return (
      <div className="battlefield">
        <div className="row creatures">
          {creatures.map((c) => (
            <div key={c.iid} className="stack">
              <CardView
                inst={c}
                selected={attackers.has(c.iid) || pendingBlocker === c.iid || !!blocks[c.iid]}
                targetable={!!sorceryIid}
                onClick={() => creatureClick(c, side)}
              />
              {attackingIids.has(c.iid) && <span className="combat-tag atk">ATK</span>}
              {blockerOf(c.iid) && <span className="combat-tag blk">blocked</span>}
            </div>
          ))}
          {creatures.length === 0 && <span className="empty">no creatures</span>}
        </div>
        <div className="row lands">
          {lands.map((c) => (
            <CardView key={c.iid} inst={c} targetable={false} />
          ))}
        </div>
      </div>
    );
  }

  function actionButtons() {
    if (!myTurnToAct) {
      const who = mode === 'ai' ? 'AI is thinking…' : 'Waiting for opponent…';
      return <div className="waiting">{game.winner ? '' : who}</div>;
    }
    if (sorceryIid) {
      return (
        <div className="actions">
          <span className="prompt">Choose a target…</span>
          <button onClick={() => setSorceryIid(null)}>Cancel</button>
        </div>
      );
    }
    switch (game.phase) {
      case 'main1':
        return (
          <div className="actions">
            <button className="primary" onClick={() => dispatch({ type: 'advance' })}>
              Go to Combat ⚔
            </button>
          </div>
        );
      case 'combat_attack':
        return (
          <div className="actions">
            <button
              className="primary"
              onClick={() => dispatch({ type: 'declareAttackers', attackers: [...attackers] })}
            >
              Attack ({attackers.size})
            </button>
            <button onClick={() => dispatch({ type: 'advance' })}>Skip Combat</button>
          </div>
        );
      case 'combat_block':
        return (
          <div className="actions">
            <span className="prompt">
              {pendingBlocker ? 'Click an attacker to block' : 'Click your blocker, then its target'}
            </span>
            <button className="primary" onClick={() => dispatch({ type: 'declareBlockers', blocks })}>
              Confirm Blocks
            </button>
            <button onClick={() => dispatch({ type: 'declareBlockers', blocks: {} })}>No Blocks</button>
          </div>
        );
      case 'end':
        return (
          <div className="actions">
            <button className="primary" onClick={() => dispatch({ type: 'advance' })}>
              End Turn
            </button>
          </div>
        );
    }
  }

  return (
    <div className="board">
      <header className="topbar">
        <button className="link" onClick={toMenu}>
          ← Menu
        </button>
        <PhaseBar game={game} myId={myId} />
        {mode === 'pvp' && <span className="role">You are {myId}</span>}
      </header>

      {/* Opponent */}
      <section className="player-zone opp">
        <PlayerBar p={opp} side={oppId} onFace={() => faceClick(oppId)} targetable={!!sorceryIid} />
        <div className="hand opp-hand">
          {opp.hand.map((c) => (
            <CardView key={c.iid} inst={c} faceDown />
          ))}
        </div>
        {permanents(oppId, oppId)}
      </section>

      <section className="center">{actionButtons()}</section>

      {/* Me */}
      <section className="player-zone me">
        {permanents(localId, localId)}
        <PlayerBar p={me} side={localId} onFace={() => faceClick(localId)} targetable={!!sorceryIid} self />
        <div className="hand">
          {me.hand.map((c) => (
            <CardView
              key={c.iid}
              inst={c}
              onClick={() => handHclick(c)}
              dim={game.phase !== 'main1' || !myTurnToAct}
            />
          ))}
        </div>
      </section>

      {error && (
        <div className="toast" onClick={clearError}>
          {error}
        </div>
      )}

      {game.winner && (
        <div className="overlay">
          <div className="result">
            <h2>{game.winner === 'draw' ? 'Draw' : `${game.winner === myId ? 'You win!' : 'You lose'}`}</h2>
            <button className="primary" onClick={toMenu}>
              Back to Menu
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerBar({
  p,
  side,
  onFace,
  targetable,
  self,
}: {
  p: { life: number; hand: unknown[]; library: unknown[] };
  side: PlayerId;
  onFace: () => void;
  targetable?: boolean;
  self?: boolean;
}) {
  return (
    <div className="playerbar">
      <span
        className={'avatar ' + (targetable ? 'targetable' : '')}
        onClick={onFace}
        title={targetable ? 'Target this player' : undefined}
      >
        {self ? 'You' : 'Opp'} ({side})
      </span>
      <span className="life">♥ {p.life}</span>
      <span className="counts">
        hand {p.hand.length} · deck {p.library.length}
      </span>
    </div>
  );
}
