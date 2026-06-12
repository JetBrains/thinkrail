import { create } from "zustand";
import { STORAGE_PREFIX } from "@/constants/branding.ts";
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
      name: `${STORAGE_PREFIX}message-history`,
      partialize: (state) => ({ history: state.history }),
    },
  ),
);
