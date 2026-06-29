import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, LayoutGroup, motion, useDragControls } from 'framer-motion';
import { useGame } from '../store/gameStore';
import { getDef } from '../cards/cards';
import { availableMana, canAttack, isCreature, isLand } from '../engine/rules';
import type { CardInstance, GameState, PlayerId } from '../engine/types';
import { needsTarget, opponentOf } from '../engine/types';
import { CardView } from './CardView';
import { CardPreview } from './CardPreview';
import { HoverCtx } from './hover';
import { PhaseBar } from './PhaseBar';
import { Rulebook } from './Rulebook';
import { ZoneViewer } from './ZoneViewer';
import { DestroyFx } from './DestroyFx';
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

  // Hide the hover preview while choosing a spell/trigger target (it blocks the prompt).
  useEffect(() => {
    if (sorceryIid || game.pending) setHovered(null);
  }, [sorceryIid, game.pending]);

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
    let dmgTargetSel: string | null = null; // who/what just took damage (for the spell fx)
    for (const pid of ['A', 'B'] as PlayerId[]) {
      const d = before.players[pid].life - game.players[pid].life;
      if (d > 0) {
        dmgTargetSel = `[data-player="${pid}"]`;
        spawnAt(`[data-player="${pid}"]`, '#ff7a33', Math.min(48, 14 + d * 3));
        const el = document.querySelector(`[data-player="${pid}"]`);
        if (el) {
          const r = el.getBoundingClientRect();
          setDmgNums((n) => [
            ...n,
            { id: dmgId.current++, x: r.left + r.width / 2, y: r.top, amt: d },
          ]);
          shakeEl(el as HTMLElement);
        }
      }
    }
    const beforeDmg = new Map<string, number>();
    for (const pid of ['A', 'B'] as PlayerId[])
      for (const c of before.players[pid].battlefield)
        if (isCreature(c)) beforeDmg.set(c.iid, c.damage);
    for (const pid of ['A', 'B'] as PlayerId[])
      for (const c of game.players[pid].battlefield)
        if (isCreature(c) && c.damage > (beforeDmg.get(c.iid) ?? 0)) {
          if (!dmgTargetSel) dmgTargetSel = `[data-iid="${c.iid}"]`;
          spawnAt(`[data-iid="${c.iid}"]`, '#ff5a4a', 18);
        }
    if (add.length) setBursts((b) => [...b, ...add]);

    // A sorcery just hit a graveyard -> play its spritesheet spell effect (3s),
    // centered on whoever/whatever took the damage (else screen centre).
    const graveBefore = new Set(
      [...before.players.A.graveyard, ...before.players.B.graveyard].map((c) => c.iid),
    );
    for (const pid of ['A', 'B'] as PlayerId[]) {
      for (const c of game.players[pid].graveyard) {
        if (!graveBefore.has(c.iid) && getDef(c.def).type === 'sorcery') {
          const fx = SPELL_FX[c.def] ?? SPELL_FX.default;
          const el = dmgTargetSel ? document.querySelector(dmgTargetSel) : null;
          const r = el?.getBoundingClientRect();
          const x = r ? r.left + r.width / 2 : window.innerWidth / 2;
          const y = r ? r.top + r.height / 2 : window.innerHeight / 2;
          setSpellFx({ id: dmgId.current++, sheet: fx.sheet, frames: fx.frames, x, y });
        }
      }
    }

    // A land was just played -> rejuvenate effect on the caster's icon.
    const battleBefore = new Set(
      [...before.players.A.battlefield, ...before.players.B.battlefield].map((c) => c.iid),
    );
    for (const pid of ['A', 'B'] as PlayerId[]) {
      for (const c of game.players[pid].battlefield) {
        if (!battleBefore.has(c.iid) && isLand(c)) {
          const el = document.querySelector(`[data-player="${pid}"]`);
          const r = el?.getBoundingClientRect();
          const x = r ? r.left + r.width / 2 : window.innerWidth / 2;
          const y = r ? r.top + r.height / 2 : window.innerHeight / 2;
          setSpellFx({ id: dmgId.current++, sheet: LAND_FX.sheet, frames: LAND_FX.frames, x, y });
        }
      }
    }

    // Combat strike animations: lunge each attacker toward its target.
    if (before.phase === 'combat_block' && game.phase === 'end' && before.combat) {
      const blockerByAtk: Record<string, string> = {};
      for (const [blk, atk] of Object.entries(before.combat.blocks)) blockerByAtk[atk] = blk;
      let faceHit = false;
      const defenderShield = document.querySelector(`[data-player="${opponentOf(before.active)}"]`);
      const newSlashes: { id: number; x: number; y: number }[] = [];
      const slashAt = (el: Element | null) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        newSlashes.push({ id: dmgId.current++, x: r.left + r.width / 2, y: r.top + r.height / 2 });
      };
      for (const atk of before.combat.attackers) {
        const atkEl = stackEl(atk);
        const blk = blockerByAtk[atk];
        if (blk) {
          lungeTo(atkEl, stackEl(blk)); // clash with blocker
          shakeEl(stackEl(blk));
          slashAt(stackEl(blk)); // slash the blocker
        } else {
          faceHit = true;
          lungeTo(atkEl, defenderShield);
          slashAt(defenderShield); // slash the defending player
        }
      }
      if (newSlashes.length) {
        setSlashes((s) => [...s, ...newSlashes]);
        const ids = new Set(newSlashes.map((n) => n.id));
        setTimeout(() => setSlashes((s) => s.filter((n) => !ids.has(n.id))), 600);
      }
      if (faceHit) {
        document
          .querySelector('.board')
          ?.animate(
            [
              { transform: 'translateY(0)' },
              { transform: 'translateY(6px)' },
              { transform: 'translateY(-4px)' },
              { transform: 'translateY(0)' },
            ],
            { duration: 260, easing: 'ease-out' },
          );
        setFaceFlash((f) => f + 1);
      }
    }

    // A creature left the battlefield (destroyed) -> 2.5s destruction sequence at
    // its last known position (captured before this render).
    const aliveNow = new Set(
      [...game.players.A.battlefield, ...game.players.B.battlefield].map((c) => c.iid),
    );
    const newDestroys: { id: number; x: number; y: number }[] = [];
    for (const pid of ['A', 'B'] as PlayerId[]) {
      for (const c of before.players[pid].battlefield) {
        if (isCreature(c) && !aliveNow.has(c.iid)) {
          const r = creatureRects.current[c.iid];
          if (r) newDestroys.push({ id: dmgId.current++, x: r.x, y: r.y });
        }
      }
    }
    if (newDestroys.length) setDestroys((d) => [...d, ...newDestroys]);

    // Record current creature positions for next time (used when they die).
    const rects: Record<string, { x: number; y: number }> = {};
    for (const pid of ['A', 'B'] as PlayerId[]) {
      for (const c of game.players[pid].battlefield) {
        if (!isCreature(c)) continue;
        const el = document.querySelector(`[data-iid="${c.iid}"]`);
        if (el) {
          const b = el.getBoundingClientRect();
          rects[c.iid] = { x: b.left + b.width / 2, y: b.top + b.height / 2 };
        }
      }
    }
    creatureRects.current = rects;
  }, [game]);
  const removeBurst = (id: number) => setBursts((b) => b.filter((x) => x.id !== id));
  const removeDestroy = (id: number) => setDestroys((d) => d.filter((x) => x.id !== id));

  const [faceFlash, setFaceFlash] = useState(0);
  const [dmgNums, setDmgNums] = useState<{ id: number; x: number; y: number; amt: number }[]>([]);
  const [slashes, setSlashes] = useState<{ id: number; x: number; y: number }[]>([]);
  const [destroys, setDestroys] = useState<{ id: number; x: number; y: number }[]>([]);
  const creatureRects = useRef<Record<string, { x: number; y: number }>>({});
  const dmgId = useRef(0);
  const dragBounds = useRef<HTMLDivElement>(null);

  // Spritesheet effect played for 3s when a sorcery is cast, centered on its target.
  const [spellFx, setSpellFx] = useState<
    { id: number; sheet: string; frames: number; x: number; y: number } | null
  >(null);
  useEffect(() => {
    if (!spellFx) return;
    const t = setTimeout(() => setSpellFx(null), 3000);
    return () => clearTimeout(t);
  }, [spellFx]);

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

  const actor: PlayerId = game.phase === 'combat_block' ? opponentOf(game.active) : game.active;
  const localId: PlayerId = mode === 'hotseat' ? actor : myId;
  const oppId = opponentOf(localId);
  const canAct = !game.winner && (mode === 'hotseat' || actor === myId);
  const myTurnToAct = canAct && actor === localId;

  const me = game.players[localId];
  const opp = game.players[oppId];
  const attackingIids = new Set(game.combat?.attackers ?? []);

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

      <Suspense fallback={null}>
        <VfxCanvas bursts={bursts} onDone={removeBurst} />
      </Suspense>

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

      {faceFlash > 0 && <div key={faceFlash} className="face-flash" />}

      {slashes.map((s) => (
        <div key={s.id} className="slashfx" style={{ left: s.x, top: s.y }} />
      ))}

      {destroys.map((d) => (
        <DestroyFx key={d.id} x={d.x} y={d.y} onDone={() => removeDestroy(d.id)} />
      ))}

      <AnimatePresence>
        {spellFx && (
          <motion.div
            key={spellFx.id}
            className="spellfx-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div
              className="spellfx"
              style={
                {
                  left: spellFx.x,
                  top: spellFx.y,
                  backgroundImage: `url(${spellFx.sheet})`,
                  '--frames': spellFx.frames,
                  '--dur': `${(spellFx.frames * 0.08).toFixed(2)}s`,
                } as CSSProperties
              }
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {dmgNums.map((n) => (
          <motion.div
            key={n.id}
            className="dmg-float"
            style={{ left: n.x, top: n.y }}
            initial={{ opacity: 0, y: 0, scale: 0.6 }}
            animate={{ opacity: [0, 1, 1, 0], y: -46, scale: 1, x: [0, -5, 5, -3, 0] }}
            transition={{ duration: 0.9, times: [0, 0.15, 0.7, 1] }}
            onAnimationComplete={() => setDmgNums((d) => d.filter((x) => x.id !== n.id))}
          >
            -{n.amt}
          </motion.div>
        ))}
      </AnimatePresence>

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
  // Pulse the mana readout for 2s whenever it changes (cast / land / untap).
  const [manaPulse, setManaPulse] = useState(false);
  const prevAvail = useRef(mana.avail);
  useEffect(() => {
    if (prevAvail.current === mana.avail) return;
    prevAvail.current = mana.avail;
    setManaPulse(true);
    const t = setTimeout(() => setManaPulse(false), 2000);
    return () => clearTimeout(t);
  }, [mana.avail]);
  return (
    <div className={'playerbar' + (self ? ' me' : '')}>
      <span
        className={'shield-avatar ' + (targetable ? 'targetable' : '')}
        data-player={side}
        onClick={onFace}
        title={(self ? 'You' : 'Opponent') + (targetable ? ' — target' : '')}
      >
        <svg className="user-ico" viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="8" r="3.6" />
          <path d="M5 20c0-4 3.5-6 7-6s7 2 7 6" />
        </svg>
      </span>
      <div className="pstats">
        <span className="life" title="Life — you lose when this hits 0">
          ♥ {p.life}
        </span>
        <span
          className={'mana' + (manaPulse ? ' pulse' : '')}
          title="Mana — untapped lands / total. Lands tap to pay card costs"
        >
          ◈ {mana.avail}/{mana.total}
        </span>
        <span className="counts" title="Cards in hand · cards left in deck">
          {p.hand.length} ✋ · {p.library.length} 🂠
        </span>
      </div>
    </div>
  );
}

// Sorcery -> spritesheet (single-row strips in public/effects; frames = width/height).
const SPELL_FX: Record<string, { sheet: string; frames: number }> = {
  cinderbolt: { sheet: '/effects/fire-bomb.png', frames: 14 },
  scorch: { sheet: '/effects/explosion.png', frames: 18 },
  insight: { sheet: '/effects/star-caller.png', frames: 7 },
  wild_growth: { sheet: '/effects/green-aura.png', frames: 8 },
  default: { sheet: '/effects/lightning.png', frames: 5 },
};
const LAND_FX = { sheet: '/effects/green-aura.png', frames: 8 }; // rejuvenate on land play

// --- combat strike animation helpers (imperative, conflict-free with framer) ---
function stackEl(iid: string): HTMLElement | null {
  return document.querySelector(`[data-iid="${iid}"]`)?.closest('.stack') ?? null;
}
function lungeTo(from: HTMLElement | null, to: Element | null) {
  if (!from || !to) return;
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  from.animate(
    [
      { transform: 'translate(0,0)' },
      { transform: `translate(${dx * 0.45}px, ${dy * 0.45}px)`, offset: 0.4 },
      { transform: 'translate(0,0)' },
    ],
    { duration: 360, easing: 'cubic-bezier(.3,.85,.3,1)' },
  );
}
function shakeEl(el: HTMLElement | null) {
  if (!el) return;
  el.animate(
    [
      { transform: 'translate(0,0)' },
      { transform: 'translate(-4px,2px)' },
      { transform: 'translate(4px,-2px)' },
      { transform: 'translate(-2px,1px)' },
      { transform: 'translate(0,0)' },
    ],
    { duration: 260, easing: 'ease-out' },
  );
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
    .replace(/\bYou (plays|casts|attacks|blocks|decks|creates|ramps|gains|heals)\b/g, (_m, v) => 'You ' + v.slice(0, -1));
}

function ActionLog({
  log,
  myId,
  boundsRef,
}: {
  log: string[];
  myId: PlayerId;
  boundsRef: React.RefObject<HTMLDivElement>;
}) {
  const controls = useDragControls();
  const recent = log.slice(-40).reverse(); // newest first
  return (
    <motion.div
      className="action-log"
      drag
      dragListener={false}
      dragControls={controls}
      dragConstraints={boundsRef}
      dragMomentum={false}
      dragElastic={0.12}
    >
      <div
        className="action-log-head"
        onPointerDown={(e) => controls.start(e)}
        style={{ touchAction: 'none' }}
      >
        <span className="grip" aria-hidden>
          ⠿
        </span>
        Activity
      </div>
      <div className="action-log-body">
        {recent.map((line, i) => (
          <div key={log.length - i} className="log-line">
            {humanize(line, myId)}
          </div>
        ))}
      </div>
    </motion.div>
  );
}
