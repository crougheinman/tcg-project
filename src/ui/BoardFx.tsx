import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { getDef } from '../cards/cards';
import { isCreature, isLand, power, toughness } from '../engine/rules';
import type { GameState, PlayerId } from '../engine/types';
import { opponentOf } from '../engine/types';
import { useGame } from '../store/gameStore';
import { DestroyFx } from './DestroyFx';
import {
  ChargeFx,
  DebrisFx,
  SlashFx,
  SmashDustFx,
  SmokeFx,
  SoulSiphonFx,
  SpellImpactFx,
  WitherFx,
  type SpellTheme,
} from './ImpactFx';
import { LandAbsorbFx, type LandAbsorb } from './LandAbsorbFx';
import { ProjectileFx, type Projectile } from './Projectile';
import { CHARGE_MS, HEAL_SPELLS, PROJECTILE_TRAVEL_MS, SMOKE_SPELLS } from './spellTiming';
import type { Burst } from './Vfx';

// three.js is heavy — split it into its own chunk, loaded only in-game.
const VfxCanvas = lazy(() => import('./Vfx').then((m) => ({ default: m.VfxCanvas })));

// Combat pacing (MTG Arena style): attackers strike one after another, and each
// strike's feedback (slash / shake / damage numbers) lands at the lunge's impact
// moment — not on declaration.
const STRIKE_STAGGER_MS = 260; // gap between consecutive attacker strikes
const IMPACT_MS = 150; // time into a lunge when the hit "lands" (~40% of 360ms)

// Creature spell-trigger (e.g. Pyre Adept): a quick charge at the creature card,
// then a bolt fired at the opponent — a mini version of the burn-spell cadence.
const TRIGGER_CHARGE_MS = 650;
const TRIGGER_THEME: SpellTheme = { core: '#fff2cf', glow: '#ff8a33', ring: '#ff5a2a' };

/**
 * The board's visual-effects engine. Diffs each new GameState against the
 * previous one and spawns the matching flourishes (particle bursts, damage
 * floaters, combat lunges/slashes, spell bursts, destruction sequences).
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
  const [dusts, setDusts] = useState<{ id: number; x: number; y: number }[]>([]);
  const [blockFx, setBlockFx] = useState<{ id: number; x: number; y: number }[]>([]);
  const [landAbsorbs, setLandAbsorbs] = useState<LandAbsorb[]>([]);
  const [projectiles, setProjectiles] = useState<Projectile[]>([]);
  const [destroys, setDestroys] = useState<
    { id: number; x: number; y: number; style: 'fire' | 'debris' | 'wither' }[]
  >([]);
  const [smokes, setSmokes] = useState<
    { id: number; x: number; y: number; color: string; ms: number }[]
  >([]);
  const [siphons, setSiphons] = useState<{ id: number; x: number; y: number; ms: number }[]>([]);
  const [spellFx, setSpellFx] = useState<
    { id: number; theme: SpellTheme; x: number; y: number } | null
  >(null);
  const [charges, setCharges] = useState<
    { id: number; x: number; y: number; theme: SpellTheme; ms: number }[]
  >([]);

  const prevGame = useRef<GameState>(game);
  const burstId = useRef(0);
  const dmgId = useRef(0);
  const creatureRects = useRef<Record<string, { x: number; y: number }>>({});

  // A spell is telegraphing (store-driven, before it resolves): 'charge' plays a
  // burn orb + screen shake at the caster; 'smoke' plays colored smoke at the
  // target card. Clears when the store applies the spell.
  const charging = useGame((s) => s.charging);
  useEffect(() => {
    if (!charging) return;
    if (charging.kind === 'smoke') {
      // smoke rises from the TARGET card (violet = Grasp, green = Withering)
      const t = charging.target;
      const sel =
        t?.kind === 'creature'
          ? `[data-iid="${t.iid}"]`
          : t?.kind === 'player'
            ? `[data-player="${t.player}"]`
            : null;
      const el = sel ? document.querySelector(sel) : null;
      const r = el?.getBoundingClientRect();
      if (!r) return;
      const color = SMOKE_COLOR[charging.def] ?? SMOKE_COLOR.default;
      const id = dmgId.current++;
      setSmokes((s) => [
        ...s,
        { id, x: r.left + r.width / 2, y: r.top + r.height / 2, color, ms: charging.ms },
      ]);
      return () => setSmokes((s) => s.filter((x) => x.id !== id));
    }
    if (charging.kind === 'heal') {
      // Self-heal ritual at the caster's own avatar: green smoke + green glow, and
      // (Soul Siphon) green souls streaming into it, for the whole window.
      const av = document.querySelector(`[data-player="${charging.casterId}"]`) as HTMLElement | null;
      const r = av?.getBoundingClientRect();
      if (!r) return;
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const id = dmgId.current++;
      setSmokes((s) => [...s, { id, x, y, color: '#6ad46a', ms: charging.ms }]);
      if (charging.def === 'soul_siphon') {
        setSiphons((sf) => [...sf, { id, x, y, ms: charging.ms }]);
      }
      av?.animate(
        [
          { filter: 'drop-shadow(0 0 0 rgba(110,224,106,0)) brightness(1)' },
          { filter: 'drop-shadow(0 0 18px rgba(110,224,106,0.95)) brightness(1.2)' },
          { filter: 'drop-shadow(0 0 18px rgba(110,224,106,0.95)) brightness(1.2)' },
          { filter: 'drop-shadow(0 0 0 rgba(110,224,106,0)) brightness(1)' },
        ],
        { duration: charging.ms, easing: 'ease-in-out', fill: 'both' },
      );
      return () => {
        setSmokes((s) => s.filter((x) => x.id !== id));
        setSiphons((sf) => sf.filter((x) => x.id !== id));
      };
    }
    // 'charge': burn orb + intensifying shake at the caster
    const av = document.querySelector(`[data-player="${charging.casterId}"]`);
    const ar = av?.getBoundingClientRect();
    const theme = SPELL_FX[charging.def] ?? SPELL_FX.default;
    const id = dmgId.current++;
    if (ar) {
      setCharges((c) => [
        ...c,
        { id, x: ar.left + ar.width / 2, y: ar.top + ar.height / 2, theme, ms: CHARGE_MS },
      ]);
    }
    chargeShake(document.querySelector('.board'), CHARGE_MS);
    return () => setCharges((c) => c.filter((x) => x.id !== id));
  }, [charging]);

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
    // A creature spell-trigger (Pyre Adept) will charge + shoot this action? Used to
    // hold a non-damage-spell's damage numbers until that trigger bolt lands.
    const triggerShot = newSpells.some((sp) => {
      const spDef = getDef(sp.def);
      return game.players[sp.owner].battlefield.some((cr) => {
        const d = getDef(cr.def);
        return d.spellTrigger?.type === 'damage' && !(spDef.type === 'instant' && !d.spellTriggerInstant);
      });
    });

    // Resolved combat this action? Its feedback is choreographed: strike i lands at
    // strikeDelay(i), so damage numbers / bursts wait for the first hit instead of
    // appearing before the attacker has even moved.
    const resolved = game.lastCombat;
    const combatHit = before.phase === 'combat_block' && game.phase === 'end' && !!resolved;
    const blockerByAtk: Record<string, string> = {};
    if (resolved) for (const [blk, atk] of Object.entries(resolved.blocks)) blockerByAtk[atk] = blk;
    const strikeDelay = (i: number) => i * STRIKE_STAGGER_MS + IMPACT_MS;
    const firstUnblocked = resolved
      ? resolved.attackers.findIndex((a) => !blockerByAtk[a])
      : -1;
    const faceDmgDelay = combatHit && firstUnblocked >= 0 ? strikeDelay(firstUnblocked) : 0;

    let dmgTargetSel: string | null = null; // who/what just took damage (for the spell fx)
    const newDmgNums: { id: number; x: number; y: number; amt: number }[] = [];
    for (const pid of ['A', 'B'] as PlayerId[]) {
      const d = before.players[pid].life - game.players[pid].life;
      if (d > 0) {
        dmgTargetSel = `[data-player="${pid}"]`;
        spawnAt(`[data-player="${pid}"]`, '#ff7a33', Math.min(48, 14 + d * 3));
        const el = document.querySelector(`[data-player="${pid}"]`);
        if (el) {
          const r = el.getBoundingClientRect();
          newDmgNums.push({ id: dmgId.current++, x: r.left + r.width / 2, y: r.top, amt: d });
          // spell damage shakes on bolt impact; combat damage shakes on strike impact
          if (!spellDamage && !combatHit) shakeEl(el as HTMLElement);
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
    // Flush damage feedback in sync with the hit that caused it: at the first
    // strike's impact in combat, at the bolt's impact for a damage spell (the
    // charge already played before this action resolved), else right away.
    const flushDamage = () => {
      if (add.length) setBursts((b) => [...b, ...add]);
      if (newDmgNums.length) setDmgNums((n) => [...n, ...newDmgNums]);
    };
    if (combatHit && faceDmgDelay) setTimeout(flushDamage, faceDmgDelay);
    else if (spellDamage) setTimeout(flushDamage, PROJECTILE_TRAVEL_MS);
    else if (triggerShot) setTimeout(flushDamage, TRIGGER_CHARGE_MS + PROJECTILE_TRAVEL_MS);
    else flushDamage();

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

    // Spell impact: a damage spell fires a bolt from the caster's avatar to its
    // target — burst + shake + creature-destroy all land on impact. Any charge-up
    // already played (store-driven) before this action resolved, so here we just
    // fire the bolt. If the target creature just DIED, aim at its last known spot
    // (its DOM node is gone) so the bolt still lands where the creature stood.
    const aliveNow = new Set(
      [...game.players.A.battlefield, ...game.players.B.battlefield].map((c) => c.iid),
    );
    let spellToX = 0;
    let spellToY = 0;
    let spellHasTarget = false;
    let spellTargetSel: string | null = dmgTargetSel;
    if (dmgTargetSel) {
      const r = document.querySelector(dmgTargetSel)?.getBoundingClientRect();
      if (r) {
        spellToX = r.left + r.width / 2;
        spellToY = r.top + r.height / 2;
        spellHasTarget = true;
      }
    }
    if (!spellHasTarget) {
      for (const pid of ['A', 'B'] as PlayerId[]) {
        for (const c of before.players[pid].battlefield) {
          if (isCreature(c) && !aliveNow.has(c.iid) && creatureRects.current[c.iid]) {
            const r = creatureRects.current[c.iid];
            spellToX = r.x;
            spellToY = r.y;
            spellHasTarget = true;
            spellTargetSel = null; // creature is gone — nothing to shake on impact
            break;
          }
        }
        if (spellHasTarget) break;
      }
    }
    for (const sp of newSpells) {
      // Smoke spells (Grasp/Withering) and heal spells (Soothe/Soul Siphon) own their
      // whole sequence via the telegraph; no generic bolt or flash for them.
      if (SMOKE_SPELLS.has(sp.def) || HEAL_SPELLS.has(sp.def)) continue;
      const theme = SPELL_FX[sp.def] ?? SPELL_FX.default;
      const isDmg = getDef(sp.def).effect?.type === 'damage';
      if (isDmg && spellHasTarget) {
        const av = document.querySelector(`[data-player="${sp.owner}"]`);
        const ar = av?.getBoundingClientRect();
        setProjectiles((p) => [
          ...p,
          {
            id: dmgId.current++,
            fromX: ar ? ar.left + ar.width / 2 : spellToX,
            fromY: ar ? ar.top + ar.height / 2 : spellToY,
            toX: spellToX,
            toY: spellToY,
            targetSel: spellTargetSel,
            theme,
            kind: sp.def === 'shuriken_volley' ? 'shuriken' : 'bolt',
          },
        ]);
      } else {
        // non-damage spell (draw / etc.) -> flash at the target or screen centre
        const el = dmgTargetSel ? document.querySelector(dmgTargetSel) : null;
        const r = el?.getBoundingClientRect();
        setSpellFx({
          id: dmgId.current++,
          theme,
          x: r ? r.left + r.width / 2 : window.innerWidth / 2,
          y: r ? r.top + r.height / 2 : window.innerHeight / 2,
        });
      }
    }

    // Creature spell-triggers (Pyre Adept & friends): when their controller casts a
    // matching spell, EACH such creature charges a bolt at its own card, then shoots
    // it at the opponent. The charge appears exactly where the creature stands.
    for (const sp of newSpells) {
      const spDef = getDef(sp.def);
      const oppId = opponentOf(sp.owner);
      const oppAv = document.querySelector(`[data-player="${oppId}"]`);
      const or = oppAv?.getBoundingClientRect();
      for (const cr of game.players[sp.owner].battlefield) {
        const crDef = getDef(cr.def);
        if (!crDef.spellTrigger || crDef.spellTrigger.type !== 'damage') continue;
        if (spDef.type === 'instant' && !crDef.spellTriggerInstant) continue;
        const el = document.querySelector(`[data-iid="${cr.iid}"]`);
        if (!el) continue;
        const cardR = el.getBoundingClientRect();
        const fromX = cardR.left + cardR.width / 2;
        const fromY = cardR.top + cardR.height / 2;
        const toX = or ? or.left + or.width / 2 : fromX;
        const toY = or ? or.top + or.height / 2 : fromY;
        const chId = dmgId.current++;
        setCharges((c) => [
          ...c,
          { id: chId, x: fromX, y: fromY, theme: TRIGGER_THEME, ms: TRIGGER_CHARGE_MS },
        ]);
        setTimeout(() => {
          setCharges((c) => c.filter((x) => x.id !== chId));
          setProjectiles((p) => [
            ...p,
            {
              id: dmgId.current++,
              fromX,
              fromY,
              toX,
              toY,
              targetSel: `[data-player="${oppId}"]`,
              theme: TRIGGER_THEME,
            },
          ]);
        }, TRIGGER_CHARGE_MS);
      }
    }

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

    // A creature just entered -> table-smash dust when its slam lands (~140ms in).
    for (const pid of ['A', 'B'] as PlayerId[]) {
      for (const c of game.players[pid].battlefield) {
        if (!battleBefore.has(c.iid) && isCreature(c)) {
          const el = document.querySelector(`[data-iid="${c.iid}"]`);
          if (!el) continue;
          const r = el.getBoundingClientRect();
          const d = { id: dmgId.current++, x: r.left + r.width / 2, y: r.top + r.height * 0.78 };
          setTimeout(() => setDusts((s) => [...s, d]), 140);
          setTimeout(() => setDusts((s) => s.filter((x) => x.id !== d.id)), 140 + 800);
        }
      }
    }

    // Combat strike choreography: each attacker strikes in turn (STRIKE_STAGGER_MS
    // apart); its slash / shield-pop / shake land at the lunge's impact moment.
    // (lastCombat, not combat — blocks never persist during combat_block.)
    if (combatHit && resolved) {
      const defenderShield = document.querySelector(`[data-player="${opponentOf(before.active)}"]`);
      const spawnSlash = (el: Element | null) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        const id = dmgId.current++;
        setSlashes((s) => [...s, { id, x: r.left + r.width / 2, y: r.top + r.height / 2 }]);
        setTimeout(() => setSlashes((s) => s.filter((n) => n.id !== id)), 600);
      };
      const spawnBlock = (el: Element | null) => {
        if (!el) return;
        const r = el.getBoundingClientRect();
        setBlockFx((b) => [
          ...b,
          { id: dmgId.current++, x: r.left + r.width / 2, y: r.top + r.height / 2 },
        ]);
      };
      resolved.attackers.forEach((atk, i) => {
        const blk = blockerByAtk[atk];
        setTimeout(() => {
          // re-query at strike time — dying cards are still in the DOM (exit fade)
          const atkEl = stackEl(atk);
          if (blk) {
            lungeTo(atkEl, stackEl(blk)); // clash with the blocker
            setTimeout(() => {
              shakeEl(stackEl(blk));
              spawnSlash(stackEl(blk));
              spawnBlock(stackEl(blk)); // shield-pop so the block reads clearly
            }, IMPACT_MS);
          } else {
            lungeTo(atkEl, defenderShield); // straight at the player
            setTimeout(() => {
              spawnSlash(defenderShield);
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
            }, IMPACT_MS);
          }
        }, i * STRIKE_STAGGER_MS);
      });
    }

    // A creature left the battlefield (destroyed). The visual matches the cause:
    // Grasp -> stone debris, Withering -> green wither, else the fire sequence.
    // Timing: combat waits for the killing strike; a fire-spell kill waits for the
    // bolt; grasp/withering fire right away (their smoke telegraph already played).
    const graspKill = newSpells.some((sp) => sp.def === 'grasp_from_grave');
    const witherKill = newSpells.some((sp) => sp.def === 'withering_touch');
    const deathStyle: 'fire' | 'debris' | 'wither' = graspKill
      ? 'debris'
      : witherKill
        ? 'wither'
        : 'fire';
    const deathDelay = (iid: string): number => {
      if (combatHit && resolved) {
        const ai = resolved.attackers.indexOf(iid); // an attacker that died in a clash
        if (ai >= 0) return strikeDelay(ai);
        const atk = resolved.blocks[iid]; // a blocker: killed on its attacker's strike
        const bi = atk ? resolved.attackers.indexOf(atk) : -1;
        return bi >= 0 ? strikeDelay(bi) : 0;
      }
      if (graspKill || witherKill) return 0; // smoke already played; fade now
      if (spellDamage) return PROJECTILE_TRAVEL_MS; // explode when the bolt lands
      return 0;
    };
    for (const pid of ['A', 'B'] as PlayerId[]) {
      for (const c of before.players[pid].battlefield) {
        if (isCreature(c) && !aliveNow.has(c.iid)) {
          const r = creatureRects.current[c.iid];
          if (!r) continue;
          const fx = { id: dmgId.current++, x: r.x, y: r.y, style: deathStyle };
          const delay = deathDelay(c.iid);
          if (delay) setTimeout(() => setDestroys((d) => [...d, fx]), delay);
          else setDestroys((d) => [...d, fx]);
          // fire (DestroyFx) removes itself via onDone; debris/wither are one-shot
          // framer sequences, so auto-clear them after they finish playing.
          if (fx.style !== 'fire') {
            setTimeout(() => setDestroys((d) => d.filter((x) => x.id !== fx.id)), delay + 1700);
          }
        }
      }
    }

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
    const t = setTimeout(() => setSpellFx(null), 1400); // one-shot burst + afterglow
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
  const onProjectileImpact = useCallback((p: Projectile) => {
    if (p.kind === 'shuriken') {
      // metallic hit: a quick slash spark, not a fireball burst
      const id = dmgId.current++;
      setSlashes((s) => [...s, { id, x: p.toX, y: p.toY }]);
      setTimeout(() => setSlashes((s) => s.filter((n) => n.id !== id)), 600);
      return;
    }
    setSpellFx({ id: dmgId.current++, theme: p.theme, x: p.toX, y: p.toY });
  }, []);

  return (
    <>
      <Suspense fallback={null}>
        <VfxCanvas bursts={bursts} onDone={removeBurst} />
      </Suspense>

      {faceFlash > 0 && <div key={faceFlash} className="face-flash" />}

      {charges.map((c) => (
        <ChargeFx key={c.id} x={c.x} y={c.y} theme={c.theme} ms={c.ms} />
      ))}

      {slashes.map((s) => (
        <SlashFx key={s.id} x={s.x} y={s.y} />
      ))}

      {dusts.map((d) => (
        <SmashDustFx key={d.id} x={d.x} y={d.y} />
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

      {destroys.map((d) =>
        d.style === 'debris' ? (
          <DebrisFx key={d.id} x={d.x} y={d.y} />
        ) : d.style === 'wither' ? (
          <WitherFx key={d.id} x={d.x} y={d.y} />
        ) : (
          <DestroyFx key={d.id} x={d.x} y={d.y} onDone={() => removeDestroy(d.id)} />
        ),
      )}

      {smokes.map((s) => (
        <SmokeFx key={s.id} x={s.x} y={s.y} color={s.color} ms={s.ms} />
      ))}

      {siphons.map((s) => (
        <SoulSiphonFx key={s.id} x={s.x} y={s.y} ms={s.ms} />
      ))}

      {landAbsorbs.map((fx) => (
        <LandAbsorbFx key={fx.id} fx={fx} onDone={removeLandAbsorb} />
      ))}

      {projectiles.map((p) => (
        <ProjectileFx key={p.id} fx={p} onImpact={onProjectileImpact} onDone={removeProjectile} />
      ))}

      <AnimatePresence>
        {spellFx && (
          <SpellImpactFx key={spellFx.id} x={spellFx.x} y={spellFx.y} theme={spellFx.theme} />
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

// Spell -> impact color theme (pure framer-motion burst; no spritesheets).
const SPELL_FX: Record<string, SpellTheme> = {
  cinderbolt: { core: '#fff3d6', glow: '#ff9a3c', ring: '#ff5a2a' },
  scorch: { core: '#ffe8c8', glow: '#ff7433', ring: '#e0392b' },
  pyroblast: { core: '#fff0d0', glow: '#ff8433', ring: '#d92f1f' },
  insight: { core: '#f0f8ff', glow: '#6aa9ff', ring: '#3d7fd6' },
  wild_growth: { core: '#eaffe8', glow: '#7fd46a', ring: '#3f9e4d' },
  soothe: { core: '#eafff4', glow: '#54c98a', ring: '#2f9e6a' },
  overgrowth: { core: '#eaffe8', glow: '#7fd46a', ring: '#3f9e4d' },
  default: { core: '#fff8dc', glow: '#ffd36a', ring: '#d9b65a' },
};

// Smoke-telegraph color per spell (Grasp = violet, Withering = green).
const SMOKE_COLOR: Record<string, string> = {
  grasp_from_grave: '#9a5cff',
  withering_touch: '#6ad46a',
  default: '#9a5cff',
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
// Pre-cast charge shake: amplitude AND frequency both ramp up over `ms` (a chirp),
// so the screen visibly rattles harder and faster the longer the charge builds.
function chargeShake(el: Element | null, ms: number, maxPx = 10) {
  if (!el) return;
  const steps = Math.max(24, Math.round(ms / 35));
  const frames: Keyframe[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const amp = maxPx * t * t; // amplitude ramps up (faster growth near the end)
    const freq = 3 + t * 10; // frequency ramps up too
    const angle = freq * t * Math.PI * 2;
    const dx = Math.sin(angle) * amp + (Math.random() - 0.5) * amp * 0.4;
    const dy = Math.cos(angle * 1.3) * amp * 0.55 + (Math.random() - 0.5) * amp * 0.3;
    frames.push({ transform: `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)` });
  }
  frames.push({ transform: 'translate(0,0)' }); // settle exactly as the bolt fires
  el.animate(frames, { duration: ms, easing: 'linear' });
}
