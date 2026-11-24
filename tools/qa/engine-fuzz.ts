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
import type { Action, CardInstance, Effect, GameState, PlayerId } from '../../src/engine/types';
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
    const e = cardOf(who, a.iid) && getDef(cardOf(who, a.iid)!.def).effect;
    if (e?.type === 'bounce' && a.target?.kind === 'creature') bounced.add(a.target.iid);
    if (e?.type === 'edict') everyVictim(who);
  }
  if (a.type === 'castCreature') {
    const who = actorOf(before);
    const e = cardOf(who, a.iid) && getDef(cardOf(who, a.iid)!.def).onEnter;
    if (e?.type === 'edict') everyVictim(who);
  }
  if (a.type === 'resolveTrigger' && before.pending) {
    if (before.pending.kind === 'sacrifice') sacrificed.add(a.target);
    else if (getDef(before.pending.def).onEnter?.type === 'bounce') bounced.add(a.target);
  }
  return { bounced, sacrificed };
}

function updateTrack(t: Track, before: GameState, a: Action, after: GameState): void {
  if (a.type === 'advance' && before.phase === 'end') { t.died = false; t.spells = { A: 0, B: 0 }; return; }
  if (a.type === 'castCreature' || a.type === 'castSorcery') t.spells[actorOf(before)] += 1;
  const stillThere = new Set(all(after).map((c) => c.iid));
  const lv = leavers(before, a);
  for (const c of creatures(before)) if (!stillThere.has(c.iid) && !lv.bounced.has(c.iid)) t.died = true;
}

/** Mana a player can spend right now: untapped lands plus floating mana (re-derived here, not the engine's helper). */
const manaOf = (st: GameState, pid: PlayerId) => st.players[pid].battlefield.filter((c) => getDef(c.def).type === 'land' && !c.tapped).length + (st.players[pid].pool ?? 0);

/** Mana SPENT by a player in a transition: lands newly tapped plus floating mana used. (Not manaOf: a ramp spell puts new untapped lands in play.) */
const spentMana = (b: GameState, a: GameState, pid: PlayerId) => {
  const tapped = (st: GameState) => st.players[pid].battlefield.filter((c) => c.tapped && getDef(c.def).type === 'land').length;
  return tapped(a) - tapped(b) + ((b.players[pid].pool ?? 0) - (a.players[pid].pool ?? 0));
};

function expectedLife(before: GameState, a: Action, t: Track): Record<PlayerId, number> {
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
    const main = getDef(hand.def).effect!;
    const isInstant = getDef(hand.def).type === 'instant';
    if (main.type === 'damage' && a.target?.kind === 'player') life[a.target.player] -= main.amount;
    if (main.type === 'heal') life[caster] += main.amount;
    // ramp puts lands from hand onto the battlefield, and each one is a landfall
    if (main.type === 'ramp') landfalls(caster, Math.min(main.amount, before.players[caster].hand.filter((c) => getDef(c.def).type === 'land').length));
    bonus(getDef(hand.def), caster);
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
  if (a.type === 'declareBlockers') {
    const sim = simulateCombat(before, a.blocks);
    life.A += sim.delta.A;
    life.B += sim.delta.B;
  }
  return life;
}

function expectedCombatDeaths(before: GameState, a: Extract<Action, { type: 'declareBlockers' }>): Set<string> {
  return simulateCombat(before, a.blocks).dead;
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
      if (isCreature(c) && (c.damage || c.buffP || c.buffT || c.tempP || c.tempT || c.auraP || c.auraT || c.blitz || c.tapped)) R('DEAD_CARD_KEEPS_STATE', `${c.def} in graveyard with damage=${c.damage} buff=${c.buffP}/${c.buffT} temp=${c.tempP ?? 0}/${c.tempT ?? 0} blitz=${c.blitz} tapped=${c.tapped}`);
    }
  }

  // 2. life oracle (skipped once a deck-out has fired: the oracle does not model draws)
  const el = expectedLife(before, a, ctx.track!);
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
    if (a.type === 'declareBlockers') return 'end';
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
    const rally = getDef(spellDef.def).effect?.type === 'rally' ? (getDef(spellDef.def).effect as { power: number; toughness: number }) : { power: 0, toughness: 0 };
    for (const c of before.players[casterId].battlefield) {
      if (!isCreature(c)) continue;
      const now = after.players[casterId].battlefield.find((x) => x.iid === c.iid);
      if (!now) continue; // died to the spell itself
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
  if (a.type === 'declareBlockers') {
    // dies triggers: each token-making death adds exactly its tokens (tokens that died are replaced, not lost)
    const afterIds = new Set(all(after).map((c) => c.iid));
    const died = creatures(before).filter((c) => !afterIds.has(c.iid));
    const defs = new Set<string>();
    for (const c of died) { const t = getDef(c.def).onDeath; if (t?.type === 'token') defs.add(t.token); }
    for (const pid of ['A', 'B'] as PlayerId[]) {
      for (const tok of defs) {
        const beforeN = before.players[pid].battlefield.filter((c) => c.def === tok).length;
        const lostN = died.filter((c) => c.owner === pid && c.def === tok).length;
        const madeN = died.filter((c) => c.owner === pid).reduce((n, c) => { const t = getDef(c.def).onDeath; return n + (t?.type === 'token' && t.token === tok ? t.count : 0); }, 0);
        const nowN = after.players[pid].battlefield.filter((c) => c.def === tok).length;
        if (nowN !== beforeN - lostN + madeN) R('DIES_TRIGGER_TOKENS', `${pid}: ${tok} count ${beforeN} -${lostN} +${madeN} expected ${beforeN - lostN + madeN}, got ${nowN}`);
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
    const e = card && (a.type === 'castSorcery' ? getDef(card.def).effect : getDef(card.def).onEnter);
    if (e?.type === 'edict') {
      const victim = opponentOf(who);
      const theirs = before.players[victim].battlefield.filter(isCreature);
      const asking = after.pending?.kind === 'sacrifice' && after.pending.controller === victim;
      if (theirs.length === 0 && after.pending) R('EDICT_PHANTOM_CHOICE', 'an Edict with nothing to sacrifice asked for a choice');
      if (theirs.length === 1 && (after.pending || all(after).some((c) => c.iid === theirs[0].iid))) R('EDICT_ONLY_CREATURE_KEPT', `${theirs[0].def} is the only creature and must be sacrificed at once`);
      if (theirs.length >= 2 && !asking) R('EDICT_NO_CHOICE_OFFERED', `${victim} has ${theirs.length} creatures but was not asked to choose`);
    }
  }
  if (a.type === 'resolveTrigger' && before.pending?.kind === 'sacrifice') {
    const was = all(before).find((c) => c.iid === a.target)!;
    if (all(after).some((c) => c.iid === a.target)) R('SACRIFICE_SURVIVED', `${was.def} was sacrificed but is still in play`);
    if (after.pending) R('SACRIFICE_STILL_PENDING', 'the choice was made but the game still waits on it');
    if (!TOKENS.has(was.def) && !after.players[was.owner].graveyard.some((c) => c.iid === a.target)) R('SACRIFICE_NOT_IN_GRAVEYARD', `${was.def} is not in its owner's graveyard`);
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
  if (a.type === 'declareBlockers') {
    const expDead = expectedCombatDeaths(before, a);
    const nowAlive = new Set(creatures(after).map((c) => c.iid));
    for (const iid of expDead) if (nowAlive.has(iid)) R('SURVIVED_LETHAL', `${creatures(before).find((c) => c.iid === iid)?.def} should have died in combat`);
    for (const c of creatures(before)) if (!expDead.has(c.iid) && !nowAlive.has(c.iid)) R('DIED_WITHOUT_LETHAL', `${c.def} died but took non-lethal combat damage`);
    for (const c of creatures(after)) if (c.damage !== 0) R('DAMAGE_NOT_CLEARED', `${c.def} carries damage ${c.damage} into the end step`);
    if (after.combat !== null) R('COMBAT_NOT_CLEARED', 'state.combat still set after resolution');
    if (!after.lastCombat) R('LASTCOMBAT_MISSING', 'lastCombat not recorded');
    for (const [b, atk] of Object.entries(a.blocks)) {
      const bl = all(before).find((c) => c.iid === b), at = all(before).find((c) => c.iid === atk);
      if (bl && at && hasKeyword(at, 'flying') && !hasKeyword(bl, 'flying') && !hasKeyword(bl, 'reach')) R('FLYER_BLOCKED_BY_GROUND', `${at.def} blocked by ${bl.def}`);
      if (bl?.tapped) R('TAPPED_BLOCKER', `${bl.def} blocked while tapped`);
      if (bl && at && hasKeyword(at, 'skulk') && power(bl) > power(at)) R('SKULK_BLOCKED_BY_GREATER', `${at.def} (power ${power(at)}) blocked by ${bl.def} (power ${power(bl)})`);
    }
  }
  // indestructible: no damage, deathtouch or destroy takes a creature with it off the battlefield. (Creatures wearing any static bonus
  // are skipped: losing it can take a point of toughness away, which is the one thing that does kill it.)
  const lv = leavers(before, a);
  for (const c of creatures(before)) {
    if (!hasKeyword(c, 'indestructible') || c.blitz || c.auraT || toughness(c) <= 0 || lv.bounced.has(c.iid) || lv.sacrificed.has(c.iid)) continue;
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
const STRESS_KW = ['reach', 'vigilance', 'firstStrike', 'doubleStrike', 'trample', 'deathtouch', 'lifelink', 'flash', 'prowess', 'skulk', 'bushido', 'indestructible', 'battleCry', 'exalted'] as const;
type CardDefDeath = (typeof CARDS)[string]['onDeath'];
type Sprinkled = { kw: string[] | undefined; death: CardDefDeath; enter: CardDefDeath; land: CardDefDeath; attack: CardDefDeath; bonus: (typeof CARDS)[string]['bonus']; cycling: number | undefined; static: (typeof CARDS)[string]['static']; activated: (typeof CARDS)[string]['activated'] };
function sprinkleKeywords(r: () => number): () => void {
  const saved = new Map<string, Sprinkled>();
  const flashed: string[] = [];
  for (const def of Object.values(CARDS)) {
    if (def.type !== 'creature') continue;
    saved.set(def.id, { kw: def.keywords as string[] | undefined, death: def.onDeath, enter: def.onEnter, land: def.landTrigger, attack: def.onAttack, bonus: def.bonus, cycling: def.cycling, static: def.static, activated: def.activated });
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
      def.onEnter = roll < 0.2 ? { type: 'discard', amount: 1 } : roll < 0.4 ? { type: 'recall' } : roll < 0.6 ? { type: 'edict' } : roll < 0.8 ? { type: 'rally', power: 1, toughness: 1 } : { type: 'bounce' };
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
      def.effect = roll < 0.34 ? { type: 'bounce' } : roll < 0.67 ? { type: 'edict' } : { type: 'rally', power: 1, toughness: 1 };
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
  // some untargeted spells gain flashback (cost + 1)
  for (const def of Object.values(CARDS)) {
    if ((def.type === 'sorcery' || def.type === 'instant') && def.effect && def.flashback === undefined && !needsTarget(def.effect) && r() < 0.4) {
      def.flashback = def.cost + 1;
      flashed.push(def.id);
    }
  }
  return () => { for (const [id, v] of saved) { CARDS[id].keywords = v.kw as never; CARDS[id].onDeath = v.death; CARDS[id].onEnter = v.enter; CARDS[id].landTrigger = v.land; CARDS[id].onAttack = v.attack; CARDS[id].bonus = v.bonus; CARDS[id].cycling = v.cycling; CARDS[id].static = v.static; CARDS[id].activated = v.activated; } for (const [id, b] of spellBonus) CARDS[id].bonus = b as never; for (const [id, e] of spellEffect) CARDS[id].effect = e; for (const [id, c] of spellCycling) CARDS[id].cycling = c; for (const id of flashed) delete CARDS[id].flashback; };
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
