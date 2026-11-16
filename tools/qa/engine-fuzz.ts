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
import { getDef } from '../../src/cards/cards';
import type { Action, CardInstance, GameState, PlayerId } from '../../src/engine/types';
import { opponentOf } from '../../src/engine/types';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const SEEDS = Number(process.env.SEEDS ?? 12);
const OUT = process.env.OUT ?? path.join(os.tmpdir(), 'engine-fuzz.json');
const TOKENS = new Set(['wolf_token', 'zombie_token']);
const BLITZ = ['swift_lancer', 'sky_talon', 'stoneback_cub', 'wolf_token'];

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
function expectedLife(before: GameState, a: Action): Record<PlayerId, number> {
  const life = { A: before.players.A.life, B: before.players.B.life };
  const caster = before.phase === 'combat_block' ? opponentOf(before.active) : before.active;
  if (a.type === 'castSorcery') {
    const hand = before.players[caster].hand.find((c) => c.iid === a.iid)!;
    const eff = getDef(hand.def).effect!;
    const isInstant = getDef(hand.def).type === 'instant';
    if (eff.type === 'damage' && a.target?.kind === 'player') life[a.target.player] -= eff.amount;
    if (eff.type === 'heal') life[caster] += eff.amount;
    // creature triggers: every trigger creature the caster controls AFTER the spell resolved
    // (a token made by the spell cannot have a trigger, so using the pre-state is equivalent)
    for (const cr of before.players[caster].battlefield) {
      const d = getDef(cr.def);
      if (!d.spellTrigger) continue;
      if (isInstant && !d.spellTriggerInstant) continue;
      if (d.spellTrigger.type === 'damage') life[opponentOf(caster)] -= d.spellTrigger.amount;
    }
  }
  if (a.type === 'declareBlockers') {
    const def = opponentOf(before.active);
    const blocked = new Map<string, string[]>();
    for (const [b, atk] of Object.entries(a.blocks)) blocked.set(atk, [...(blocked.get(atk) ?? []), b]);
    for (const atkIid of before.combat?.attackers ?? []) {
      const atk = all(before).find((c) => c.iid === atkIid);
      if (!atk) continue; // gone before damage
      const live = (blocked.get(atkIid) ?? []).filter((b) => all(before).some((c) => c.iid === b));
      if (live.length === 0) life[def] -= power(atk);
    }
  }
  return life;
}

function expectedCombatDeaths(before: GameState, a: Extract<Action, { type: 'declareBlockers' }>): Set<string> {
  // damage is simultaneous: collect first, then judge
  const dmg = new Map<string, number>();
  const find = (iid: string) => all(before).find((c) => c.iid === iid);
  for (const c of creatures(before)) dmg.set(c.iid, c.damage);
  for (const atkIid of before.combat?.attackers ?? []) {
    const atk = find(atkIid);
    if (!atk) continue;
    const blockers = Object.entries(a.blocks).filter(([, t]) => t === atkIid).map(([b]) => find(b)).filter(Boolean) as CardInstance[];
    for (const b of blockers) {
      dmg.set(b.iid, (dmg.get(b.iid) ?? 0) + power(atk));
      dmg.set(atk.iid, (dmg.get(atk.iid) ?? 0) + power(b));
    }
  }
  const dead = new Set<string>();
  for (const c of creatures(before)) if ((dmg.get(c.iid) ?? 0) >= toughness(c)) dead.add(c.iid);
  return dead;
}

// ---------- invariants over one transition ----------
function check(
  before: GameState, a: Action, after: GameState, sizes: Record<PlayerId, number>,
  ctx: { pair: string; policy: string; seed: number; step: number },
) {
  const R = (code: string, d: string) => report(code, d, ctx);

  // 1. iid uniqueness + conservation + zone ownership
  const ids = new Set<string>();
  for (const pid of ['A', 'B'] as PlayerId[]) {
    const p = after.players[pid];
    const zones: [string, CardInstance[]][] = [['library', p.library], ['hand', p.hand], ['battlefield', p.battlefield], ['graveyard', p.graveyard]];
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
      if (isCreature(c) && (c.damage || c.buffP || c.buffT || c.blitz || c.tapped)) R('DEAD_CARD_KEEPS_STATE', `${c.def} in graveyard with damage=${c.damage} buff=${c.buffP}/${c.buffT} blitz=${c.blitz} tapped=${c.tapped}`);
    }
  }

  // 2. life oracle (skipped once a deck-out has fired: the oracle does not model draws)
  const el = expectedLife(before, a);
  const decked = (after.log.at(-1) ?? '').includes('decks out') || after.log.some((l, i) => i >= before.log.length && l.includes('decks out'));
  if (!decked) {
    for (const pid of ['A', 'B'] as PlayerId[]) {
      if (after.players[pid].life !== el[pid]) R('LIFE_MISMATCH', `${pid}: expected ${el[pid]} got ${after.players[pid].life} after ${a.type}`);
    }
  }

  // 3. phase transitions
  const exp = (() => {
    if (a.type === 'advance') return before.phase === 'main1' ? 'combat_attack' : before.phase === 'combat_attack' ? 'end' : 'main1';
    if (a.type === 'declareAttackers') return a.attackers.length ? 'combat_block' : 'end';
    if (a.type === 'declareBlockers') return 'end';
    return before.phase; // spells, land, creature, whipflash
  })();
  if (after.phase !== exp && !after.winner) R('PHASE_TRANSITION', `${before.phase} + ${a.type} -> ${after.phase}, expected ${exp}`);
  if (a.type === 'advance' && before.phase === 'end') {
    if (after.active === before.active) R('TURN_PASS', 'active player did not change');
    if (after.turn !== before.turn + 1) R('TURN_COUNTER', `turn ${before.turn} -> ${after.turn}`);
  }

  // 4. combat-specific
  if (a.type === 'declareAttackers') {
    for (const iid of a.attackers) {
      const c = after.players[before.active].battlefield.find((x) => x.iid === iid);
      if (c && !c.tapped) R('ATTACKER_NOT_TAPPED', `${c.def} attacked but is untapped`);
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
      if (bl && at && hasKeyword(at, 'flying') && !hasKeyword(bl, 'flying')) R('FLYER_BLOCKED_BY_GROUND', `${at.def} blocked by ${bl.def}`);
      if (bl?.tapped) R('TAPPED_BLOCKER', `${bl.def} blocked while tapped`);
    }
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
  if (s.pending?.kind === 'whipflash') {
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
      const opts = pool.filter((b) => !used.has(b.iid) && (!hasKeyword(atk, 'flying') || hasKeyword(b, 'flying')));
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

for (const policy of ['ai', 'chaos'] as const) {
  for (const A of DECK_LIST) {
    for (const B of DECK_LIST) {
      if (A.id === B.id) continue;
      const row: Row = { a: A.id, b: B.id, policy, games: 0, aWins: 0, bWins: 0, draws: 0, stalls: 0, throws: 0, avgTurns: 0, combats: 0, blockedAttacks: 0, unblockedHits: 0 };
      let turns = 0;
      for (let seed = 1; seed <= SEEDS; seed++) {
        const gseed = seed * 7919 + (policy === 'chaos' ? 17 : 3);
        const r = rng(gseed ^ 0x9e3779b9);
        let g = createInitialState(gseed, A.cards, B.cards);
        const sizes = { A: A.cards.length, B: B.cards.length } as Record<PlayerId, number>;
        const ctx = { pair: `${A.id} v ${B.id}`, policy, seed: gseed, step: 0 };
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
          g = next; step++;
        }
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
