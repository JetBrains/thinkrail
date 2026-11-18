import { describe, expect, test } from "bun:test";
import { RiBrainLine } from "@remixicon/react";
import {
	DEFAULT_MODEL_PROTOCOL_VERSION,
	EXTENSION_CATALOG_PROTOCOL_VERSION,
	MCP_PROTOCOL_VERSION,
	SUBAGENT_SETTINGS_PROTOCOL_VERSION,
	WORKSPACE_SETTLE_PROTOCOL_VERSION,
} from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import { SettingsSection } from "@/store";
import {
	filterSettingsNavGroups,
	resolveSettingsSection,
	type SettingsNavGroup,
	settingsNavGroups,
} from "./settingsNav";

const LATEST = Math.max(
	DEFAULT_MODEL_PROTOCOL_VERSION,
	EXTENSION_CATALOG_PROTOCOL_VERSION,
	MCP_PROTOCOL_VERSION,
	SUBAGENT_SETTINGS_PROTOCOL_VERSION,
	WORKSPACE_SETTLE_PROTOCOL_VERSION,
);
const GATED = [
	SettingsSection.Models,
	SettingsSection.Subagents,
	SettingsSection.Mcp,
	SettingsSection.Extensions,
	SettingsSection.Workspaces,
];

const ids = (protocolVersion: number | null, hasUpdates: boolean) =>
	settingsNavGroups(protocolVersion, hasUpdates).flatMap((g) => g.sections.map((s) => s.id));

describe("settingsNavGroups", () => {
	test("current hosts with injected updates list every section in its group, in order", () => {
		expect(
			settingsNavGroups(LATEST, true).map((g) => [t(g.label), g.sections.map((s) => s.id)]),
		).toEqual([
			[
				"Agent",
				[
					SettingsSection.Models,
					SettingsSection.Providers,
					SettingsSection.Subagents,
					SettingsSection.Extensions,
					SettingsSection.Mcp,
					SettingsSection.Templates,
				],
			],
			[
				"Interface",
				[
					SettingsSection.Appearance,
					SettingsSection.Text,
					SettingsSection.Chat,
					SettingsSection.Layout,
					SettingsSection.Keyboard,
					SettingsSection.Terminal,
				],
			],
			[
				"System",
				[
					SettingsSection.Workspaces,
					SettingsSection.Github,
					SettingsSection.Notifications,
					SettingsSection.Privacy,
					SettingsSection.Updates,
				],
			],
		]);
	});

	test("the newest host lists Environment, Language and Voice where they belong", () => {
		const groups = settingsNavGroups(Number.MAX_SAFE_INTEGER, true);
		expect(groups.map((g) => g.sections.map((s) => s.id))).toEqual([
			[
				SettingsSection.Models,
				SettingsSection.Providers,
				SettingsSection.Subagents,
				SettingsSection.Extensions,
				SettingsSection.Mcp,
				SettingsSection.Templates,
				SettingsSection.Environment,
			],
			[
				SettingsSection.Appearance,
				SettingsSection.Text,
				SettingsSection.Chat,
				SettingsSection.Layout,
				SettingsSection.Keyboard,
				SettingsSection.Language,
				SettingsSection.Voice,
				SettingsSection.Terminal,
			],
			[
				SettingsSection.Workspaces,
				SettingsSection.Github,
				SettingsSection.Notifications,
				SettingsSection.Phone,
				SettingsSection.Privacy,
				SettingsSection.Updates,
			],
		]);
		expect(t(groups[0]?.sections[3]?.label ?? "settings.nav.models")).toBe("Extensions & skills");
		expect(t(groups[1]?.sections[1]?.label ?? "settings.nav.models")).toBe("Text & fonts");
	});

	test("protocol-gated sections are hidden on old or unnegotiated hosts", () => {
		for (const version of [1, null]) {
			const available = ids(version, true);
			for (const gated of GATED) expect(available).not.toContain(gated);
			expect(available).toContain(SettingsSection.Providers);
			expect(available).toContain(SettingsSection.Appearance);
			expect(available).toContain(SettingsSection.Text);
		}
	});

	test("each gated section appears exactly at its protocol version", () => {
		const gates = [
			[SettingsSection.Models, DEFAULT_MODEL_PROTOCOL_VERSION],
			[SettingsSection.Subagents, SUBAGENT_SETTINGS_PROTOCOL_VERSION],
			[SettingsSection.Mcp, MCP_PROTOCOL_VERSION],
			[SettingsSection.Extensions, EXTENSION_CATALOG_PROTOCOL_VERSION],
			[SettingsSection.Workspaces, WORKSPACE_SETTLE_PROTOCOL_VERSION],
		] as const;
		for (const [id, version] of gates) {
			expect(ids(version - 1, false)).not.toContain(id);
			expect(ids(version, false)).toContain(id);
		}
	});

	test("Updates is listed only with injected content", () => {
		expect(ids(LATEST, false)).not.toContain(SettingsSection.Updates);
		expect(ids(LATEST, true)).toContain(SettingsSection.Updates);
	});

	test("retired sections and Feedback are never listed", () => {
		const available = ids(Number.MAX_SAFE_INTEGER, true);
		expect(available).not.toContain(SettingsSection.Review);
		expect(available).not.toContain(SettingsSection.LineWidth);
		expect(available).not.toContain(SettingsSection.Artifacts);
		expect(available).not.toContain(SettingsSection.Feedback);
	});

	test("groups left without an available section disappear", () => {
		const groups: SettingsNavGroup[] = [
			{
				label: "settings.nav.group.agent",
				sections: [
					{
						id: SettingsSection.Models,
						label: "settings.nav.models",
						icon: RiBrainLine,
						requiresProtocolVersion: DEFAULT_MODEL_PROTOCOL_VERSION,
					},
					{
						id: SettingsSection.Updates,
						label: "settings.nav.updates",
						icon: RiBrainLine,
						requiresInjectedContent: true,
					},
				],
			},
			{
				label: "settings.nav.group.interface",
				sections: [{ id: SettingsSection.Chat, label: "settings.nav.chat", icon: RiBrainLine }],
			},
		];
		expect(filterSettingsNavGroups(groups, 1, false).map((g) => g.label)).toEqual([
			"settings.nav.group.interface",
		]);
		expect(filterSettingsNavGroups(groups, 1, true).map((g) => g.label)).toEqual([
			"settings.nav.group.agent",
			"settings.nav.group.interface",
		]);
		expect(settingsNavGroups(1, false).every((g) => g.sections.length > 0)).toBe(true);
	});
});

describe("resolveSettingsSection", () => {
	test("keeps an available section", () => {
		const groups = settingsNavGroups(Number.MAX_SAFE_INTEGER, true);
		for (const id of ids(Number.MAX_SAFE_INTEGER, true)) {
			expect(resolveSettingsSection(id, groups)).toBe(id);
		}
	});

	test("Feedback is always resolvable", () => {
		for (const version of [LATEST, 1, null]) {
			const groups = settingsNavGroups(version, false);
			expect(resolveSettingsSection(SettingsSection.Feedback, groups)).toBe(
				SettingsSection.Feedback,
			);
		}
		expect(resolveSettingsSection(SettingsSection.Feedback, [])).toBe(SettingsSection.Feedback);
	});

	test("a retired section opens the section its settings moved to", () => {
		const groups = settingsNavGroups(LATEST, true);
		expect(resolveSettingsSection(SettingsSection.Artifacts, groups)).toBe(SettingsSection.Layout);
		expect(resolveSettingsSection(SettingsSection.LineWidth, groups)).toBe(SettingsSection.Text);
		expect(resolveSettingsSection(SettingsSection.Review, groups)).toBe(SettingsSection.Models);
	});

	test("a retired section whose new home is unavailable falls back like any other", () => {
		expect(resolveSettingsSection(SettingsSection.Review, settingsNavGroups(1, false))).toBe(
			SettingsSection.Appearance,
		);
	});

	test("unavailable sections fall back to Appearance", () => {
		const old = settingsNavGroups(1, false);
		for (const gated of GATED) {
			expect(resolveSettingsSection(gated, old)).toBe(SettingsSection.Appearance);
		}
		expect(resolveSettingsSection(SettingsSection.Updates, settingsNavGroups(LATEST, false))).toBe(
			SettingsSection.Appearance,
		);
	});

	test("without Appearance it falls back to the first available section", () => {
		const groups: SettingsNavGroup[] = [
			{
				label: "settings.nav.group.system",
				sections: settingsNavGroups(LATEST, true)
					.flatMap((g) => g.sections)
					.filter((s) => s.id === SettingsSection.Privacy),
			},
		];
		expect(resolveSettingsSection(SettingsSection.Models, groups)).toBe(SettingsSection.Privacy);
		expect(resolveSettingsSection(SettingsSection.Models, [])).toBe(SettingsSection.Appearance);
	});
});
