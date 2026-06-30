import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { getDef } from '../cards/cards';
import { isCreature, isLand } from '../engine/rules';
import type { GameState, PlayerId } from '../engine/types';
import { opponentOf } from '../engine/types';
import { DestroyFx } from './DestroyFx';
import type { Burst } from './Vfx';

// three.js is heavy — split it into its own chunk, loaded only in-game.
const VfxCanvas = lazy(() => import('./Vfx').then((m) => ({ default: m.VfxCanvas })));

/**
 * The board's visual-effects engine. Diffs each new GameState against the
 * previous one and spawns the matching flourishes (particle bursts, damage
 * floaters, combat lunges/slashes, spell spritesheets, destruction sequences).
 * Self-contained: reads `game`, owns all fx state, queries the DOM by the
 * data-attributes Board renders. Pure flourish — never dispatches.
 */
export function BoardFx({ game }: { game: GameState }) {
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [faceFlash, setFaceFlash] = useState(0);
  const [dmgNums, setDmgNums] = useState<{ id: number; x: number; y: number; amt: number }[]>([]);
  const [slashes, setSlashes] = useState<{ id: number; x: number; y: number }[]>([]);
  const [destroys, setDestroys] = useState<{ id: number; x: number; y: number }[]>([]);
  const [spellFx, setSpellFx] = useState<
    { id: number; sheet: string; frames: number; x: number; y: number } | null
  >(null);

  const prevGame = useRef<GameState>(game);
  const burstId = useRef(0);
  const dmgId = useRef(0);
  const creatureRects = useRef<Record<string, { x: number; y: number }>>({});

  // Spawn three.js particle bursts on damage (face + surviving creatures).
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

  useEffect(() => {
    if (!spellFx) return;
    const t = setTimeout(() => setSpellFx(null), 3000);
    return () => clearTimeout(t);
  }, [spellFx]);

  const removeBurst = (id: number) => setBursts((b) => b.filter((x) => x.id !== id));
  const removeDestroy = (id: number) => setDestroys((d) => d.filter((x) => x.id !== id));

  return (
    <>
      <Suspense fallback={null}>
        <VfxCanvas bursts={bursts} onDone={removeBurst} />
      </Suspense>

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
    </>
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
