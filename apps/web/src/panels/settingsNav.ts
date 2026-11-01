import {
	type RemixiconComponentType,
	RiApps2Line,
	RiBrainLine,
	RiChat2Line,
	RiDownloadCloud2Line,
	RiFolderSettingsLine,
	RiGitRepositoryLine,
	RiKeyboardLine,
	RiKeyLine,
	RiLayoutGridLine,
	RiLayoutTop2Line,
	RiNotification3Line,
	RiPaletteLine,
	RiPlugLine,
	RiPuzzle2Line,
	RiShieldCheckLine,
	RiTerminalBoxLine,
	RiTranslate2,
} from "@remixicon/react";
import {
	DEFAULT_MODEL_PROTOCOL_VERSION,
	EXTENSION_CATALOG_PROTOCOL_VERSION,
	HOST_ENVIRONMENT_PROTOCOL_VERSION,
	LOCALES_PROTOCOL_VERSION,
	MCP_PROTOCOL_VERSION,
	WORKSPACE_SETTLE_PROTOCOL_VERSION,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { SettingsSection } from "@/store";

export interface SettingsNavSection {
	id: SettingsSection;
	label: MessageKey;
	icon: RemixiconComponentType;
	requiresInjectedContent?: true;
	requiresProtocolVersion?: number;
}

export interface SettingsNavGroup {
	label: MessageKey;
	sections: SettingsNavSection[];
}

const NAV_GROUPS: SettingsNavGroup[] = [
	{
		label: "settings.nav.group.agent",
		sections: [
			{
				id: SettingsSection.Models,
				label: "settings.nav.models",
				icon: RiBrainLine,
				requiresProtocolVersion: DEFAULT_MODEL_PROTOCOL_VERSION,
			},
			{ id: SettingsSection.Providers, label: "settings.nav.providers", icon: RiKeyLine },
			{
				id: SettingsSection.Mcp,
				label: "settings.nav.mcp",
				icon: RiPlugLine,
				requiresProtocolVersion: MCP_PROTOCOL_VERSION,
			},
			{ id: SettingsSection.Templates, label: "settings.nav.templates", icon: RiLayoutGridLine },
			{
				id: SettingsSection.Environment,
				label: "settings.nav.environment",
				icon: RiFolderSettingsLine,
				requiresProtocolVersion: HOST_ENVIRONMENT_PROTOCOL_VERSION,
			},
		],
	},
	{
		label: "settings.nav.group.interface",
		sections: [
			{ id: SettingsSection.Chat, label: "settings.nav.chat", icon: RiChat2Line },
			{ id: SettingsSection.Appearance, label: "settings.nav.appearance", icon: RiPaletteLine },
			{
				id: SettingsSection.Language,
				label: "settings.nav.language",
				icon: RiTranslate2,
				requiresProtocolVersion: LOCALES_PROTOCOL_VERSION,
			},
			{ id: SettingsSection.Layout, label: "settings.nav.layout", icon: RiLayoutTop2Line },
			{ id: SettingsSection.Keyboard, label: "settings.nav.keyboard", icon: RiKeyboardLine },
			{ id: SettingsSection.Terminal, label: "settings.nav.terminal", icon: RiTerminalBoxLine },
		],
	},
	{
		label: "settings.nav.group.system",
		sections: [
			{
				id: SettingsSection.Workspaces,
				label: "settings.nav.workspaces",
				icon: RiGitRepositoryLine,
				requiresProtocolVersion: WORKSPACE_SETTLE_PROTOCOL_VERSION,
			},
			{ id: SettingsSection.Github, label: "settings.nav.github", icon: RiApps2Line },
			{
				id: SettingsSection.Extensions,
				label: "settings.nav.extensions",
				icon: RiPuzzle2Line,
				requiresProtocolVersion: EXTENSION_CATALOG_PROTOCOL_VERSION,
			},
			{
				id: SettingsSection.Notifications,
				label: "settings.nav.notifications",
				icon: RiNotification3Line,
			},
			{ id: SettingsSection.Privacy, label: "settings.nav.privacy", icon: RiShieldCheckLine },
			{
				id: SettingsSection.Updates,
				label: "settings.nav.updates",
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
