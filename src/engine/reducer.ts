import { getDef, isToken } from '../cards/cards';
import type { Action, CardDef, CardInstance, Effect, GameState, PlayerId, PlayerState, Target } from './types';
import { needsCreatureChoice, opponentOf } from './types';
import { nextRandom, shuffle } from './rng';
import { OPENING_HAND } from './state';
import {
  actorOf,
  availableMana,
  blitzCue,
  canTargetCreature,
  findCreature,
  hasKeyword,
  isCreature,
  isLand,
  isLethal,
  markDamage,
  splitDamage,
  staticBonus,
  strikesIn,
  toughness,
  untappedLands,
  validateAction,
  power,
} from './rules';

/**
 * The one rule: apply an action to a state, return the next state.
 * Pure — never mutates the input. Validates first, so illegal (e.g. networked)
 * actions throw instead of corrupting state.
 */
export function applyAction(state: GameState, action: Action): GameState {
  if (state.winner) return state;
  validateAction(state, action);
  const s: GameState = structuredClone(state);
  const active = s.players[s.active];

  switch (action.type) {
    case 'playLand': {
      moveFromHand(active, action.iid, active.battlefield);
      active.landPlayedThisTurn = true;
      s.log.push(`${s.active} plays ${name(action.iid, s)}`);
      landfall(s, s.active);
      break;
    }
    case 'castCreature': {
      // Whoever may act now casts it: the active player, or the defender when a flash creature
      // is cast in the block step.
      const casterId = actorOf(state);
      const caster = s.players[casterId];
      const c = takeFromHand(caster, action.iid);
      const def = getDef(c.def);
      payMana(caster, def.cost);
      const blitz = blitzCue(caster, c); // Kunoichi + a beast together because of this cast (read before it enters)
      c.tapped = false;
      c.damage = 0;
      c.summoningSick = !hasKeyword(c, 'haste');
      caster.battlefield.push(c);
      s.log.push(`${casterId} casts ${def.name}`);
      countSpell(s, casterId);
      const skill = def.skill ?? def.name;
      if (def.onEnter) {
        if (needsCreatureChoice(def.onEnter)) {
          // there must be something it may target (hexproof creatures of the opponent are not)
          const targetable = (['A', 'B'] as PlayerId[]).some((pid) => s.players[pid].battlefield.some((x) => isCreature(x) && x.iid !== c.iid && canTargetCreature(casterId, x, pid)));
          if (targetable) {
            s.pending = { kind: 'enter', source: c.iid, def: c.def, controller: casterId };
            s.log.push(`✦ ${skill}! Choose a creature.`);
          } else {
            s.log.push(`${skill} fizzles — no target.`);
          }
        } else {
          s.log.push(`✦ ${skill}`);
          applyEffect(s, casterId, def.onEnter, { kind: 'player', player: opponentOf(casterId) });
        }
      } else if (def.skill && def.skill !== 'Beast Blitz') {
        s.log.push(`✦ ${def.skill} activated!`); // a static skill: it simply switches on
      }
      // Beast Blitz announces itself only when Kunoichi and a beast meet, whichever arrives second.
      if (blitz) s.log.push('✦ Beast Blitz activated!');
      resolveBonus(s, casterId, def);
      if (s.pending && !s.pending.def) s.pending.def = def.id; // an Edict on entering: name the card behind the choice
      break;
    }
    case 'keepHand': {
      const m = s.mulligan!;
      const took = m.taken[m.deciding];
      s.log.push(`${m.deciding} keeps ${took ? `${OPENING_HAND - took} cards` : 'their hand'}`);
      if (m.deciding === 'A') {
        m.deciding = 'B';
      } else {
        s.phase = 'main1'; // both have decided: the game begins on A's turn
        s.mulligan = null;
        s.log.push('The game begins. A is on the play.');
      }
      break;
    }
    case 'mulligan': {
      const m = s.mulligan!;
      const pid = m.deciding;
      const p = s.players[pid];
      m.taken[pid] += 1;
      const [mixed, next] = shuffle([...p.hand, ...p.library], s.rngState); // hand back into the deck, reshuffled
      s.rngState = next;
      const size = OPENING_HAND - m.taken[pid];
      p.hand = mixed.slice(0, size);
      p.library = mixed.slice(size);
      s.log.push(`${pid} takes a mulligan: ${size} cards`);
      break;
    }
    case 'resolveTrigger': {
      const pend = s.pending!;
      if (pend.kind === 'discard') {
        // Loot: the chosen card goes from the controller's hand to their graveyard. (Logged as "loots away", not "discards": that line is Rot's show.)
        const owner = s.players[pend.controller];
        const card = takeFromHand(owner, action.target);
        owner.graveyard.push(card);
        s.log.push(`${pend.controller} loots away ${getDef(card.def).name}`);
        s.pending = null;
        break;
      }
      if (pend.kind === 'sacrifice') {
        // Edict: the victim's chosen creature is sacrificed (it dies even if indestructible)
        const victim = findCreature(s, action.target)!;
        sacrifice(s, pend.controller, victim.card);
        s.pending = null;
        break;
      }
      const def = getDef(pend.def);
      const found = findCreature(s, action.target);
      if (found && def.onEnter) {
        applyEffect(s, pend.controller, def.onEnter, { kind: 'creature', iid: action.target });
        if (def.onEnter.type === 'damage') {
          s.log.push(`${def.skill ?? def.name} hits ${getDef(found.card.def).name} for ${def.onEnter.amount}`);
        }
      }
      s.pending = null;
      break;
    }
    case 'scry': {
      // Scry: decide the next unseen card of the top N. Bottom: it goes to the end of the library. Top: it stays, and the next card is looked at.
      const pend = s.pending!;
      const lib = s.players[pend.controller].library;
      const seen = pend.seen ?? 0;
      if (action.bottom) {
        lib.push(lib.splice(seen, 1)[0]);
        s.log.push(`${pend.controller} puts a card on the bottom`);
      } else {
        pend.seen = seen + 1;
        s.log.push(`${pend.controller} keeps a card on top`);
      }
      pend.left = (pend.left ?? 1) - 1;
      if (pend.left <= 0) s.pending = null;
      break;
    }
    case 'castSorcery': {
      // Handles both sorceries and instants. Instants can be cast off-turn by the
      // defender during combat_block, so the caster is derived from the phase (same
      // model as blocking) rather than always being the active player.
      const casterId = s.phase === 'combat_block' ? opponentOf(s.active) : s.active;
      const caster = s.players[casterId];
      // Flashback: a spell not in hand is cast from the graveyard for its flashback cost, then exiled.
      const fromGrave = !caster.hand.some((x) => x.iid === action.iid);
      const c = fromGrave ? takeFromGraveyard(caster, action.iid) : takeFromHand(caster, action.iid);
      const def = getDef(c.def);
      payMana(caster, fromGrave ? def.flashback! : def.cost);
      if (fromGrave) (caster.exile ??= []).push(c);
      else caster.graveyard.push(c);
      s.log.push(`${casterId} casts ${def.name}${fromGrave ? ' (flashback)' : ''}`);
      countSpell(s, casterId);
      const blitz = blitzCue(caster, c); // a token spell (Call Wolves) making beasts next to Kunoichi
      applyEffect(s, casterId, def.effect!, action.target);
      if (blitz) s.log.push('✦ Beast Blitz activated!');
      resolveBonus(s, casterId, def);
      if (s.pending && !s.pending.def) s.pending.def = def.id; // an Edict spell: name the card behind the choice
      // Creatures that trigger when their controller casts a spell. By default they
      // fire only on sorceries (e.g. Pyre Adept, Plague Priest); a creature flagged
      // `spellTriggerInstant` (e.g. Grave Necromancer) also fires on instants.
      for (const cr of caster.battlefield) {
        const crDef = getDef(cr.def);
        if (!crDef.spellTrigger) continue;
        if (def.type === 'instant' && !crDef.spellTriggerInstant) continue;
        s.log.push(`✦ ${crDef.name} triggers`);
        applyEffect(s, casterId, crDef.spellTrigger, { kind: 'player', player: opponentOf(casterId) });
      }
      // Prowess: +1/+1 until end of turn for each such creature, on any spell (sorcery or instant).
      for (const cr of caster.battlefield) {
        if (!isCreature(cr) || !hasKeyword(cr, 'prowess')) continue;
        cr.tempP = (cr.tempP ?? 0) + 1;
        cr.tempT = (cr.tempT ?? 0) + 1;
        s.log.push(`✦ ${getDef(cr.def).name} — prowess`);
      }
      break;
    }
    case 'declareAttackers': {
      for (const iid of action.attackers) {
        const c = active.battlefield.find((x) => x.iid === iid)!;
        if (!hasKeyword(c, 'vigilance')) c.tapped = true; // vigilance: attacking does not tap
      }
      s.combat = { attackers: [...action.attackers], blocks: {} };
      if (action.attackers.length === 0) toEnd(s);
      else {
        s.phase = 'combat_block';
        s.log.push(`${s.active} attacks with ${action.attackers.length}`);
        attackTriggers(s, action.attackers);
      }
      break;
    }
    case 'declareBlockers': {
      s.combat = { attackers: s.combat?.attackers ?? [], blocks: { ...action.blocks } };
      // Bushido: a creature that blocks, or is blocked, gets +1/+1 until end of turn (before damage)
      for (const [blk, atk] of Object.entries(s.combat.blocks)) {
        for (const iid of [blk, atk]) {
          const c = findCreature(s, iid)?.card;
          if (c && hasKeyword(c, 'bushido')) {
            c.tempP = (c.tempP ?? 0) + 1;
            c.tempT = (c.tempT ?? 0) + 1;
            s.log.push(`${getDef(c.def).name} — bushido`);
          }
        }
      }
      resolveCombat(s);
      break;
    }
    case 'activate': {
      // An activated ability: pay the cost (tap, mana), then its untargeted effect resolves at once. It is not a cast: no spell triggers, no spell count.
      const c = active.battlefield.find((x) => x.iid === action.iid)!;
      const d = getDef(c.def);
      const ab = d.activated!;
      if (ab.cost.mana) payMana(active, ab.cost.mana);
      if (ab.cost.tap) c.tapped = true;
      s.log.push(`✦ ${d.name} — ability`);
      applyEffect(s, s.active, ab.effect, { kind: 'player', player: opponentOf(s.active) });
      break;
    }
    case 'cycle': {
      // Cycling: pay its cycling cost, discard it from hand, draw a card (it is a discard you choose, not a cast: no spell triggers)
      const c = takeFromHand(active, action.iid);
      const d = getDef(c.def);
      payMana(active, d.cycling!);
      active.graveyard.push(c);
      s.log.push(`${s.active} cycles ${d.name}`);
      applyEffect(s, s.active, { type: 'draw', amount: 1 });
      break;
    }
    case 'advance': {
      if (s.phase === 'main1') {
        s.combat = { attackers: [], blocks: {} };
        s.phase = 'combat_attack';
      } else if (s.phase === 'combat_attack') {
        toEnd(s);
      } else if (s.phase === 'end') {
        beginTurn(s, opponentOf(s.active));
      }
      break;
    }
  }

  if (s.phase !== state.phase) for (const pid of ['A', 'B'] as PlayerId[]) s.players[pid].pool = 0; // floating mana empties with the phase
  settle(s); // deaths and static abilities (Beast Blitz, Lords, Threshold) until stable
  return s;
}

// ---- internals ----


/**
 * Static abilities (Beast Blitz, Lords, Threshold): every creature's bonus is rebuilt from scratch from what is on the battlefield now
 * (`staticBonus`), so it is idempotent and stacks without bookkeeping. Returns whether anything changed.
 */
function recomputeStatics(s: GameState): boolean {
  let changed = false;
  for (const pid of ['A', 'B'] as PlayerId[]) {
    const p = s.players[pid];
    for (const c of p.battlefield) {
      if (!isCreature(c)) continue;
      const b = staticBonus(p, c);
      if ((c.auraP ?? 0) !== b.power || (c.auraT ?? 0) !== b.toughness || c.blitz !== b.blitz) {
        c.auraP = b.power;
        c.auraT = b.toughness;
        c.blitz = b.blitz;
        changed = true;
      }
    }
  }
  return changed;
}

/**
 * Deaths and static abilities feed each other: a lord dying takes its bonus away (which can kill a creature it was keeping alive), a death
 * trigger can make a creature that a static lifts. Settle both until nothing moves (the cap is a safety net).
 */
function settle(s: GameState): void {
  recomputeStatics(s); // first, so a creature a static is keeping alive is not judged without it
  for (let i = 0; i < 8; i++) {
    checkDeaths(s);
    if (!recomputeStatics(s)) break;
  }
}

function name(iid: string, s: GameState): string {
  for (const pid of ['A', 'B'] as PlayerId[]) {
    const c = s.players[pid].battlefield
      .concat(s.players[pid].hand)
      .find((x) => x.iid === iid);
    if (c) return getDef(c.def).name;
  }
  return iid;
}

function moveFromHand(p: PlayerState, iid: string, dest: PlayerState['battlefield']): void {
  const c = takeFromHand(p, iid);
  dest.push(c);
}

function takeFromHand(p: PlayerState, iid: string) {
  const idx = p.hand.findIndex((c) => c.iid === iid);
  if (idx < 0) throw new Error('card not in hand');
  return p.hand.splice(idx, 1)[0];
}

function takeFromGraveyard(p: PlayerState, iid: string) {
  const idx = p.graveyard.findIndex((c) => c.iid === iid);
  if (idx < 0) throw new Error('card not in graveyard');
  return p.graveyard.splice(idx, 1)[0];
}

function payMana(p: PlayerState, cost: number): void {
  if (availableMana(p) < cost) throw new Error('not enough mana');
  const fromPool = Math.min(p.pool ?? 0, cost); // floating mana is spent first, so lands stay untapped
  if (fromPool) p.pool = (p.pool ?? 0) - fromPool;
  const lands = untappedLands(p);
  for (let i = 0; i < cost - fromPool; i++) lands[i].tapped = true;
}

function drawCard(s: GameState, pid: PlayerId): void {
  const p = s.players[pid];
  if (p.library.length === 0) {
    s.winner = opponentOf(pid);
    s.log.push(`${pid} decks out and loses`);
    return;
  }
  p.hand.push(p.library.shift()!);
}

function applyEffect(s: GameState, controller: PlayerId, effect: Effect, target?: Target): void {
  switch (effect.type) {
    case 'damage': {
      if (target?.kind === 'player') {
        s.players[target.player].life -= effect.amount;
      } else if (target?.kind === 'creature') {
        const found = findCreature(s, target.iid);
        if (found) found.card.damage += effect.amount;
      }
      break;
    }
    case 'draw': {
      for (let i = 0; i < effect.amount; i++) drawCard(s, controller);
      break;
    }
    case 'rally': {
      // every creature the controller has NOW gets +P/+T until end of turn (a creature that enters later does not)
      for (const c of s.players[controller].battlefield) {
        if (!isCreature(c)) continue;
        c.tempP = (c.tempP ?? 0) + effect.power;
        c.tempT = (c.tempT ?? 0) + effect.toughness;
      }
      s.log.push(`✦ ${controller}'s creatures get +${effect.power}/+${effect.toughness} until end of turn`);
      break;
    }
    case 'bounce': {
      if (target?.kind !== 'creature') break;
      const found = findCreature(s, target.iid);
      if (!found) break;
      const c = found.card;
      const side = s.players[found.controller];
      side.battlefield = side.battlefield.filter((x) => x.iid !== c.iid);
      // it leaves play like a dead creature does: every buff, mark and aura is gone, and it is summoning sick if recast
      c.tapped = false; c.damage = 0; c.buffP = 0; c.buffT = 0; c.tempP = 0; c.tempT = 0; c.auraP = 0; c.auraT = 0; c.blitz = false; c.summoningSick = true;
      if (!isToken(c.def)) s.players[c.owner].hand.push(c); // a token just ceases to exist
      // it is no longer attacking or blocking
      if (s.combat) {
        s.combat.attackers = s.combat.attackers.filter((iid) => iid !== c.iid);
        for (const [blk, atk] of Object.entries(s.combat.blocks)) if (blk === c.iid || atk === c.iid) delete s.combat.blocks[blk];
      }
      s.log.push(`${getDef(c.def).name} is returned to ${isToken(c.def) ? 'nowhere (a token)' : "its owner's hand"}`);
      break;
    }
    case 'scry': {
      const p = s.players[controller];
      const n = Math.min(effect.amount, p.library.length);
      if (s.pending || n <= 0) break; // (a decision is already waiting, or there is nothing to look at)
      s.pending = { kind: 'scry', source: '', def: '', controller, left: n, seen: 0 };
      s.log.push(`${controller} scries ${n}`);
      break;
    }
    case 'loot': {
      drawCard(s, controller);
      if (s.winner || s.pending || s.players[controller].hand.length === 0) break;
      s.pending = { kind: 'discard', source: '', def: '', controller, left: 1 };
      s.log.push(`${controller} loots`);
      break;
    }
    case 'bite': {
      // The controller's creature with the greatest power (the first on the battlefield wins a tie) deals damage equal to its power to the target.
      if (target?.kind !== 'creature') break;
      const biters = s.players[controller].battlefield.filter(isCreature);
      const victim = findCreature(s, target.iid);
      if (!biters.length || !victim) break;
      const biter = biters.reduce((best, c) => (power(c) > power(best) ? c : best));
      markDamage(biter, victim.card, power(biter)); // (a deathtouch biter kills it)
      s.log.push(`${getDef(biter.def).name} bites ${getDef(victim.card.def).name} for ${power(biter)}`);
      break;
    }
    case 'edict': {
      const victimId = opponentOf(controller);
      const theirs = s.players[victimId].battlefield.filter(isCreature);
      if (theirs.length === 0) s.log.push(`${victimId} has no creature to sacrifice`);
      else if (theirs.length === 1) sacrifice(s, victimId, theirs[0]); // nothing to choose
      else {
        // the VICTIM chooses, so the decision is theirs: `actorOf` hands the turn to them until they pick
        s.pending = { kind: 'sacrifice', source: '', def: '', controller: victimId };
        s.log.push(`✦ ${victimId} must sacrifice a creature`);
      }
      break;
    }
    case 'buff': {
      if (target?.kind === 'creature') {
        const found = findCreature(s, target.iid);
        if (found) {
          found.card.buffP += effect.power;
          found.card.buffT += effect.toughness;
        }
      }
      break;
    }
    case 'heal': {
      s.players[controller].life += effect.amount;
      break;
    }
    case 'mana': {
      const p = s.players[controller];
      p.pool = (p.pool ?? 0) + effect.amount;
      s.log.push(`${controller} adds ${effect.amount} mana`);
      break;
    }
    case 'ramp': {
      const p = s.players[controller];
      let moved = 0;
      for (let i = p.hand.length - 1; i >= 0 && moved < effect.amount; i--) {
        if (isLand(p.hand[i])) {
          const land = p.hand.splice(i, 1)[0];
          land.tapped = false;
          p.battlefield.push(land);
          moved++;
        }
      }
      if (moved) s.log.push(`${controller} ramps ${moved} land${moved > 1 ? 's' : ''}`);
      for (let i = 0; i < moved; i++) landfall(s, controller); // each land that entered
      break;
    }
    case 'token': {
      const p = s.players[controller];
      for (let i = 0; i < effect.count; i++) p.battlefield.push(makeToken(s, effect.token, controller));
      s.log.push(`${controller} creates ${effect.count} ${getDef(effect.token).name}`);
      break;
    }
    case 'tapAll': {
      const enemy = s.players[opponentOf(controller)];
      let n = 0;
      for (const c of enemy.battlefield) {
        if (isCreature(c) && !c.tapped && toughness(c) <= effect.maxToughness) {
          c.tapped = true;
          n++;
        }
      }
      s.log.push(`${controller} topples ${n} creature${n === 1 ? '' : 's'}`);
      break;
    }
    case 'discard': {
      // The opponent discards at random. The pick comes from the game's own rng, so it is deterministic.
      const victimId = opponentOf(controller);
      const victim = s.players[victimId];
      for (let i = 0; i < effect.amount && victim.hand.length > 0; i++) {
        const [r, next] = nextRandom(s.rngState);
        s.rngState = next;
        const gone = victim.hand.splice(Math.floor(r * victim.hand.length), 1)[0];
        victim.graveyard.push(gone);
        s.log.push(`${victimId} discards ${getDef(gone.def).name}`);
      }
      break;
    }
    case 'recall': {
      const p = s.players[controller];
      let idx = -1;
      for (let i = p.graveyard.length - 1; i >= 0; i--) {
        if (isCreature(p.graveyard[i])) {
          idx = i;
          break;
        }
      }
      if (idx < 0) {
        s.log.push(`${controller} finds no creature to return`);
      } else {
        const back = p.graveyard.splice(idx, 1)[0];
        p.hand.push(back);
        s.log.push(`${controller} returns ${getDef(back.def).name} to hand`);
      }
      break;
    }
    case 'destroy': {
      if (target?.kind === 'creature') {
        const found = findCreature(s, target.iid);
        if (found) {
          if (hasKeyword(found.card, 'indestructible')) {
            s.log.push(`${getDef(found.card.def).name} is indestructible`); // destroy does nothing to it
          } else {
            found.card.damage += 9999; // lethal -> checkDeaths removes it (+ destroy VFX)
            s.log.push(`${getDef(found.card.def).name} is destroyed`);
          }
        }
      }
      break;
    }
  }
}

function makeToken(s: GameState, defId: string, owner: PlayerId): CardInstance {
  return {
    iid: `c${s.nextIid++}`,
    def: defId,
    owner,
    tapped: false,
    summoningSick: true,
    damage: 0,
    buffP: 0,
    buffT: 0,
    auraP: 0,
    auraT: 0,
    blitz: false,
  };
}

function resolveCombat(s: GameState): void {
  const combat = s.combat!;
  // Snapshot what actually happened so the UI can animate/announce it — `combat`
  // itself is cleared by toEnd() below, and blocks never persist in `combat_block`.
  s.lastCombat = { attackers: [...combat.attackers], blocks: { ...combat.blocks } };
  const defenderId = opponentOf(s.active);
  const defender = s.players[defenderId];
  // 1:1 blocking (validated). Taken BEFORE damage: deaths between the two steps prune
  // `s.combat`, but an attacker whose blocker died is still a *blocked* attacker.
  const attackers = [...combat.attackers];
  const blockerOf: Record<string, string> = {};
  for (const [blk, atk] of Object.entries(combat.blocks)) blockerOf[atk] = blk;

  for (const step of [1, 2] as const) {
    for (const atkIid of attackers) {
      const atk = findCreature(s, atkIid)?.card;
      if (!atk) continue; // died in an earlier step (or was removed before damage)
      const blkIid = blockerOf[atkIid];
      const blk = blkIid ? (findCreature(s, blkIid)?.card ?? null) : null;

      if (strikesIn(atk, step)) {
        const { toBlocker, toFace } = splitDamage(atk, blk, !!blkIid);
        if (blk) markDamage(atk, blk, toBlocker);
        defender.life -= toFace;
        if (hasKeyword(atk, 'lifelink')) s.players[s.active].life += toBlocker + toFace;
      }
      if (blk && strikesIn(blk, step)) {
        markDamage(blk, atk, power(blk));
        if (hasKeyword(blk, 'lifelink')) defender.life += power(blk);
      }
    }
    checkDeaths(s); // lethal damage resolves between the steps (first strike), and before cleanup
    if (s.winner) break;
  }
  toEnd(s);
}

/** Enter the end step: combat over, marked damage wears off (cleanup). */
function toEnd(s: GameState): void {
  s.combat = null;
  for (const pid of ['A', 'B'] as PlayerId[]) {
    for (const c of s.players[pid].battlefield) c.damage = 0;
  }
  s.phase = 'end';
}

function beginTurn(s: GameState, next: PlayerId): void {
  s.active = next;
  s.turn += 1;
  s.diedThisTurn = false; // per-turn counters for Morbid and second-spell bonuses
  s.spellsThisTurn = { A: 0, B: 0 };
  const p = s.players[next];
  for (const c of p.battlefield) {
    c.tapped = false;
    c.summoningSick = false;
  }
  // "Until end of turn" buffs (prowess) end as the next turn begins, for both players' creatures.
  for (const pid of ['A', 'B'] as PlayerId[]) {
    for (const c of s.players[pid].battlefield) {
      if (c.tempP || c.tempT) {
        c.tempP = 0;
        c.tempT = 0;
      }
    }
  }
  p.landPlayedThisTurn = false;
  s.phase = 'main1';
  drawCard(s, next);
  s.log.push(`Turn ${s.turn}: ${next}'s turn`);
}

/** State-based actions: lethal-damage deaths and life<=0 loss. */
/** Sacrifice: marked for the next death check, which kills it even if it is indestructible. */
function sacrifice(s: GameState, pid: PlayerId, c: CardInstance): void {
  c.doomed = true;
  s.log.push(`${pid} sacrifices ${getDef(c.def).name}`);
}

/** Landfall: each creature its controller has with a landTrigger resolves it, once per land that entered. */
function landfall(s: GameState, pid: PlayerId): void {
  for (const c of [...s.players[pid].battlefield]) {
    const trig = isCreature(c) ? getDef(c.def).landTrigger : undefined;
    if (!trig) continue;
    s.log.push(`✦ ${getDef(c.def).name} — landfall`);
    applyEffect(s, pid, trig, { kind: 'player', player: opponentOf(pid) });
  }
}

/** One more spell cast by `pid` this turn (creature spells count). Read by second-spell bonuses. */
function countSpell(s: GameState, pid: PlayerId): void {
  s.spellsThisTurn ??= { A: 0, B: 0 };
  s.spellsThisTurn[pid] += 1;
}

/** A card's conditional bonus: Morbid (a creature has died this turn) or second spell (the caster's 2nd or later this turn). */
function resolveBonus(s: GameState, pid: PlayerId, def: CardDef): void {
  const b = def.bonus;
  if (!b) return;
  const holds = b.when === 'morbid' ? !!s.diedThisTurn : (s.spellsThisTurn?.[pid] ?? 0) >= 2;
  if (!holds) return;
  s.log.push(`✦ ${def.name} — ${b.when === 'morbid' ? 'morbid' : 'second spell'}`);
  applyEffect(s, pid, b.effect, { kind: 'player', player: opponentOf(pid) });
}

/**
 * Attack triggers, in the order the attackers were declared: Battle cry (each OTHER attacker gets +1/+0), Exalted (a creature
 * attacking alone gets +1/+1 for each exalted creature its controller has, attacking or not) and onAttack effects. All
 * "until end of turn" (tempP / tempT), so they are in place before blocks are declared.
 */
function attackTriggers(s: GameState, attackers: string[]): void {
  const mine = s.players[s.active].battlefield;
  const atk = attackers.map((iid) => mine.find((c) => c.iid === iid)!).filter(Boolean);
  for (const c of atk) {
    if (!hasKeyword(c, 'battleCry')) continue;
    s.log.push(`✦ ${getDef(c.def).name} — battle cry`);
    for (const o of atk) {
      if (o.iid === c.iid) continue;
      o.tempP = (o.tempP ?? 0) + 1;
    }
  }
  if (atk.length === 1) {
    const n = mine.filter((c) => isCreature(c) && hasKeyword(c, 'exalted')).length;
    if (n > 0) {
      atk[0].tempP = (atk[0].tempP ?? 0) + n;
      atk[0].tempT = (atk[0].tempT ?? 0) + n;
      s.log.push(`✦ Exalted — ${getDef(atk[0].def).name} attacks alone: +${n}/+${n}`);
    }
  }
  for (const c of atk) {
    const trig = getDef(c.def).onAttack;
    if (!trig) continue;
    s.log.push(`✦ ${getDef(c.def).name} — attack trigger`);
    applyEffect(s, s.active, trig, { kind: 'player', player: opponentOf(s.active) });
  }
}

function checkDeaths(s: GameState): void {
  const gone = new Set<string>();
  // Dies triggers can change the board (a token appears), so deaths are processed in rounds until the
  // board is stable. The cap is a safety net: today's triggers cannot kill anything, so it never binds.
  for (let round = 0; round < 8; round++) {
    const fallen: CardInstance[] = [];
    // Simultaneous deaths resolve in a fixed order: the active player's creatures first, then the
    // other player's, each in battlefield order (the order the engine, the log and replays all agree on).
    for (const pid of [s.active, opponentOf(s.active)] as PlayerId[]) {
      const p = s.players[pid];
      const dead = p.battlefield.filter((c) => isCreature(c) && (isLethal(c) || c.doomed));
      if (!dead.length) continue;
      p.battlefield = p.battlefield.filter((c) => !dead.includes(c));
      for (const c of dead) {
        gone.add(c.iid);
        fallen.push(c);
        c.tapped = false;
        c.damage = 0;
        c.buffP = 0;
        c.buffT = 0;
        c.tempP = 0;
        c.tempT = 0;
        c.auraP = 0;
        c.auraT = 0;
        c.blitz = false;
        c.doomed = false;
        c.summoningSick = true;
        // A token that dies simply ceases to exist. It is not a card, so it must not
        // pad the graveyard (the count, the viewer and the result screen all read it).
        if (!isToken(c.def)) s.players[c.owner].graveyard.push(c);
        s.log.push(`${getDef(c.def).name} dies`);
        const skill = getDef(c.def).static?.mark === 'blitz' ? getDef(c.def).skill : undefined;
        if (skill && !p.battlefield.some((x) => getDef(x.def).static?.mark === 'blitz')) s.log.push(`${skill} fades.`);
      }
    }
    if (!fallen.length) break;
    s.diedThisTurn = true; // Morbid: a creature has died this turn
    // Dies triggers (tokens trigger too: they die like any creature, they just leave no card behind).
    for (const c of fallen) {
      const trig = getDef(c.def).onDeath;
      if (!trig) continue;
      s.log.push(`✦ ${getDef(c.def).name} — last breath`);
      applyEffect(s, c.owner, trig, { kind: 'player', player: opponentOf(c.owner) });
    }
  }
  // Combat bookkeeping may only name creatures that are still in play. An instant cast
  // during the block step can kill an attacker; leaving it listed made the defender's
  // planned block against it unconfirmable ("attacker no longer in play").
  if (gone.size && s.combat) {
    s.combat.attackers = s.combat.attackers.filter((iid) => !gone.has(iid));
    for (const [blocker, attacker] of Object.entries(s.combat.blocks)) {
      if (gone.has(blocker) || gone.has(attacker)) delete s.combat.blocks[blocker];
    }
  }
  const aDead = s.players.A.life <= 0;
  const bDead = s.players.B.life <= 0;
  if (aDead && bDead) s.winner = 'draw';
  else if (aDead) s.winner = 'B';
  else if (bDead) s.winner = 'A';
}

// re-export for convenience
export { isLand, isCreature, availableMana };
