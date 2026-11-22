import { create } from 'zustand';
import { createInitialState } from '../engine/state';
import { applyAction } from '../engine/reducer';
import type { Action, CardInstance, GameState, PlayerId, Target } from '../engine/types';
import { actorOf, blitzCue, isFlashCast } from '../engine/rules';
import { cuesFor } from '../audio/cues';
import { isMuted, playCues, setMuted as persistMuted } from '../audio/sfx';
import { deckById, randomDeck } from '../cards/decks';
import { resolveDeck } from '../cards/customDecks';
import { readDepth, saveDepth } from '../ui/depth';
import { combatHoldMs } from '../ui/firstStrike';
import { isIaijutsuOnHana } from '../ui/cinematics';
import { blockStepIsEmpty } from '../ui/phaseInfo';
import { getDef } from '../cards/cards';
import { aiShouldAct, pickAction } from '../ai/ai';
import {
  CAST_MS,
  CHARGE_MS,
  CHARGE_SPELLS,
  CUTIN_MS,
  CUTINS,
  FLASH_CUTINS,
  type CutInKind,
  HEAL_MS,
  HEAL_SPELLS,
  PHASE_PAUSE_MS,
  END_PAUSE_MS,
  SKILL_CREATURES,
  skillMs,
  SMOKE_MS,
  SMOKE_SPELLS,
  IAIJUTSU_MS,
} from '../ui/fxTiming';
import type { MatchConnection } from '../net/match';
import { rejoinMatch } from '../net/match';
import { clearMatch, loadMatch } from '../net/resume';

export type Mode = 'menu' | 'ai' | 'hotseat' | 'pvp';

/** A transient chat bubble shown over a player's avatar (PvP only). */
export interface ChatBubble {
  id: string;
  text: string;
}

interface Store {
  mode: Mode;
  game: GameState | null;
  myId: PlayerId; // side the local human controls
  aiId: PlayerId | null;
  net: MatchConnection | null;
  error: string | null;
  chat: Record<PlayerId, ChatBubble | null>; // current bubble per side (cosmetic)
  // PvP meta win: opponent left the match (aborted / disconnected). Kept out of the
  // deterministic GameState — it's a network outcome, not a rules outcome.
  forfeit: { winner: PlayerId; reason: string } | null;
  // Peer is out of contact but the match is still recoverable (a blip, a
  // backgrounded tab). Purely presentational — the engine is untouched, and the
  // transport resyncs by itself if the peer comes back.
  peerStale: boolean;
  // 3D table on/off. Presentation only — see ui/depth.ts for the default.
  depth: boolean;
  setDepth: (v: boolean) => void;
  // Sound on/off. Persisted; the synth itself is a no-op while muted.
  muted: boolean;
  setMuted: (v: boolean) => void;
  // Guided mode: contextual coach bubbles that teach the game. Persisted; ON by
  // default so newcomers get help immediately.
  guided: boolean;
  setGuided: (v: boolean) => void;
  // The deck pairing from the last vs-AI match, so "Play Again" can rematch with a
  // fresh shuffle without sending the player back through deck-select.
  lastAiDecks: { deck: string; oppDeck: string } | null;
  // A spell mid-telegraph: its castSorcery is deferred so BoardFx can play a lead-in
  // (a burn charge-up at the caster, or smoke at the target) while the target card
  // stays on the board — it resolves only when the telegraph finishes.
  //   kind 'charge' -> Cinderbolt/Scorch/Pyroblast charge orb at the caster.
  //   kind 'smoke'  -> Grasp/Withering smoke at the target, then debris/wither.
  charging: {
    casterId: PlayerId;
    def: string;
    kind: 'charge' | 'smoke' | 'heal' | 'cast';
    ms: number;
    target?: Target;
  } | null;
  // Cards currently floating in the cast spotlight (a spell or creature skill being cast).
  // Purely visual; in PvP they play WITHOUT delaying the effect (lockstep timing).
  spotlights: Spotlight[];
  pushSpotlight: (s: Omit<Spotlight, 'id' | 'at'>) => void;

  startAI: (deckId: string, oppDeckId?: string) => void; // oppDeckId: pre-picked (face-off shows it)
  startHotseat: (deckA: string, deckB: string) => void;
  startPvp: (net: MatchConnection) => void;
  /** Rejoin the match this tab was playing before a reload. No-op if there is none. */
  resumePvp: () => void;
  dispatch: (action: Action) => void; // local human action
  sendChat: (text: string) => void; // local human chat (PvP only)
  abortMatch: () => void; // local player forfeits (PvP tells the opponent) -> menu
  playAgain: () => void; // vs AI only: rematch with the same decks, fresh shuffle
  toMenu: () => void;
  clearError: () => void;
}

const AI_DELAY_MS = 600;
const AI_DELAY_GUIDED_MS = 1600; // guided mode: slower, so learners can read each move
const BUBBLE_MS = 5000; // how long a chat bubble stays before fading
const noChat = (): Record<PlayerId, ChatBubble | null> => ({ A: null, B: null });

export interface Spotlight {
  id: number;
  card: CardInstance;
  ownerId: PlayerId;
  label: string;
  ms: number;
  /** This cast is an ultimate: its face cuts in across the screen (CutIn). */
  cutIn?: CutInKind;
  /** A full-screen film instead of the floating card (Iaijutsu Strike on Hana). */
  cinematic?: 'iaijutsu';
  /** When it went up (Date.now()), so a later effect can wait out what is left of it. Set by pushSpotlight. */
  at: number;
}

/** A card the player can cast right now by id: from the hand, or from the graveyard (flashback). */
function castableCard(p: GameState['players'][PlayerId], iid: string): CardInstance | undefined {
  return p.hand.find((c) => c.iid === iid) ?? p.graveyard.find((c) => c.iid === iid);
}

export const useGame = create<Store>((set, get) => {
  // Should this cast telegraph (delay its resolution so BoardFx can play a lead-in)?
  // Returns the telegraph descriptor, else null. PvP is excluded (desyncs timing).
  type Telegraph = { casterId: PlayerId; def: string; kind: 'charge' | 'smoke' | 'heal' | 'cast'; ms: number; target?: Target };
  function telegraphFor(g: GameState, action: Action): Telegraph | null {
    if (action.type !== 'castSorcery' && action.type !== 'castCreature') return null;
    // instants can be cast off-turn while blocking -> caster is whoever may act now
    const casterId = actorOf(g);
    const card = castableCard(g.players[casterId], action.iid);
    if (!card) return null;
    const blitz = blitzCue(g.players[casterId], card);
    if (action.type === 'castCreature') {
      // Beast Blitz: only when Kunoichi and a beast meet (she enters with a beast out, or a beast enters
      // with her out); on her own she is a plain creature. Other skills fire the moment they are cast.
      if (blitz) return { casterId, def: card.def, kind: 'cast', ms: CUTIN_MS };
      if (isFlashCast(g, card) && FLASH_CUTINS[card.def]) return { casterId, def: card.def, kind: 'cast', ms: CUTIN_MS };
      const skill = SKILL_CREATURES[card.def];
      return skill && skill !== 'Beast Blitz' ? { casterId, def: card.def, kind: 'cast', ms: skillMs(skill) } : null;
    }
    if (CHARGE_SPELLS.has(card.def) && getDef(card.def).effect?.type === 'damage')
      return { casterId, def: card.def, kind: 'charge', ms: CHARGE_MS };
    if (SMOKE_SPELLS.has(card.def))
      return { casterId, def: card.def, kind: 'smoke', ms: SMOKE_MS, target: action.target };
    if (HEAL_SPELLS.has(card.def))
      return { casterId, def: card.def, kind: 'heal', ms: HEAL_MS[card.def] ?? 2000 };
    // Iaijutsu Strike on Hana: the blackout film plays first, then the spell resolves
    if (isIaijutsuOnHana(g, action, card)) return { casterId, def: card.def, kind: 'cast', ms: IAIJUTSU_MS };
    // every other sorcery/instant: a plain spotlight window, no extra effect
    return { casterId, def: card.def, kind: 'cast', ms: blitz ? CUTIN_MS : CAST_MS };
  }

  // The card to float in the spotlight for this action, read BEFORE the action is applied
  // (the card leaves the hand). Null for actions that have no cast moment.
  function spotlightFor(g: GameState, action: Action, ms: number): Omit<Spotlight, 'id' | 'at'> | null {
    if (action.type !== 'castSorcery' && action.type !== 'castCreature') return null;
    const casterId = actorOf(g);
    const card = castableCard(g.players[casterId], action.iid);
    if (!card) return null;
    const blitz = blitzCue(g.players[casterId], card);
    if (action.type === 'castCreature') {
      // Beast Blitz features Kunoichi (the one entering, or the one already out when a beast arrives)
      if (blitz) return { card: blitz.show, ownerId: casterId, label: '✦ Beast Blitz', ms: Math.max(ms, CUTIN_MS), cutIn: 'blitz' };
      if (isFlashCast(g, card) && FLASH_CUTINS[card.def])
        return { card, ownerId: casterId, label: '✦ Flash', ms: Math.max(ms, CUTIN_MS), cutIn: FLASH_CUTINS[card.def] };
      const skill = SKILL_CREATURES[card.def];
      return skill && skill !== 'Beast Blitz'
        ? { card, ownerId: casterId, label: `✦ ${skill}`, ms: Math.max(ms, skillMs(skill)), ...(CUTINS[skill] ? { cutIn: CUTINS[skill] } : {}) }
        : null;
    }
    if (isIaijutsuOnHana(g, action, card)) {
      return { card, ownerId: casterId, label: 'Iaijutsu', ms: IAIJUTSU_MS, cinematic: 'iaijutsu' };
    }
    return {
      card,
      ownerId: casterId,
      label: getDef(card.def).type === 'instant' ? 'Instant' : 'Casting',
      ms: blitz ? Math.max(ms, CUTIN_MS) : ms,
      ...(blitz ? { cutIn: 'blitz' as const } : {}),
    };
  }

  /** How long the AI waits after a phase or turn change so its banner can be read: none when no banner is shown (an empty block step). */
  function phasePauseMs(prev: GameState, next: GameState): number {
    if (next.phase === prev.phase && next.active === prev.active) return 0;
    if (blockStepIsEmpty(next)) return 0;
    return next.phase === 'end' ? END_PAUSE_MS : PHASE_PAUSE_MS;
  }

  let spotSeq = 0;
  function pushSpotlight(sp: Omit<Spotlight, 'id' | 'at'>) {
    const id = ++spotSeq;
    set((st) => ({ spotlights: [...st.spotlights, { ...sp, id, at: Date.now() }] }));
    setTimeout(() => set((st) => ({ spotlights: st.spotlights.filter((x) => x.id !== id) })), sp.ms);
  }

  // Step the AI one action at a time so the human sees each move.
  // `pauseMs`: extra wait after a phase/turn change, so the phase banner has time to play.
  function scheduleAi(pauseMs = 0) {
    const st = get();
    if (st.mode !== 'ai' || !st.game || !st.aiId || st.charging) return;
    if (!aiShouldAct(st.game, st.aiId)) return;
    setTimeout(
      () => {
        const s = get();
        if (s.mode !== 'ai' || !s.game || !s.aiId || s.charging || !aiShouldAct(s.game, s.aiId))
          return;
        const action = pickAction(s.game, s.aiId);
        const tel = telegraphFor(s.game, action);
        const applyAi = () => {
          const cur = get();
          if (cur.mode !== 'ai' || !cur.game) return;
          let pause = 0;
          try {
            const next = applyAction(cur.game, action);
            sfx(action, cur.game, next);
            pause = phasePauseMs(cur.game, next);
            pause += combatHoldMs(cur.game, next); // let the clash and its banner play out
            set({ game: next, charging: null });
          } catch (e) {
            set({ error: `AI error: ${(e as Error).message}`, charging: null });
            return;
          }
          scheduleAi(pause);
        };
        if (tel) {
          const spot = spotlightFor(s.game, action, tel.ms);
          set({ charging: tel }); // telegraph, then resolve
          if (spot) pushSpotlight(spot);
          setTimeout(applyAi, tel.ms);
        } else {
          applyAi();
        }
      },
      (st.guided ? AI_DELAY_GUIDED_MS : AI_DELAY_MS) + pauseMs,
    );
  }

  // Sound effects hang off the apply path rather than the UI, so local, AI and
  // peer actions all sound identical and BoardFx stays a pure visual layer.
  // (The store is already the only place in the app with side effects.)
  function sfx(action: Action, before: GameState, after: GameState) {
    playCues(cuesFor(action, before, after, get().myId));
  }

  // Show a chat bubble over `side`, replacing any current one. Auto-clears after
  // BUBBLE_MS, but only if a newer message hasn't taken its place (id guard).
  function showBubble(side: PlayerId, text: string) {
    const clean = text.trim().slice(0, 120);
    if (!clean) return;
    const id = `${side}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set((s) => ({ chat: { ...s.chat, [side]: { id, text: clean } } }));
    setTimeout(() => {
      set((s) => (s.chat[side]?.id === id ? { chat: { ...s.chat, [side]: null } } : s));
    }, BUBBLE_MS);
  }

  return {
    mode: 'menu',
    game: null,
    myId: 'A',
    aiId: null,
    net: null,
    error: null,
    chat: noChat(),
    forfeit: null,
    charging: null,
    spotlights: [],
    pushSpotlight,
    peerStale: false,
    depth: readDepth(),
    setDepth: (v) => {
      saveDepth(v);
      set({ depth: v });
    },
    muted: isMuted(),
    setMuted: (v) => {
      persistMuted(v);
      set({ muted: v });
    },
    guided: localStorage.getItem('guided') !== '0', // default ON
    setGuided: (v) => {
      localStorage.setItem('guided', v ? '1' : '0');
      set({ guided: v });
    },
    lastAiDecks: null,

    startAI: (deckId, oppDeckId) => {
      const seed = Math.floor(Math.random() * 0x7fffffff);
      // AI plays the pre-picked deck (shown in the face-off), else a random one.
      const aiDeck = oppDeckId ? resolveDeck(oppDeckId) : randomDeck();
      set({
        mode: 'ai',
        myId: 'A',
        aiId: 'B',
        net: null,
        error: null,
        forfeit: null,
        charging: null,
        spotlights: [],
        lastAiDecks: { deck: deckId, oppDeck: aiDeck.id },
        game: createInitialState(seed, resolveDeck(deckId).cards, aiDeck.cards, { mulligan: true }),
      });
      scheduleAi(); // in case AI ever goes first (it doesn't on turn 1, but safe)
    },

    startHotseat: (deckA, deckB) => {
      const seed = Math.floor(Math.random() * 0x7fffffff);
      set({
        mode: 'hotseat',
        myId: 'A',
        aiId: null,
        net: null,
        error: null,
        forfeit: null,
        charging: null,
        spotlights: [],
        game: createInitialState(seed, resolveDeck(deckA).cards, resolveDeck(deckB).cards, { mulligan: true }),
      });
    },

    startPvp: (net) => {
      // Rebuild the match. For a fresh game initialLog is empty; for a rejoin it
      // is the saved action stream, and replaying it through the same seeded
      // engine lands byte-identical to where this client left off.
      let game: GameState;
      try {
        game = createInitialState(net.seed, deckById(net.deckA).cards, deckById(net.deckB).cards, { mulligan: true });
        for (const a of net.initialLog) game = applyAction(game, a);
      } catch (e) {
        // A log that will not replay is a corrupt record, not a playable match.
        clearMatch();
        net.leave();
        set({ mode: 'menu', game: null, net: null, error: `could not restore match: ${(e as Error).message}` });
        return;
      }

      net.onAction((action) => {
        const s = get();
        if (!s.game) return;
        try {
          const spot = spotlightFor(s.game, action, CAST_MS); // the opponent's cast, floated alongside
          const next = applyAction(s.game, action);
          sfx(action, s.game, next);
          if (next.winner) clearMatch(); // finished — nothing left to reconnect to
          set({ game: next });
          if (spot) pushSpotlight(spot);
        } catch (e) {
          set({ error: `desync: ${(e as Error).message}` });
        }
      });
      net.onPeerStatus((st) => set({ peerStale: st === 'stale' }));
      net.onChat((m) => showBubble(m.from, m.text)); // opponent message -> their avatar
      // Opponent left the match: declare the local player the winner, with the reason.
      net.onGone((reason) => {
        const s = get();
        if (s.mode !== 'pvp' || s.game?.winner || s.forfeit) return; // already decided
        const winner = s.myId;
        const why =
          reason === 'aborted' ? 'Your opponent aborted the match.' : 'Your opponent disconnected.';
        set({ forfeit: { winner, reason: why }, peerStale: false }); // terminal — stop the "reconnecting" banner
      });
      set({
        mode: 'pvp',
        myId: net.role,
        aiId: null,
        net,
        error: null,
        chat: noChat(),
        forfeit: null,
        charging: null,
        spotlights: [],
        peerStale: false,
        game,
      });
    },

    resumePvp: () => {
      const saved = loadMatch();
      if (!saved) return;
      try {
        rejoinMatch(saved, (conn) => get().startPvp(conn));
      } catch (e) {
        clearMatch();
        set({ error: (e as Error).message });
      }
    },

    dispatch: (action) => {
      const s = get();
      if (!s.game || s.charging) return; // ignore input while a spell is telegraphing
      // Only the legal actor may ORIGINATE an action.
      //  - PvP lockstep: the transport stamps each action with one shared seq counter, so
      //    if the non-actor client also originates one both sides stamp the same seq and
      //    each drops the other's copy as "already applied" -> silent divergence.
      //  - vs AI: the human's dispatch must never move the AI's turn along (skipping its
      //    main phase, say). The AI applies its own moves directly, not through here.
      // Hotseat is exempt: one person legitimately drives both sides.
      // Enforce it here, at the only place local input enters.
      if ((s.mode === 'pvp' || s.mode === 'ai') && s.myId !== actorOf(s.game)) return;
      const tel = s.mode !== 'pvp' ? telegraphFor(s.game, action) : null;
      const apply = () => {
        const cur = get();
        if (!cur.game) return;
        let next: GameState;
        try {
          next = applyAction(cur.game, action);
        } catch (e) {
          set({ error: (e as Error).message, charging: null });
          return;
        }
        sfx(action, cur.game, next);
        set({ game: next, error: null, charging: null });
        if (next.winner) clearMatch(); // finished — nothing left to reconnect to
        if (cur.mode === 'pvp' && cur.net) cur.net.sendAction(action);
        if (cur.mode === 'ai')
          scheduleAi(
            phasePauseMs(cur.game, next) + combatHoldMs(cur.game, next),
          );
      };
      if (tel) {
        // Telegraph first (charge orb at caster, or smoke at the target — the target
        // card stays on the board), THEN resolve so the payoff lands with the visual.
        const spot = spotlightFor(s.game, action, tel.ms);
        set({ charging: tel });
        if (spot) pushSpotlight(spot);
        setTimeout(apply, tel.ms);
      } else {
        // PvP can't delay (both clients apply on arrival), so the spotlight plays alongside.
        const spot = s.mode === 'pvp' ? spotlightFor(s.game, action, CAST_MS) : null;
        apply();
        if (spot) pushSpotlight(spot);
      }
    },

    sendChat: (text) => {
      const s = get();
      if (s.mode !== 'pvp' || !s.net) return; // PvP only
      const clean = text.trim();
      if (!clean) return;
      showBubble(s.myId, clean); // local echo (self:false won't bounce it back)
      s.net.sendChat(clean);
    },

    abortMatch: () => {
      const s = get();
      if (s.mode === 'pvp' && s.net) {
        s.net.sendAbort(); // tell the opponent before tearing down
        const net = s.net;
        setTimeout(() => net.leave(), 200); // let the forfeit packet flush first
      } else {
        s.net?.leave();
      }
      clearMatch(); // deliberately leaving — don't offer to reconnect
      set({ mode: 'menu', game: null, net: null, aiId: null, error: null, chat: noChat(), forfeit: null, charging: null, spotlights: [], peerStale: false });
    },

    playAgain: () => {
      const s = get();
      if (s.mode !== 'ai' || !s.lastAiDecks) return;
      s.startAI(s.lastAiDecks.deck, s.lastAiDecks.oppDeck);
    },

    toMenu: () => {
      get().net?.leave();
      clearMatch(); // deliberately leaving — don't offer to reconnect
      set({ mode: 'menu', game: null, net: null, aiId: null, error: null, chat: noChat(), forfeit: null, charging: null, spotlights: [], peerStale: false });
    },

    clearError: () => set({ error: null }),
  };
});

// dev-only: expose the store on window for manual inspection / e2e checks.
// ponytail: DEV guard strips this from production builds.
if (import.meta.env.DEV) {
  (window as unknown as { __game?: typeof useGame }).__game = useGame;
}
