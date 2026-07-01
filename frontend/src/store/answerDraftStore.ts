import { create } from "zustand";

/**
 * Draft text destined for a pending question's "Other" field, keyed by the
 * question's requestId. A discussion subsession launched from a question writes
 * its returned summary here; the QuestionCard for that requestId seeds its Other
 * field from it. `getDraft` returns undefined (not "") so callers can tell
 * "no draft" from an empty answer.
 */
interface AnswerDraftStore {
  drafts: Map<string, string>;
  getDraft: (requestId: string) => string | undefined;
  setDraft: (requestId: string, text: string) => void;
  clearDraft: (requestId: string) => void;
}

export const useAnswerDraftStore = create<AnswerDraftStore>((set, get) => ({
  drafts: new Map(),
  getDraft: (requestId) => get().drafts.get(requestId),
  setDraft: (requestId, text) =>
    set((s) => {
      const next = new Map(s.drafts);
      next.set(requestId, text);
      return { drafts: next };
    }),
  clearDraft: (requestId) =>
    set((s) => {
      const next = new Map(s.drafts);
      next.delete(requestId);
      return { drafts: next };
    }),
}));
