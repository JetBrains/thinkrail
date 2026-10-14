import {
	type RemixiconComponentType,
	RiApps2Line,
	RiBrainLine,
	RiChat2Line,
	RiDownloadCloud2Line,
	RiGitRepositoryLine,
	RiKeyLine,
	RiLayoutGridLine,
	RiLayoutTop2Line,
	RiNotification3Line,
	RiPaletteLine,
	RiPlugLine,
	RiPuzzle2Line,
	RiShieldCheckLine,
	RiTerminalBoxLine,
} from "@remixicon/react";
import {
	DEFAULT_MODEL_PROTOCOL_VERSION,
	EXTENSION_CATALOG_PROTOCOL_VERSION,
	MCP_PROTOCOL_VERSION,
	WORKSPACE_SETTLE_PROTOCOL_VERSION,
} from "@thinkrail/contracts";
import { SettingsSection } from "@/store";

export interface SettingsNavSection {
	id: SettingsSection;
	label: string;
	icon: RemixiconComponentType;
	requiresInjectedContent?: true;
	requiresProtocolVersion?: number;
}

export interface SettingsNavGroup {
	label: string;
	sections: SettingsNavSection[];
}

const NAV_GROUPS: SettingsNavGroup[] = [
	{
		label: "Agent",
		sections: [
			{
				id: SettingsSection.Models,
				label: "Models",
				icon: RiBrainLine,
				requiresProtocolVersion: DEFAULT_MODEL_PROTOCOL_VERSION,
			},
			{ id: SettingsSection.Providers, label: "Providers", icon: RiKeyLine },
			{
				id: SettingsSection.Mcp,
				label: "MCP servers",
				icon: RiPlugLine,
				requiresProtocolVersion: MCP_PROTOCOL_VERSION,
			},
			{ id: SettingsSection.Templates, label: "Prompt templates", icon: RiLayoutGridLine },
		],
	},
	{
		label: "Interface",
		sections: [
			{ id: SettingsSection.Chat, label: "Chat", icon: RiChat2Line },
			{ id: SettingsSection.Appearance, label: "Appearance", icon: RiPaletteLine },
			{ id: SettingsSection.Layout, label: "Layout", icon: RiLayoutTop2Line },
			{ id: SettingsSection.Terminal, label: "Terminal", icon: RiTerminalBoxLine },
		],
	},
	{
		label: "System",
		sections: [
			{
				id: SettingsSection.Workspaces,
				label: "Workspaces",
				icon: RiGitRepositoryLine,
				requiresProtocolVersion: WORKSPACE_SETTLE_PROTOCOL_VERSION,
			},
			{ id: SettingsSection.Github, label: "Integrations", icon: RiApps2Line },
			{
				id: SettingsSection.Extensions,
				label: "Extensions",
				icon: RiPuzzle2Line,
				requiresProtocolVersion: EXTENSION_CATALOG_PROTOCOL_VERSION,
			},
			{ id: SettingsSection.Notifications, label: "Notifications", icon: RiNotification3Line },
			{ id: SettingsSection.Privacy, label: "Privacy", icon: RiShieldCheckLine },
			{
				id: SettingsSection.Updates,
				label: "Updates",
				icon: RiDownloadCloud2Line,
				requiresInjectedContent: true,
			},
		],
	},
];

function isAvailable(
	section: SettingsNavSection,
	protocolVersion: number | null,
	hasUpdates: boolean,
): boolean {
	return (
		(!section.requiresInjectedContent || hasUpdates) &&
		(section.requiresProtocolVersion === undefined ||
			(protocolVersion !== null && protocolVersion >= section.requiresProtocolVersion))
	);
}

export function settingsNavGroups(
	protocolVersion: number | null,
	hasUpdates: boolean,
): SettingsNavGroup[] {
	return filterSettingsNavGroups(NAV_GROUPS, protocolVersion, hasUpdates);
}

export function filterSettingsNavGroups(
	groups: SettingsNavGroup[],
	protocolVersion: number | null,
	hasUpdates: boolean,
): SettingsNavGroup[] {
	return groups
		.map((group) => ({
			...group,
			sections: group.sections.filter((s) => isAvailable(s, protocolVersion, hasUpdates)),
		}))
		.filter((group) => group.sections.length > 0);
}

export function resolveSettingsSection(
	section: SettingsSection,
	groups: SettingsNavGroup[],
): SettingsSection {
	const available = groups.flatMap((g) => g.sections);
	if (section === SettingsSection.Feedback || available.some((s) => s.id === section)) {
		return section;
	}
	if (available.some((s) => s.id === SettingsSection.Appearance)) {
		return SettingsSection.Appearance;
	}
	return available[0]?.id ?? SettingsSection.Appearance;
}
