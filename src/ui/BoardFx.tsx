import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { getDef } from '../cards/cards';
import { isCreature, isLand, power, toughness } from '../engine/rules';
import type { GameState, PlayerId } from '../engine/types';
import { opponentOf } from '../engine/types';
import { DestroyFx } from './DestroyFx';
import { LandAbsorbFx, type LandAbsorb } from './LandAbsorbFx';
import { ProjectileFx, type Projectile } from './Projectile';
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
  const [statFloats, setStatFloats] = useState<
    { id: number; x: number; y: number; text: string; up: boolean }[]
  >([]);
  const [slashes, setSlashes] = useState<{ id: number; x: number; y: number }[]>([]);
  const [blockFx, setBlockFx] = useState<{ id: number; x: number; y: number }[]>([]);
  const [landAbsorbs, setLandAbsorbs] = useState<LandAbsorb[]>([]);
  const [projectiles, setProjectiles] = useState<Projectile[]>([]);
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
    // Spells that just entered a graveyard this action (sorcery or instant). A damage
    // spell defers its shake + explosion to the bolt's impact, so the hit lands with it.
    const graveBefore = new Set(
      [...before.players.A.graveyard, ...before.players.B.graveyard].map((c) => c.iid),
    );
    const newSpells: { def: string; owner: PlayerId }[] = [];
    for (const pid of ['A', 'B'] as PlayerId[])
      for (const c of game.players[pid].graveyard)
        if (!graveBefore.has(c.iid)) {
          const t = getDef(c.def).type;
          if (t === 'sorcery' || t === 'instant') newSpells.push({ def: c.def, owner: pid });
        }
    const spellDamage = newSpells.some((sp) => getDef(sp.def).effect?.type === 'damage');

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
          if (!spellDamage) shakeEl(el as HTMLElement); // spell damage shakes on bolt impact
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

    // Creature stat changes -> a floating number at the creature (green up / red down),
    // same drift-down-and-fade as the "Mana +1" float. Covers persistent changes the
    // state diff can see: buffs/debuffs (power/toughness) and marked damage (e.g. burn,
    // Whipflash). Combat damage on survivors clears in the same action, so it's not shown.
    const beforeStats = new Map<string, { p: number; t: number; d: number }>();
    for (const pid of ['A', 'B'] as PlayerId[])
      for (const c of before.players[pid].battlefield)
        if (isCreature(c)) beforeStats.set(c.iid, { p: power(c), t: toughness(c), d: c.damage });
    const newStatFloats: { id: number; x: number; y: number; text: string; up: boolean }[] = [];
    for (const pid of ['A', 'B'] as PlayerId[])
      for (const c of game.players[pid].battlefield) {
        if (!isCreature(c)) continue;
        const b = beforeStats.get(c.iid);
        if (!b) continue; // just entered — no delta to show
        const dP = power(c) - b.p;
        const dT = toughness(c) - b.t;
        const dDmg = c.damage - b.d;
        let text: string | null = null;
        let up = true;
        if (dP !== 0 || dT !== 0) {
          up = dP + dT > 0; // buffs are +/+, debuffs -/-
          text = `${dP >= 0 ? '+' : ''}${dP}/${dT >= 0 ? '+' : ''}${dT}`;
        } else if (dDmg > 0) {
          up = false; // took (persistent) damage — durability down
          text = `-${dDmg}`;
        }
        if (!text) continue;
        const el = document.querySelector(`[data-iid="${c.iid}"]`);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        newStatFloats.push({ id: dmgId.current++, x: r.left + r.width / 2, y: r.top + 6, text, up });
      }
    if (newStatFloats.length) setStatFloats((s) => [...s, ...newStatFloats]);

    // Spell impact: damage spells fly a bolt from the caster's avatar to the target
    // (explosion + shake land on impact); other spells flash at the target immediately.
    const targetXY = () => {
      const el = dmgTargetSel ? document.querySelector(dmgTargetSel) : null;
      const r = el?.getBoundingClientRect();
      return {
        x: r ? r.left + r.width / 2 : window.innerWidth / 2,
        y: r ? r.top + r.height / 2 : window.innerHeight / 2,
      };
    };
    const newProjectiles: Projectile[] = [];
    for (const sp of newSpells) {
      const fx = SPELL_FX[sp.def] ?? SPELL_FX.default;
      const { x, y } = targetXY();
      if (getDef(sp.def).effect?.type === 'damage' && dmgTargetSel) {
        const av = document.querySelector(`[data-player="${sp.owner}"]`);
        const ar = av?.getBoundingClientRect();
        newProjectiles.push({
          id: dmgId.current++,
          fromX: ar ? ar.left + ar.width / 2 : x,
          fromY: ar ? ar.top + ar.height / 2 : y,
          toX: x,
          toY: y,
          targetSel: dmgTargetSel,
          sheet: fx.sheet,
          frames: fx.frames,
        });
      } else {
        setSpellFx({ id: dmgId.current++, sheet: fx.sheet, frames: fx.frames, x, y });
      }
    }
    if (newProjectiles.length) setProjectiles((p) => [...p, ...newProjectiles]);

    // A land just entered -> it vaporizes into a blue mana orb that flies to its
    // controller's avatar (the land card itself is hidden; the mana readout is it now).
    const battleBefore = new Set(
      [...before.players.A.battlefield, ...before.players.B.battlefield].map((c) => c.iid),
    );
    const newLands: LandAbsorb[] = [];
    for (const pid of ['A', 'B'] as PlayerId[]) {
      for (const c of game.players[pid].battlefield) {
        if (!battleBefore.has(c.iid) && isLand(c)) {
          const avatar = document.querySelector(`[data-player="${pid}"]`);
          const bf = avatar?.closest('.player-zone')?.querySelector('.battlefield') ?? null;
          const fr = bf?.getBoundingClientRect();
          const ar = avatar?.getBoundingClientRect();
          if (!ar) continue;
          const toX = ar.left + ar.width / 2;
          const toY = ar.top + ar.height / 2;
          newLands.push({
            id: dmgId.current++,
            fromX: fr ? fr.left + fr.width / 2 : toX,
            fromY: fr ? fr.top + fr.height / 2 : toY - 80,
            toX,
            toY,
            art: getDef(c.def).art,
            pid,
          });
        }
      }
    }
    if (newLands.length) setLandAbsorbs((la) => [...la, ...newLands]);

    // Combat strike animations: lunge each attacker toward its target. Read the
    // *resolved* combat (lastCombat) — blocks never persist in `combat` during the
    // combat_block phase, so before.combat.blocks would always look empty.
    const resolved = game.lastCombat;
    if (before.phase === 'combat_block' && game.phase === 'end' && resolved) {
      const blockerByAtk: Record<string, string> = {};
      for (const [blk, atk] of Object.entries(resolved.blocks)) blockerByAtk[atk] = blk;
      let faceHit = false;
      const defenderShield = document.querySelector(`[data-player="${opponentOf(before.active)}"]`);
      const newSlashes: { id: number; x: number; y: number }[] = [];
      const newBlocks: { id: number; x: number; y: number }[] = [];
      const slashAt = (el: Element | null) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        newSlashes.push({ id: dmgId.current++, x: r.left + r.width / 2, y: r.top + r.height / 2 });
      };
      const blockAt = (el: Element | null) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        newBlocks.push({ id: dmgId.current++, x: r.left + r.width / 2, y: r.top + r.height / 2 });
      };
      for (const atk of resolved.attackers) {
        const atkEl = stackEl(atk);
        const blk = blockerByAtk[atk];
        if (blk) {
          lungeTo(atkEl, stackEl(blk)); // clash with blocker
          shakeEl(stackEl(blk));
          slashAt(stackEl(blk)); // slash the blocker
          blockAt(stackEl(blk)); // shield-pop on the blocker so the block reads clearly
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
      if (newBlocks.length) setBlockFx((b) => [...b, ...newBlocks]);
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
  const removeLandAbsorb = useCallback(
    (id: number) => setLandAbsorbs((la) => la.filter((x) => x.id !== id)),
    [],
  );
  // Stable refs so ProjectileFx's animation effect doesn't restart on every BoardFx
  // re-render (which happens repeatedly during a cast as other fx state updates).
  const removeProjectile = useCallback(
    (id: number) => setProjectiles((p) => p.filter((x) => x.id !== id)),
    [],
  );
  const onProjectileImpact = useCallback(
    (p: Projectile) =>
      setSpellFx({ id: dmgId.current++, sheet: p.sheet, frames: p.frames, x: p.toX, y: p.toY }),
    [],
  );

  return (
    <>
      <Suspense fallback={null}>
        <VfxCanvas bursts={bursts} onDone={removeBurst} />
      </Suspense>

      {faceFlash > 0 && <div key={faceFlash} className="face-flash" />}

      {slashes.map((s) => (
        <div key={s.id} className="slashfx" style={{ left: s.x, top: s.y }} />
      ))}

      {blockFx.map((b) => (
        <motion.img
          key={b.id}
          className="block-fx"
          src="/ui/shield.png"
          alt=""
          draggable={false}
          // x/y stay -50% (centering) so framer's transform doesn't break it; scale/opacity animate.
          style={{ left: b.x, top: b.y }}
          initial={{ opacity: 0, scale: 0.3, x: '-50%', y: '-50%' }}
          animate={{ opacity: [0, 1, 1, 0], scale: [0.3, 1.35, 1.1, 1], x: '-50%', y: '-50%' }}
          transition={{ duration: 0.7, times: [0, 0.25, 0.6, 1], ease: 'easeOut' }}
          onAnimationComplete={() => setBlockFx((f) => f.filter((x) => x.id !== b.id))}
        />
      ))}

      {destroys.map((d) => (
        <DestroyFx key={d.id} x={d.x} y={d.y} onDone={() => removeDestroy(d.id)} />
      ))}

      {landAbsorbs.map((fx) => (
        <LandAbsorbFx key={fx.id} fx={fx} onDone={removeLandAbsorb} />
      ))}

      {projectiles.map((p) => (
        <ProjectileFx key={p.id} fx={p} onImpact={onProjectileImpact} onDone={removeProjectile} />
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

      <AnimatePresence>
        {statFloats.map((f) => (
          <motion.div
            key={f.id}
            className={'stat-float ' + (f.up ? 'up' : 'down')}
            // same drift-down-and-fade as the "Mana +1" float (x stays -50% to center).
            style={{ left: f.x, top: f.y }}
            initial={{ opacity: 0, y: -6, x: '-50%' }}
            animate={{ opacity: [0, 1, 1, 0], y: [-6, 2, 24, 40], x: '-50%' }}
            transition={{ duration: 1, times: [0, 0.18, 0.7, 1], ease: 'easeIn' }}
            onAnimationComplete={() => setStatFloats((s) => s.filter((x) => x.id !== f.id))}
          >
            {f.text}
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
