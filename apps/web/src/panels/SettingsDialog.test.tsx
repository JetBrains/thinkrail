import { describe, expect, test } from "bun:test";
import { RiBrainLine } from "@remixicon/react";
import {
	DEFAULT_MODEL_PROTOCOL_VERSION,
	EXTENSION_CATALOG_PROTOCOL_VERSION,
	MCP_PROTOCOL_VERSION,
	WORKSPACE_SETTLE_PROTOCOL_VERSION,
} from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";
import { SettingsSection } from "@/store";
import { filterSettingsNavGroups, resolveSettingsSection, settingsNavGroups } from "./settingsNav";

const LATEST = Math.max(
	DEFAULT_MODEL_PROTOCOL_VERSION,
	EXTENSION_CATALOG_PROTOCOL_VERSION,
	MCP_PROTOCOL_VERSION,
	WORKSPACE_SETTLE_PROTOCOL_VERSION,
);
const GATED = [
	SettingsSection.Models,
	SettingsSection.Mcp,
	SettingsSection.Extensions,
	SettingsSection.Workspaces,
];

const ids = (protocolVersion: number | null, hasUpdates: boolean) =>
	settingsNavGroups(protocolVersion, hasUpdates).flatMap((g) => g.sections.map((s) => s.id));

describe("settingsNavGroups", () => {
	test("current hosts with injected updates list every section in its group", () => {
		expect(
			settingsNavGroups(LATEST, true).map((g) => [t(g.label), g.sections.map((s) => s.id)]),
		).toEqual([
			[
				"Agent",
				[
					SettingsSection.Models,
					SettingsSection.Providers,
					SettingsSection.Mcp,
					SettingsSection.Templates,
				],
			],
			[
				"Interface",
				[
					SettingsSection.Chat,
					SettingsSection.Appearance,
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
					SettingsSection.Extensions,
					SettingsSection.Notifications,
					SettingsSection.Privacy,
					SettingsSection.Updates,
				],
			],
		]);
	});

	test("protocol-gated sections are hidden on old or unnegotiated hosts", () => {
		for (const version of [1, null]) {
			const available = ids(version, true);
			for (const gated of GATED) expect(available).not.toContain(gated);
			expect(available).toContain(SettingsSection.Providers);
			expect(available).toContain(SettingsSection.Appearance);
		}
	});

	test("each gated section appears exactly at its protocol version", () => {
		const gates = [
			[SettingsSection.Models, DEFAULT_MODEL_PROTOCOL_VERSION],
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

	test("removed sections are never listed", () => {
		const available = ids(LATEST, true);
		expect(available).not.toContain(SettingsSection.Review);
		expect(available).not.toContain(SettingsSection.LineWidth);
		expect(available).not.toContain(SettingsSection.Feedback);
	});

	test("groups left without an available section disappear", () => {
		const groups = [
			{
				label: "Gated",
				sections: [
					{
						id: SettingsSection.Models,
						label: "Models",
						icon: RiBrainLine,
						requiresProtocolVersion: DEFAULT_MODEL_PROTOCOL_VERSION,
					},
					{
						id: SettingsSection.Updates,
						label: "Updates",
						icon: RiBrainLine,
						requiresInjectedContent: true as const,
					},
				],
			},
			{ label: "Open", sections: [{ id: SettingsSection.Chat, label: "Chat", icon: RiBrainLine }] },
		];
		expect(filterSettingsNavGroups(groups, 1, false).map((g) => g.label)).toEqual(["Open"]);
		expect(filterSettingsNavGroups(groups, 1, true).map((g) => g.label)).toEqual(["Gated", "Open"]);
		expect(settingsNavGroups(1, false).every((g) => g.sections.length > 0)).toBe(true);
	});
});

describe("resolveSettingsSection", () => {
	test("keeps an available section", () => {
		const groups = settingsNavGroups(LATEST, true);
		for (const id of ids(LATEST, true)) expect(resolveSettingsSection(id, groups)).toBe(id);
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

	test("unavailable sections fall back to Appearance", () => {
		const old = settingsNavGroups(1, false);
		for (const gated of GATED) {
			expect(resolveSettingsSection(gated, old)).toBe(SettingsSection.Appearance);
		}
		expect(resolveSettingsSection(SettingsSection.Updates, settingsNavGroups(LATEST, false))).toBe(
			SettingsSection.Appearance,
		);
	});

	test("removed sections fall back to Appearance", () => {
		const groups = settingsNavGroups(LATEST, true);
		expect(resolveSettingsSection(SettingsSection.Review, groups)).toBe(SettingsSection.Appearance);
		expect(resolveSettingsSection(SettingsSection.LineWidth, groups)).toBe(
			SettingsSection.Appearance,
		);
	});

	test("without Appearance it falls back to the first available section", () => {
		const groups = [
			{
				label: "Only",
				sections: settingsNavGroups(LATEST, true)
					.flatMap((g) => g.sections)
					.filter((s) => s.id === SettingsSection.Privacy),
			},
		];
		expect(resolveSettingsSection(SettingsSection.Models, groups)).toBe(SettingsSection.Privacy);
		expect(resolveSettingsSection(SettingsSection.Models, [])).toBe(SettingsSection.Appearance);
	});
});
