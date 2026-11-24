import { describe, expect, test } from "bun:test";
import {
	FONTS_PROTOCOL_VERSION,
	MCP_USER_SERVERS_PROTOCOL_VERSION,
	PROTOCOL_VERSION,
	TERMINAL_COPY_ON_SELECT_PROTOCOL_VERSION,
	WINDOWS_SHELL_SETTINGS_PROTOCOL_VERSION,
} from "@thinkrail/contracts";
import { EN } from "@thinkrail/locales";
import { t } from "@thinkrail/locales/react";
import { SettingsSection } from "@/store";
import {
	availableSettings,
	SETTING,
	SETTINGS_CATALOG,
	type SettingsCatalogContext,
	settingProps,
} from "./settingsCatalog";
import { settingsNavGroups } from "./settingsNav";

const LATEST: SettingsCatalogContext = {
	protocolVersion: PROTOCOL_VERSION,
	hasWorkspace: true,
	hostPlatform: "darwin",
	signedInProviders: true,
	voiceFiles: true,
	survey: true,
};

const ids = (context: SettingsCatalogContext, hasUpdates = true) =>
	availableSettings(settingsNavGroups(context.protocolVersion, hasUpdates), context).map(
		(entry) => entry.id,
	);

describe("the settings catalog", () => {
	test("labels and descriptions take no interpolation values, since search renders them bare", () => {
		for (const setting of Object.values(SETTING)) {
			for (const key of [
				setting.label,
				"description" in setting ? setting.description : undefined,
			]) {
				if (key !== undefined) expect(EN[key]).not.toContain("{{");
			}
		}
	});

	test("ids are unique and never a section id, so palette rows stay apart", () => {
		const all = SETTINGS_CATALOG.map((entry) => entry.id);
		expect(new Set(all).size).toBe(all.length);
		const sections = new Set<string>(Object.values(SettingsSection));
		expect(all.filter((id) => sections.has(id))).toEqual([]);
		expect(all.every((id) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(id))).toBe(true);
		expect(SETTING.doubleShift.id).toBe("double-shift");
	});

	test("every entry lives in a live section", () => {
		const live = new Set<SettingsSection>([
			SettingsSection.Feedback,
			...settingsNavGroups(Number.MAX_SAFE_INTEGER, true).flatMap((group) =>
				group.sections.map((section) => section.id),
			),
		]);
		expect(SETTINGS_CATALOG.filter((entry) => !live.has(entry.section))).toEqual([]);
		for (const section of live) {
			expect([section, SETTINGS_CATALOG.some((entry) => entry.section === section)]).toEqual([
				section,
				true,
			]);
		}
	});

	test("every label and description is an English key", () => {
		const keys = SETTINGS_CATALOG.flatMap((entry) =>
			entry.description === undefined ? [entry.label] : [entry.label, entry.description],
		);
		expect(keys.filter((key) => !Object.hasOwn(EN, key))).toEqual([]);
	});

	test("settingProps gives a row its id, label and description from the catalog", () => {
		expect(settingProps(t, SETTING.chatLineWidth)).toEqual({
			settingId: "chat-line-width",
			label: "Chat line width",
			description: "Maximum characters per line in chat.",
		});
		expect(settingProps(t, SETTING.apiKeyProviders).description).toBeUndefined();
	});
});

describe("availableSettings", () => {
	test("copy on select appears in search only on capable hosts, on every platform", () => {
		for (const hostPlatform of ["darwin", "linux", "win32"] as const) {
			expect(ids({ ...LATEST, hostPlatform })).toContain("terminal-copy-on-select");
		}
		for (const protocolVersion of [null, TERMINAL_COPY_ON_SELECT_PROTOCOL_VERSION - 1]) {
			expect(ids({ ...LATEST, protocolVersion })).not.toContain("terminal-copy-on-select");
		}
	});
	test("a current host in a workspace offers every entry except other platforms' ones", () => {
		const available = ids(LATEST);
		expect(available).toContain("chat-model");
		expect(available).toContain("subagents-workspace");
		expect(available).toContain("feedback-survey");
		expect(available).not.toContain("windows-shell");
		expect(ids({ ...LATEST, hostPlatform: "win32" })).toContain("windows-shell");
	});

	test("an entry follows its section's gate and then its own", () => {
		const old = { ...LATEST, protocolVersion: FONTS_PROTOCOL_VERSION - 1 };
		expect(ids(old)).toContain("chat-line-width");
		expect(ids(old)).not.toContain("interface-font");
		const windows = { ...LATEST, protocolVersion: WINDOWS_SHELL_SETTINGS_PROTOCOL_VERSION - 1 };
		expect(ids({ ...windows, hostPlatform: "win32" })).not.toContain("windows-shell");
		const none = ids({ ...LATEST, protocolVersion: null }, false);
		expect(none).not.toContain("chat-model");
		expect(none).not.toContain("software-updates");
		expect(none).toContain("feedback-discord");
	});

	test("entries about a workspace's own things need one open", () => {
		const outside = ids({ ...LATEST, hasWorkspace: false });
		expect(outside).not.toContain("subagents-workspace");
		expect(outside).not.toContain("mcp-project-servers");
		expect(outside).not.toContain("project-templates");
		expect(outside).toContain("mcp-user-servers");
		expect(outside).toContain("global-templates");
	});

	test("signed-in providers, voice files and the survey are offered only while there are any", () => {
		expect(ids({ ...LATEST, signedInProviders: false })).not.toContain("signed-in-providers");
		expect(ids({ ...LATEST, voiceFiles: false })).not.toContain("voice-files");
		expect(ids({ ...LATEST, survey: false })).not.toContain("feedback-survey");
		expect(ids(LATEST)).toEqual(expect.arrayContaining(["signed-in-providers", "voice-files"]));
	});

	test("user MCP servers need a workspace on a host older than the no-workspace protocol", () => {
		const older = { ...LATEST, protocolVersion: MCP_USER_SERVERS_PROTOCOL_VERSION - 1 };
		expect(ids({ ...older, hasWorkspace: false })).not.toContain("mcp-user-servers");
		expect(ids({ ...older, hasWorkspace: false })).not.toContain("mcp-add");
		expect(ids(older)).toContain("mcp-user-servers");
	});

	test("Updates entries need the injected section", () => {
		expect(ids(LATEST, true)).toContain("software-updates");
		expect(ids(LATEST, false)).not.toContain("software-updates");
	});
});
