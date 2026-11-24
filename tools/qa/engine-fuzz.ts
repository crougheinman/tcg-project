// Run:  npx vite-node tools/qa/engine-fuzz.ts      (SEEDS=100 for the full ~11,000-game pass; default 12)
// Engine-layer combat test. For every ordered deck pairing (56), play many games under
// two policies and check every single transition against an INDEPENDENT oracle:
//   ai    - both sides use the shipped heuristic AI (realistic combat states)
//   chaos - random legal actions incl. random attack subsets / block assignments /
//           instants at any legal moment (states the AI never reaches)
// Oracle = re-derives expected life, deaths, phase and zone contents from the RULES as
// documented, not by calling the reducer's own helpers for the thing being checked.
import { createInitialState } from '../../src/engine/state';
import { applyAction } from '../../src/engine/reducer';
import { pickAction } from '../../src/ai/ai';
import {
  actorOf, canAttack, hasKeyword, isCreature, legalActions, power, toughness,
} from '../../src/engine/rules';
import { DECK_LIST } from '../../src/cards/decks';
import { CARDS, getDef } from '../../src/cards/cards';
import type { Action, CardDef, CardInstance, Effect, GameState, PlayerId, PlayerState } from '../../src/engine/types';
import { needsTarget, opponentOf } from '../../src/engine/types';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const SEEDS = Number(process.env.SEEDS ?? 12);
const OUT = process.env.OUT ?? path.join(os.tmpdir(), 'engine-fuzz.json');
const TOKENS = new Set(['wolf_token', 'zombie_token']);
const BLITZ = ['swift_lancer', 'sky_talon', 'stoneback_cub', 'wolf_token', 'thornwood_brute', 'dread_maw']; // Kunoichi's six beasts (kept independent of BLITZ_BEASTS on purpose)

// tiny seeded PRNG so every failure is reproducible
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

type Finding = { code: string; detail: string; pair: string; policy: string; seed: number; step: number };
const findings: Finding[] = [];
const seen = new Map<string, number>();
function report(code: string, detail: string, ctx: { pair: string; policy: string; seed: number; step: number }) {
  const key = code;
  seen.set(key, (seen.get(key) ?? 0) + 1);
  if ((seen.get(key) ?? 0) <= 4) findings.push({ code, detail, ...ctx });
}

const all = (s: GameState) => [...s.players.A.battlefield, ...s.players.B.battlefield];
const creatures = (s: GameState) => all(s).filter(isCreature);

// ---------- independent expectations ----------
// Per-game counters for Morbid and second-spell bonuses, kept HERE from what is observed between states (a creature leaving the
// battlefield, a creature or spell being cast), not read from the engine's own `diedThisTurn` / `spellsThisTurn`.
type Track = { died: boolean; spells: Record<PlayerId, number> };
const newTrack = (): Track => ({ died: false, spells: { A: 0, B: 0 } });

/**
 * Creatures this action takes off the battlefield for a reason other than damage. A BOUNCED creature goes back to a hand (or, as a token, ceases to
 * exist): that is not a death. A SACRIFICED one does die, but indestructible does not save it. (For an Edict that has not asked yet, every creature the
 * victim has is listed: a superset is fine, it only serves as an exemption.)
 */
function leavers(before: GameState, a: Action): { bounced: Set<string>; sacrificed: Set<string> } {
  const bounced = new Set<string>(), sacrificed = new Set<string>();
  const cardOf = (who: PlayerId, iid: string) => before.players[who].hand.find((c) => c.iid === iid) ?? before.players[who].graveyard.find((c) => c.iid === iid);
  const everyVictim = (who: PlayerId) => { for (const c of before.players[opponentOf(who)].battlefield) if (isCreature(c)) sacrificed.add(c.iid); };
  if (a.type === 'castSorcery') {
    const who = actorOf(before);
    const e = cardOf(who, a.iid) && chosen(getDef(cardOf(who, a.iid)!.def), a);
    if (e?.type === 'bounce' && a.target?.kind === 'creature') bounced.add(a.target.iid);
    if (e?.type === 'edict') everyVictim(who);
  }
  if (a.type === 'castCreature') {
    const who = actorOf(before);
    const e = cardOf(who, a.iid) && getDef(cardOf(who, a.iid)!.def).onEnter;
    if (e?.type === 'edict') everyVictim(who);
  }
  if (a.type === 'ninjutsu') bounced.add(a.attacker); // the swapped-out attacker returns to hand: a bounce, not a death
  if (a.type === 'resolveTrigger' && before.pending) {
    if (before.pending.kind === 'sacrifice') sacrificed.add(a.target);
    else if (before.pending.kind === 'enter' && getDef(before.pending.def).onEnter?.type === 'bounce') bounced.add(a.target);
  }
  return { bounced, sacrificed };
}

function updateTrack(t: Track, before: GameState, a: Action, after: GameState): void {
  if (a.type === 'advance' && before.phase === 'end') { t.died = false; t.spells = { A: 0, B: 0 }; return; }
  if (a.type === 'castCreature' || a.type === 'castSorcery') t.spells[actorOf(before)] += 1;
  const stillThere = new Set(all(after).map((c) => c.iid));
  const lv = leavers(before, a);
  for (const c of creatures(before)) if (!stillThere.has(c.iid) && !lv.bounced.has(c.iid) && !c.unearthed) t.died = true; // (an unearthed creature leaving at the end step is exiled, not dead)
  // an Undying creature that died and came back never left the battlefield, but it did die (Morbid): the log is the witness
  if (after.log.slice(before.log.length).some((l) => l.endsWith(' dies'))) t.died = true;
}

/** Mana a player can spend right now: untapped lands plus floating mana (re-derived here, not the engine's helper). */
const manaOf = (st: GameState, pid: PlayerId) => st.players[pid].battlefield.filter((c) => getDef(c.def).type === 'land' && !c.tapped).length + (st.players[pid].pool ?? 0);

/** Mana SPENT by a player in a transition: lands newly tapped plus floating mana used. (Not manaOf: a ramp spell puts new untapped lands in play.) */
const spentMana = (b: GameState, a: GameState, pid: PlayerId) => {
  const tapped = (st: GameState) => st.players[pid].battlefield.filter((c) => c.tapped && getDef(c.def).type === 'land').length;
  return tapped(a) - tapped(b) + ((b.players[pid].pool ?? 0) - (a.players[pid].pool ?? 0));
};

/** The effect a cast resolves, re-derived here: the chosen mode, with X applied to an X spell's damage / heal / draw amount. */
function chosen(d: ReturnType<typeof getDef>, a: { x?: number; mode?: number }): Effect | undefined {
  let e = d.modes ? d.modes[a.mode ?? 0] : d.effect;
  if (e && d.x && (e.type === 'damage' || e.type === 'heal' || e.type === 'draw')) e = { ...e, amount: e.amount * (a.x ?? 0) };
  return e;
}
type CastOptsOf = { x?: number; mode?: number; kicked?: boolean };

/** An Undying creature that would come back if it died now (it has no counter yet), and an unearthed one (exiled at the end step, or instead of dying): neither follows the plain die-and-stay-dead rules the older checks assume. */
const wouldReturn = (c: CardInstance) => hasKeyword(c, 'undying') && !c.revived && !c.unearthed;

/** The static-ability bonus a creature should wear on `side`'s battlefield, from card data only (own loop, own threshold literal 7, own `unique` handling). */
function auraOf(side: PlayerState, c: CardInstance): { p: number; t: number } {
  let p = 0, t = 0;
  const once = new Set<string>();
  for (const src of side.battlefield) {
    const st = CARDS[src.def].static;
    if (!st) continue;
    if (st.when === 'threshold' && side.graveyard.length < 7) continue;
    const hit = (st.affects.self && c.iid === src.iid) || (st.affects.others && c.iid !== src.iid) || (st.affects.ids ?? []).includes(c.def);
    if (!hit) continue;
    if (st.unique) { if (once.has(src.def)) continue; once.add(src.def); }
    p += st.power; t += st.toughness;
  }
  return { p, t };
}

/**
 * Part 4h: combat is split in two when a Ninjutsu window opens (blocks, then the attacker's answer, then damage). For the action that resolves the
 * window, build the state combat is actually resolved from: the pause state with the Bushido the engine applied at the pause taken back (the simulator
 * applies it itself), and for a swap the ninja in and the attacker out (with the bonuses the new battlefield gives).
 */
function combatView(before: GameState, a: Action): { vb: GameState; blocks: Record<string, string> } {
  const vb = structuredClone(before);
  const blocks = { ...(before.combat?.blocks ?? {}) };
  vb.pending = null;
  for (const [blk, atk] of Object.entries(blocks)) for (const iid of [blk, atk]) {
    const c = all(vb).find((x) => x.iid === iid);
    if (c && hasKeyword(c, 'bushido')) { c.tempP = (c.tempP ?? 0) - 1; c.tempT = (c.tempT ?? 0) - 1; }
  }
  if (a.type === 'ninjutsu') {
    const side = vb.players[vb.active];
    const atk = side.battlefield.find((c) => c.iid === a.attacker)!;
    const ninja = side.hand.find((c) => c.iid === a.ninja)!;
    side.battlefield = side.battlefield.filter((c) => c.iid !== atk.iid);
    side.hand = side.hand.filter((c) => c.iid !== ninja.iid);
    ninja.tapped = true;
    side.battlefield.push(ninja);
    vb.combat = { attackers: (vb.combat?.attackers ?? []).map((i) => (i === a.attacker ? a.ninja : i)), blocks };
    for (const c of side.battlefield) if (CARDS[c.def].type === 'creature') { const x = auraOf(side, c); c.auraP = x.p; c.auraT = x.t; }
  }
  return { vb, blocks };
}

function expectedLife(before: GameState, a: Action, t: Track, paused = false): Record<PlayerId, number> {
  const life = { A: before.players.A.life, B: before.players.B.life };
  const caster = before.phase === 'combat_block' ? opponentOf(before.active) : before.active;
  // an untargeted trigger or bonus effect: it heals its controller, or hurts the opponent when it is damage aimed at the player
  const eff = (e: Effect | undefined, who: PlayerId) => {
    if (!e) return;
    if (e.type === 'heal') life[who] += e.amount;
    if (e.type === 'damage' && e.targets === 'player') life[opponentOf(who)] -= e.amount;
  };
  // Morbid: a creature died earlier this turn. Second spell: the caster has already cast one this turn.
  const bonus = (d: ReturnType<typeof getDef>, who: PlayerId) => {
    if (!d.bonus) return;
    if (d.bonus.when === 'morbid' ? t.died : t.spells[who] >= 1) eff(d.bonus.effect, who);
  };
  const landfalls = (who: PlayerId, lands: number) => {
    for (const cr of before.players[who].battlefield) if (isCreature(cr)) for (let i = 0; i < lands; i++) eff(getDef(cr.def).landTrigger, who);
  };
  if (a.type === 'playLand') landfalls(before.active, 1);
  if (a.type === 'activate') eff(getDef(before.players[before.active].battlefield.find((c) => c.iid === a.iid)!.def).activated!.effect, before.active);
  if (a.type === 'castCreature') bonus(getDef(before.players[actorOf(before)].hand.find((c) => c.iid === a.iid)!.def), actorOf(before));
  if (a.type === 'declareAttackers') for (const iid of a.attackers) eff(getDef(before.players[before.active].battlefield.find((c) => c.iid === iid)!.def).onAttack, before.active);
  if (a.type === 'castSorcery') {
    const hand = (before.players[caster].hand.find((c) => c.iid === a.iid) ?? before.players[caster].graveyard.find((c) => c.iid === a.iid))!; // (flashback casts from the graveyard)
    const main = chosen(getDef(hand.def), a)!;
    const isInstant = getDef(hand.def).type === 'instant';
    if (main.type === 'damage' && a.target?.kind === 'player') life[a.target.player] -= main.amount;
    if (main.type === 'heal') life[caster] += main.amount;
    // ramp puts lands from hand onto the battlefield, and each one is a landfall
    if (main.type === 'ramp') landfalls(caster, Math.min(main.amount, before.players[caster].hand.filter((c) => getDef(c.def).type === 'land').length));
    bonus(getDef(hand.def), caster);
    if (a.kicked && getDef(hand.def).kicker) eff(getDef(hand.def).kicker!.effect, caster); // a paid kicker adds its own effect
    // creature triggers: every trigger creature the caster controls AFTER the spell resolved. A token made by the spell cannot have a trigger, but a
    // creature the spell bounced is gone before the triggers are looked at, so it does not trigger; one that merely dies of damage still does
    // (deaths are checked after the whole action).
    const bouncedAway = leavers(before, a).bounced;
    for (const cr of before.players[caster].battlefield) {
      if (bouncedAway.has(cr.iid)) continue;
      const d = getDef(cr.def);
      if (!d.spellTrigger) continue;
      if (isInstant && !d.spellTriggerInstant) continue;
      if (d.spellTrigger.type === 'damage') life[opponentOf(caster)] -= d.spellTrigger.amount;
    }
  }
  if (a.type === 'declareBlockers' && !paused) {
    const sim = simulateCombat(before, a.blocks);
    life.A += sim.delta.A;
    life.B += sim.delta.B;
  }
  if (a.type === 'ninjutsu' || a.type === 'skipNinjutsu') {
    const cv = combatView(before, a);
    const sim = simulateCombat(cv.vb, cv.blocks);
    life.A += sim.delta.A;
    life.B += sim.delta.B;
  }
  return life;
}

/**
 * Combat, re-derived from the rules text (NOT from the engine's helpers): two damage steps,
 * deaths between them. Step 1 = first strike / double strike; step 2 = everything without first
 * strike, plus double strikers again. Trample assigns lethal to the blocker, the rest to the player;
 * deathtouch makes 1 damage lethal; lifelink gains the damage dealt, in the same step. Bushido gives +1/+1 to a
 * creature that blocks or is blocked (before damage); an indestructible creature is not killed by damage, only by 0 toughness.
 */
function simulateCombat(before: GameState, blocks: Record<string, string>): { delta: Record<PlayerId, number>; dead: Set<string> } {
  const find = (iid: string) => all(before).find((c) => c.iid === iid);
  const side = (iid: string): PlayerId => (before.players.A.battlefield.some((c) => c.iid === iid) ? 'A' : 'B');
  const defSide = opponentOf(before.active);
  const marked = new Map<string, number>();
  const alive = new Set<string>();
  for (const c of creatures(before)) { marked.set(c.iid, c.damage); alive.add(c.iid); }
  const delta: Record<PlayerId, number> = { A: 0, B: 0 };
  const blockerOf = new Map<string, string>();
  for (const [b, atk] of Object.entries(blocks)) blockerOf.set(atk, b);
  const kw = (iid: string, k: Parameters<typeof hasKeyword>[1]) => hasKeyword(find(iid)!, k);
  // bushido: +1/+1 for each creature that is in a block, applied before any damage
  const bushido = new Map<string, number>();
  for (const [b, atk] of Object.entries(blocks)) for (const iid of [b, atk]) if (find(iid) && kw(iid, 'bushido')) bushido.set(iid, (bushido.get(iid) ?? 0) + 1);
  const pw = (iid: string) => power(find(iid)!) + (bushido.get(iid) ?? 0);
  const tough = (iid: string) => toughness(find(iid)!) + (bushido.get(iid) ?? 0);
  const deals = (iid: string, step: 1 | 2) => (step === 1 ? kw(iid, 'firstStrike') || kw(iid, 'doubleStrike') : kw(iid, 'doubleStrike') || !kw(iid, 'firstStrike'));

  for (const step of [1, 2] as const) {
    const hits: { src: string; dst: string | 'face'; n: number }[] = [];
    for (const atkIid of before.combat?.attackers ?? []) {
      if (!find(atkIid) || !alive.has(atkIid)) continue;
      const blkIid = blockerOf.get(atkIid);
      const blkAlive = !!blkIid && !!find(blkIid) && alive.has(blkIid);
      if (deals(atkIid, step)) {
        const n = pw(atkIid);
        if (!blkIid) hits.push({ src: atkIid, dst: 'face', n });
        else if (blkAlive) {
          if (kw(atkIid, 'trample')) {
            const room = tough(blkIid!) - (marked.get(blkIid!) ?? 0);
            const need = Math.max(0, kw(atkIid, 'deathtouch') ? Math.min(1, room) : room);
            hits.push({ src: atkIid, dst: blkIid!, n: Math.min(n, need) });
            hits.push({ src: atkIid, dst: 'face', n: Math.max(0, n - need) });
          } else hits.push({ src: atkIid, dst: blkIid!, n });
        } else if (kw(atkIid, 'trample')) hits.push({ src: atkIid, dst: 'face', n });
      }
      if (blkAlive && deals(blkIid!, step)) hits.push({ src: blkIid!, dst: atkIid, n: pw(blkIid!) });
    }
    for (const h of hits) {
      if (h.n <= 0) continue;
      if (h.dst === 'face') delta[defSide] -= h.n;
      else {
        marked.set(h.dst, (marked.get(h.dst) ?? 0) + h.n);
        if (kw(h.src, 'deathtouch')) marked.set(h.dst, Math.max(marked.get(h.dst)!, tough(h.dst)));
      }
      if (kw(h.src, 'lifelink')) delta[side(h.src)] += h.n;
    }
    for (const iid of [...alive]) if (kw(iid, 'indestructible') ? tough(iid) <= 0 : (marked.get(iid) ?? 0) >= tough(iid)) alive.delete(iid);
    if (before.players.A.life + delta.A <= 0 || before.players.B.life + delta.B <= 0) break; // game over: no second step
  }
  const dead = new Set<string>();
  for (const c of creatures(before)) if (!alive.has(c.iid)) dead.add(c.iid);
  return { delta, dead };
}

// ---------- invariants over one transition ----------
function check(
  before: GameState, a: Action, after: GameState, sizes: Record<PlayerId, number>,
  ctx: { pair: string; policy: string; seed: number; step: number; track?: Track },
) {
  const R = (code: string, d: string) => report(code, d, ctx);

  // 1. iid uniqueness + conservation + zone ownership
  const ids = new Set<string>();
  for (const pid of ['A', 'B'] as PlayerId[]) {
    const p = after.players[pid];
    const zones: [string, CardInstance[]][] = [['library', p.library], ['hand', p.hand], ['battlefield', p.battlefield], ['graveyard', p.graveyard], ['exile', p.exile ?? []]];
    let real = 0;
    for (const [zn, zone] of zones) {
      for (const c of zone) {
        if (ids.has(c.iid)) R('ZONE_DUPLICATE_IID', `${c.iid} (${c.def}) appears twice`);
        ids.add(c.iid);
        if (c.owner !== pid) R('ZONE_WRONG_OWNER', `${c.def} owned by ${c.owner} sits in ${pid}'s ${zn}`);
        if (TOKENS.has(c.def)) {
          if (zn === 'hand' || zn === 'library') R('TOKEN_IN_HAND_OR_LIBRARY', c.def);
          if (zn === 'graveyard') R('TOKEN_IN_GRAVEYARD', `${c.def} sits in ${pid}'s graveyard (counts toward graveyard size / viewer / HUD chip)`);
        } else real++;
      }
    }
    if (real !== sizes[pid]) R('CARD_CONSERVATION', `${pid} has ${real} real cards, started with ${sizes[pid]}`);
    for (const c of p.graveyard) {
      if (isCreature(c) && (c.damage || c.buffP || c.buffT || c.tempP || c.tempT || c.auraP || c.auraT || c.blitz || c.tapped || c.revived || c.unearthed)) R('DEAD_CARD_KEEPS_STATE', `${c.def} in graveyard with damage=${c.damage} buff=${c.buffP}/${c.buffT} temp=${c.tempP ?? 0}/${c.tempT ?? 0} blitz=${c.blitz} tapped=${c.tapped}`);
    }
  }

  // 2. life oracle (skipped once a deck-out has fired: the oracle does not model draws)
  const paused = a.type === 'declareBlockers' && after.pending?.kind === 'ninjutsu'; // Part 4h: combat stopped for the attacker's Ninjutsu answer
  const resolving = a.type === 'ninjutsu' || a.type === 'skipNinjutsu'; // ...and the action that finishes it
  const el = expectedLife(before, a, ctx.track!, paused);
  const decked = (after.log.at(-1) ?? '').includes('decks out') || after.log.some((l, i) => i >= before.log.length && l.includes('decks out'));
  if (!decked) {
    for (const pid of ['A', 'B'] as PlayerId[]) {
      if (after.players[pid].life !== el[pid]) R('LIFE_MISMATCH', `${pid}: expected ${el[pid]} got ${after.players[pid].life} after ${a.type}; log: ${after.log.slice(before.log.length).join(' / ')}`);
    }
  }

  // 3. phase transitions
  const exp = (() => {
    if (a.type === 'keepHand') return before.mulligan?.deciding === 'A' ? 'mulligan' : 'main1';
    if (a.type === 'mulligan') return 'mulligan';
    if (a.type === 'advance') return before.phase === 'main1' ? 'combat_attack' : before.phase === 'combat_attack' ? 'end' : 'main1';
    if (a.type === 'declareAttackers') return a.attackers.length ? 'combat_block' : 'end';
    if (a.type === 'declareBlockers') return paused ? 'combat_block' : 'end';
    if (a.type === 'ninjutsu' || a.type === 'skipNinjutsu') return 'end';
    return before.phase; // spells, land, creature, resolveTrigger
  })();
  if (after.phase !== exp && !after.winner) R('PHASE_TRANSITION', `${before.phase} + ${a.type} -> ${after.phase}, expected ${exp}`);
  if (a.type === 'advance' && before.phase === 'end') {
    if (after.active === before.active) R('TURN_PASS', 'active player did not change');
    if (after.turn !== before.turn + 1) R('TURN_COUNTER', `turn ${before.turn} -> ${after.turn}`);
  }

  // 3a. mulligan: the deciding player's hand is one card smaller each time, and keeping hands the decision over
  if (a.type === 'mulligan' && before.mulligan) {
    const who = before.mulligan.deciding;
    const want = 7 - (before.mulligan.taken[who] + 1);
    if (after.players[who].hand.length !== want) R('MULLIGAN_HAND_SIZE', `${who}: hand ${after.players[who].hand.length}, expected ${want}`);
    if (after.mulligan?.deciding !== who) R('MULLIGAN_TURN', `deciding changed from ${who} after a mulligan`);
    if (after.players[opponentOf(who)].hand.map((c) => c.iid).join() !== before.players[opponentOf(who)].hand.map((c) => c.iid).join()) R('MULLIGAN_TOUCHED_OTHER', 'the other player\'s hand changed');
  }
  if (a.type === 'keepHand' && before.mulligan?.deciding === 'B' && (after.phase !== 'main1' || after.mulligan)) R('MULLIGAN_NOT_OVER', `B kept but the game is in ${after.phase}`);

  // 3b. Phase 2 rules, each re-derived from the rules text rather than from the engine's helpers
  if (a.type === 'advance' && before.phase === 'end') {
    // "until end of turn" buffs are gone once the next turn begins
    for (const c of creatures(after)) if (c.tempP || c.tempT) R('TEMP_NOT_EXPIRED', `${c.def} still has +${c.tempP}/+${c.tempT} in the next turn`);
  }
  if (a.type === 'castSorcery') {
    // prowess: every surviving prowess creature of the caster gets exactly one more +1/+1; a Rally spell gives EVERY creature of the caster
    // (prowess or not) its +P/+T on top. A creature that entered or left does not count.
    const casterId = before.phase === 'combat_block' ? opponentOf(before.active) : before.active;
    const spellDef = (before.players[casterId].hand.find((x) => x.iid === a.iid) ?? before.players[casterId].graveyard.find((x) => x.iid === a.iid))!;
    const chosenE = chosen(getDef(spellDef.def), a);
    const rally = chosenE?.type === 'rally' ? chosenE : { power: 0, toughness: 0 };
    for (const c of before.players[casterId].battlefield) {
      if (!isCreature(c)) continue;
      const now = after.players[casterId].battlefield.find((x) => x.iid === c.iid);
      if (!now) continue; // died to the spell itself
      if (hasKeyword(c, 'undying')) continue; // (a creature that died and came back has lost its temporary bonus)
      const pro = hasKeyword(c, 'prowess') ? 1 : 0;
      if ((now.tempP ?? 0) !== (c.tempP ?? 0) + pro + rally.power || (now.tempT ?? 0) !== (c.tempT ?? 0) + pro + rally.toughness) {
        R('PROWESS_WRONG', `${c.def} temp ${c.tempP ?? 0}/${c.tempT ?? 0} -> ${now.tempP ?? 0}/${now.tempT ?? 0} after a spell (prowess ${pro}, rally +${rally.power}/+${rally.toughness})`);
      }
    }
  }
  if (a.type === 'castCreature' && before.phase !== 'main1') {
    const casterId = actorOf(before);
    const c = before.players[casterId].hand.find((x) => x.iid === a.iid);
    if (c && !hasKeyword(c, 'flash')) R('NON_FLASH_CAST_OFF_MAIN', `${c.def} cast in ${before.phase} without flash`);
    if (before.phase === 'end') R('FLASH_IN_END_STEP', `${c?.def} cast in the end step`);
  }
  if (a.type === 'castCreature') {
    // enter effects that move cards between zones, re-derived from the rules text
    const casterId = actorOf(before);
    const opp = opponentOf(casterId);
    const cast = before.players[casterId].hand.find((x) => x.iid === a.iid);
    const eff = cast && getDef(cast.def).onEnter;
    if (eff?.type === 'discard') {
      const removed = Math.min(eff.amount, before.players[opp].hand.length);
      const gone = before.players[opp].hand.filter((c) => !after.players[opp].hand.some((x) => x.iid === c.iid));
      if (gone.length !== removed) R('DISCARD_COUNT', `${cast!.def}: expected ${removed} discarded, ${gone.length} left the hand`);
      for (const c of gone) if (!after.players[opp].graveyard.some((x) => x.iid === c.iid)) R('DISCARD_NOT_IN_GRAVEYARD', `${c.def} left the hand but is not in the graveyard`);
    }
    if (eff?.type === 'recall') {
      const g = before.players[casterId].graveyard;
      let want = -1;
      for (let i = g.length - 1; i >= 0; i--) if (isCreature(g[i])) { want = i; break; }
      if (want >= 0) {
        if (!after.players[casterId].hand.some((x) => x.iid === g[want].iid)) R('RECALL_WRONG_CARD', `expected ${g[want].def} (the most recent creature) back in hand`);
        if (after.players[casterId].graveyard.length !== g.length - 1) R('RECALL_GRAVEYARD', `graveyard ${g.length} -> ${after.players[casterId].graveyard.length}`);
      } else if (after.players[casterId].graveyard.length !== g.length) R('RECALL_FROM_NOTHING', 'graveyard changed with no creature in it');
    }
  }
  if (a.type === 'castSorcery') {
    // flashback: cast from the graveyard, paid at the flashback cost, then exiled (not back in the graveyard)
    const casterId = before.phase === 'combat_block' ? opponentOf(before.active) : before.active;
    const fromGrave = before.players[casterId].graveyard.find((x) => x.iid === a.iid);
    if (fromGrave && !before.players[casterId].hand.some((x) => x.iid === a.iid)) {
      const fb = getDef(fromGrave.def).flashback;
      if (fb === undefined) R('FLASHBACK_WITHOUT_KEYWORD', `${fromGrave.def} was cast from the graveyard`);
      else {
        if (spentMana(before, after, casterId) !== fb) R('FLASHBACK_COST', `${fromGrave.def}: paid ${spentMana(before, after, casterId)}, flashback costs ${fb}`);
        if (!(after.players[casterId].exile ?? []).some((x) => x.iid === a.iid)) R('FLASHBACK_NOT_EXILED', `${fromGrave.def} is not in exile`);
        if (after.players[casterId].graveyard.some((x) => x.iid === a.iid)) R('FLASHBACK_BACK_IN_GRAVEYARD', `${fromGrave.def} returned to the graveyard`);
      }
    }
  }
  if ((a.type === 'declareBlockers' && !paused) || resolving) {
    // dies triggers: each token-making death adds exactly its tokens (tokens that died are replaced, not lost)
    const cvv = resolving ? combatView(before, a) : null;
    const bfore = cvv ? cvv.vb : before; // (a swap has already happened in the view: the returned attacker is not a death)
    const afterIds = new Set(all(after).map((c) => c.iid));
    // an unearthed creature that leaves at the end step is exiled, not dead, but one that is killed in combat dies and its trigger fires. The log counts the
    // "X dies" lines per name: ordinary leavers account for theirs first, and an unearthed copy is dead only if a line is left over for it.
    const dyingLeft = new Map<string, number>();
    for (const l of after.log.slice(before.log.length)) { const m = /^(.*) dies$/.exec(l); if (m) dyingLeft.set(m[1], (dyingLeft.get(m[1]) ?? 0) + 1); }
    const gone = creatures(bfore).filter((c) => !afterIds.has(c.iid));
    for (const c of gone) if (!c.unearthed) dyingLeft.set(getDef(c.def).name, (dyingLeft.get(getDef(c.def).name) ?? 0) - 1);
    const died = gone.filter((c) => {
      if (!c.unearthed) return true;
      const left = dyingLeft.get(getDef(c.def).name) ?? 0;
      if (left > 0) { dyingLeft.set(getDef(c.def).name, left - 1); return true; }
      return false;
    });
    const defs = new Set<string>();
    for (const c of died) { const t = getDef(c.def).onDeath; if (t?.type === 'token') defs.add(t.token); }
    for (const pid of ['A', 'B'] as PlayerId[]) {
      for (const tok of defs) {
        const beforeN = bfore.players[pid].battlefield.filter((c) => c.def === tok).length;
        const lostN = died.filter((c) => c.owner === pid && c.def === tok).length;
        const madeN = died.filter((c) => c.owner === pid).reduce((n, c) => { const t = getDef(c.def).onDeath; return n + (t?.type === 'token' && t.token === tok ? t.count : 0); }, 0);
        const nowN = after.players[pid].battlefield.filter((c) => c.def === tok).length;
        if (nowN !== beforeN - lostN + madeN && !creatures(bfore).some((c) => hasKeyword(c, 'undying'))) R('DIES_TRIGGER_TOKENS', `${pid}: ${tok} count ${beforeN} -${lostN} +${madeN} expected ${beforeN - lostN + madeN}, got ${nowN}`);
      }
    }
  }

  // 3c. Part 4c: Cycling, Bounce and Edict, each re-derived from the rule text
  if (a.type === 'cycle') {
    const who = before.active;
    const was = before.players[who].hand.find((c) => c.iid === a.iid)!;
    const cost = getDef(was.def).cycling!;
    if (after.players[who].hand.some((c) => c.iid === a.iid)) R('CYCLE_STILL_IN_HAND', `${was.def} is still in hand`);
    if (!after.players[who].graveyard.some((c) => c.iid === a.iid)) R('CYCLE_NOT_IN_GRAVEYARD', `${was.def} is not in the graveyard`);
    if (spentMana(before, after, who) !== cost) R('CYCLE_COST', `${was.def}: paid ${spentMana(before, after, who)}, cycling costs ${cost}`);
    if (!after.winner && after.players[who].hand.length !== before.players[who].hand.length) R('CYCLE_HAND_SIZE', `hand ${before.players[who].hand.length} -> ${after.players[who].hand.length}: one card out, one drawn`);
    if (!after.winner && after.players[who].library.length !== before.players[who].library.length - 1) R('CYCLE_NO_DRAW', 'the library did not shrink by exactly one');
    if ((after.spellsThisTurn?.[who] ?? 0) !== (before.spellsThisTurn?.[who] ?? 0)) R('CYCLE_COUNTED_AS_SPELL', 'cycling is not a cast');
    if (after.players.A.life !== before.players.A.life || after.players.B.life !== before.players.B.life) R('CYCLE_CHANGED_LIFE', 'cycling changed a life total');
  }
  // 3e. Part 4f: hexproof, Scry, Loot and Bite, each re-derived from the rule text
  {
    const caster = before.phase === 'combat_block' ? opponentOf(before.active) : before.active;
    // a creature targeted by the OPPONENT's spell or enter effect must not have hexproof
    let target: string | undefined, by: PlayerId | undefined;
    if (a.type === 'castSorcery' && a.target?.kind === 'creature') { target = a.target.iid; by = caster; }
    if (a.type === 'resolveTrigger' && before.pending?.kind === 'enter') { target = a.target; by = before.pending.controller; }
    if (target && by) {
      const t = all(before).find((c) => c.iid === target);
      if (t && t.owner !== by && hasKeyword(t, 'hexproof') && before.players[opponentOf(by)].battlefield.some((c) => c.iid === target)) R('HEXPROOF_TARGETED', `${t.def} has hexproof but ${by} targeted it`);
    }
  }
  if (a.type === 'scry' && before.pending?.kind === 'scry') {
    const who = before.pending.controller, seen = before.pending.seen ?? 0;
    const lb = before.players[who].library.map((c) => c.iid), la = after.players[who].library.map((c) => c.iid);
    const expected = a.bottom ? [...lb.slice(0, seen), ...lb.slice(seen + 1), lb[seen]] : lb;
    if (JSON.stringify(la) !== JSON.stringify(expected)) R('SCRY_LIBRARY', `scry ${a.bottom ? 'bottom' : 'top'} at ${seen}: library is not as expected`);
    const leftBefore = before.pending.left ?? 1;
    if (leftBefore <= 1 ? after.pending !== null : (after.pending?.left ?? -1) !== leftBefore - 1) R('SCRY_COUNT', `left ${leftBefore} -> ${after.pending?.left ?? 'done'}`);
    if (!a.bottom && after.pending && (after.pending.seen ?? 0) !== seen + 1) R('SCRY_SEEN', 'keeping a card must advance the cursor');
    for (const l of after.log.slice(before.log.length)) if (!/^(A|B) (keeps a card on top|puts a card on the bottom)$/.test(l)) R('SCRY_LOG', `a Scry answer logged something unexpected (it must not name the card): ${l}`);
  }
  if (a.type === 'castSorcery' || a.type === 'castCreature') {
    const who = a.type === 'castCreature' ? actorOf(before) : caster0(before);
    const card = before.players[who].hand.find((c) => c.iid === a.iid) ?? before.players[who].graveyard.find((c) => c.iid === a.iid);
    const d = card && getDef(card.def);
    const eff = a.type === 'castCreature' ? d?.onEnter : d && chosen(d, a as CastOptsOf);
    if (eff?.type === 'scry') {
      const want = Math.min(eff.amount, before.players[who].library.length);
      if (want > 0 && !before.pending && after.pending?.kind !== 'scry' && !after.winner) R('SCRY_NOT_ASKED', `${d!.name} scry ${eff.amount} did not wait on a choice`);
      if (after.pending?.kind === 'scry' && (after.pending.left !== want || after.pending.controller !== who)) R('SCRY_LEFT', `left ${after.pending.left}, expected ${want} for ${after.pending.controller}`);
    }
    if (eff?.type === 'loot' && !after.winner && d?.bonus?.effect.type !== 'draw' && !(( a as CastOptsOf).kicked && d?.kicker?.effect.type === 'draw')) { // (a Morbid draw bonus on the same card would draw a second card)
      if (after.players[who].library.length !== before.players[who].library.length - 1) R('LOOT_NO_DRAW', 'a Loot must draw exactly one card');
      if (after.pending?.kind !== 'discard' || after.pending.controller !== who) R('LOOT_NOT_ASKED', 'a Loot must then wait on the controller discarding');
    }
    if (a.type === 'castSorcery' && eff?.type === 'bite' && a.target?.kind === 'creature') {
      const mine = before.players[who].battlefield.filter(isCreature);
      const victimB = all(before).find((c) => c.iid === a.target!.iid);
      if (mine.length && victimB) {
        const biter = mine.reduce((best, c) => (power(c) > power(best) ? c : best));
        const victimA = all(after).find((c) => c.iid === victimB.iid);
        const lethal = !hasKeyword(victimB, 'indestructible') && (victimB.damage + power(biter) >= toughness(victimB) || (hasKeyword(biter, 'deathtouch') && power(biter) > 0));
        if (lethal && victimA && !after.pending && !wouldReturn(victimB)) R('BITE_SURVIVED', `${biter.def} (power ${power(biter)}) bit ${victimB.def} (toughness ${toughness(victimB)}, damage ${victimB.damage}) and it lived`);
        if (!lethal && victimA && power(biter) > 0 && victimA.damage - victimB.damage !== power(biter) && !hasKeyword(victimB, 'indestructible')) R('BITE_DAMAGE', `${victimB.def}: damage ${victimB.damage} -> ${victimA.damage}, expected +${power(biter)}`);
        const biterA = all(after).find((c) => c.iid === biter.iid);
        if (biterA && biterA.damage !== biter.damage && !after.winner) R('BITE_HURT_BITER', `${biter.def} took damage from its own bite`);
      }
    }
  }
  if (a.type === 'resolveTrigger' && before.pending?.kind === 'discard') {
    const who = before.pending.controller;
    if (!before.players[who].hand.some((c) => c.iid === a.target)) R('LOOT_FOREIGN_CARD', 'discarded a card that was not in hand');
    if (after.players[who].hand.length !== before.players[who].hand.length - 1) R('LOOT_HAND_SIZE', `hand ${before.players[who].hand.length} -> ${after.players[who].hand.length}`);
    if (!after.players[who].graveyard.some((c) => c.iid === a.target)) R('LOOT_NOT_IN_GRAVEYARD', 'the discarded card is not in the graveyard');
    if (after.pending) R('LOOT_STILL_PENDING', 'the discard was made but the game still waits');
    if (after.log.slice(before.log.length).some((l) => /discards/.test(l))) R('LOOT_LOGGED_AS_DISCARD', 'a Loot must not log "discards" (that is Rot\'s show)');
  }

  // 3f. Part 4f2: what a spell COSTS with its cast options, re-derived: cost (or flashback cost) + X + kicker + the ward of an opposing creature it targets
  if (a.type === 'castSorcery') {
    const who = caster0(before);
    const card = before.players[who].hand.find((c) => c.iid === a.iid) ?? before.players[who].graveyard.find((c) => c.iid === a.iid);
    const d = card && getDef(card.def);
    if (d) {
      const fromGrave = !before.players[who].hand.some((c) => c.iid === a.iid);
      let want = fromGrave ? d.flashback! : d.cost;
      if (d.x) want += a.x ?? 0;
      if (a.kicked && d.kicker) want += d.kicker.cost;
      if (a.target?.kind === 'creature') {
        const tc = before.players[opponentOf(who)].battlefield.find((c) => c.iid === (a.target as { iid: string }).iid);
        if (tc) want += getDef(tc.def).ward ?? 0;
      }
      if (spentMana(before, after, who) !== want) R('SPELL_COST', `${d.name}: paid ${spentMana(before, after, who)}, it costs ${want} (x=${a.x ?? '-'} kicked=${!!a.kicked} mode=${a.mode ?? '-'})`);
      if (a.x !== undefined && !d.x) R('X_WITHOUT_X', `${d.name} was cast with X`);
      if (a.kicked && !d.kicker) R('KICKED_WITHOUT_KICKER', `${d.name} was kicked`);
    }
  }

  // 3g. Part 4g: Undying and Unearth, each re-derived from the rule text
  {
    const lvg = leavers(before, a);
    const afterBf = new Set(creatures(after).map((c) => c.iid));
    for (const c of creatures(before)) {
      const now = creatures(after).find((x) => x.iid === c.iid);
      // a first death of an Undying creature must bring it back (it is not on the battlefield only if it was bounced, exiled by Unearth's end step, or already carried its counter)
      const newLog = after.log.slice(before.log.length);
      const diedTwice = newLog.some((l) => l === `${getDef(c.def).name} rises again (Undying)`); // it came back and died again within the action: legitimately gone
      if (hasKeyword(c, 'undying') && !afterBf.has(c.iid) && !lvg.bounced.has(c.iid) && !c.revived && !c.unearthed && !diedTwice) {
        R('UNDYING_STAYED_DEAD', `${c.def} left the battlefield without its counter and did not return (after ${a.type})`);
      }
      if (now && c.revived && !c.summoningSick && now.summoningSick) R('UNDYING_TWICE', `${c.def} returned a second time`);
      if (now?.revived && (!hasKeyword(now, 'undying') || now.buffP < 1)) R('UNDYING_NO_COUNTER', `${now.def} is marked as returned but lacks the +1/+1 counter`);
      // an unearthed creature that leaves must be exiled, never in the graveyard
      if (c.unearthed && !afterBf.has(c.iid) && !lvg.bounced.has(c.iid)) {
        if (after.players[c.owner].graveyard.some((x) => x.iid === c.iid)) R('UNEARTH_TO_GRAVEYARD', `${c.def} was unearthed and ended in the graveyard`);
        if (!TOKENS.has(c.def) && !(after.players[c.owner].exile ?? []).some((x) => x.iid === c.iid)) R('UNEARTH_NOT_EXILED', `${c.def} was unearthed and is not in exile`);
      }
    }
    // the end step exiles everything unearthed
    if (before.phase !== 'end' && after.phase === 'end') for (const c of creatures(after)) if (c.unearthed) R('UNEARTH_SURVIVED_END', `${c.def} is still on the battlefield in the end step`);
    if (a.type === 'unearth') {
      const who = before.active;
      const was = before.players[who].graveyard.find((c) => c.iid === a.iid)!;
      const cost = getDef(was.def).unearth!;
      const now = after.players[who].battlefield.find((c) => c.iid === a.iid);
      if (!now) R('UNEARTH_NOT_BACK', `${was.def} did not return to the battlefield`);
      else if (now.summoningSick) R('UNEARTH_NO_HASTE', `${was.def} returned summoning sick`);
      if (after.players[who].graveyard.some((c) => c.iid === a.iid)) R('UNEARTH_STILL_IN_GRAVEYARD', `${was.def} is in both zones`);
      if (spentMana(before, after, who) !== cost) R('UNEARTH_COST', `${was.def}: paid ${spentMana(before, after, who)}, unearth costs ${cost}`);
      if ((after.spellsThisTurn?.[who] ?? 0) !== (before.spellsThisTurn?.[who] ?? 0)) R('UNEARTH_COUNTED_AS_SPELL', 'an unearth is not a cast');
    }
  }

  // 3h. Part 4h: the Ninjutsu window opens exactly when a ninja in the attacker's hand can be paid for and an attacker is unblocked, and the swap does what the rules text says
  if (a.type === 'declareBlockers') {
    const who = before.active;
    const blocked = new Set(Object.values(a.blocks));
    const open = (before.combat?.attackers ?? []).filter((i) => !blocked.has(i) && before.players[who].battlefield.some((c) => c.iid === i && CARDS[c.def].type === 'creature'));
    const mana = manaOf(before, who);
    const want = open.length > 0 && before.players[who].hand.some((c) => CARDS[c.def].ninjutsu !== undefined && CARDS[c.def].type === 'creature' && CARDS[c.def].ninjutsu! <= mana);
    if (want && !paused) R('NINJUTSU_WINDOW_MISSING', `a ninja could be swapped in (mana ${mana}, ${open.length} unblocked) but combat resolved without asking`);
    if (!want && paused) R('NINJUTSU_WINDOW_SPURIOUS', 'the Ninjutsu window opened with no ninja to pay for or no unblocked attacker');
    if (paused && (after.players[opponentOf(who)].life !== before.players[opponentOf(who)].life || after.players[who].life !== before.players[who].life)) R('NINJUTSU_PAUSE_DAMAGE', 'damage was dealt before the Ninjutsu answer');
    if (paused && after.pending?.controller !== who) R('NINJUTSU_WRONG_CHOOSER', `the window belongs to ${who}, not ${after.pending?.controller}`);
  }
  if (a.type === 'ninjutsu') {
    const who = before.active;
    const ninja = before.players[who].hand.find((c) => c.iid === a.ninja);
    const atk = before.players[who].battlefield.find((c) => c.iid === a.attacker);
    if (!ninja || !atk) R('NINJUTSU_ILLEGAL', 'the swap named a card that is not where it must be');
    else {
      if ((before.combat?.blocks && Object.values(before.combat.blocks).includes(a.attacker))) R('NINJUTSU_BLOCKED_ATTACKER', `${atk.def} was blocked and still swapped`);
      if (spentMana(before, after, who) !== CARDS[ninja.def].ninjutsu) R('NINJUTSU_COST', `${ninja.def}: paid ${spentMana(before, after, who)}, ninjutsu costs ${CARDS[ninja.def].ninjutsu}`);
      if (after.players[who].battlefield.some((c) => c.iid === a.attacker)) R('NINJUTSU_ATTACKER_STAYED', `${atk.def} is still on the battlefield`);
      if (!TOKENS.has(atk.def) && !after.players[who].hand.some((c) => c.iid === a.attacker)) R('NINJUTSU_ATTACKER_NOT_HOME', `${atk.def} did not return to hand`);
      const li = after.lastCombat?.attackers ?? [];
      if (!li.includes(a.ninja) || li.includes(a.attacker)) R('NINJUTSU_COMBAT_LIST', `the combat should name the ninja, not the swapped attacker (${li.join(',')})`);
      if (!after.players[who].battlefield.some((c) => c.iid === a.ninja) && !after.players[who].graveyard.some((c) => c.iid === a.ninja) && !TOKENS.has(ninja.def)) R('NINJUTSU_NINJA_LOST', `${ninja.def} is neither in play nor in the graveyard`);
      if ((after.spellsThisTurn?.[who] ?? 0) !== (before.spellsThisTurn?.[who] ?? 0)) R('NINJUTSU_COUNTED_AS_SPELL', 'ninjutsu is not a cast');
    }
  }
  if (resolving && after.pending) R('NINJUTSU_STILL_PENDING', 'the window was answered but the game still waits');

  // 3d. Part 4e: activated abilities, from the rule text: the cost is paid (tap, mana), the effect resolves, and it is not a cast
  if (a.type === 'activate') {
    const who = before.active;
    const was = before.players[who].battlefield.find((c) => c.iid === a.iid)!;
    const ab = getDef(was.def).activated!;
    const now = after.players[who].battlefield.find((c) => c.iid === a.iid);
    if (ab.cost.tap && (was.tapped || was.summoningSick)) R('ACTIVATE_ILLEGAL_TAP', `${was.def} used a tap ability while tapped=${was.tapped} sick=${was.summoningSick}`);
    if (ab.cost.tap && !now?.tapped) R('ACTIVATE_NOT_TAPPED', `${was.def} used a tap ability and is not tapped`);
    const gain = ab.effect.type === 'mana' ? ab.effect.amount : 0;
    if (manaOf(after, who) !== manaOf(before, who) - (ab.cost.mana ?? 0) + gain) R('ACTIVATE_MANA', `${was.def}: mana ${manaOf(before, who)} -> ${manaOf(after, who)}, cost ${ab.cost.mana ?? 0}, adds ${gain}`);
    if ((after.spellsThisTurn?.[who] ?? 0) !== (before.spellsThisTurn?.[who] ?? 0)) R('ACTIVATE_COUNTED_AS_SPELL', 'an ability is not a cast');
    if (ab.effect.type === 'draw' && !after.winner && after.players[who].hand.length !== before.players[who].hand.length + ab.effect.amount) R('ACTIVATE_DRAW', `${was.def}: hand ${before.players[who].hand.length} -> ${after.players[who].hand.length}`);
    if (ab.effect.type === 'token') {
      const tok = ab.effect.token;
      const nowN = after.players[who].battlefield.filter((c) => c.def === tok).length, wasN = before.players[who].battlefield.filter((c) => c.def === tok).length;
      if (nowN !== wasN + ab.effect.count) R('ACTIVATE_TOKENS', `${was.def}: ${tok} ${wasN} -> ${nowN}, expected +${ab.effect.count}`);
    }
  }
  // floating mana: never negative, and gone whenever the phase has changed
  for (const pid of ['A', 'B'] as PlayerId[]) {
    const pool = after.players[pid].pool ?? 0;
    if (pool < 0) R('POOL_NEGATIVE', `${pid} pool ${pool}`);
    if (before.phase !== after.phase && pool !== 0) R('POOL_NOT_EMPTIED', `${pid} still has ${pool} floating mana after ${before.phase} -> ${after.phase}`);
  }
  for (const iid of leavers(before, a).bounced) {
    const was = all(before).find((c) => c.iid === iid);
    if (!was) continue;
    if (all(after).some((c) => c.iid === iid)) R('BOUNCE_STILL_IN_PLAY', `${was.def} is still on the battlefield`);
    const inHand = after.players[was.owner].hand.find((c) => c.iid === iid);
    if (!TOKENS.has(was.def) !== !!inHand) R('BOUNCE_ZONE', `${was.def}: ${TOKENS.has(was.def) ? 'a token must vanish' : "must be in its owner's hand"}`);
    if ((after.combat?.attackers ?? []).includes(iid) || Object.entries(after.combat?.blocks ?? {}).some(([b, at]) => b === iid || at === iid)) R('BOUNCE_STILL_IN_COMBAT', `${was.def} is still named in combat`);
    if (inHand && (inHand.buffP || inHand.buffT || inHand.damage || inHand.tempP || inHand.tempT || inHand.auraP || inHand.auraT || inHand.blitz || inHand.tapped)) R('BOUNCE_KEEPS_STATE', `${was.def} came back with its marks, buffs or aura`);
  }
  if (a.type === 'castSorcery' || a.type === 'castCreature') {
    const who = actorOf(before);
    const card = before.players[who].hand.find((c) => c.iid === a.iid) ?? before.players[who].graveyard.find((c) => c.iid === a.iid);
    const e = card && (a.type === 'castSorcery' ? chosen(getDef(card.def), a) : getDef(card.def).onEnter);
    if (e?.type === 'edict') {
      const victim = opponentOf(who);
      const theirs = before.players[victim].battlefield.filter(isCreature);
      const asking = after.pending?.kind === 'sacrifice' && after.pending.controller === victim;
      if (theirs.length === 0 && after.pending) R('EDICT_PHANTOM_CHOICE', 'an Edict with nothing to sacrifice asked for a choice');
      if (theirs.length === 1 && (after.pending || (all(after).some((c) => c.iid === theirs[0].iid) && !wouldReturn(theirs[0])))) R('EDICT_ONLY_CREATURE_KEPT', `${theirs[0].def} is the only creature and must be sacrificed at once`);
      if (theirs.length >= 2 && !asking) R('EDICT_NO_CHOICE_OFFERED', `${victim} has ${theirs.length} creatures but was not asked to choose`);
    }
  }
  if (a.type === 'resolveTrigger' && before.pending?.kind === 'sacrifice') {
    const was = all(before).find((c) => c.iid === a.target)!;
    if (all(after).some((c) => c.iid === a.target) && !wouldReturn(was)) R('SACRIFICE_SURVIVED', `${was.def} was sacrificed but is still in play`);
    if (after.pending) R('SACRIFICE_STILL_PENDING', 'the choice was made but the game still waits on it');
    if (!TOKENS.has(was.def) && !was.unearthed && !wouldReturn(was) && !after.players[was.owner].graveyard.some((c) => c.iid === a.target)) R('SACRIFICE_NOT_IN_GRAVEYARD', `${was.def} is not in its owner's graveyard`);
  }

  // 4. combat-specific
  if (a.type === 'declareAttackers' && a.attackers.length) {
    // Battle cry: each OTHER attacker gets +1/+0. Exalted: a lone attacker gets +1/+1 per exalted creature its controller has.
    const mine = before.players[before.active].battlefield;
    const exalted = mine.filter((c) => isCreature(c) && hasKeyword(c, 'exalted')).length;
    for (const iid of a.attackers) {
      const was = mine.find((x) => x.iid === iid), now = after.players[before.active].battlefield.find((x) => x.iid === iid);
      if (!was || !now) continue;
      const cries = a.attackers.filter((o) => o !== iid && hasKeyword(mine.find((x) => x.iid === o)!, 'battleCry')).length;
      const ex = a.attackers.length === 1 ? exalted : 0;
      const dP = (now.tempP ?? 0) - (was.tempP ?? 0), dT = (now.tempT ?? 0) - (was.tempT ?? 0);
      if (dP !== cries + ex) R('ATTACK_PUMP_POWER', `${was.def}: temp power ${was.tempP ?? 0} -> ${now.tempP ?? 0}, expected +${cries + ex} (${cries} battle cry, ${ex} exalted)`);
      if (dT !== ex) R('ATTACK_PUMP_TOUGHNESS', `${was.def}: temp toughness ${was.tempT ?? 0} -> ${now.tempT ?? 0}, expected +${ex}`);
    }
  }
  if (a.type === 'declareAttackers') {
    for (const iid of a.attackers) {
      const c = after.players[before.active].battlefield.find((x) => x.iid === iid);
      if (c && !c.tapped && !hasKeyword(c, 'vigilance')) R('ATTACKER_NOT_TAPPED', `${c.def} attacked but is untapped`);
      if (c && c.tapped && hasKeyword(c, 'vigilance')) R('VIGILANCE_TAPPED', `${c.def} has vigilance but tapped to attack`);
    }
  }
  if ((a.type === 'declareBlockers' && !paused) || resolving) {
    const cvw = resolving ? combatView(before, a) : null;
    const cbefore = cvw ? cvw.vb : before;
    const cblocks = cvw ? cvw.blocks : (a as Extract<Action, { type: 'declareBlockers' }>).blocks;
    const expDead = simulateCombat(cbefore, cblocks).dead;
    const nowAlive = new Set(creatures(after).map((c) => c.iid));
    for (const iid of expDead) if (nowAlive.has(iid) && !wouldReturn(creatures(cbefore).find((c) => c.iid === iid)!)) R('SURVIVED_LETHAL', `${creatures(cbefore).find((c) => c.iid === iid)?.def} should have died in combat`);
    for (const c of creatures(cbefore)) if (!expDead.has(c.iid) && !nowAlive.has(c.iid) && !c.unearthed) R('DIED_WITHOUT_LETHAL', `${c.def} died but took non-lethal combat damage`);
    for (const c of creatures(after)) if (c.damage !== 0) R('DAMAGE_NOT_CLEARED', `${c.def} carries damage ${c.damage} into the end step`);
    if (after.combat !== null) R('COMBAT_NOT_CLEARED', 'state.combat still set after resolution');
    if (!after.lastCombat) R('LASTCOMBAT_MISSING', 'lastCombat not recorded');
    for (const [b, atk] of Object.entries(cblocks)) {
      const bl = all(cbefore).find((c) => c.iid === b), at = all(cbefore).find((c) => c.iid === atk);
      if (bl && at && hasKeyword(at, 'flying') && !hasKeyword(bl, 'flying') && !hasKeyword(bl, 'reach')) R('FLYER_BLOCKED_BY_GROUND', `${at.def} blocked by ${bl.def}`);
      if (bl?.tapped) R('TAPPED_BLOCKER', `${bl.def} blocked while tapped`);
      if (bl && at && hasKeyword(at, 'skulk') && power(bl) > power(at)) R('SKULK_BLOCKED_BY_GREATER', `${at.def} (power ${power(at)}) blocked by ${bl.def} (power ${power(bl)})`);
    }
  }
  // indestructible: no damage, deathtouch or destroy takes a creature with it off the battlefield. (Creatures wearing any static bonus
  // are skipped: losing it can take a point of toughness away, which is the one thing that does kill it.)
  const lv = leavers(before, a);
  for (const c of creatures(before)) {
    if (!hasKeyword(c, 'indestructible') || c.blitz || c.auraT || toughness(c) <= 0 || lv.bounced.has(c.iid) || lv.sacrificed.has(c.iid) || c.unearthed) continue;
    if (!after.players[c.owner].battlefield.some((x) => x.iid === c.iid)) R('INDESTRUCTIBLE_DIED', `${c.def} (toughness ${toughness(c)}) left the battlefield`);
  }
  // damage must never survive into a new turn
  if (a.type === 'advance' && before.phase === 'end') for (const c of creatures(after)) if (c.damage) R('DAMAGE_ACROSS_TURNS', c.def);

  // 5. beast blitz consistency
  for (const pid of ['A', 'B'] as PlayerId[]) {
    const has = after.players[pid].battlefield.some((c) => c.def === 'kunoichi');
    for (const c of after.players[pid].battlefield) {
      const should = has && BLITZ.includes(c.def);
      if (c.blitz !== should) R('BLITZ_FLAG', `${c.def} blitz=${c.blitz}, expected ${should}`);
      if (c.buffT < -3 || c.buffP < -3) R('NEGATIVE_BUFF', `${c.def} buff ${c.buffP}/${c.buffT}`);
    }
  }
  // 5a. static abilities (Beast Blitz, Lords, Threshold): every creature's aura must equal what the battlefield says it should be, worked
  // out here from the card data with its own loop and its own threshold literal (never the engine's helper).
  for (const pid of ['A', 'B'] as PlayerId[]) {
    const side = after.players[pid];
    const expP: Record<string, number> = {}, expT: Record<string, number> = {};
    const crea = side.battlefield.filter((c) => CARDS[c.def].type === 'creature');
    for (const c of crea) { expP[c.iid] = 0; expT[c.iid] = 0; }
    const once = new Set<string>(); // `${creature}|${source card id}` of unique statics already counted
    for (const src of side.battlefield) {
      const st = CARDS[src.def].static;
      if (!st) continue;
      if (st.when === 'threshold' && side.graveyard.length < 7) continue;
      for (const c of crea) {
        const hit = (st.affects.self && c.iid === src.iid) || (st.affects.others && c.iid !== src.iid) || (st.affects.ids ?? []).includes(c.def);
        if (!hit) continue;
        if (st.unique) { if (once.has(`${c.iid}|${src.def}`)) continue; once.add(`${c.iid}|${src.def}`); }
        expP[c.iid] += st.power;
        expT[c.iid] += st.toughness;
      }
    }
    for (const c of crea) {
      if ((c.auraP ?? 0) !== expP[c.iid] || (c.auraT ?? 0) !== expT[c.iid]) R('AURA_WRONG', `${c.def} has aura ${c.auraP ?? 0}/${c.auraT ?? 0}, the battlefield says ${expP[c.iid]}/${expT[c.iid]} (graveyard ${side.graveyard.length})`);
    }
  }

  // 5b. combat bookkeeping must only reference creatures that are still in play
  if (after.combat) {
    const alive = new Set(creatures(after).map((c) => c.iid));
    for (const iid of after.combat.attackers) if (!alive.has(iid)) R('COMBAT_STALE_ATTACKER', `combat.attackers lists ${iid}, which is no longer on the battlefield (after ${a.type} in ${after.phase})`);
    for (const [b, atk] of Object.entries(after.combat.blocks)) if (!alive.has(b) || !alive.has(atk)) R('COMBAT_STALE_BLOCK', `combat.blocks references a dead creature (${b} -> ${atk})`);
  }

  // 6. winner consistency
  if (after.winner && after.winner !== 'draw') {
    const loser = opponentOf(after.winner);
    const L = after.players[loser];
    const hasReason = L.life <= 0 || L.library.length === 0 || after.log.some((l) => l.includes('decks out'));
    if (!hasReason) R('WINNER_WITHOUT_REASON', `${after.winner} won but ${loser} has life ${L.life}, library ${L.library.length}`);
  }
  if (!after.winner) for (const pid of ['A', 'B'] as PlayerId[]) if (after.players[pid].life <= 0) R('ZERO_LIFE_NO_WINNER', pid);
}

// ---------- policies ----------
function chaosAction(s: GameState, actor: PlayerId, r: () => number): Action {
  if (s.phase === 'mulligan') {
    const t = legalActions(s, actor);
    return t[Math.floor(r() * t.length)];
  }
  if (s.pending) {
    // an enter trigger waiting for a target, or an Edict waiting for the victim's choice
    const t = legalActions(s, actor);
    return t[Math.floor(r() * t.length)];
  }
  if (s.phase === 'combat_block') {
    const me = s.players[actor];
    const atks = (s.combat?.attackers ?? []).map((i) => all(s).find((c) => c.iid === i)).filter(Boolean) as CardInstance[];
    const spells = legalActions(s, actor);
    if (spells.length && r() < 0.45) return spells[Math.floor(r() * spells.length)];
    const pool = me.battlefield.filter((c) => isCreature(c) && !c.tapped);
    const blocks: Record<string, string> = {};
    const used = new Set<string>();
    for (const atk of atks) {
      if (r() < 0.55) continue;
      const opts = pool.filter((b) => !used.has(b.iid) && (!hasKeyword(atk, 'flying') || hasKeyword(b, 'flying') || hasKeyword(b, 'reach')) && (!hasKeyword(atk, 'skulk') || power(b) <= power(atk)));
      if (!opts.length) continue;
      const b = opts[Math.floor(r() * opts.length)];
      blocks[b.iid] = atk.iid;
      used.add(b.iid);
    }
    return { type: 'declareBlockers', blocks };
  }
  if (s.phase === 'combat_attack') {
    const cands = legalActions(s, actor);
    if (cands.length > 1 && r() < 0.3) return cands[Math.floor(r() * cands.length)];
    const able = s.players[actor].battlefield.filter(canAttack);
    const pick = able.filter(() => r() < 0.6).map((c) => c.iid);
    return { type: 'declareAttackers', attackers: pick };
  }
  const cands = legalActions(s, actor);
  const nonAdv = cands.filter((c) => c.type !== 'advance');
  if (nonAdv.length && r() < 0.8) return nonAdv[Math.floor(r() * nonAdv.length)];
  return cands.find((c) => c.type === 'advance') ?? cands[0];
}

// ---------- run ----------
type Row = { a: string; b: string; policy: string; games: number; aWins: number; bWins: number; draws: number; stalls: number; throws: number; avgTurns: number; combats: number; blockedAttacks: number; unblockedHits: number };
const rows: Row[] = [];
const t0 = Date.now();

// Keyword stress: besides the real decks, replay every policy with the new keywords sprinkled at random
// over the decks' creatures, so every keyword combination meets every situation (not just the few
// the shipped cards happen to carry). Keywords are restored after each game.
function caster0(st: GameState): PlayerId { return st.phase === 'combat_block' ? opponentOf(st.active) : st.active; }
const STRESS_KW = ['reach', 'vigilance', 'firstStrike', 'doubleStrike', 'trample', 'deathtouch', 'lifelink', 'flash', 'prowess', 'skulk', 'bushido', 'indestructible', 'battleCry', 'exalted', 'hexproof', 'undying'] as const;
type CardDefDeath = (typeof CARDS)[string]['onDeath'];
type Sprinkled = { ninjutsu: number | undefined; unearth: number | undefined; ward: number | undefined; kw: string[] | undefined; death: CardDefDeath; enter: CardDefDeath; land: CardDefDeath; attack: CardDefDeath; bonus: (typeof CARDS)[string]['bonus']; cycling: number | undefined; static: (typeof CARDS)[string]['static']; activated: (typeof CARDS)[string]['activated'] };
function sprinkleKeywords(r: () => number): () => void {
  const saved = new Map<string, Sprinkled>();
  const flashed: string[] = [];
  for (const def of Object.values(CARDS)) {
    if (def.type !== 'creature') continue;
    saved.set(def.id, { kw: def.keywords as string[] | undefined, death: def.onDeath, enter: def.onEnter, land: def.landTrigger, attack: def.onAttack, bonus: def.bonus, cycling: def.cycling, static: def.static, activated: def.activated, ward: def.ward, unearth: def.unearth, ninjutsu: def.ninjutsu });
    const extra = STRESS_KW.filter(() => r() < 0.25);
    if (extra.length) def.keywords = [...(def.keywords ?? []), ...extra];
    // some creatures raise a token when they die (tokens included, so triggers can chain through them)
    if (!def.onDeath && r() < 0.12) def.onDeath = { type: 'token', token: 'zombie_token', count: 1 };
    // Phase 4b triggers: Landfall and attack triggers (life gain / burn to the player) and Morbid / second-spell bonuses
    if (!def.landTrigger && r() < 0.2) def.landTrigger = r() < 0.5 ? { type: 'heal', amount: 1 } : { type: 'damage', amount: 1, targets: 'player' };
    if (!def.onAttack && r() < 0.2) def.onAttack = r() < 0.5 ? { type: 'heal', amount: 1 } : { type: 'damage', amount: 1, targets: 'player' };
    if (!def.bonus && r() < 0.25) def.bonus = { when: r() < 0.5 ? 'morbid' : 'secondSpell', effect: r() < 0.5 ? { type: 'heal', amount: 2 } : { type: 'damage', amount: 1, targets: 'player' } };
    // some creatures make the opponent discard, or bring the last fallen creature back, as they enter
    if (!def.onEnter && r() < 0.18) {
      const roll = r();
      def.onEnter = roll < 0.16 ? { type: 'discard', amount: 1 } : roll < 0.32 ? { type: 'recall' } : roll < 0.48 ? { type: 'edict' } : roll < 0.62 ? { type: 'rally', power: 1, toughness: 1 } : roll < 0.76 ? { type: 'bounce' } : roll < 0.9 ? { type: 'scry', amount: 1 + Math.floor(r() * 2) } : { type: 'loot' };
    }
    // Phase 4d static abilities: a lord for the rest of its side, a self-buff, or a Threshold bonus (never marked 'blitz')
    if (!def.static && r() < 0.15) {
      const roll = r();
      const affects = roll < 0.4 ? { others: true } : roll < 0.7 ? { self: true } : { ids: ['wolf_token', 'zombie_token', 'ashigaru'] };
      def.static = { affects, power: r() < 0.5 ? 1 : 0, toughness: r() < 0.5 ? 1 : 0, ...(r() < 0.4 ? { when: 'threshold' as const } : {}) };
    }
    // Phase 4e activated abilities: mana, pings, healing, a card, a token (some need mana too)
    if (!def.activated && r() < 0.18) {
      const roll = r();
      const eff = roll < 0.3 ? { type: 'mana' as const, amount: 1 } : roll < 0.5 ? { type: 'damage' as const, amount: 1, targets: 'player' as const } : roll < 0.65 ? { type: 'heal' as const, amount: 1 } : roll < 0.85 ? { type: 'draw' as const, amount: 1 } : { type: 'token' as const, token: 'zombie_token', count: 1 };
      const cost: { tap?: boolean; mana?: number } = { ...(r() < 0.85 ? { tap: true } : {}), ...(eff.type !== 'mana' && r() < 0.4 ? { mana: 1 + Math.floor(r() * 2) } : {}) };
      if (!cost.tap && (!cost.mana || eff.type === 'mana')) cost.tap = true; // an ability always costs something, or it could be used without limit
      def.activated = { cost, effect: eff };
    }
    // Phase 4h: Ninjutsu (swap in for an unblocked attacker)
    if (def.ninjutsu === undefined && r() < 0.15) def.ninjutsu = Math.floor(r() * 3);
    // Phase 4g: Unearth (come back from the graveyard for a turn)
    if (def.unearth === undefined && r() < 0.15) def.unearth = 1 + Math.floor(r() * 3);
    // Phase 4f2: ward (opposing spells that target it cost more)
    if (def.ward === undefined && r() < 0.12) def.ward = 1 + Math.floor(r() * 2);
    // Cycling on some creatures
    if (def.cycling === undefined && r() < 0.15) def.cycling = 1 + Math.floor(r() * 2);
  }
  // some spells become a Bounce, an Edict or a Rally (their old effect is restored afterwards) and some gain Cycling
  const spellEffect = new Map<string, (typeof CARDS)[string]['effect']>();
  const spellCycling = new Map<string, number | undefined>();
  for (const def of Object.values(CARDS)) {
    if (def.type !== 'sorcery' && def.type !== 'instant') continue;
    if (!def.blockOnly && def.flashback === undefined && r() < 0.3) {
      spellEffect.set(def.id, def.effect);
      const roll = r();
      def.effect = roll < 0.2 ? { type: 'bounce' } : roll < 0.4 ? { type: 'edict' } : roll < 0.55 ? { type: 'rally', power: 1, toughness: 1 } : roll < 0.7 ? { type: 'scry', amount: 1 + Math.floor(r() * 3) } : roll < 0.85 ? { type: 'loot' } : { type: 'bite' };
    }
    if (def.cycling === undefined && r() < 0.15) { spellCycling.set(def.id, def.cycling); def.cycling = 1 + Math.floor(r() * 2); }
  }
  // some spells carry a Morbid / second-spell bonus too
  const spellBonus = new Map<string, CardDefDeath | (typeof CARDS)[string]['bonus']>();
  for (const def of Object.values(CARDS)) {
    if ((def.type === 'sorcery' || def.type === 'instant') && !def.bonus && r() < 0.3) {
      spellBonus.set(def.id, def.bonus);
      def.bonus = { when: r() < 0.5 ? 'morbid' : 'secondSpell', effect: r() < 0.5 ? { type: 'heal', amount: 2 } : { type: 'damage', amount: 1, targets: 'player' } };
    }
  }
  // Phase 4f2: some spells become modal, X spells, or gain a kicker (restored afterwards)
  const spellOpts = new Map<string, { x: boolean | undefined; kicker: CardDef['kicker']; modes: CardDef['modes'] }>();
  for (const def of Object.values(CARDS)) {
    if ((def.type !== 'sorcery' && def.type !== 'instant') || !def.effect || def.flashback !== undefined || def.blockOnly) continue;
    const saved = { x: def.x, kicker: def.kicker, modes: def.modes };
    let touched = false;
    const optRoll = r();
    if (optRoll < 0.14) { // modal: its own effect, or one of three other effects
      const other: Effect[] = [{ type: 'draw', amount: 1 }, { type: 'heal', amount: 2 }, { type: 'damage', amount: 2, targets: 'any' }];
      def.modes = [def.effect, other[Math.floor(r() * other.length)]];
      touched = true;
    } else if (optRoll < 0.28 && (def.effect.type === 'damage' || def.effect.type === 'heal' || def.effect.type === 'draw')) { // an X spell
      def.x = true;
      touched = true;
    }
    if (r() < 0.16) { // a kicker: heal, draw or damage at the player
      def.kicker = { cost: 1 + Math.floor(r() * 2), effect: r() < 0.33 ? { type: 'heal', amount: 2 } : r() < 0.5 ? { type: 'draw', amount: 1 } : { type: 'damage', amount: 1, targets: 'player' } };
      touched = true;
    }
    if (touched) spellOpts.set(def.id, saved);
  }
  // some untargeted spells gain flashback (cost + 1)
  for (const def of Object.values(CARDS)) {
    if ((def.type === 'sorcery' || def.type === 'instant') && def.effect && def.flashback === undefined && !needsTarget(def.effect) && !def.x && !def.kicker && !def.modes && r() < 0.4) {
      def.flashback = def.cost + 1;
      flashed.push(def.id);
    }
  }
  return () => { for (const [id, v] of saved) { CARDS[id].keywords = v.kw as never; CARDS[id].onDeath = v.death; CARDS[id].onEnter = v.enter; CARDS[id].landTrigger = v.land; CARDS[id].onAttack = v.attack; CARDS[id].bonus = v.bonus; CARDS[id].cycling = v.cycling; CARDS[id].static = v.static; CARDS[id].activated = v.activated; CARDS[id].ward = v.ward; CARDS[id].unearth = v.unearth; CARDS[id].ninjutsu = v.ninjutsu; } for (const [id, b] of spellBonus) CARDS[id].bonus = b as never; for (const [id, e] of spellEffect) CARDS[id].effect = e; for (const [id, c] of spellCycling) CARDS[id].cycling = c; for (const [id, o] of spellOpts) { CARDS[id].x = o.x; CARDS[id].kicker = o.kicker; CARDS[id].modes = o.modes; } for (const id of flashed) delete CARDS[id].flashback; };
}

for (const policyName of ['ai', 'chaos', 'ai+kw', 'chaos+kw'] as const) {
  const policy = policyName.startsWith('ai') ? 'ai' : 'chaos';
  const stress = policyName.endsWith('+kw');
  for (const A of DECK_LIST) {
    for (const B of DECK_LIST) {
      if (A.id === B.id) continue;
      const row: Row = { a: A.id, b: B.id, policy: policyName, games: 0, aWins: 0, bWins: 0, draws: 0, stalls: 0, throws: 0, avgTurns: 0, combats: 0, blockedAttacks: 0, unblockedHits: 0 };
      let turns = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const gseed = seed * 7919 + (policy === 'chaos' ? 17 : 3);
        const r = rng(gseed ^ 0x9e3779b9);
        let g = createInitialState(gseed, A.cards, B.cards, { mulligan: seed % 2 === 0 }); // half the games open with the keep-or-mulligan decision
        const sizes = { A: A.cards.length, B: B.cards.length } as Record<PlayerId, number>;
        const ctx = { pair: `${A.id} v ${B.id}`, policy: policyName, seed: gseed, step: 0, track: newTrack() };
        const restore = stress ? sprinkleKeywords(rng(gseed ^ 0x51ed270b)) : () => {};
        let step = 0;
        while (!g.winner && step < 3000) {
          const actor = actorOf(g);
          let act: Action;
          try { act = policy === 'ai' ? pickAction(g, actor) : chaosAction(g, actor, r); }
          catch (e) { report('POLICY_THREW', (e as Error).message, { ...ctx, step }); row.throws++; break; }
          let next: GameState;
          try { next = applyAction(g, act); }
          catch (e) { report('REDUCER_REJECTED_LEGAL_ACTION', `${act.type} in ${g.phase}: ${(e as Error).message}`, { ...ctx, step }); row.throws++; break; }
          ctx.step = step;
          if (act.type === 'declareBlockers') {
            row.combats++;
            for (const atk of g.combat?.attackers ?? []) {
              if (Object.values(act.blocks).includes(atk)) row.blockedAttacks++;
              else row.unblockedHits++;
            }
          }
          check(g, act, next, sizes, ctx);
          updateTrack(ctx.track, g, act, next);
          g = next; step++;
        }
        restore();
        row.games++; turns += g.turn;
        if (!g.winner) { row.stalls++; report('STALL', `no winner after ${step} steps (turn ${g.turn})`, { ...ctx, step }); }
        else if (g.winner === 'A') row.aWins++; else if (g.winner === 'B') row.bWins++; else row.draws++;
      }
      row.avgTurns = +(turns / row.games).toFixed(1);
      rows.push(row);
    }
  }
}
fs.writeFileSync(OUT, JSON.stringify({ rows, findings, counts: Object.fromEntries(seen), seconds: (Date.now() - t0) / 1000, seeds: SEEDS }, null, 1));
console.log('done in', ((Date.now() - t0) / 1000).toFixed(1) + 's; games:', rows.reduce((n, r) => n + r.games, 0));
console.log('finding counts:', JSON.stringify(Object.fromEntries(seen)));
