import { expect, test } from "bun:test";
import { holdSettingsEscape, holdsSettingsEscape } from "./settingsEscape";

const at = (...ancestors: string[]) => ({
	closest: (selector: string) =>
		selector.split(", ").some((part) => ancestors.includes(part)) ? {} : null,
});

test("only the content and the search hold Esc; the nav, Close and the dialog itself let Radix close", () => {
	expect(holdsSettingsEscape(at("[data-settings-content]"))).toBe(true);
	expect(holdsSettingsEscape(at("[data-settings-search]"))).toBe(true);
	expect(holdsSettingsEscape(at("[data-settings-dialog]"))).toBe(false);
	expect(holdsSettingsEscape(null)).toBe(false);
});

test("a held press reads as prevented only until the listener returns, so element steps still see it clean", async () => {
	const event = new Event("keydown", { cancelable: true });
	holdSettingsEscape(event, at("[data-settings-content]"));
	expect(event.defaultPrevented).toBe(true);
	await Promise.resolve();
	expect(event.defaultPrevented).toBe(false);
	event.preventDefault();
	expect(event.defaultPrevented).toBe(true);
});

test("a press outside the content and the search is left to Radix", () => {
	const event = new Event("keydown", { cancelable: true });
	holdSettingsEscape(event, at("[data-settings-dialog]"));
	expect(event.defaultPrevented).toBe(false);
});
