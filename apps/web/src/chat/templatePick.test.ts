import { expect, test } from "bun:test";
import { shouldApplyTemplatePick } from "./templatePick";

test("a current pick with an untouched draft applies", () => {
	expect(
		shouldApplyTemplatePick({
			generation: 1,
			latestGeneration: 1,
			draftAtPick: "/rev",
			currentDraft: "/rev",
		}),
	).toBe(true);
});

test("a delayed response is dropped once the user has typed a new draft", () => {
	expect(
		shouldApplyTemplatePick({
			generation: 1,
			latestGeneration: 1,
			draftAtPick: "/rev",
			currentDraft: "an entirely new draft the user typed meanwhile",
		}),
	).toBe(false);
});

test("out-of-order responses: only the newest pick applies, whatever order the responses land in", () => {
	expect(
		shouldApplyTemplatePick({
			generation: 2,
			latestGeneration: 2,
			draftAtPick: "/rev",
			currentDraft: "/rev",
		}),
	).toBe(true);
	expect(
		shouldApplyTemplatePick({
			generation: 1,
			latestGeneration: 2,
			draftAtPick: "/rev",
			currentDraft: "/rev",
		}),
	).toBe(false);
});
