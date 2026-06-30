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

  startAI: (deckId: string) => void;
  startHotseat: (deckA: string, deckB: string) => void;
  startPvp: (net: MatchConnection) => void;
  dispatch: (action: Action) => void; // local human action
  sendChat: (text: string) => void; // local human chat (PvP only)
  toMenu: () => void;
  clearError: () => void;
}

const AI_DELAY_MS = 600;
const BUBBLE_MS = 5000; // how long a chat bubble stays before fading
const noChat = (): Record<PlayerId, ChatBubble | null> => ({ A: null, B: null });

export const useGame = create<Store>((set, get) => {
  // Step the AI one action at a time so the human sees each move.
  function scheduleAi() {
    const st = get();
    if (st.mode !== 'ai' || !st.game || !st.aiId) return;
    if (!aiShouldAct(st.game, st.aiId)) return;
    setTimeout(() => {
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
    }, AI_DELAY_MS);
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

    startAI: (deckId) => {
      const seed = Math.floor(Math.random() * 0x7fffffff);
      set({
        mode: 'ai',
        myId: 'A',
        aiId: 'B',
        net: null,
        error: null,
        // AI plays a random deck from the pool.
        game: createInitialState(seed, deckById(deckId).cards, randomDeck().cards),
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
      set({
        mode: 'pvp',
        myId: net.role,
        aiId: null,
        net,
        error: null,
        chat: noChat(),
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

    toMenu: () => {
      get().net?.leave();
      set({ mode: 'menu', game: null, net: null, aiId: null, error: null, chat: noChat() });
    },

    clearError: () => set({ error: null }),
  };
});
