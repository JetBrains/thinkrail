import { describe, it, expect, beforeEach } from "vitest";
import { useAnswerDraftStore } from "@/store/answerDraftStore.ts";

describe("answerDraftStore", () => {
  beforeEach(() => useAnswerDraftStore.setState({ drafts: new Map() }));

  it("returns undefined when no draft exists", () => {
    expect(useAnswerDraftStore.getState().getDraft("req-1")).toBeUndefined();
  });

  it("sets and gets a draft by requestId", () => {
    useAnswerDraftStore.getState().setDraft("req-1", "keychain");
    expect(useAnswerDraftStore.getState().getDraft("req-1")).toBe("keychain");
  });

  it("clears a draft", () => {
    useAnswerDraftStore.getState().setDraft("req-1", "x");
    useAnswerDraftStore.getState().clearDraft("req-1");
    expect(useAnswerDraftStore.getState().getDraft("req-1")).toBeUndefined();
  });
});
