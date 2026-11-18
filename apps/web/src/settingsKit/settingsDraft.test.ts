import { expect, test } from "bun:test";
import { escapeDraft, shouldCommitDraft } from "./settingsDraft";

test("Esc reverts a dirty draft and says it handled the key", () => {
	expect(escapeDraft("90", "80")).toEqual({ next: "80", reverted: true });
	expect(escapeDraft("", "80")).toEqual({ next: "80", reverted: true });
});

test("Esc in a clean field is left for the next step", () => {
	expect(escapeDraft("80", "80")).toEqual({ next: "80", reverted: false });
});

test("a draft commits once, only when valid and different from what the host holds", () => {
	const draft = { draft: "90", invalid: false, submitted: null, authoritative: "80" };
	expect(shouldCommitDraft(draft)).toBe(true);
	expect(shouldCommitDraft({ ...draft, invalid: true })).toBe(false);
	expect(shouldCommitDraft({ ...draft, submitted: "90" })).toBe(false);
	expect(shouldCommitDraft({ ...draft, authoritative: "90" })).toBe(false);
});
