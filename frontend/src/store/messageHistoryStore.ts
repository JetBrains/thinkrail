import { create } from "zustand";
import { persist } from "zustand/middleware";

interface MessageHistoryStore {
  history: string[];
  addMessage: (text: string) => void;
}

const MAX_HISTORY = 50;

export const useMessageHistoryStore = create<MessageHistoryStore>()(
  persist(
    (set) => ({
      history: [],
      addMessage: (text) =>
        set((s) => ({
          history: [text, ...s.history.filter((m) => m !== text)].slice(0, MAX_HISTORY),
        })),
    }),
    {
      name: "bonsai-message-history",
      partialize: (state) => ({ history: state.history }),
    },
  ),
);
