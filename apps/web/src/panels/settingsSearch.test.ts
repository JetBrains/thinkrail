import { describe, expect, test } from "bun:test";
import { FONTS_PROTOCOL_VERSION, PROTOCOL_VERSION } from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import { SettingsSection } from "@/store";
import type { SettingsCatalogContext } from "./settingsCatalog";
import { settingsNavGroups } from "./settingsNav";
import {
	type SettingsSearchEntry,
	searchSettings,
	settingsSearchEntries,
	settingsSectionLabels,
} from "./settingsSearch";

const LATEST: SettingsCatalogContext = {
	protocolVersion: PROTOCOL_VERSION,
	hasWorkspace: true,
	hostPlatform: "win32",
	signedInProviders: true,
	voiceFiles: true,
	survey: true,
};

const groups = (hasUpdates = true, protocolVersion: number | null = PROTOCOL_VERSION) =>
	settingsNavGroups(protocolVersion, hasUpdates);

const labels = settingsSectionLabels(t, groups());

const ids = (query: string, entries: readonly SettingsSearchEntry[]) =>
	searchSettings(query, entries, labels).map((result) => result.entry.id);

const entry = (
	id: string,
	section: SettingsSection,
	label: string,
	extra: Partial<SettingsSearchEntry> = {},
): SettingsSearchEntry => ({ id, section, label, ...extra });

describe("Settings search", () => {
	test("a label match outranks a description or keyword match", () => {
		const entries = [
			entry("theme", SettingsSection.Appearance, "Theme", { description: "Fonts follow it" }),
			entry("tags", SettingsSection.Chat, "Tags", { keywords: ["font"] }),
			entry("code-font", SettingsSection.Text, "Code font"),
			entry("font-size", SettingsSection.Appearance, "Font size"),
		];
		const ranked = ids("font", entries);
		expect(ranked.slice(0, 2)).toEqual(["font-size", "code-font"]);
		expect(ranked.slice(2).sort()).toEqual(["tags", "theme"]);
		expect(ids("   ", entries)).toEqual([]);
	});

	test("equal matches keep the nav order, then the catalog order", () => {
		const entries = [
			entry("text-width", SettingsSection.Text, "Width"),
			entry("models-width", SettingsSection.Models, "Width"),
			entry("text-width-2", SettingsSection.Text, "Width"),
		];
		expect(ids("width", entries)).toEqual(["models-width", "text-width", "text-width-2"]);
	});

	test("the section name is a secondary field and is highlighted as the breadcrumb", () => {
		const entries = [
			entry("message-order", SettingsSection.Chat, "Message order"),
			entry("chat-line-width", SettingsSection.Text, "Chat line width"),
		];
		const [first, second] = searchSettings("chat", entries, labels);
		expect(first?.entry.id).toBe("chat-line-width");
		expect(first?.ranges.label).toEqual([[0, 4]]);
		expect(second?.entry.id).toBe("message-order");
		expect(second?.sectionLabel).toBe("Chat");
		expect(second?.ranges).toEqual({ section: [[0, 4]] });
	});

	test("every term must match somewhere, across fields", () => {
		const entries = [entry("chat-line-width", SettingsSection.Text, "Chat line width")];
		expect(ids("text width", entries)).toEqual(["chat-line-width"]);
		expect(ids("text height", entries)).toEqual([]);
	});

	test("catalog entries a host, workspace or platform does not offer are hidden", () => {
		const all = settingsSearchEntries(t, groups(), LATEST).map((item) => item.id);
		expect(all).toContain("windows-shell");
		expect(all).toContain("mcp-project-servers");
		expect(all).toContain("software-updates");
		expect(all).toContain("feedback-survey");

		const elsewhere = settingsSearchEntries(t, groups(false), {
			...LATEST,
			hasWorkspace: false,
			hostPlatform: "darwin",
		}).map((item) => item.id);
		expect(elsewhere).not.toContain("windows-shell");
		expect(elsewhere).not.toContain("mcp-project-servers");
		expect(elsewhere).not.toContain("software-updates");

		const older = FONTS_PROTOCOL_VERSION - 1;
		const old = settingsSearchEntries(t, groups(true, older), {
			...LATEST,
			protocolVersion: older,
		});
		expect(old.some((item) => item.id === "interface-font")).toBe(false);
		expect(ids("Open search with double Shift", old)).toEqual(["double-shift"]);
	});

	test("entries are translated, and injected shortcut rows are searchable in a live section only", () => {
		const shortcut = entry("shortcut:palette.open", SettingsSection.Keyboard, "Open the palette", {
			keywords: ["shortcut"],
		});
		const stray = entry("shortcut:gone", SettingsSection.Updates, "Open the palette elsewhere");
		const entries = settingsSearchEntries(t, groups(false), LATEST, [shortcut, stray]);
		const lineWidth = entries.find((item) => item.id === "chat-line-width");
		expect(lineWidth?.label).toBe("Chat line width");
		expect(lineWidth?.section).toBe(SettingsSection.Text);
		const results = searchSettings(
			"open palette",
			entries,
			settingsSectionLabels(t, groups(false)),
		);
		expect(results.map((result) => result.entry.id)).toContain("shortcut:palette.open");
		expect(results.map((result) => result.entry.id)).not.toContain("shortcut:gone");
		expect(results.find((result) => result.entry === shortcut)?.sectionLabel).toBe("Keyboard");
	});
});
