import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { useGame } from '../store/gameStore';
import { getDef } from '../cards/cards';
import { availableMana, canAttack, isCreature, isLand } from '../engine/rules';
import type { CardInstance, PlayerId } from '../engine/types';
import { needsTarget, opponentOf } from '../engine/types';
import { CardView } from './CardView';
import { CardPreview } from './CardPreview';
import { HoverCtx } from './hover';
import { PhaseBar } from './PhaseBar';
import { Rulebook } from './Rulebook';
import { ZoneViewer } from './ZoneViewer';
import { BoardFx } from './BoardFx';
import { PlayerBar } from './PlayerBar';
import { ActionLog } from './ActionLog';
import { ChatDock } from './ChatDock';
import { humanize } from './boardLog';

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

  // Lock page scroll to this screen only — the board owns the viewport, while
  // menus / deck-select / rulebook keep their normal scrolling.
  useEffect(() => {
    document.body.classList.add('in-game');
    return () => document.body.classList.remove('in-game');
  }, []);

  // Clear transient selection whenever the situation changes.
  useEffect(() => {
    setSorceryIid(null);
    setAttackers(new Set());
    setBlocks({});
    setPendingBlocker(null);
    setHovered(null); // hovered card may have left play
  }, [game.phase, game.turn, game.active]);

  // Hide the hover preview while choosing a spell/trigger target (it blocks the prompt).
  useEffect(() => {
    if (sorceryIid || game.pending) setHovered(null);
  }, [sorceryIid, game.pending]);

  const dragBounds = useRef<HTMLDivElement>(null);

  // Deck / graveyard viewer.
  const [zone, setZone] = useState<'deck' | 'graveyard' | null>(null);

  // Drag a hand card onto the battlefield to play it.
  const [dragActive, setDragActive] = useState(false);
  const myFieldRef = useRef<HTMLDivElement>(null);
  function dropPlay(inst: CardInstance, point: { x: number; y: number }) {
    const field = myFieldRef.current;
    if (!field) return;
    const r = field.getBoundingClientRect();
    const inside = point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom;
    if (!inside) return;
    const def = getDef(inst.def);
    if (def.type === 'land') dispatch({ type: 'playLand', iid: inst.iid });
    else if (def.type === 'creature') dispatch({ type: 'castCreature', iid: inst.iid });
    // sorceries need a target — keep using click/targeting for those
  }

  // Announce each new log entry as a transient center banner.
  const [announce, setAnnounce] = useState<{ id: number; text: string; ms?: number } | null>(null);
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
    const t = setTimeout(() => setAnnounce(null), announce.ms ?? 1800);
    return () => clearTimeout(t);
  }, [announce]);

  // Auto-skip your combat when no creature can attack — notify with the reason,
  // hold the banner ~3s, then advance past combat.
  const autoSkipRef = useRef<string>('');
  useEffect(() => {
    const myTurn = !game.winner && (mode === 'hotseat' || game.active === myId);
    if (game.phase !== 'combat_attack' || !myTurn || game.pending) return;
    const creatures = game.players[game.active].battlefield.filter(isCreature);
    if (creatures.filter(canAttack).length > 0) return; // a reason to attack — let the player choose
    const key = `${game.turn}-${game.active}`;
    if (autoSkipRef.current === key) return; // only once per combat
    autoSkipRef.current = key;
    const reason =
      creatures.length === 0
        ? 'no creatures to attack with'
        : 'your creatures are not ready (summoning sick)';
    setAnnounce({ id: announceId.current++, text: `⚔ Combat skipped — ${reason}`, ms: 3000 });
    const t = setTimeout(() => {
      if (useGame.getState().game?.phase === 'combat_attack') dispatch({ type: 'advance' });
    }, 1500);
    return () => clearTimeout(t);
  }, [game, myId, mode, dispatch]);

  // Auto-resolve blocks when the defender has nothing that can block — no reason
  // to defend, so let the damage through after a brief notice.
  const autoBlockRef = useRef<string>('');
  useEffect(() => {
    const defender = opponentOf(game.active);
    const myTurn = !game.winner && (mode === 'hotseat' || defender === myId);
    if (game.phase !== 'combat_block' || !myTurn || game.pending) return;
    if (game.players[defender].battlefield.some((c) => isCreature(c) && !c.tapped)) return; // can block
    const key = `${game.turn}-${defender}`;
    if (autoBlockRef.current === key) return;
    autoBlockRef.current = key;
    setAnnounce({ id: announceId.current++, text: '🛡 No blockers — damage goes through', ms: 2200 });
    const t = setTimeout(() => {
      if (useGame.getState().game?.phase === 'combat_block') dispatch({ type: 'declareBlockers', blocks: {} });
    }, 1500);
    return () => clearTimeout(t);
  }, [game, myId, mode, dispatch]);

  const actor: PlayerId = game.phase === 'combat_block' ? opponentOf(game.active) : game.active;
  const localId: PlayerId = mode === 'hotseat' ? actor : myId;
  const oppId = opponentOf(localId);
  const canAct = !game.winner && (mode === 'hotseat' || actor === myId);
  const myTurnToAct = canAct && actor === localId;

  const me = game.players[localId];
  const opp = game.players[oppId];
  const attackingIids = new Set(game.combat?.attackers ?? []);

  // Is there any reason to show combat option buttons? Hide them otherwise.
  const canAnyAttack = game.players[game.active].battlefield.filter(isCreature).some(canAttack);
  const canAnyBlock = game.players[opponentOf(game.active)].battlefield.some(
    (c) => isCreature(c) && !c.tapped,
  );

  // ---- click handlers ----

  // While a spell awaits a target, which creatures are valid to click?
  function sorceryTargetable(c: CardInstance): boolean {
    if (!sorceryIid) return false;
    const card = me.hand.find((h) => h.iid === sorceryIid);
    const eff = card ? getDef(card.def).effect : undefined;
    if (eff?.type === 'destroy') return c.tapped; // Take Counter: tapped only
    return true; // damage / buff: any creature
  }

  // Is this hand card playable right now (turn, phase, mana, land-drop, targets)?
  function canPlay(c: CardInstance): boolean {
    if (!myTurnToAct || game.phase !== 'main1' || game.pending) return false;
    const def = getDef(c.def);
    const mana = availableMana(me);
    if (def.type === 'land') return !me.landPlayedThisTurn;
    if (def.type === 'creature') return def.cost <= mana;
    if (def.type === 'sorcery') {
      if (def.cost > mana) return false;
      // a "buff" sorcery needs a creature on the board to target
      if (def.effect?.type === 'buff') {
        return me.battlefield.some(isCreature) || opp.battlefield.some(isCreature);
      }
      if (def.effect?.type === 'ramp') return me.hand.some(isLand); // needs a land to ramp
      if (def.effect?.type === 'destroy') {
        return me.battlefield.concat(opp.battlefield).some((c) => isCreature(c) && c.tapped);
      }
      return true;
    }
    return false;
  }

  // Put the hover preview on the side opposite the hovered card so it never covers it.
  function previewSide(iid: string): 'left' | 'right' {
    const el = document.querySelector(`[data-iid="${iid}"]`);
    if (!el) return 'right';
    const r = el.getBoundingClientRect();
    return r.left + r.width / 2 < window.innerWidth / 2 ? 'right' : 'left';
  }

  function handHclick(c: CardInstance) {
    if (!canPlay(c)) return; // greyed/unplayable cards are fully disabled
    const def = getDef(c.def);
    if (def.type === 'land') dispatch({ type: 'playLand', iid: c.iid });
    else if (def.type === 'creature') dispatch({ type: 'castCreature', iid: c.iid });
    else if (def.type === 'sorcery') {
      if (def.effect && !needsTarget(def.effect)) dispatch({ type: 'castSorcery', iid: c.iid });
      else setSorceryIid(c.iid);
    }
  }

  function creatureClick(c: CardInstance, side: PlayerId) {
    // Resolving a pending Whipflash takes priority.
    if (game.pending?.kind === 'whipflash' && myTurnToAct) {
      if (c.iid !== game.pending.source) dispatch({ type: 'whipflash', target: c.iid });
      return;
    }
    // Targeting a spell next.
    if (sorceryIid) {
      if (!sorceryTargetable(c)) return; // e.g. Take Counter needs a tapped creature
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

  function permanents(pid: PlayerId, side: PlayerId, mine = false) {
    const p = game.players[pid];
    const lands = p.battlefield.filter(isLand);
    const creatures = p.battlefield.filter(isCreature);
    const blockerOf = (atkIid: string) =>
      Object.entries(blocks).find(([, a]) => a === atkIid)?.[0];
    return (
      <div
        className={'battlefield' + (mine && dragActive ? ' drop-active' : '')}
        ref={mine ? myFieldRef : undefined}
      >
        <div className="row creatures">
          <AnimatePresence>
            {creatures.map((c) => (
              <motion.div
                key={c.iid}
                className="stack"
                initial={false}
                exit={{ opacity: 0, scale: 0.85, transition: { duration: 1.8, ease: 'easeIn' } }}
              >
                <CardView
                  inst={c}
                  arena
                  selected={attackers.has(c.iid) || pendingBlocker === c.iid || !!blocks[c.iid]}
                  targetable={
                    sorceryTargetable(c) ||
                    (game.pending?.kind === 'whipflash' && c.iid !== game.pending.source)
                  }
                  onClick={() => creatureClick(c, side)}
                />
                {attackingIids.has(c.iid) && <span className="combat-tag atk">ATK</span>}
                {blockerOf(c.iid) && <span className="combat-tag blk">blocked</span>}
                <div className="attack-overlay">
                  <AnimatePresence>
                    {attackers.has(c.iid) && [
                      <motion.img
                        key="sword"
                        className="attack-sword"
                        src="/ui/sword.png"
                        alt="attacking"
                        draggable={false}
                        initial={{ opacity: 0, x: -22, y: 26, rotate: -75, scale: 0.7 }}
                        animate={{ opacity: 1, x: 0, y: 0, rotate: -26, scale: 1 }}
                        exit={{ opacity: 0, x: -22, y: 26, rotate: -75, scale: 0.7 }}
                        transition={{ type: 'spring', stiffness: 420, damping: 20 }}
                      />,
                      <motion.span
                        key="ready"
                        className="ready-box"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 12 }}
                        transition={{ type: 'spring', stiffness: 480, damping: 24 }}
                      >
                        Ready to attack
                      </motion.span>,
                    ]}
                    {(pendingBlocker === c.iid || !!blocks[c.iid]) && [
                      <motion.img
                        key="shield"
                        className="attack-sword block"
                        src="/ui/shield.png"
                        alt="blocking"
                        draggable={false}
                        initial={{ opacity: 0, y: 28, scale: 0.6 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 28, scale: 0.6 }}
                        transition={{ type: 'spring', stiffness: 420, damping: 20 }}
                      />,
                      <motion.span
                        key="rblock"
                        className="ready-box block"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 12 }}
                        transition={{ type: 'spring', stiffness: 480, damping: 24 }}
                      >
                        Ready to block
                      </motion.span>,
                    ]}
                  </AnimatePresence>
                </div>
              </motion.div>
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
    if (game.pending?.kind === 'whipflash') {
      return myTurnToAct ? (
        <div className="actions">
          <span className="prompt">✦ Whipflash — click a creature to deal 1 damage</span>
        </div>
      ) : (
        <div className="waiting">Opponent resolving Whipflash…</div>
      );
    }
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
        // No creature can attack → no buttons; the auto-skip effect advances combat.
        if (!canAnyAttack) {
          return (
            <div className="actions">
              <span className="prompt">⚔ No creatures ready to attack…</span>
            </div>
          );
        }
        return (
          <div className="actions">
            <span className="prompt">⚔ Select creatures to attack</span>
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
        // Nothing can block → no buttons; the auto-resolve effect lets damage through.
        if (!canAnyBlock) {
          return (
            <div className="actions">
              <span className="prompt">🛡 No blockers available…</span>
            </div>
          );
        }
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
        <div className="topbar-right">
          <Rulebook label={false} />
        </div>
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
        {permanents(localId, localId, true)}
        <div className="player-dock">
        <div className="hand">
          <AnimatePresence>
            {me.hand.map((c) => (
              <CardView
                key={c.iid}
                inst={c}
                onClick={() => handHclick(c)}
                dim={!canPlay(c)}
                draggable={canPlay(c) && getDef(c.def).type !== 'sorcery'}
                onDragChange={setDragActive}
                onDrop={(point) => dropPlay(c, point)}
              />
            ))}
          </AnimatePresence>
        </div>
        <div className="player-platform">
          <button
            className="zone-btn left"
            onClick={() => setZone('graveyard')}
            title="View graveyard"
          >
            ⚰ {me.graveyard.length}
          </button>
          <PlayerBar
            p={me}
            side={localId}
            mana={{ avail: availableMana(me), total: me.battlefield.filter(isLand).length }}
            onFace={() => faceClick(localId)}
            targetable={!!sorceryIid}
            self
          />
          <button className="zone-btn right" onClick={() => setZone('deck')} title="View deck">
            🂠 {me.library.length}
          </button>
        </div>
        </div>
      </section>

      <BoardFx game={game} />

      <AnimatePresence>
        {hovered && !sorceryIid && !game.pending && (
          <CardPreview key={hovered.iid} inst={hovered} side={previewSide(hovered.iid)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {zone && (
          <ZoneViewer
            key={zone}
            title={zone === 'deck' ? 'Your Deck' : 'Graveyard'}
            cards={zone === 'deck' ? me.library : me.graveyard}
            onClose={() => setZone(null)}
          />
        )}
      </AnimatePresence>

      <div className="announce-wrap">
        <AnimatePresence>
          {announce && (
            <motion.div
              key={announce.id}
              className={'announce' + (announce.text.includes('✦') ? ' skill' : '')}
              initial={{ opacity: 0, scale: 0.8, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 1.1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 26 }}
            >
              {announce.text}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div ref={dragBounds} className="drag-layer" />
      <ActionLog log={game.log} myId={myId} boundsRef={dragBounds} />
      {mode === 'pvp' && <ChatDock />}

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
