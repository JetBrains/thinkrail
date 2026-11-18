import { expect, test } from "bun:test";
import { EN } from "@thinkrail/locales";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { configResetPatch, isConfigDefault } from "./settingDefaults";
import { idleDescription, toChoice, WorkspacesSettingsView } from "./WorkspacesSettings";

const view = (settleIdleDays: number | null, changed = false) =>
	renderToStaticMarkup(
		createElement(WorkspacesSettingsView, {
			settleIdleDays,
			supported: true,
			reset: { changed, onReset: () => {} },
			onSelect: () => {},
		}),
	);

const text = (key: keyof typeof EN) => String(EN[key]).replaceAll("'", "&#x27;");

test("a valid non-preset settle window is not displayed as the default preset", () => {
	expect(toChoice(null)).toBe("never");
	expect(toChoice(3)).toBe("3");
	expect(toChoice(30)).toBe("30");
	expect(view(30)).not.toContain('aria-selected="true"');
	expect(view(30)).toContain("30 days");
});

test("the settle window is an expensive choice of option buttons, not radios", () => {
	const markup = view(7);
	expect(markup).toContain('role="listbox"');
	expect(markup).toContain('data-cost="expensive"');
	expect(markup).toContain(`aria-label="${EN["settings.workspaces.title"]}"`);
	expect(markup.match(/role="option"/g)).toHaveLength(5);
	expect(markup).toMatch(/<button[^>]*aria-selected="true"[^>]*data-testid="settle-idle-7"/);
	expect(markup).not.toContain('type="radio"');
	expect(markup).toContain('data-setting-id="settle-idle"');
});

test("the row describes the selected option, and the pending option while it waits for Enter", () => {
	expect(view(7)).toContain(text("settings.workspaces.idle.sevenDays"));
	expect(view(7)).not.toContain(text("settings.workspaces.idle.never"));
	expect(view(null)).toContain(text("settings.workspaces.idle.never"));
	expect(idleDescription(null, "7")).toBe("settings.workspaces.idle.sevenDays");
	expect(idleDescription("14", "7")).toBe("settings.workspaces.idle.fourteenDays");
	expect(idleDescription(null, "30")).toBeNull();
});

test("Reset puts back 7 days, because null means Never", () => {
	expect(configResetPatch("settleIdleDays")).toEqual({ settleIdleDays: 7 });
	expect(isConfigDefault("settleIdleDays", 7)).toBe(true);
	expect(isConfigDefault("settleIdleDays", null)).toBe(false);
	expect(view(14, true)).toContain('data-testid="settings-reset-settle-idle"');
	expect(view(7)).not.toContain("settings-reset-settle-idle");
});
