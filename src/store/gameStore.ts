import { create } from 'zustand';
import { createInitialState } from '../engine/state';
import { applyAction } from '../engine/reducer';
import type { Action, GameState, PlayerId } from '../engine/types';
import { deckById, randomDeck } from '../cards/decks';
import { aiShouldAct, pickAction } from '../ai/ai';
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

  startAI: (deckId: string, oppDeckId?: string) => void; // oppDeckId: pre-picked (face-off shows it)
  startHotseat: (deckA: string, deckB: string) => void;
  startPvp: (net: MatchConnection) => void;
  dispatch: (action: Action) => void; // local human action
  sendChat: (text: string) => void; // local human chat (PvP only)
  abortMatch: () => void; // local player forfeits (PvP tells the opponent) -> menu
  toMenu: () => void;
  clearError: () => void;
}

const AI_DELAY_MS = 600;
const AI_DELAY_GUIDED_MS = 1600; // guided mode: slower, so learners can read each move
const BUBBLE_MS = 5000; // how long a chat bubble stays before fading
const noChat = (): Record<PlayerId, ChatBubble | null> => ({ A: null, B: null });

export const useGame = create<Store>((set, get) => {
  // Step the AI one action at a time so the human sees each move.
  function scheduleAi() {
    const st = get();
    if (st.mode !== 'ai' || !st.game || !st.aiId) return;
    if (!aiShouldAct(st.game, st.aiId)) return;
    setTimeout(
      () => {
        const s = get();
        if (s.mode !== 'ai' || !s.game || !s.aiId || !aiShouldAct(s.game, s.aiId)) return;
        try {
          const next = applyAction(s.game, pickAction(s.game, s.aiId));
          set({ game: next });
        } catch (e) {
          set({ error: `AI error: ${(e as Error).message}` });
          return;
        }
        scheduleAi();
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
    guided: localStorage.getItem('guided') !== '0', // default ON
    setGuided: (v) => {
      localStorage.setItem('guided', v ? '1' : '0');
      set({ guided: v });
    },

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
        game: createInitialState(net.seed, deckById(net.deckA).cards, deckById(net.deckB).cards),
      });
    },

    dispatch: (action) => {
      const s = get();
      if (!s.game) return;
      let next: GameState;
      try {
        next = applyAction(s.game, action);
      } catch (e) {
        set({ error: (e as Error).message });
        return;
      }
      set({ game: next, error: null });
      if (s.mode === 'pvp' && s.net) s.net.sendAction(action);
      if (s.mode === 'ai') scheduleAi();
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
      set({ mode: 'menu', game: null, net: null, aiId: null, error: null, chat: noChat(), forfeit: null });
    },

    toMenu: () => {
      get().net?.leave();
      set({ mode: 'menu', game: null, net: null, aiId: null, error: null, chat: noChat(), forfeit: null });
    },

    clearError: () => set({ error: null }),
  };
});

// dev-only: expose the store on window for manual inspection / e2e checks.
// ponytail: DEV guard strips this from production builds.
if (import.meta.env.DEV) {
  (window as unknown as { __game?: typeof useGame }).__game = useGame;
}
