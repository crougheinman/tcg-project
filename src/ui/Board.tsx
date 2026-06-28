import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { useGame } from '../store/gameStore';
import { getDef } from '../cards/cards';
import { availableMana, canAttack, isCreature, isLand } from '../engine/rules';
import type { CardInstance, GameState, PlayerId } from '../engine/types';
import { opponentOf } from '../engine/types';
import { CardView } from './CardView';
import { CardPreview } from './CardPreview';
import { HoverCtx } from './hover';
import { PhaseBar } from './PhaseBar';
import type { Burst } from './Vfx';

// three.js is heavy — split it into its own chunk, loaded only in-game.
const VfxCanvas = lazy(() => import('./Vfx').then((m) => ({ default: m.VfxCanvas })));

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
  const [hovered, setHovered] = useState<CardInstance | null>(null);

  // Clear transient selection whenever the situation changes.
  useEffect(() => {
    setSorceryIid(null);
    setAttackers(new Set());
    setBlocks({});
    setPendingBlocker(null);
    setHovered(null); // hovered card may have left play
  }, [game.phase, game.turn, game.active]);

  // Spawn three.js particle bursts on damage (face + surviving creatures).
  const [bursts, setBursts] = useState<Burst[]>([]);
  const prevGame = useRef<GameState>(game);
  const burstId = useRef(0);
  useEffect(() => {
    const before = prevGame.current;
    prevGame.current = game;
    if (!before || before === game) return;
    const add: Burst[] = [];
    const spawnAt = (sel: string, color: string, n: number) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const r = el.getBoundingClientRect();
      add.push({ id: burstId.current++, x: r.left + r.width / 2, y: r.top + r.height / 2, color, n });
    };
    for (const pid of ['A', 'B'] as PlayerId[]) {
      const d = before.players[pid].life - game.players[pid].life;
      if (d > 0) spawnAt(`[data-player="${pid}"]`, '#ff7a33', Math.min(48, 14 + d * 3));
    }
    const beforeDmg = new Map<string, number>();
    for (const pid of ['A', 'B'] as PlayerId[])
      for (const c of before.players[pid].battlefield)
        if (isCreature(c)) beforeDmg.set(c.iid, c.damage);
    for (const pid of ['A', 'B'] as PlayerId[])
      for (const c of game.players[pid].battlefield)
        if (isCreature(c) && c.damage > (beforeDmg.get(c.iid) ?? 0))
          spawnAt(`[data-iid="${c.iid}"]`, '#ff5a4a', 18);
    if (add.length) setBursts((b) => [...b, ...add]);
  }, [game]);
  const removeBurst = (id: number) => setBursts((b) => b.filter((x) => x.id !== id));

  // Announce each new log entry as a transient center banner.
  const [announce, setAnnounce] = useState<{ id: number; text: string } | null>(null);
  const prevLogLen = useRef(game.log.length);
  const announceId = useRef(0);
  useEffect(() => {
    if (game.log.length > prevLogLen.current) {
      const last = game.log[game.log.length - 1];
      setAnnounce({ id: announceId.current++, text: humanize(last, myId) });
    }
    prevLogLen.current = game.log.length;
  }, [game, myId]);
  useEffect(() => {
    if (!announce) return;
    const t = setTimeout(() => setAnnounce(null), 1800);
    return () => clearTimeout(t);
  }, [announce]);

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
          <AnimatePresence>
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
          </AnimatePresence>
          {creatures.length === 0 && <span className="empty">no creatures</span>}
        </div>
        <div className="row lands">
          <AnimatePresence>
            {lands.map((c) => (
              <CardView key={c.iid} inst={c} targetable={false} />
            ))}
          </AnimatePresence>
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
    <HoverCtx.Provider value={setHovered}>
    <LayoutGroup>
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
        <PlayerBar
          p={opp}
          side={oppId}
          mana={{ avail: availableMana(opp), total: opp.battlefield.filter(isLand).length }}
          onFace={() => faceClick(oppId)}
          targetable={!!sorceryIid}
        />
        <div className="hand opp-hand">
          <AnimatePresence>
            {opp.hand.map((c) => (
              <CardView key={c.iid} inst={c} faceDown />
            ))}
          </AnimatePresence>
        </div>
        {permanents(oppId, oppId)}
      </section>

      <section className="center">{actionButtons()}</section>

      {/* Me */}
      <section className="player-zone me">
        {permanents(localId, localId)}
        <PlayerBar
          p={me}
          side={localId}
          mana={{ avail: availableMana(me), total: me.battlefield.filter(isLand).length }}
          onFace={() => faceClick(localId)}
          targetable={!!sorceryIid}
          self
        />
        <div className="hand">
          <AnimatePresence>
            {me.hand.map((c) => (
              <CardView
                key={c.iid}
                inst={c}
                onClick={() => handHclick(c)}
                dim={game.phase !== 'main1' || !myTurnToAct}
              />
            ))}
          </AnimatePresence>
        </div>
      </section>

      <Suspense fallback={null}>
        <VfxCanvas bursts={bursts} onDone={removeBurst} />
      </Suspense>

      <AnimatePresence>{hovered && <CardPreview key={hovered.iid} inst={hovered} />}</AnimatePresence>

      <AnimatePresence>
        {announce && (
          <motion.div
            key={announce.id}
            className="announce"
            initial={{ opacity: 0, scale: 0.8, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 1.1 }}
            transition={{ type: 'spring', stiffness: 400, damping: 26 }}
          >
            {announce.text}
          </motion.div>
        )}
      </AnimatePresence>

      <ActionLog log={game.log} myId={myId} />

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
    </LayoutGroup>
    </HoverCtx.Provider>
  );
}

function PlayerBar({
  p,
  side,
  mana,
  onFace,
  targetable,
  self,
}: {
  p: { life: number; hand: unknown[]; library: unknown[] };
  side: PlayerId;
  mana: { avail: number; total: number };
  onFace: () => void;
  targetable?: boolean;
  self?: boolean;
}) {
  const hpPct = Math.max(0, Math.min(100, (p.life / MAX_LIFE) * 100));
  return (
    <div className="playerbar">
      <span
        className={'avatar ' + (targetable ? 'targetable' : '')}
        data-player={side}
        onClick={onFace}
        title={targetable ? 'Target this player' : undefined}
      >
        {self ? 'You' : 'Opp'} ({side})
      </span>
      <div className="bars">
        <div className="bar health" title={`${p.life} / ${MAX_LIFE} life`}>
          <div
            className="bar-fill"
            style={{ width: hpPct + '%', background: hpColor(hpPct) }}
          />
          <span className="bar-label">♥ {p.life}</span>
        </div>
        <div className="manabar" title="Available mana (untapped lands / total)">
          {Array.from({ length: mana.total }, (_, i) => (
            <span key={i} className={'pip' + (i < mana.avail ? ' on' : '')} />
          ))}
          <span className="bar-label small">
            ◈ {mana.avail}/{mana.total}
          </span>
        </div>
      </div>
      <span className="counts">
        hand {p.hand.length} · deck {p.library.length}
      </span>
    </div>
  );
}

const MAX_LIFE = 20;
function hpColor(pct: number): string {
  if (pct > 50) return '#54c98a';
  if (pct > 25) return '#d9b65a';
  return '#e0573e';
}

// Rewrite engine log lines (which use 'A'/'B') from the local player's view.
function humanize(s: string, myId: PlayerId): string {
  const opp = opponentOf(myId);
  return s
    .replace(new RegExp(`\\b${myId}'s\\b`, 'g'), 'Your')
    .replace(new RegExp(`\\b${opp}'s\\b`, 'g'), "Opponent's")
    .replace(new RegExp(`\\b${myId}\\b`, 'g'), 'You')
    .replace(new RegExp(`\\b${opp}\\b`, 'g'), 'Opponent')
    // first-person verb agreement for the local player
    .replace(/\bYou is\b/g, 'You are')
    .replace(/\bYou (plays|casts|attacks|blocks|decks)\b/g, (_m, v) => 'You ' + v.slice(0, -1));
}

function ActionLog({ log, myId }: { log: string[]; myId: PlayerId }) {
  const recent = log.slice(-40).reverse(); // newest first
  return (
    <div className="action-log">
      <div className="action-log-head">Activity</div>
      <div className="action-log-body">
        {recent.map((line, i) => (
          <div key={log.length - i} className="log-line">
            {humanize(line, myId)}
          </div>
        ))}
      </div>
    </div>
  );
}
