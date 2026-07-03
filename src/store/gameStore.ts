import { create } from 'zustand';
import { createInitialState } from '../engine/state';
import { applyAction } from '../engine/reducer';
import type { Action, GameState, PlayerId, Target } from '../engine/types';
import { opponentOf } from '../engine/types';
import { deckById, randomDeck } from '../cards/decks';
import { getDef } from '../cards/cards';
import { aiShouldAct, pickAction } from '../ai/ai';
import { CHARGE_MS, CHARGE_SPELLS, HEAL_MS, HEAL_SPELLS, SMOKE_MS, SMOKE_SPELLS } from '../ui/spellTiming';
import type { MatchConnection } from '../net/match';

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
    kind: 'charge' | 'smoke' | 'heal';
    ms: number;
    target?: Target;
  } | null;

  startAI: (deckId: string, oppDeckId?: string) => void; // oppDeckId: pre-picked (face-off shows it)
  startHotseat: (deckA: string, deckB: string) => void;
  startPvp: (net: MatchConnection) => void;
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

export const useGame = create<Store>((set, get) => {
  // Should this cast telegraph (delay its resolution so BoardFx can play a lead-in)?
  // Returns the telegraph descriptor, else null. PvP is excluded (desyncs timing).
  type Telegraph = { casterId: PlayerId; def: string; kind: 'charge' | 'smoke' | 'heal'; ms: number; target?: Target };
  function telegraphFor(g: GameState, action: Action): Telegraph | null {
    if (action.type !== 'castSorcery') return null;
    // instants can be cast off-turn while blocking -> caster derives from the phase
    const casterId = g.phase === 'combat_block' ? opponentOf(g.active) : g.active;
    const card = g.players[casterId].hand.find((c) => c.iid === action.iid);
    if (!card) return null;
    if (CHARGE_SPELLS.has(card.def) && getDef(card.def).effect?.type === 'damage')
      return { casterId, def: card.def, kind: 'charge', ms: CHARGE_MS };
    if (SMOKE_SPELLS.has(card.def))
      return { casterId, def: card.def, kind: 'smoke', ms: SMOKE_MS, target: action.target };
    if (HEAL_SPELLS.has(card.def))
      return { casterId, def: card.def, kind: 'heal', ms: HEAL_MS[card.def] ?? 2000 };
    return null;
  }

  // Step the AI one action at a time so the human sees each move.
  function scheduleAi() {
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
          try {
            set({ game: applyAction(cur.game, action), charging: null });
          } catch (e) {
            set({ error: `AI error: ${(e as Error).message}`, charging: null });
            return;
          }
          scheduleAi();
        };
        if (tel) {
          set({ charging: tel }); // telegraph, then resolve
          setTimeout(applyAi, tel.ms);
        } else {
          applyAi();
        }
      },
      st.guided ? AI_DELAY_GUIDED_MS : AI_DELAY_MS,
    );
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
    guided: localStorage.getItem('guided') !== '0', // default ON
    setGuided: (v) => {
      localStorage.setItem('guided', v ? '1' : '0');
      set({ guided: v });
    },
    lastAiDecks: null,

    startAI: (deckId, oppDeckId) => {
      const seed = Math.floor(Math.random() * 0x7fffffff);
      // AI plays the pre-picked deck (shown in the face-off), else a random one.
      const aiDeck = oppDeckId ? deckById(oppDeckId) : randomDeck();
      set({
        mode: 'ai',
        myId: 'A',
        aiId: 'B',
        net: null,
        error: null,
        forfeit: null,
        charging: null,
        lastAiDecks: { deck: deckId, oppDeck: aiDeck.id },
        game: createInitialState(seed, deckById(deckId).cards, aiDeck.cards),
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
        game: createInitialState(seed, deckById(deckA).cards, deckById(deckB).cards),
      });
    },

    startPvp: (net) => {
      net.onAction((action) => {
        const s = get();
        if (!s.game) return;
        try {
          set({ game: applyAction(s.game, action) });
        } catch (e) {
          set({ error: `desync: ${(e as Error).message}` });
        }
      });
      net.onChat((m) => showBubble(m.from, m.text)); // opponent message -> their avatar
      // Opponent left the match: declare the local player the winner, with the reason.
      net.onGone((reason) => {
        const s = get();
        if (s.mode !== 'pvp' || s.game?.winner || s.forfeit) return; // already decided
        const winner = s.myId;
        const why =
          reason === 'aborted' ? 'Your opponent aborted the match.' : 'Your opponent disconnected.';
        set({ forfeit: { winner, reason: why } });
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
        game: createInitialState(net.seed, deckById(net.deckA).cards, deckById(net.deckB).cards),
      });
    },

    dispatch: (action) => {
      const s = get();
      if (!s.game || s.charging) return; // ignore input while a spell is telegraphing
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
        set({ game: next, error: null, charging: null });
        if (cur.mode === 'pvp' && cur.net) cur.net.sendAction(action);
        if (cur.mode === 'ai') scheduleAi();
      };
      if (tel) {
        // Telegraph first (charge orb at caster, or smoke at the target — the target
        // card stays on the board), THEN resolve so the payoff lands with the visual.
        set({ charging: tel });
        setTimeout(apply, tel.ms);
      } else {
        apply();
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
      set({ mode: 'menu', game: null, net: null, aiId: null, error: null, chat: noChat(), forfeit: null, charging: null });
    },

    playAgain: () => {
      const s = get();
      if (s.mode !== 'ai' || !s.lastAiDecks) return;
      s.startAI(s.lastAiDecks.deck, s.lastAiDecks.oppDeck);
    },

    toMenu: () => {
      get().net?.leave();
      set({ mode: 'menu', game: null, net: null, aiId: null, error: null, chat: noChat(), forfeit: null, charging: null });
    },

    clearError: () => set({ error: null }),
  };
});

// dev-only: expose the store on window for manual inspection / e2e checks.
// ponytail: DEV guard strips this from production builds.
if (import.meta.env.DEV) {
  (window as unknown as { __game?: typeof useGame }).__game = useGame;
}
