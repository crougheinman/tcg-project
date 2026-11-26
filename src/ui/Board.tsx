import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { combatImpactDelays, combatJustResolved } from './firstStrike';
import { DEATH_CRACK_MS, DEATH_DUST_MS } from './fxTiming';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { useGame } from '../store/gameStore';
import { getDef } from '../cards/cards';
import { activateError, actorOf, availableMana, canAttack, canBlock, canTargetCreature, castCost, equipOptions, isEquipment, ninjutsuOptions, spellEffect, hasKeyword, isCreature, isLand } from '../engine/rules';
import type { Action, CardInstance, GameState, PlayerId, Target } from '../engine/types';
import { needsTarget, opponentOf } from '../engine/types';
import { CardView } from './CardView';
import { liveAttackers, prune, tapAttacker, tapBlocker } from './blockSelection';
import { BlockLines, type BlockLine } from './BlockLines';
import { CardPreview } from './CardPreview';
import { HoverCtx } from './hover';
import { PhaseBar } from './PhaseBar';
import { Rulebook } from './Rulebook';
import { HelpLink } from './HelpLink';
import type { HelpPageId } from '../rulebook/content';
import { ZoneViewer } from './ZoneViewer';
import { ScryPrompt } from './ScryPrompt';
import { CastOptions } from './CastOptions';
import type { CastOpts } from './CastOptions';
import { BoardFx } from './BoardFx';
import { CastSpotlight } from './CastSpotlight';
import { warmIaijutsuClip } from './cinematics';
import { useLockFailsafe } from './useLockFailsafe';
import { PhaseBanner } from './PhaseBanner';
import { blockStepIsEmpty } from './phaseInfo';
import { CombatTallyChip } from './CombatTallyChip';
import { attackTally, blockTally } from './combatTally';
import { MAX_MULLIGANS, OPENING_HAND } from '../engine/state';
import { PlayerBar } from './PlayerBar';
import { ResultScreen } from './ResultScreen';
import { CoachBubble, type Tip } from './GuideCoach';
import { ActionLog } from './ActionLog';
import { ChatDock } from './ChatDock';
import { humanize } from './boardLog';

/** What a pending enter effect does to the creature you tap, in words (Whipflash hits it, a bounce sends it home). */
function enterVerbFor(defId: string): string {
  const eff = getDef(defId).onEnter;
  if (eff?.type === 'bounce') return "to return it to its owner's hand";
  return `to deal ${eff?.type === 'damage' ? eff.amount : 1} damage to it`;
}

export function Board() {
  const live = useGame((s) => s.game)!;
  // A phase change plays its banner first: the board keeps showing the state from BEFORE the change
  // (nothing draws, untaps or slides) and the cards are locked until the banner has left, then it
  // catches up with `live`. A combat clash is never held: its fx need the real state at once.
  const [hold, setHold] = useState<GameState | null>(null);
  const holdKey = live.phase === 'mulligan' ? null : `${live.turn}:${live.active}:${live.phase}`;
  const [seenHoldKey, setSeenHoldKey] = useState(holdKey);
  const shownGame = useRef(live); // what the last render drew
  const prevLive = useRef(live); // the live state before this one
  if (holdKey !== seenHoldKey) {
    setSeenHoldKey(holdKey);
    if (holdKey !== null && !hold && !live.winner && !combatJustResolved(prevLive.current, live)) setHold(shownGame.current);
  }
  const game = hold && !live.winner ? hold : live;
  const mode = useGame((s) => s.mode);
  const myId = useGame((s) => s.myId);
  const dispatch = useGame((s) => s.dispatch);
  const toMenu = useGame((s) => s.toMenu);
  const abortMatch = useGame((s) => s.abortMatch);
  const playAgain = useGame((s) => s.playAgain);
  const forfeit = useGame((s) => s.forfeit);
  const error = useGame((s) => s.error);
  const peerStale = useGame((s) => s.peerStale);
  const clearError = useGame((s) => s.clearError);

  const [menuOpen, setMenuOpen] = useState(false); // burger menu modal
  const [confirmAbort, setConfirmAbort] = useState(false); // abort confirmation
  const [rulesOpen, setRulesOpen] = useState(false); // the Field Manual (controlled Rulebook)
  const [helpPage, setHelpPage] = useState<string | undefined>(); // the manual page a "?" link asked for (undefined = the first page)
  const openHelp = (page: HelpPageId) => {
    setHelpPage(page);
    setRulesOpen(true);
  };
  const guided = useGame((s) => s.guided);
  const depth = useGame((s) => s.depth);
  const setDepth = useGame((s) => s.setDepth);
  const muted = useGame((s) => s.muted);
  const setMuted = useGame((s) => s.setMuted);
  const setGuided = useGame((s) => s.setGuided);
  const [hushed, setHushed] = useState<Set<string>>(new Set()); // per-session dismissed tips
  const [sorceryIid, setSorceryIid] = useState<string | null>(null);
  const [sorceryOpts, setSorceryOpts] = useState<CastOpts>({}); // the mode / kicker / X chosen for the spell awaiting its target
  const [castOptsIid, setCastOptsIid] = useState<string | null>(null); // a modal / kicker / X spell choosing its options
  const [cycleMode, setCycleMode] = useState(false); // choosing a card to cycle (Cycling)
  const [equipIid, setEquipIid] = useState<string | null>(null); // an equipment of mine picked, waiting for the creature to put it on
  const [ninjaIid, setNinjaIid] = useState<string | null>(null); // Ninjutsu window: the ninja picked from my hand, waiting for an unblocked attacker
  const [abilityMode, setAbilityMode] = useState(false); // choosing one of my creatures to use its activated ability
  const [attackers, setAttackers] = useState<Set<string>>(new Set());
  const autoAttack = useRef<string | null>(null); // dragged to the enemy board in Main: pick it once combat starts
  const [atkDrag, setAtkDrag] = useState<string | null>(null); // the creature being dragged toward the enemy
  const [blocks, setBlocks] = useState<Record<string, string>>({});
  const [pendingBlocker, setPendingBlocker] = useState<string | null>(null);
  const [hovered, setHovered] = useState<CardInstance | null>(null);
  // Cards can't be clicked while a phase banner is on its way in, up, and out (PhaseBanner).
  const [cardsLocked, setCardsLocked] = useState(false);
  const lock = useCallback((v: boolean) => {
    setCardsLocked(v);
    if (!v) setHold(null);
  }, []);
  // failsafe: a banner that never reports back (covers a held board AND locked cards: after a combat resolves nothing is held)
  const releaseLock = useCallback(() => lock(false), [lock]);
  useLockFailsafe(hold !== null || cardsLocked, releaseLock);
  // The action buttons (Go to Combat, End Turn, Attack, Confirm Blocks...) are drawn from the HELD state while a phase banner plays, but
  // dispatch against the live one. A quick second tap on "Go to Combat" therefore hit the same button again and skipped the attack
  // step. While the board is held they do nothing, as the cards do (and look dimmed: `.board.holding`).
  const act = (a: Action) => {
    if (hold) return;
    dispatch(a);
  };
  useEffect(() => {
    warmIaijutsuClip(live); // the Iaijutsu film's clip is fetched once, as soon as a deck holds the card
  }, [live]);
  useEffect(() => {
    shownGame.current = game;
    prevLive.current = live;
  });
  // A click on a summoning-sick creature: it shakes its head and sheds a tear (n re-keys the tear
  // so a second click replays it).
  const [denied, setDenied] = useState<{ iid: string; n: number } | null>(null);
  // Haste creatures that entered THIS turn wear a "Can Attack" tag until the end phase.
  const [hasteIids, setHasteIids] = useState<Set<string>>(new Set());
  const seenIids = useRef<Set<string> | null>(null); // null until the first look, so the opening board isn't tagged
  const hasteTurn = useRef(game.turn);
  useEffect(() => {
    const now = new Set<string>();
    const fresh: string[] = [];
    for (const pid of ['A', 'B'] as PlayerId[])
      for (const c of game.players[pid].battlefield) {
        if (!isCreature(c)) continue;
        now.add(c.iid);
        if (seenIids.current && !seenIids.current.has(c.iid) && hasKeyword(c, 'haste')) fresh.push(c.iid);
      }
    seenIids.current = now;
    const newTurn = hasteTurn.current !== game.turn;
    hasteTurn.current = game.turn;
    setHasteIids((prev) => {
      if (game.phase === 'end' || newTurn) return prev.size ? new Set() : prev; // the effect ends with the turn's last phase
      const next = new Set([...prev].filter((i) => now.has(i)));
      for (const i of fresh) next.add(i);
      return next.size === prev.size && [...next].every((i) => prev.has(i)) ? prev : next;
    });
  }, [game]);

  const denyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(denyTimer.current), []);

  function denyTired(iid: string) {
    setDenied((d) => ({ iid, n: (d?.n ?? 0) + 1 }));
    clearTimeout(denyTimer.current);
    denyTimer.current = setTimeout(() => setDenied(null), 1500);
    // Horizontal head-shake on the stack (imperative: framer owns the card's transform).
    const stack = document.querySelector(`[data-iid="${iid}"]`)?.closest('.stack') as HTMLElement | null;
    if (stack && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      stack.animate(
        [0, -8, 8, -6, 6, -3, 3, 0].map((x) => ({ transform: `translateX(${x}px)` })),
        { duration: 440, easing: 'ease-out' },
      );
    }
  }

  // Lock page scroll to this screen only — the board owns the viewport, while
  // menus / deck-select / rulebook keep their normal scrolling.
  useEffect(() => {
    document.body.classList.add('in-game');
    return () => document.body.classList.remove('in-game');
  }, []);

  // Clear transient selection whenever the situation changes.
  useEffect(() => {
    setSorceryIid(null);
    // A creature dragged onto the enemy's board (dropAttack) arrives in the Attack phase already picked.
    const auto = autoAttack.current;
    autoAttack.current = null;
    const picked =
      auto !== null &&
      game.phase === 'combat_attack' &&
      game.players[game.active].battlefield.some((c) => c.iid === auto && isCreature(c) && canAttack(c));
    setAttackers(picked ? new Set([auto]) : new Set());
    setBlocks({});
    setPendingBlocker(null);
    setHovered(null); // hovered card may have left play
  }, [game.phase, game.turn, game.active]);

  // Hide the hover preview while choosing a spell/trigger target (it blocks the prompt).
  useEffect(() => {
    if (sorceryIid || game.pending) setHovered(null);
  }, [sorceryIid, game.pending]);

  // Click anywhere outside the preview card dismisses it. Needed on touch/hybrid
  // devices where a tap fires mouseenter (opening the preview) but never mouseleave,
  // so it would otherwise stay stuck open. Defer the listener one tick so the tap
  // that opened the preview doesn't immediately close it.
  useEffect(() => {
    if (!hovered) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as Element).closest('.pcard')) setHovered(null);
    };
    const id = window.setTimeout(() => document.addEventListener('click', close), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('click', close);
    };
  }, [hovered]);

  const dragBounds = useRef<HTMLDivElement>(null);

  // Deck / graveyard viewer.
  const [zone, setZone] = useState<'deck' | 'graveyard' | 'oppGraveyard' | null>(null);

  // Drag a hand card onto the battlefield to play it.
  const [dragActive, setDragActive] = useState(false);
  const myFieldRef = useRef<HTMLDivElement>(null);
  function dropPlay(inst: CardInstance, point: { x: number; y: number }) {
    const field = myFieldRef.current;
    if (!field || cardsLocked) return;
    const r = field.getBoundingClientRect();
    const inside = point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom;
    if (!inside) return;
    const def = getDef(inst.def);
    if (def.type === 'land') dispatch({ type: 'playLand', iid: inst.iid });
    else if (def.type === 'creature') dispatch({ type: 'castCreature', iid: inst.iid });
    else if (def.type === 'equipment') dispatch({ type: 'castEquipment', iid: inst.iid });
    // sorceries need a target — keep using click/targeting for those
  }

  // Drag one of your ready creatures from your board onto the enemy's board: go to combat with it already
  // picked as the attacker. Only creatures that can attack right now are draggable (not tapped, not
  // summoning sick), and only in your Main phase.
  function attackDraggable(c: CardInstance, side: PlayerId): boolean {
    return (
      side === localId &&
      game.phase === 'main1' &&
      myTurnToAct &&
      !cardsLocked &&
      !game.pending &&
      !sorceryIid &&
      isCreature(c) &&
      canAttack(c)
    );
  }
  function dropAttack(c: CardInstance, point: { x: number; y: number }) {
    const zone = document.querySelector('.player-zone.opp');
    if (!zone || !attackDraggable(c, localId)) return;
    const r = zone.getBoundingClientRect();
    if (point.x < r.left || point.x > r.right || point.y < r.top || point.y > r.bottom) return;
    autoAttack.current = c.iid;
    dispatch({ type: 'advance' }); // main1 -> combat_attack
    if (useGame.getState().game?.phase !== 'combat_attack') autoAttack.current = null; // refused
  }

  // Announce each new log entry as a transient center banner.
  const [announce, setAnnounce] = useState<{ id: number; text: string; ms?: number } | null>(null);
  const prevLogLen = useRef(game.log.length);
  const announceId = useRef(0);
  useEffect(() => {
    if (game.log.length > prevLogLen.current) {
      const last = game.log[game.log.length - 1];
      // Land plays get no banner — the mana-orb animation already tells the story. Turn changes get none
      // either: the phase banner (PhaseBanner) announces whose turn it is.
      if (!/ plays /.test(last) && !/^Turn \d+/.test(last)) {
        setAnnounce({ id: announceId.current++, text: humanize(last, myId) });
      }
    }
    prevLogLen.current = game.log.length;
  }, [game, myId]);
  useEffect(() => {
    if (!announce) return;
    // Guided mode: hold every banner ~1.6x longer so learners can actually read
    // what just happened (opponent attacks, spells, triggers, ...).
    const hold = (announce.ms ?? 1800) * (guided ? 1.6 : 1);
    const t = setTimeout(() => setAnnounce(null), hold);
    return () => clearTimeout(t);
  }, [announce, guided]);

  // A planned block must stay true. (Defined AFTER the log-announce effect on purpose: effects run in
  // order and the last setAnnounce wins, so the kill's own "Dread Maw dies" banner would otherwise
  // hide this notice.) An instant cast during the step can kill an
  // attacker (or a blocker), leaving an assignment the engine would reject: drop it now
  // and say so, instead of letting Confirm fail with an error toast.
  useEffect(() => {
    if (game.phase !== 'combat_block') return;
    const r = prune({ blocks, pending: pendingBlocker }, game);
    if (r.sel.blocks !== blocks) setBlocks(r.sel.blocks);
    if (r.sel.pending !== pendingBlocker) setPendingBlocker(r.sel.pending);
    if (r.dropped) {
      setAnnounce({ id: announceId.current++, text: '🛡 A planned block was removed — that creature is gone', ms: 2600 });
    }
  }, [game, blocks, pendingBlocker]);

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
    const t = setTimeout(
      () => {
        if (useGame.getState().game?.phase === 'combat_attack') dispatch({ type: 'advance' });
      },
      guided ? 2800 : 1500, // guided: linger so the learner sees why combat skipped
    );
    return () => clearTimeout(t);
  }, [game, myId, mode, dispatch, guided]);

  // Auto-resolve blocks when the defender has nothing that can block — no reason
  // to defend, so let the damage through after a brief notice.
  const autoBlockRef = useRef<string>('');
  useEffect(() => {
    const defender = opponentOf(game.active);
    const myTurn = !game.winner && (mode === 'hotseat' || defender === myId);
    if (game.phase !== 'combat_block' || !myTurn || game.pending) return;
    // Nothing to decide: no creature can block any attacker (a flyer with no flyer or reach to meet it counts) and no
    // affordable instant they might want to cast. The block banner is skipped for the same reason (blockStepIsEmpty).
    if (!blockStepIsEmpty(game)) return;
    const key = `${game.turn}-${defender}`;
    if (autoBlockRef.current === key) return;
    autoBlockRef.current = key;
    setAnnounce({ id: announceId.current++, text: '🛡 No blockers — damage goes through', ms: 2200 });
    const t = setTimeout(
      () => {
        if (useGame.getState().game?.phase === 'combat_block')
          dispatch({ type: 'declareBlockers', blocks: {} });
      },
      guided ? 2800 : 1500,
    );
    return () => clearTimeout(t);
  }, [game, myId, mode, dispatch, guided]);

  // Announce when an attack gets blocked — easy to miss otherwise, especially for
  // the attacker (the engine resolves the block silently). Runs after the
  // log-announce effect so the block banner wins for that frame.
  const prevForBlock = useRef(live);
  // A creature killed in combat stays on the board until its strike lands (then fades under the death
  // fx): the exit below waits for its entry here. Read during render, while the ref still holds the
  // previous state, so it is ready by the render that removes the card.
  const impactDelays = useMemo(() => combatImpactDelays(prevForBlock.current, live), [live]);
  useEffect(() => {
    const before = prevForBlock.current;
    prevForBlock.current = live;
    if (before === live) return;
    if (before.phase !== 'combat_block' || live.phase !== 'end') return;
    const n = Object.keys(live.lastCombat?.blocks ?? {}).length; // resolved blocks
    if (n === 0) return; // nothing was blocked
    const suffix = n > 1 ? `${n} attackers` : 'the attack';
    const text =
      mode === 'hotseat'
        ? `🛡 ${suffix.charAt(0).toUpperCase() + suffix.slice(1)} blocked`
        : before.active === myId
          ? `🛡 Your attack was blocked!`
          : `🛡 You blocked ${suffix}!`;
    setAnnounce({ id: announceId.current++, text, ms: 2400 });
  }, [live, myId, mode]);

  const actor: PlayerId = actorOf(game); // never re-inline the combat_block ternary
  const localId: PlayerId = mode === 'hotseat' ? actor : myId;
  const liveLocal: PlayerId = mode === 'hotseat' ? actorOf(live) : myId;
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

  // Block step, you defending: the live attackers drive the "who can block what" cues.
  const inBlock = game.phase === 'combat_block' && myTurnToAct && !game.winner && !game.pending; // (a paused Ninjutsu window belongs to the ATTACKER, who is not planning blocks)
  // cycle mode ends as soon as it cannot apply (the phase moved on, something is pending, or it is not my move)
  useEffect(() => {
    if (cycleMode && (game.phase !== 'main1' || game.pending || !myTurnToAct)) setCycleMode(false);
  }, [cycleMode, game.phase, game.pending, myTurnToAct]);
  useEffect(() => {
    if (abilityMode && (game.phase !== 'main1' || game.pending || !myTurnToAct)) setAbilityMode(false);
  }, [abilityMode, game.phase, game.pending, myTurnToAct]);
  const liveAtk = inBlock ? liveAttackers(game) : [];

  // Guided mode: pick the ONE tip that matches the current situation (priority order).
  // Teaches core MTG-style flow: lands -> mana -> creatures -> attack -> block.
  function coachTip(): Tip | null {
    if (!guided || game.winner || forfeit) return null;
    if (game.pending?.kind === 'sacrifice' && myTurnToAct)
      return {
        key: 'sacrifice',
        sel: '.player-zone.me .row.creatures',
        text: `✦ ${triggerName}! You must sacrifice a creature. Tap one of yours to give it up.`,
        place: 'above',
      };
    if (game.pending?.kind === 'enter' && myTurnToAct)
      return {
        key: 'trigger',
        sel: '.player-zone.opp .row.creatures',
        text: `✦ ${triggerName} triggered! Tap a creature ${game.pending ? enterVerbFor(game.pending.def) : ''}.`,
        place: 'below',
      };
    if (sorceryIid)
      return {
        key: 'target',
        sel: '.center',
        text: 'Aim the spell: tap a glowing creature (or an avatar) to hit it. Tap Cancel to back out.',
      };
    if (!myTurnToAct)
      return {
        key: 'wait',
        sel: '.player-zone.opp',
        text: "Opponent's turn — watch their plays. If they attack, you'll be asked to block.",
        place: 'below',
      };
    switch (game.phase) {
      case 'main1': {
        if (!me.landPlayedThisTurn && me.hand.some(isLand))
          return {
            key: 'land',
            sel: '.player-dock .hand',
            text: 'Play a land: tap one in your hand. Lands make mana ◈, and mana pays for cards. One land per turn.',
          };
        if (me.hand.some(canPlay))
          return {
            key: 'cast',
            sel: '.player-dock .hand',
            text: 'Cast a card: tap or drag it onto the battlefield. The orb number is its mana cost.',
          };
        return {
          key: 'combatgo',
          sel: '.center',
          text: 'Nothing castable? Head to Combat to attack with your creatures. Or just End Turn to skip combat.',
        };
      }
      case 'combat_attack': {
        if (!canAnyAttack) return null; // auto-skip banner already explains
        if (attackers.size === 0)
          return {
            key: 'pick-attackers',
            sel: '.player-zone.me .row.creatures',
            text: 'Tap the creatures you want to attack with — attackers deal their ⚔ power to the opponent.',
          };
        return {
          key: 'confirm-attack',
          sel: '.center',
          text: 'Ready! Press Attack to send them in. Unblocked attackers hit the opponent’s life.',
        };
      }
      case 'combat_block': {
        if (!canAnyBlock) return null; // auto-resolve banner already explains
        if (pendingBlocker)
          return {
            key: 'pick-victim',
            sel: '.player-zone.opp .row.creatures',
            text: 'Now tap the attacking creature you want it to block.',
            place: 'below',
          };
        return {
          key: 'pick-blockers',
          sel: '.player-zone.me .row.creatures',
          text: 'Defend! Tap one of your creatures to block — it takes the hit instead of you.',
        };
      }
      case 'end':
        return {
          key: 'end-turn',
          sel: '.center',
          text: 'Press End Turn. Next turn you untap, draw a card, and get fresh mana.',
        };
    }
    return null;
  }
  const tip = coachTip();
  // During the block step: does the defender hold a castable instant? (drives the
  // "…or cast an instant" hint and the green card glow). canPlay is hoisted below.
  const instantInHand =
    game.phase === 'combat_block' &&
    me.hand.some((c) => (getDef(c.def).type === 'instant' || hasKeyword(c, 'flash')) && canPlay(c));

  // ---- click handlers ----

  // While a spell awaits a target, which creatures are valid to click?
  function sorceryTargetable(c: CardInstance): boolean {
    if (!sorceryIid) return false;
    const card = me.hand.find((h) => h.iid === sorceryIid);
    const eff = card ? spellEffect(getDef(card.def), sorceryOpts) : undefined;
    if (!canTargetCreature(localId, c, controllerOf(c.iid))) return false; // hexproof: not by the opponent's spells
    if (eff?.type === 'destroy') return c.tapped; // Take Counter: tapped only
    if (eff?.type === 'bite') return controllerOf(c.iid) !== localId; // a bite needs an opposing creature
    return true; // damage / buff: any creature
  }
  // which side a creature on the battlefield belongs to
  function controllerOf(iid: string): PlayerId {
    return me.battlefield.some((x) => x.iid === iid) ? localId : opponentOf(localId);
  }

  // Is this hand card playable right now (turn, phase, mana, land-drop, targets)?
  function canPlay(c: CardInstance): boolean {
    if (!myTurnToAct || game.pending) return false;
    const def = getDef(c.def);
    const mana = availableMana(me);
    // Lands/creatures/sorceries are main-phase only; instants cast any time you may
    // act (myTurnToAct already resolves to the active player in main1/combat_attack
    // and to the defender during combat_block).
    const sorcerySpeed = game.phase === 'main1';
    if (def.type === 'land') return sorcerySpeed && !me.landPlayedThisTurn;
    if (def.type === 'equipment') return sorcerySpeed && def.cost <= mana;
    // a flash creature may also be cast in the attack step and as a surprise blocker
    if (def.type === 'creature') return (sorcerySpeed || (hasKeyword(c, 'flash') && game.phase !== 'end')) && def.cost <= mana;
    if (def.type === 'sorcery' || def.type === 'instant') {
      if (def.type === 'sorcery' && !sorcerySpeed) return false;
      if (def.blockOnly && game.phase !== 'combat_block') return false; // block-only instants
      if (def.cost > mana) return false;
      // a "buff" spell needs a creature on the board to target
      if (def.effect?.type === 'buff') {
        return me.battlefield.some(isCreature) || opp.battlefield.some(isCreature);
      }
      if (def.effect?.type === 'ramp') return me.hand.some(isLand); // needs a land to ramp
      if (def.effect?.type === 'bounce') return me.battlefield.concat(opp.battlefield).some(isCreature); // needs a creature in play
      if (def.effect?.type === 'destroy') {
        return me.battlefield.concat(opp.battlefield).some((c) => isCreature(c) && c.tapped);
      }
      return true;
    }
    return false;
  }

  // Cycling: in your own main phase, with nothing pending, if you can pay the card's cycling cost
  function canCycle(c: CardInstance): boolean {
    const cost = getDef(c.def).cycling;
    return myTurnToAct && !game.pending && !game.winner && game.phase === 'main1' && cost !== undefined && cost <= availableMana(me);
  }
  const anyCyclable = me.hand.some(canCycle);

  // Activated abilities: one of my creatures, in my own main phase, whose cost I can pay now (the engine's own `activateError` decides)
  function canActivate(c: CardInstance): boolean {
    return myTurnToAct && !game.pending && !game.winner && isCreature(c) && !!getDef(c.def).activated && !activateError(game, me, c);
  }
  const anyActivatable = me.battlefield.some(canActivate);

  // Equipment: one of MY equipment in play that I can pay to attach now; tap it, then the creature to put it on
  const equipOpts = myTurnToAct && !game.pending && !game.winner && game.phase === 'main1' ? equipOptions(game, localId) : [];
  const canEquip = (c: CardInstance) => equipOpts.some((o) => o.equipment === c.iid);
  const equipPossible = !!equipIid && equipOpts.some((o) => o.equipment === equipIid);
  useEffect(() => {
    if (equipIid && !equipPossible) setEquipIid(null); // the pick stopped being possible (phase moved on, mana spent, equipment gone)
  }, [equipIid, equipPossible]);

  // Unearth: a creature in my graveyard, in my own main phase, whose unearth cost I can pay
  function canUnearth(c: CardInstance): boolean {
    const cost = getDef(c.def).unearth;
    return myTurnToAct && !game.pending && !game.winner && game.phase === 'main1' && cost !== undefined && getDef(c.def).type === 'creature' && cost <= availableMana(me);
  }

  // Can this graveyard card be cast from here right now (flashback: right timing, enough mana, untargeted)?
  function canFlashback(c: CardInstance): boolean {
    const def = getDef(c.def);
    if (!myTurnToAct || game.pending || def.flashback === undefined || !def.effect) return false;
    if (def.type !== 'sorcery' && def.type !== 'instant') return false;
    if (def.type === 'sorcery' && game.phase !== 'main1') return false;
    return def.flashback <= availableMana(me) && !needsTarget(def.effect);
  }

  // Put the hover preview on the side opposite the hovered card so it never covers it.
  function previewSide(iid: string): 'left' | 'right' {
    const el = document.querySelector(`[data-iid="${iid}"]`);
    if (!el) return 'right';
    const r = el.getBoundingClientRect();
    return r.left + r.width / 2 < window.innerWidth / 2 ? 'right' : 'left';
  }

  // Loot: a card of mine must go; any card in my hand will do
  const lootPick = game.pending?.kind === 'discard' && myTurnToAct;
  // Ninjutsu: the window between blocks and damage, answered by me (the attacker): a ninja from my hand, then an unblocked attacker
  const ninjaPick = game.pending?.kind === 'ninjutsu' && myTurnToAct;
  const ninjaOpts = ninjaPick ? ninjutsuOptions(game) : [];
  const isNinja = (c: CardInstance) => ninjaOpts.some((o) => o.ninja === c.iid);
  useEffect(() => {
    if (!ninjaPick) setNinjaIid(null);
  }, [ninjaPick]);
  function handHclick(c: CardInstance) {
    if (ninjaPick) {
      if (cardsLocked) return;
      if (isNinja(c)) setNinjaIid((cur) => (cur === c.iid ? null : c.iid));
      else setAnnounce({ id: announceId.current++, text: '⚠ Pick a ninja you can pay for', ms: 1800 });
      return;
    }
    if (lootPick) {
      if (!cardsLocked) dispatch({ type: 'resolveTrigger', target: c.iid });
      return;
    }
    if (cycleMode) {
      // the next card you tap is cycled (if it can be); either way the mode ends
      if (!cardsLocked && canCycle(c)) act({ type: 'cycle', iid: c.iid });
      setCycleMode(false);
      return;
    }
    if (cardsLocked || !canPlay(c)) return; // greyed/unplayable cards are fully disabled
    const def = getDef(c.def);
    if (def.type === 'land') dispatch({ type: 'playLand', iid: c.iid });
    else if (def.type === 'creature') dispatch({ type: 'castCreature', iid: c.iid });
    else if (def.type === 'equipment') dispatch({ type: 'castEquipment', iid: c.iid });
    else if (def.type === 'sorcery' || def.type === 'instant') {
      if (def.x || def.kicker || def.modes) setCastOptsIid(c.iid); // choose the options first
      else startCast(c.iid, {});
    }
  }
  // Cast a spell with its options: straight away when its effect needs no target, else wait for one.
  function startCast(iid: string, opts: CastOpts) {
    const def = getDef(me.hand.find((h) => h.iid === iid)?.def ?? '');
    const eff = spellEffect(def, opts);
    if (eff && !needsTarget(eff)) dispatch({ type: 'castSorcery', iid, ...opts });
    else {
      setSorceryOpts(opts);
      setSorceryIid(iid);
    }
  }
  // The target is chosen: cast. A ward creature makes it dearer, which is said up front rather than failing.
  function castAt(target: Target) {
    const card = me.hand.find((h) => h.iid === sorceryIid);
    if (!sorceryIid || !card) return;
    const need = castCost(game, localId, getDef(card.def), { ...sorceryOpts, target });
    if (need > availableMana(me)) {
      setAnnounce({ id: announceId.current++, text: `⚠ Ward: that costs ${need} mana`, ms: 2200 });
      return;
    }
    dispatch({ type: 'castSorcery', iid: sorceryIid, target, ...sorceryOpts });
    setSorceryIid(null);
  }

  // the equipment attached to creature `c` on `pid`'s side (for the tag on the creature)
  function equipmentOn(pid: PlayerId, c: CardInstance): CardInstance[] {
    return game.players[pid].battlefield.filter((e) => isEquipment(e) && e.attachedTo === c.iid);
  }
  // tapping one of my equipment in play starts an equip: pick the creature next
  function equipClick(e: CardInstance) {
    if (cardsLocked) return;
    if (!canEquip(e)) {
      setAnnounce({ id: announceId.current++, text: '⚠ Equip needs your main phase, the mana, and a creature to put it on', ms: 2200 });
      return;
    }
    setEquipIid((cur) => (cur === e.iid ? null : e.iid));
  }

  function creatureClick(c: CardInstance, side: PlayerId) {
    if (cardsLocked) return; // the Attack phase banner is still playing
    // An Edict is waiting on ME: only my own creatures can be sacrificed
    if (game.pending?.kind === 'sacrifice' && myTurnToAct) {
      if (side === localId) dispatch({ type: 'resolveTrigger', target: c.iid });
      return;
    }
    // The Ninjutsu window: an unblocked attacker of mine is swapped for the ninja picked from my hand
    if (game.pending?.kind === 'ninjutsu' && myTurnToAct) {
      if (!ninjaIid) setAnnounce({ id: announceId.current++, text: '⚠ Pick a ninja in your hand first', ms: 1800 });
      else if (side === localId && ninjaOpts.some((o) => o.ninja === ninjaIid && o.attacker === c.iid)) {
        dispatch({ type: 'ninjutsu', ninja: ninjaIid, attacker: c.iid });
        setNinjaIid(null);
      } else setAnnounce({ id: announceId.current++, text: '⚠ Pick one of your UNBLOCKED attackers', ms: 1800 });
      return;
    }
    // Resolving a pending Whipflash takes priority.
    if (game.pending?.kind === 'enter' && myTurnToAct) {
      if (c.iid !== game.pending.source && canTargetCreature(localId, c, side)) dispatch({ type: 'resolveTrigger', target: c.iid });
      else if (c.iid !== game.pending.source) setAnnounce({ id: announceId.current++, text: '⚠ That creature has hexproof', ms: 2000 });
      return;
    }
    // Equip mode: the equipment picked from my battlefield goes on this creature of mine
    if (equipIid) {
      if (side === localId && equipOpts.some((o) => o.equipment === equipIid && o.creature === c.iid)) act({ type: 'equip', equipment: equipIid, creature: c.iid });
      setEquipIid(null);
      return;
    }
    // Ability mode: the next creature of mine that can use its ability does; either way the mode ends
    if (abilityMode) {
      if (side === localId && canActivate(c)) act({ type: 'activate', iid: c.iid });
      setAbilityMode(false);
      return;
    }
    // Targeting a spell next.
    if (sorceryIid) {
      if (!sorceryTargetable(c)) return; // e.g. Take Counter needs a tapped creature
      castAt({ kind: 'creature', iid: c.iid });
      return;
    }
    if (!myTurnToAct) return;

    // Your own creature that cannot attack yet: refuse with the tired shake + tear.
    if (side === localId && c.summoningSick && (game.phase === 'main1' || game.phase === 'combat_attack')) {
      denyTired(c.iid);
      return;
    }

    if (game.phase === 'combat_attack' && side === localId) {
      if (!canAttack(c)) return;
      setAttackers((prev) => {
        const next = new Set(prev);
        if (next.has(c.iid)) next.delete(c.iid);
        else next.add(c.iid);
        return next;
      });
    } else if (game.phase === 'combat_block') {
      // All of the block-planning rules live in blockSelection.ts (pure, tested, and
      // built on the engine's own canBlock). This only routes the tap and shows why a
      // pairing was refused.
      const sel = { blocks, pending: pendingBlocker };
      const r = side === localId ? tapBlocker(sel, game, c.iid) : tapAttacker(sel, game, c.iid);
      if (r.sel.blocks !== blocks) setBlocks(r.sel.blocks);
      if (r.sel.pending !== pendingBlocker) setPendingBlocker(r.sel.pending);
      if (r.hint) setAnnounce({ id: announceId.current++, text: `⚠ ${r.hint}`, ms: 2600 });
    }
  }

  function faceClick(side: PlayerId) {
    if (sorceryIid) {
      castAt({ kind: 'player', player: side });
    }
  }

  // ---- render helpers ----

  const pendingBlockerCard = pendingBlocker
    ? (game.players[localId].battlefield.find((x) => x.iid === pendingBlocker) ?? null)
    : null;

  const blockedNow = new Set(Object.values(blocks));

  // Which "your move" cue a battlefield creature gets (CSS class on its stack):
  //   can-attack   attack step: your creatures that may attack, until picked
  //   can-block    block step: your untapped creatures that can block something, until used
  //   block-target block step, a blocker selected: the attackers it can legally take
  function stackNudge(c: CardInstance, side: PlayerId): string {
    if (!myTurnToAct) return '';
    if (game.phase === 'combat_attack') {
      return side === localId && !attackers.has(c.iid) && canAttack(c) ? ' can-attack' : '';
    }
    if (!inBlock) return '';
    if (side === localId) {
      return !pendingBlocker && !blocks[c.iid] && !c.tapped && liveAtk.some((a) => canBlock(c, a))
        ? ' can-block'
        : '';
    }
    return pendingBlockerCard &&
      liveAtk.some((a) => a.iid === c.iid) &&
      !blockedNow.has(c.iid) &&
      canBlock(pendingBlockerCard, c)
      ? ' block-target'
      : '';
  }

  // Curves: confirmed blocks, plus every attacker the selected blocker could still take.
  const blockLines: BlockLine[] = inBlock
    ? [
        ...Object.entries(blocks).map(([b, a]) => ({ from: b, to: a, kind: 'set' as const })),
        ...(pendingBlockerCard
          ? liveAtk
              .filter((a) => !blockedNow.has(a.iid) && canBlock(pendingBlockerCard, a))
              .map((a) => ({ from: pendingBlockerCard.iid, to: a.iid, kind: 'candidate' as const }))
          : []),
      ]
    : [];

  // A flyer can only be blocked by a flyer or a reach creature: say so on the card, and
  // say "unblockable" when nothing of yours can take it.
  function flyMark(c: CardInstance) {
    if (!inBlock || !attackingIids.has(c.iid) || !hasKeyword(c, 'flying')) return null;
    const takeable = me.battlefield.some((b) => isCreature(b) && !b.tapped && canBlock(b, c));
    return (
      <span className={'fly-mark' + (takeable ? '' : ' none')}>
        ✈ {takeable ? 'Reach only' : 'Unblockable'}
      </span>
    );
  }

  function permanents(pid: PlayerId, side: PlayerId, mine = false) {
    const p = game.players[pid];
    const lands = p.battlefield.filter(isLand);
    const creatures = p.battlefield.filter(isCreature);
    const gear = p.battlefield.filter(isEquipment);
    const blockerOf = (atkIid: string) =>
      Object.entries(blocks).find(([, a]) => a === atkIid)?.[0];
    return (
      <div
        className={'battlefield' + (mine && dragActive ? ' drop-active' : '') + (!mine && atkDrag ? ' attack-drop' : '')}
        ref={mine ? myFieldRef : undefined}
      >
        <div className="row creatures" data-focus-zone tabIndex={-1}>
          <AnimatePresence custom={impactDelays}>
            {creatures.map((c) => (
              <motion.div
                key={c.iid}
                className={'stack' + stackNudge(c, side) + (atkDrag === c.iid ? ' dragging' : '')}
                initial={false}
                custom={impactDelays}
                variants={{
                  out: (delays: Record<string, number>) => ({
                    opacity: 0,
                    scale: delays[c.iid] ? 0.94 : 0.85,
                    transition: {
                      // Killed in combat: impact -> crack (DEATH_CRACK_MS) -> pulverize (DEATH_DUST_MS) ->
                      // gone. The card is held whole through the hit and the cracking, and only disappears
                      // across the pulverize, finishing exactly when the pieces do (ShatterFx). Anything
                      // else fades slowly as before.
                      duration: delays[c.iid] ? DEATH_DUST_MS / 1000 : 1.8,
                      ease: delays[c.iid] ? 'linear' : 'easeIn',
                      delay: delays[c.iid] ? (delays[c.iid] + DEATH_CRACK_MS) / 1000 : 0,
                    },
                  }),
                }}
                exit="out"
              >
                <CardView
                  inst={c}
                  arena
                  selected={attackers.has(c.iid) || pendingBlocker === c.iid || !!blocks[c.iid]}
                  targetable={
                    sorceryTargetable(c) ||
                    (game.pending?.kind === 'enter' && c.iid !== game.pending.source && canTargetCreature(localId, c, side)) ||
                    (game.pending?.kind === 'sacrifice' && myTurnToAct && side === localId) ||
                    (abilityMode && side === localId && canActivate(c)) ||
                    (!!equipIid && side === localId && equipOpts.some((o) => o.equipment === equipIid && o.creature === c.iid)) ||
                    (ninjaPick && !!ninjaIid && side === localId && ninjaOpts.some((o) => o.ninja === ninjaIid && o.attacker === c.iid))
                  }
                  // With a blocker waiting for its target, dim the attackers it cannot legally
                  // block (e.g. a flyer vs a ground creature) so that is clear BEFORE the tap.
                  dim={!!pendingBlockerCard && attackingIids.has(c.iid) && !canBlock(pendingBlockerCard, c)}
                  onClick={() => creatureClick(c, side)}
                  draggable={attackDraggable(c, side)}
                  onDragChange={(on) => setAtkDrag(on ? c.iid : null)}
                  onDrop={(point) => dropAttack(c, point)}
                />
                {denied?.iid === c.iid && (
                  <span key={denied.n} className="deny-tear" aria-hidden>
                    <i />
                  </span>
                )}
                {equipmentOn(side, c).length > 0 && <span className="equip-tag">⚔ {equipmentOn(side, c).map((e) => getDef(e.def).name).join(' · ')}</span>}
                {c.unearthed && <span className="haste-tag">Unearthed</span>}
                {hasteIids.has(c.iid) && !c.unearthed && !attackingIids.has(c.iid) && <span className="haste-tag">Can Attack</span>}
                {attackingIids.has(c.iid) && <span className="combat-tag atk">ATK</span>}
                {side !== localId && flyMark(c)}
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
                        className={'ready-box block' + (pendingBlocker === c.iid ? ' pending' : '')}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 12 }}
                        transition={{ type: 'spring', stiffness: 480, damping: 24 }}
                      >
                        {pendingBlocker === c.iid ? 'Pick a target…' : 'Blocking'}
                      </motion.span>,
                    ]}
                  </AnimatePresence>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {gear.map((e) => {
            const holder = e.attachedTo ? creatures.find((c) => c.iid === e.attachedTo) : undefined;
            const mineE = side === localId;
            return (
              <div key={e.iid} className="equip-item">
                <CardView
                  inst={e}
                  onClick={mineE ? () => equipClick(e) : undefined}
                  greenGlow={mineE && (canEquip(e) || equipIid === e.iid)}
                  targetable={false}
                />
                <span className="equip-tag on">{holder ? `on ${getDef(holder.def).name}` : 'unattached'}</span>
              </div>
            );
          })}
          {creatures.length === 0 && gear.length === 0 && <span className="empty">no creatures</span>}
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

  // The name of the enter-the-battlefield skill waiting on a target ("Whipflash"), for the prompts.
  // (a Scry / Loot / Ninjutsu decision may have no card behind it: its `def` is empty)
  const triggerName = game.pending?.def ? (getDef(game.pending.def).skill ?? getDef(game.pending.def).name) : '';
  // what the pending enter effect does to the creature you pick, in words (Whipflash hits it, a bounce sends it home)
  const enterVerb = game.pending?.kind === 'enter' ? enterVerbFor(game.pending.def) : '';
  const abilityBtn = anyActivatable ? (
    <button onClick={() => setAbilityMode(true)} title="Use a creature's ability (mana, ping, heal...): tap this, then the creature">
      ✦ Ability
    </button>
  ) : null;
  const cycleBtn = anyCyclable ? (
    <button onClick={() => setCycleMode(true)} title="Pay a card's cycling cost and discard it from your hand to draw a card">
      ⟳ Cycle
    </button>
  ) : null;

  // The damage readout (attack: what the chosen attackers could deal; block: what is coming and what is left).
  const attackTotals = game.phase === 'combat_attack' && myTurnToAct ? attackTally(game, attackers) : null;
  const blockTotals = game.phase === 'combat_block' && myTurnToAct && !game.pending ? blockTally(game, blocks) : null;

  function actionButtons() {
    if (game.pending?.kind === 'sacrifice') {
      return myTurnToAct ? (
        <div className="actions">
          <span className="prompt">✦ {triggerName} — choose one of your creatures to sacrifice</span>
          <HelpLink page="effects" onOpen={openHelp} />
        </div>
      ) : (
        <div className="waiting">Opponent is choosing a creature to sacrifice…</div>
      );
    }
    if (game.pending?.kind === 'enter') {
      return myTurnToAct ? (
        <div className="actions">
          <span className="prompt">✦ {triggerName} — click a creature {enterVerb}</span>
        </div>
      ) : (
        <div className="waiting">Opponent resolving {triggerName}…</div>
      );
    }
    if (game.pending?.kind === 'ninjutsu') {
      return myTurnToAct ? (
        <div className="actions">
          <span className="prompt">✦ Ninjutsu — {ninjaIid ? 'tap one of your unblocked attackers to swap it out' : 'tap a ninja in your hand, or skip'}</span>
          <HelpLink page="ninjutsu" onOpen={openHelp} />
          <button
            onClick={() => {
              setNinjaIid(null);
              dispatch({ type: 'skipNinjutsu' });
            }}
          >
            No ninjutsu
          </button>
        </div>
      ) : (
        <div className="waiting">Opponent is deciding on ninjutsu…</div>
      );
    }
    if (game.pending?.kind === 'scry') {
      return myTurnToAct ? (
        <div className="actions">
          <span className="prompt">✦ Scry — keep the top card or put it on the bottom</span>
          <HelpLink page="effects" onOpen={openHelp} />
        </div>
      ) : (
        <div className="waiting">Opponent is scrying…</div>
      );
    }
    if (game.pending?.kind === 'discard') {
      return myTurnToAct ? (
        <div className="actions">
          <span className="prompt">✦ Loot — tap a card in your hand to discard</span>
          <HelpLink page="effects" onOpen={openHelp} />
        </div>
      ) : (
        <div className="waiting">Opponent is looting…</div>
      );
    }
    if (!myTurnToAct) {
      const who =
        game.phase === 'mulligan' ? 'Opponent is deciding on their hand…' : mode === 'ai' ? 'AI is thinking…' : 'Waiting for opponent…';
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
    if (cycleMode) {
      return (
        <div className="actions">
          <span className="prompt">⟳ Choose a card to cycle…</span>
          <HelpLink page="cycling" onOpen={openHelp} />
          <button onClick={() => setCycleMode(false)}>Cancel</button>
        </div>
      );
    }
    if (equipIid) {
      return (
        <div className="actions">
          <span className="prompt">⚔ Choose a creature to equip…</span>
          <HelpLink page="equipment" onOpen={openHelp} />
          <button onClick={() => setEquipIid(null)}>Cancel</button>
        </div>
      );
    }
    if (abilityMode) {
      return (
        <div className="actions">
          <span className="prompt">✦ Choose a creature to use its ability…</span>
          <HelpLink page="activated" onOpen={openHelp} />
          <button onClick={() => setAbilityMode(false)}>Cancel</button>
        </div>
      );
    }
    switch (game.phase) {
      case 'mulligan': {
        // The opening hand is on the table below; this is the keep-or-mulligan decision about it.
        const taken = game.mulligan?.taken[localId] ?? 0;
        return (
          <div className="actions">
            <span className="prompt">Keep this hand?</span>
            <button className="primary" onClick={() => act({ type: 'keepHand' })}>
              Keep hand
            </button>
            {taken < MAX_MULLIGANS && (
              <button onClick={() => act({ type: 'mulligan' })}>
                Mulligan ({OPENING_HAND - taken - 1})
              </button>
            )}
          </div>
        );
      }
      case 'main1': {
        // End the turn in one click: advance straight past combat + end.
        const endTurn = () => {
          act({ type: 'advance' }); // main1 -> combat_attack
          act({ type: 'advance' }); // combat_attack -> end
          act({ type: 'advance' }); // end -> next turn
        };
        // No creature can attack → combat is pointless; offer only End Turn.
        if (!canAnyAttack) {
          // Nothing castable, no flashback, nothing to attack with: say so, and make
          // End Turn pulse straight away (no 5s wait) — it is the only thing left to do.
          const noMovesLeft = !me.hand.some(canPlay) && !me.graveyard.some(canFlashback) && !me.graveyard.some(canUnearth) && !anyCyclable && !anyActivatable;
          return (
            <div className="actions">
              {noMovesLeft && <span className="prompt nomoves">No more moves</span>}
              {abilityBtn}
              {cycleBtn}
              <button className={'primary' + (noMovesLeft ? ' urgent' : '')} onClick={endTurn}>
                End Turn
              </button>
            </div>
          );
        }
        // Attackers available: offer Combat, or End Turn to skip it entirely.
        return (
          <div className="actions">
            <button className="primary" onClick={() => act({ type: 'advance' })}>
              Go to Combat
            </button>
            {abilityBtn}
              {cycleBtn}
            <button className="primary" onClick={endTurn}>End Turn</button>
          </div>
        );
      }
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
            {attackTotals && <CombatTallyChip t={attackTotals} />}
            <span className="prompt">⚔ Select creatures to attack</span>
            <button
              className="primary"
              onClick={() => act({ type: 'declareAttackers', attackers: [...attackers] })}
            >
              Attack ({attackers.size})
            </button>
            <button onClick={() => act({ type: 'advance' })}>Skip Combat</button>
          </div>
        );
      case 'combat_block': {
        const instantHint = instantInHand && (
          <span className="prompt-hint">…or cast a glowing card</span>
        );
        // No creature can block. Still let them cast an instant (or pass) if they have one;
        // otherwise the auto-resolve effect lets damage through.
        if (!canAnyBlock) {
          return (
            <div className="actions">
              {blockTotals && <CombatTallyChip t={blockTotals} />}
              <div className="prompt-stack">
                <span className="prompt">🛡 No blockers available…</span>
                {instantHint}
              </div>
              {instantInHand && (
                <button onClick={() => act({ type: 'declareBlockers', blocks: {} })}>
                  Let it through
                </button>
              )}
            </div>
          );
        }
        return (
          <div className="actions">
            {blockTotals && <CombatTallyChip t={blockTotals} />}
            <div className="prompt-stack">
              <span className="prompt">
                {pendingBlocker ? 'Click an attacker to block' : 'Click your blocker, then its target'}
              </span>
              {instantHint}
            </div>
            <button
              className="primary"
              onClick={() => {
                // A blocker is selected but not yet pointed at an attacker — don't
                // silently let the attack through; nudge the player to finish (or cancel).
                if (pendingBlocker) {
                  setAnnounce({
                    id: announceId.current++,
                    text: '⚠ Tap an attacker for your selected blocker (or tap the blocker again to cancel)',
                    ms: 2600,
                  });
                  return;
                }
                act({ type: 'declareBlockers', blocks });
              }}
            >
              Confirm Blocks
            </button>
            <button onClick={() => act({ type: 'declareBlockers', blocks: {} })}>No Blocks</button>
          </div>
        );
      }
      case 'end':
        return (
          <div className="actions">
            <button className="primary" onClick={() => act({ type: 'advance' })}>
              End Turn
            </button>
          </div>
        );
    }
  }

  return (
    <HoverCtx.Provider value={setHovered}>
      <LayoutGroup>
        {/* nudge-main: your main phase with nothing pending — CSS pulses the playable
            hand cards (after a delay) so the next move is easy to spot */}
        <div
          className={
            'board' +
            (depth ? ' depth-3d' : '') +
            (cardsLocked ? ' cards-locked' : '') +
            (hold ? ' holding' : '') +
            (myTurnToAct && game.phase === 'main1' && !sorceryIid && !game.pending && !game.winner
              ? ' nudge-main'
              : '')
          }
        >
          <header className="topbar">
            <button className="menu-btn" onClick={() => setMenuOpen(true)} aria-label="Menu" title="Menu">
              ☰
            </button>
            <PhaseBar game={live} myId={liveLocal} />
            <div className="topbar-right">
              {mode === 'pvp' && <span className="role">You are {myId}</span>}
              <Rulebook label={false} />
            </div>
          </header>

          {/* Opponent */}
          <section className={'player-zone opp' + (game.active === oppId && !game.winner ? ' turn' : '')}>
            <PlayerBar
              p={opp}
              side={oppId}
              mana={{ avail: availableMana(opp), total: opp.battlefield.filter(isLand).length }}
              onFace={() => faceClick(oppId)}
              targetable={!!sorceryIid}
              acting={!game.winner && actor === oppId}
              onGraveyard={() => setZone('oppGraveyard')}
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
          <section className={'player-zone me' + (game.active === localId && !game.winner ? ' turn' : '')}>
            {permanents(localId, localId, true)}
            <div className="player-dock">
              {/* tabIndex -1: not a tab stop itself, but a place to put focus back
                  when the focused card is played and leaves the DOM. */}
              <div className="hand" data-focus-zone tabIndex={-1}>
                <AnimatePresence>
                  {me.hand.map((c) => (
                    <CardView
                      key={c.iid}
                      inst={c}
                      onClick={() => handHclick(c)}
                      dim={cardsLocked || (ninjaPick ? !isNinja(c) : lootPick ? false : cycleMode ? !canCycle(c) : !canPlay(c))}
                      greenGlow={lootPick || (ninjaPick && isNinja(c)) || ninjaIid === c.iid || (cycleMode && canCycle(c)) || (game.phase === 'combat_block' && (getDef(c.def).type === 'instant' || hasKeyword(c, 'flash')) && canPlay(c))}
                      draggable={!cardsLocked && canPlay(c) && getDef(c.def).type !== 'sorcery' && getDef(c.def).type !== 'instant'}
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
                  acting={!game.winner && actor === localId}
                  self
                />
                <button
                  // You lose by drawing from an empty deck, so the last few cards matter.
                  className={'zone-btn right' + (me.library.length <= 5 ? ' low' : '')}
                  onClick={() => setZone('deck')}
                  title={
                    me.library.length <= 5
                      ? `View deck — only ${me.library.length} left; you lose if you must draw from an empty deck`
                      : 'View deck'
                  }
                >
                  🂠 {me.library.length}
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* Everything below renders OUTSIDE `.board` on purpose. `.board` gets a CSS
        transform during screen-shake fx (chargeShake / combat face-hit impact),
        and a transformed ancestor becomes the containing block for its
        `position: fixed` descendants per spec — silently breaking every fixed fx
        overlay's viewport-relative coordinates for as long as the shake runs
        (this is what misplaced the charge-up orb). Rendering these as siblings
        of `.board`, not children, keeps them truly viewport-fixed regardless of
        what `.board` is doing. */}
        <BoardFx game={live} locked={cardsLocked} />
        <BlockLines lines={blockLines} />
        <CastSpotlight />
        {!game.winner && <div className={'turn-glow ' + (game.active === localId ? 'me' : 'foe')} aria-hidden />}
        <PhaseBanner game={live} localId={liveLocal} guided={guided} onLock={lock} />

        <AnimatePresence>
          {hovered && !sorceryIid && !game.pending && (
            <CardPreview key={hovered.iid} inst={hovered} side={previewSide(hovered.iid)} />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {zone && (
            <ZoneViewer
              key={zone}
              title={
                zone === 'deck' ? 'Your Deck' : zone === 'graveyard' ? 'Graveyard' : "Opponent's Graveyard"
              }
              cards={zone === 'deck' ? me.library : zone === 'graveyard' ? me.graveyard : opp.graveyard}
              onClose={() => setZone(null)}
              unearth={
                zone === 'graveyard'
                  ? {
                      can: canUnearth,
                      cast: (c) => {
                        setZone(null);
                        act({ type: 'unearth', iid: c.iid });
                      },
                    }
                  : undefined
              }
              flashback={
                zone === 'graveyard'
                  ? {
                      can: canFlashback,
                      cast: (c) => {
                        setZone(null);
                        dispatch({ type: 'castSorcery', iid: c.iid });
                      },
                    }
                  : undefined
              }
            />
          )}
        </AnimatePresence>

        {castOptsIid && me.hand.some((h) => h.iid === castOptsIid) && !game.pending && (
          <CastOptions
            def={getDef(me.hand.find((h) => h.iid === castOptsIid)!.def)}
            mana={availableMana(me)}
            onCancel={() => setCastOptsIid(null)}
            onHelp={() => openHelp('cast-options')}
            onCast={(o) => {
              const iid = castOptsIid;
              setCastOptsIid(null);
              startCast(iid, o);
            }}
          />
        )}
        {game.pending?.kind === 'scry' && myTurnToAct && me.library[game.pending.seen ?? 0] && (
          <ScryPrompt
            card={me.library[game.pending.seen ?? 0]}
            index={(game.pending.seen ?? 0)}
            total={(game.pending.seen ?? 0) + (game.pending.left ?? 1)}
            onKeep={() => dispatch({ type: 'scry', bottom: false })}
            onBottom={() => dispatch({ type: 'scry', bottom: true })}
            onHelp={() => openHelp('effects')}
          />
        )}

        {/* Guided-mode coach bubble (one at a time, anchored to the relevant UI) */}
        <AnimatePresence>
          {tip && !hushed.has(tip.key) && (
            <CoachBubble
              key={tip.key}
              tip={tip}
              onHush={(k) => setHushed((h) => new Set(h).add(k))}
            />
          )}
        </AnimatePresence>

        <div className="announce-wrap">
          <AnimatePresence>
            {announce && (
              <motion.div
                key={announce.id}
                className={
                  'announce' +
                  (announce.text.includes('✦') ? ' skill' : '')
                }
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

        {/* The peer went quiet but the match is still recoverable: the transport
            resyncs by itself if they come back, and only gives up after a long
            grace period. Informational only — play is already blocked because it
            is not this client's turn to act. */}
        {mode === 'pvp' && peerStale && !game.winner && (
          <div className="toast net-stale" role="status">
            <span className="net-stale-dot" aria-hidden /> Opponent connection lost — reconnecting…
          </div>
        )}

        {/* Burger menu modal */}
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              className="overlay"
              onClick={() => setMenuOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.div
                className="game-menu"
                onClick={(e) => e.stopPropagation()}
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 320, damping: 26 }}
              >
                <button className="modal-x" onClick={() => setMenuOpen(false)} aria-label="Close">
                  ×
                </button>
                <h2 className="game-menu-title">Menu</h2>
                <button
                  className="game-menu-item danger"
                  onClick={() => {
                    setMenuOpen(false);
                    setConfirmAbort(true);
                  }}
                >
                  Abort Match
                </button>
                <button
                  className="game-menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    setRulesOpen(true);
                  }}
                >
                  Field Manual
                </button>
                <button
                  className={'game-menu-item toggle' + (guided ? ' on' : '')}
                  onClick={() => {
                    setGuided(!guided);
                    if (!guided) setHushed(new Set()); // re-enabling revives dismissed tips
                  }}
                >
                  Guided Mode
                  <span className="toggle-pill" aria-hidden>
                    {guided ? 'ON' : 'OFF'}
                  </span>
                </button>
                <button
                  className={'game-menu-item toggle' + (depth ? ' on' : '')}
                  onClick={() => setDepth(!depth)}
                >
                  3D Table
                  <span className="toggle-pill" aria-hidden>
                    {depth ? 'ON' : 'OFF'}
                  </span>
                </button>
                <button
                  className={'game-menu-item toggle' + (!muted ? ' on' : '')}
                  onClick={() => setMuted(!muted)}
                >
                  Sound
                  <span className="toggle-pill" aria-hidden>
                    {muted ? 'OFF' : 'ON'}
                  </span>
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Abort confirmation */}
        <AnimatePresence>
          {confirmAbort && (
            <motion.div
              className="overlay"
              onClick={() => setConfirmAbort(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.div
                className="game-menu confirm"
                onClick={(e) => e.stopPropagation()}
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 320, damping: 26 }}
              >
                <button className="modal-x" onClick={() => setConfirmAbort(false)} aria-label="Close">
                  ×
                </button>
                <h2 className="game-menu-title">Abort match?</h2>
                <p className="game-menu-msg">You’ll forfeit this match and return to the main menu.</p>
                <div className="game-menu-row">
                  <button
                    className="game-menu-item danger"
                    onClick={() => {
                      setConfirmAbort(false);
                      abortMatch();
                    }}
                  >
                    Yes, abort
                  </button>
                  <button className="game-menu-item" onClick={() => setConfirmAbort(false)}>
                    Cancel
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* the Field Manual, opened from the game menu */}
        <Rulebook
          trigger={false}
          open={rulesOpen}
          page={helpPage}
          onOpenChange={(v) => {
            setRulesOpen(v);
            if (!v) setHelpPage(undefined);
          }}
        />

        {/* Game over (a winner) or PvP forfeit (opponent left) -> animated stats. */}
        {(game.winner || forfeit) && (
          <ResultScreen
            game={game}
            myId={myId}
            reason={forfeit && !game.winner ? forfeit.reason : undefined}
            onMenu={toMenu}
            onPlayAgain={mode === 'ai' ? playAgain : undefined}
          />
        )}
      </LayoutGroup>
    </HoverCtx.Provider>
  );
}
