import { beforeEach, describe, expect, test } from "bun:test";
import {
	clearPromptSnooze,
	isPromptSnoozed,
	type PromptStorage,
	SNOOZE_DAYS,
	snoozePrompt,
} from "./notificationPrompt";

function memoryStorage(): PromptStorage {
	const map = new Map<string, string>();
	return {
		getItem: (key) => map.get(key) ?? null,
		setItem: (key, value) => {
			map.set(key, value);
		},
		removeItem: (key) => {
			map.delete(key);
		},
	};
}

describe("notification prompt snooze", () => {
	let storage: PromptStorage;
	const now = 1_000_000;
	const day = 24 * 60 * 60 * 1000;

	beforeEach(() => {
		storage = memoryStorage();
	});

	test("no snooze by default", () => {
		expect(isPromptSnoozed(now, storage)).toBe(false);
	});

	test("snooze suppresses within the window and expires after", () => {
		snoozePrompt(now, storage);
		expect(isPromptSnoozed(now + day, storage)).toBe(true);
		expect(isPromptSnoozed(now + SNOOZE_DAYS * day - 1, storage)).toBe(true);
		expect(isPromptSnoozed(now + SNOOZE_DAYS * day + 1, storage)).toBe(false);
	});

	test("clear removes the snooze", () => {
		snoozePrompt(now, storage);
		clearPromptSnooze(storage);
		expect(isPromptSnoozed(now + day, storage)).toBe(false);
	});
});
