import { create } from "zustand";

interface InputDraftStore {
  drafts: Map<string, string>;
  getDraft: (sessionId: string) => string;
  setDraft: (sessionId: string, text: string) => void;
  clearDraft: (sessionId: string) => void;
}

export const useInputDraftStore = create<InputDraftStore>((set, get) => ({
  drafts: new Map(),
  getDraft: (sessionId) => get().drafts.get(sessionId) ?? "",
  setDraft: (sessionId, text) =>
    set((s) => {
      const next = new Map(s.drafts);
      next.set(sessionId, text);
      return { drafts: next };
    }),
  clearDraft: (sessionId) =>
    set((s) => {
      const next = new Map(s.drafts);
      next.delete(sessionId);
      return { drafts: next };
    }),
}));
