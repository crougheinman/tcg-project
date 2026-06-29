import { create } from 'zustand';
import { createInitialState } from '../engine/state';
import { applyAction } from '../engine/reducer';
import type { Action, GameState, PlayerId } from '../engine/types';
import { deckById, randomDeck } from '../cards/decks';
import { aiShouldAct, pickAction } from '../ai/ai';
import type { MatchConnection } from '../net/match';

export type Mode = 'menu' | 'ai' | 'hotseat' | 'pvp';

interface Store {
  mode: Mode;
  game: GameState | null;
  myId: PlayerId; // side the local human controls
  aiId: PlayerId | null;
  net: MatchConnection | null;
  error: string | null;

  startAI: (deckId: string) => void;
  startHotseat: (deckA: string, deckB: string) => void;
  startPvp: (net: MatchConnection) => void;
  dispatch: (action: Action) => void; // local human action
  toMenu: () => void;
  clearError: () => void;
}

const AI_DELAY_MS = 600;

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

  return {
    mode: 'menu',
    game: null,
    myId: 'A',
    aiId: null,
    net: null,
    error: null,

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
      set({
        mode: 'pvp',
        myId: net.role,
        aiId: null,
        net,
        error: null,
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

    toMenu: () => {
      get().net?.leave();
      set({ mode: 'menu', game: null, net: null, aiId: null, error: null });
    },

    clearError: () => set({ error: null }),
  };
});
