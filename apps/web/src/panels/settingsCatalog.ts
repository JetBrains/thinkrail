import {
	AGENT_REVIEW_SETTING_PROTOCOL_VERSION,
	CACHE_WARMING_SETTINGS_PROTOCOL_VERSION,
	CONTEXT_WINDOW_SETTINGS_PROTOCOL_VERSION,
	CUSTOM_ENDPOINTS_PROTOCOL_VERSION,
	EXTENSION_SETTINGS_PROTOCOL_VERSION,
	FONTS_PROTOCOL_VERSION,
	type HostPlatform,
	isCustomEndpointId,
	JBCENTRAL_QUOTA_PROTOCOL_VERSION,
	KEYBINDINGS_PROTOCOL_VERSION,
	MCP_USER_SERVERS_PROTOCOL_VERSION,
	OTHER_AGENT_SKILLS_PROTOCOL_VERSION,
	PI_PACKAGES_PROTOCOL_VERSION,
	QUESTION_PANEL_PROTOCOL_VERSION,
	SUBAGENT_CATALOG_PROTOCOL_VERSION,
	SUBAGENT_CONCURRENCY_PROTOCOL_VERSION,
	USER_THEMES_PROTOCOL_VERSION,
	WINDOWS_SHELL_SETTINGS_PROTOCOL_VERSION,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import type { Translator } from "@thinkrail/locales/react";
import { useShallow } from "zustand/react/shallow";
import { SettingsSection, selectActiveWorkspace, useAppStore } from "@/store";
import type { SettingsNavGroup } from "./settingsNav";

export interface SettingsCatalogContext {
	readonly protocolVersion: number | null;
	readonly hasWorkspace: boolean;
	readonly hostPlatform: HostPlatform | null;
	readonly signedInProviders: boolean;
	readonly voiceFiles: boolean;
	readonly survey: boolean;
}

export function useSettingsCatalogContext(): SettingsCatalogContext {
	return useAppStore(
		useShallow((s) => ({
			protocolVersion: s.protocolVersion,
			hasWorkspace: selectActiveWorkspace(s) !== null,
			hostPlatform: s.hostPlatform,
			signedInProviders:
				s.providerStatus.report?.providers.some(
					(provider) => provider.configured && !isCustomEndpointId(provider.id),
				) ?? false,
			voiceFiles: (s.speech?.diskBytes ?? 0) > 0,
			survey: s.inAppSurvey !== null,
		})),
	);
}

export interface SettingEntry {
	readonly id: string;
	readonly section: SettingsSection;
	readonly label: MessageKey;
	readonly description?: MessageKey;
	readonly keywords?: readonly string[];
	readonly requiresProtocolVersion?: number;
	readonly when?: (context: SettingsCatalogContext) => boolean;
}

const inWorkspace = (context: SettingsCatalogContext) => context.hasWorkspace;
const userMcpReachable = (context: SettingsCatalogContext) =>
	context.hasWorkspace || (context.protocolVersion ?? 0) >= MCP_USER_SERVERS_PROTOCOL_VERSION;

export const SETTING = {
	chatModel: {
		id: "chat-model",
		section: SettingsSection.Models,
		label: "settings.models.chatModel",
		description: "settings.catalog.chatModel.description",
		keywords: ["default model", "effort", "reasoning", "thinking level"],
	},
	reviewModel: {
		id: "review-model",
		section: SettingsSection.Models,
		label: "settings.models.reviewModel",
		description: "settings.catalog.reviewModel.description",
		keywords: ["review", "effort", "reasoning"],
	},
	agentReview: {
		id: "agent-review",
		section: SettingsSection.Models,
		label: "settings.models.agentReview",
		description: "settings.models.agentReviewDescription",
		requiresProtocolVersion: AGENT_REVIEW_SETTING_PROTOCOL_VERSION,
	},
	autoFix: {
		id: "auto-fix",
		section: SettingsSection.Models,
		label: "settings.models.autoFix",
		description: "settings.models.autoFixDescription",
		keywords: ["review"],
	},
	contextWindow: {
		id: "context-window",
		section: SettingsSection.Models,
		label: "settings.modelContext.allModels",
		description: "settings.catalog.contextWindow.description",
		keywords: ["gpt", "context", "tokens", "1M"],
		requiresProtocolVersion: CONTEXT_WINDOW_SETTINGS_PROTOCOL_VERSION,
	},
	promptCache: {
		id: "prompt-cache",
		section: SettingsSection.Models,
		label: "settings.cacheWarming.label",
		description: "settings.cacheWarming.description",
		keywords: ["cache warming", "cost"],
		requiresProtocolVersion: CACHE_WARMING_SETTINGS_PROTOCOL_VERSION,
	},
	visibleModels: {
		id: "visible-models",
		section: SettingsSection.Models,
		label: "settings.visibleModels.title",
		description: "settings.catalog.visibleModels.description",
		keywords: ["model picker", "hide", "show", "provider"],
	},
	signedInProviders: {
		id: "signed-in-providers",
		section: SettingsSection.Providers,
		label: "settings.catalog.signedInProviders.label",
		description: "settings.catalog.signedInProviders.description",
		keywords: ["sign out", "connected", "anthropic", "openai", "copilot", "google"],
		when: (context: SettingsCatalogContext) => context.signedInProviders,
	},
	jetbrainsCentral: {
		id: "jetbrains-central",
		section: SettingsSection.Providers,
		label: "settings.jbcentral.title",
		description: "settings.catalog.jetbrainsCentral.description",
		keywords: ["jetbrains", "central", "proxy", "connect", "jcp"],
	},
	jetbrainsQuota: {
		id: "jetbrains-quota",
		section: SettingsSection.Providers,
		label: "settings.jbcentral.quota.show",
		description: "settings.catalog.jetbrainsQuota.description",
		keywords: ["jetbrains", "quota"],
		requiresProtocolVersion: JBCENTRAL_QUOTA_PROTOCOL_VERSION,
	},
	jetbrainsQuotaInterval: {
		id: "jetbrains-quota-interval",
		section: SettingsSection.Providers,
		label: "settings.catalog.jetbrainsQuotaInterval.label",
		keywords: ["jetbrains", "quota", "refresh", "seconds"],
		requiresProtocolVersion: JBCENTRAL_QUOTA_PROTOCOL_VERSION,
	},
	subscriptions: {
		id: "subscriptions",
		section: SettingsSection.Providers,
		label: "settings.providers.subscriptionsGroup",
		description: "settings.providers.subscriptionsDescription",
		keywords: ["sign in", "claude", "chatgpt", "copilot", "codex"],
	},
	customServers: {
		id: "custom-servers",
		section: SettingsSection.Providers,
		label: "settings.customEndpoints.title",
		description: "settings.customEndpoints.description",
		keywords: ["model endpoint", "openai compatible", "ollama", "vllm"],
		requiresProtocolVersion: CUSTOM_ENDPOINTS_PROTOCOL_VERSION,
	},
	apiKeyProviders: {
		id: "api-key-providers",
		section: SettingsSection.Providers,
		label: "settings.catalog.apiKeyProviders.label",
		keywords: ["api key", "provider", "bedrock", "azure", "mistral", "deepseek"],
	},
	subagentsAllow: {
		id: "subagents-allow",
		section: SettingsSection.Subagents,
		label: "settings.subagents.allow",
		description: "settings.subagents.allowOnDescription",
		keywords: ["delegate", "agents"],
	},
	subagentsPerChat: {
		id: "subagents-per-chat",
		section: SettingsSection.Subagents,
		label: "settings.subagents.perChat",
		description: "settings.subagents.perChatDescription",
		keywords: ["subagents", "concurrent", "limit"],
		requiresProtocolVersion: SUBAGENT_CONCURRENCY_PROTOCOL_VERSION,
	},
	subagentsWorkspace: {
		id: "subagents-workspace",
		section: SettingsSection.Subagents,
		label: "settings.catalog.subagentsWorkspace.label",
		description: "settings.catalog.subagentsWorkspace.description",
		keywords: ["delegate", "override", "this workspace"],
		when: inWorkspace,
	},
	subagentsWorkspaceLimit: {
		id: "subagents-workspace-limit",
		section: SettingsSection.Subagents,
		label: "settings.catalog.subagentsWorkspaceLimit.label",
		keywords: ["subagents", "concurrent", "limit", "this workspace"],
		requiresProtocolVersion: SUBAGENT_CONCURRENCY_PROTOCOL_VERSION,
		when: inWorkspace,
	},
	subagentRoles: {
		id: "subagent-roles",
		section: SettingsSection.Subagents,
		label: "settings.subagents.available",
		description: "settings.subagents.availableDescription",
		keywords: ["agents", "roles", "disable", "model", "scout", "worker", "reviewer"],
		requiresProtocolVersion: SUBAGENT_CATALOG_PROTOCOL_VERSION,
	},
	installPackage: {
		id: "install-package",
		section: SettingsSection.Extensions,
		label: "settings.packages.installDialog.title",
		description: "settings.packages.installDialog.description",
		keywords: ["pi package", "npm", "gallery"],
		requiresProtocolVersion: PI_PACKAGES_PROTOCOL_VERSION,
	},
	bundledExtensions: {
		id: "bundled-extensions",
		section: SettingsSection.Extensions,
		label: "settings.extensions.group.bundled",
		keywords: [
			"visualize",
			"mermaid",
			"ask user question",
			"web access",
			"next steps",
			"hint mode",
		],
	},
	richPreviews: {
		id: "rich-previews",
		section: SettingsSection.Extensions,
		label: "settings.extensions.ask-user-question.richPreviews.title",
		description: "settings.extensions.ask-user-question.richPreviews.description",
		keywords: ["ask user question", "mockups", "previews"],
		requiresProtocolVersion: EXTENSION_SETTINGS_PROTOCOL_VERSION,
	},
	installedPackages: {
		id: "installed-packages",
		section: SettingsSection.Extensions,
		label: "settings.catalog.installedPackages.label",
		description: "settings.extensions.group.installedDescription",
		keywords: ["pi package", "npm", "git", "update"],
		requiresProtocolVersion: PI_PACKAGES_PROTOCOL_VERSION,
	},
	otherAgentSkills: {
		id: "other-agent-skills",
		section: SettingsSection.Extensions,
		label: "settings.extensions.otherAgentSkills",
		description: "settings.extensions.otherAgentSkillsDescription",
		keywords: ["skills", "claude", "codex", "gemini", "copilot"],
		requiresProtocolVersion: OTHER_AGENT_SKILLS_PROTOCOL_VERSION,
	},
	piBuiltins: {
		id: "pi-builtins",
		section: SettingsSection.Extensions,
		label: "settings.extensions.group.builtin",
		description: "settings.catalog.piBuiltins.description",
		keywords: ["mcp client", "tool search"],
	},
	mcpAdd: {
		id: "mcp-add",
		section: SettingsSection.Mcp,
		label: "mcp.addDialog.title",
		keywords: ["mcp", "preset", "json", "context7", "linear", "playwright"],
		when: userMcpReachable,
	},
	mcpUserServers: {
		id: "mcp-user-servers",
		section: SettingsSection.Mcp,
		label: "settings.catalog.mcpUserServers.label",
		keywords: ["mcp", "server", "tools", "all projects"],
		when: userMcpReachable,
	},
	mcpProjectServers: {
		id: "mcp-project-servers",
		section: SettingsSection.Mcp,
		label: "settings.catalog.mcpProjectServers.label",
		keywords: ["mcp", "server", "tools", ".pi/mcp.json"],
		when: inWorkspace,
	},
	projectTemplates: {
		id: "project-templates",
		section: SettingsSection.Templates,
		label: "settings.templates.projectTitle",
		keywords: ["prompt", "slash", ".pi/prompts"],
		when: inWorkspace,
	},
	globalTemplates: {
		id: "global-templates",
		section: SettingsSection.Templates,
		label: "settings.templates.globalTitle",
		keywords: ["prompt", "slash", "all projects"],
	},
	piConfigFolder: {
		id: "pi-config-folder",
		section: SettingsSection.Environment,
		label: "settings.environment.agentDir.label",
		description: "settings.environment.agentDir.hint",
		keywords: ["PI_CODING_AGENT_DIR"],
	},
	environmentVariables: {
		id: "environment-variables",
		section: SettingsSection.Environment,
		label: "settings.environment.vars.label",
		keywords: ["env", "variable", "proxy"],
	},
	themeMode: {
		id: "theme-mode",
		section: SettingsSection.Appearance,
		label: "settings.appearance.themeMode",
		description: "settings.appearance.themeModeDescription",
		keywords: ["dark", "light", "system", "theme"],
	},
	lightTheme: {
		id: "light-theme",
		section: SettingsSection.Appearance,
		label: "settings.appearance.lightTheme",
		keywords: ["theme", "color"],
	},
	darkTheme: {
		id: "dark-theme",
		section: SettingsSection.Appearance,
		label: "settings.appearance.darkTheme",
		keywords: ["theme", "color"],
	},
	contrast: {
		id: "contrast",
		section: SettingsSection.Appearance,
		label: "settings.appearance.contrastLevel",
		keywords: ["high contrast", "accessibility", "theme"],
	},
	themeFolder: {
		id: "theme-folder",
		section: SettingsSection.Appearance,
		label: "settings.appearance.custom.folder",
		keywords: ["custom theme", "json"],
		requiresProtocolVersion: USER_THEMES_PROTOCOL_VERSION,
	},
	interfaceFont: {
		id: "interface-font",
		section: SettingsSection.Text,
		label: "settings.catalog.interfaceFont.label",
		description: "settings.appearance.fonts.interface.description",
		keywords: ["font", "typeface"],
		requiresProtocolVersion: FONTS_PROTOCOL_VERSION,
	},
	textWeight: {
		id: "font-weight",
		section: SettingsSection.Text,
		label: "settings.appearance.fonts.weight",
		description: "settings.appearance.fonts.weightDescription",
		keywords: ["bold", "font"],
		requiresProtocolVersion: FONTS_PROTOCOL_VERSION,
	},
	codeFont: {
		id: "code-font",
		section: SettingsSection.Text,
		label: "settings.catalog.codeFont.label",
		description: "settings.appearance.fonts.code.description",
		keywords: ["monospace", "font"],
		requiresProtocolVersion: FONTS_PROTOCOL_VERSION,
	},
	interfaceFallbacks: {
		id: "interface-fallbacks",
		section: SettingsSection.Text,
		label: "settings.appearance.fonts.interfaceFallbacks",
		description: "settings.appearance.fonts.interfaceFallbacksDescription",
		keywords: ["font", "fallback", "characters"],
		requiresProtocolVersion: FONTS_PROTOCOL_VERSION,
	},
	codeSize: {
		id: "code-size",
		section: SettingsSection.Text,
		label: "settings.catalog.codeSize.label",
		keywords: ["font size", "pixels"],
		requiresProtocolVersion: FONTS_PROTOCOL_VERSION,
	},
	ligatures: {
		id: "ligatures",
		section: SettingsSection.Text,
		label: "settings.appearance.fonts.ligatures",
		description: "settings.appearance.fonts.ligaturesDescription",
		keywords: ["font"],
		requiresProtocolVersion: FONTS_PROTOCOL_VERSION,
	},
	codeFallbacks: {
		id: "code-fallbacks",
		section: SettingsSection.Text,
		label: "settings.appearance.fonts.codeFallbacks",
		description: "settings.appearance.fonts.codeFallbacksDescription",
		keywords: ["font", "fallback", "symbols", "nerd font", "terminal"],
		requiresProtocolVersion: FONTS_PROTOCOL_VERSION,
	},
	chatLineWidth: {
		id: "chat-line-width",
		section: SettingsSection.Text,
		label: "settings.lineWidth.chat.inputLabel",
		description: "settings.lineWidth.chat.description",
		keywords: ["wrap", "characters", "width"],
	},
	chatFitToPane: {
		id: "chat-fit-to-pane",
		section: SettingsSection.Text,
		label: "settings.lineWidth.chat.boundedLabel",
		description: "settings.lineWidth.fitToPaneDescription",
		keywords: ["wrap", "width"],
	},
	fileLineWidth: {
		id: "file-line-width",
		section: SettingsSection.Text,
		label: "settings.lineWidth.file.inputLabel",
		description: "settings.lineWidth.file.description",
		keywords: ["wrap", "characters", "editor", "code", "diff"],
	},
	fileFitToPane: {
		id: "file-fit-to-pane",
		section: SettingsSection.Text,
		label: "settings.lineWidth.file.boundedLabel",
		description: "settings.lineWidth.fitToPaneDescription",
		keywords: ["wrap", "width", "editor"],
	},
	customFonts: {
		id: "custom-fonts",
		section: SettingsSection.Text,
		label: "settings.appearance.customFonts.title",
		description: "settings.appearance.customFonts.description",
		keywords: ["font", "ttf", "otf", "woff"],
		requiresProtocolVersion: FONTS_PROTOCOL_VERSION,
	},
	fontsFolder: {
		id: "fonts-folder",
		section: SettingsSection.Text,
		label: "settings.appearance.customFonts.folder",
		keywords: ["custom font", "ttf", "otf", "remove"],
		requiresProtocolVersion: FONTS_PROTOCOL_VERSION,
	},
	messageOrder: {
		id: "message-order",
		section: SettingsSection.Chat,
		label: "settings.chat.messageOrder",
		description: "settings.chat.messageOrderDescription",
		keywords: ["oldest first", "newest first"],
	},
	composerSize: {
		id: "composer-size",
		section: SettingsSection.Chat,
		label: "settings.chat.composerSize",
		description: "settings.chat.composerSizeDescription",
		keywords: ["message box", "height"],
	},
	questionPanelHeight: {
		id: "question-panel-height",
		section: SettingsSection.Chat,
		label: "settings.chat.questionPanelHeight",
		description: "settings.chat.questionPanelHeightDescription",
		keywords: ["ask", "percent"],
		requiresProtocolVersion: QUESTION_PANEL_PROTOCOL_VERSION,
	},
	layoutPresets: {
		id: "layout-presets",
		section: SettingsSection.Layout,
		label: "settings.catalog.layoutPresets.label",
		keywords: ["balanced", "focus", "review", "panels"],
	},
	layoutAdd: {
		id: "layout-add",
		section: SettingsSection.Layout,
		label: "workbench.layoutSettings.addNew",
		description: "workbench.layoutSettings.addNewDescription",
		keywords: ["layout", "preset", "save"],
	},
	layoutReset: {
		id: "layout-reset",
		section: SettingsSection.Layout,
		label: "workbench.layoutSettings.resetToDefault",
		keywords: ["layout", "balanced"],
	},
	layoutGroupLimits: {
		id: "layout-group-limits",
		section: SettingsSection.Layout,
		label: "workbench.layoutSettings.groupLimits",
		description: "workbench.layoutSettings.groupLimitsDescription",
		keywords: ["left", "right", "bottom", "groups"],
	},
	markdownOutline: {
		id: "markdown-outline",
		section: SettingsSection.Layout,
		label: "settings.appearance.markdownOutlineSide",
		description: "settings.appearance.markdownOutlineSide.description",
		keywords: ["preview", "headings"],
	},
	doubleShift: {
		id: "double-shift",
		section: SettingsSection.Keyboard,
		label: "settings.keyboard.doubleShift",
		description: "settings.keyboard.doubleShiftHint",
		keywords: ["shortcut", "palette", "shift"],
	},
	keyboardShortcuts: {
		id: "keyboard-shortcuts",
		section: SettingsSection.Keyboard,
		label: "settings.keyboard.shortcuts",
		keywords: ["keybinding", "shortcut", "import", "export", "reset all"],
		requiresProtocolVersion: KEYBINDINGS_PROTOCOL_VERSION,
	},
	interfaceLanguage: {
		id: "interface-language",
		section: SettingsSection.Language,
		label: "settings.catalog.interfaceLanguage.label",
		description: "settings.language.choiceDescription",
		keywords: ["locale", "translation"],
	},
	languageFolder: {
		id: "language-folder",
		section: SettingsSection.Language,
		label: "settings.language.folder.label",
		keywords: ["translate", "locale"],
	},
	languageContribute: {
		id: "language-contribute",
		section: SettingsSection.Language,
		label: "settings.language.contribute.label",
		description: "settings.language.contribute.description",
		keywords: ["translate"],
	},
	voiceInput: {
		id: "voice-input",
		section: SettingsSection.Voice,
		label: "settings.voice.enable",
		description: "settings.voice.enableDescription",
		keywords: ["speech", "mic", "dictation"],
	},
	voiceLanguage: {
		id: "voice-language",
		section: SettingsSection.Voice,
		label: "settings.catalog.voiceLanguage.label",
		description: "settings.voice.languageDescription",
		keywords: ["speech", "model"],
	},
	voiceShortcut: {
		id: "voice-shortcut",
		section: SettingsSection.Voice,
		label: "settings.voice.shortcut",
		description: "settings.voice.shortcutDescription",
		keywords: ["dictation", "shortcut"],
	},
	voiceFiles: {
		id: "voice-files",
		section: SettingsSection.Voice,
		label: "settings.voice.delete",
		keywords: ["speech", "model", "disk"],
		when: (context: SettingsCatalogContext) => context.voiceFiles,
	},
	scrollback: {
		id: "scrollback",
		section: SettingsSection.Terminal,
		label: "settings.terminal.scrollback.title",
		description: "settings.terminal.scrollback.description",
		keywords: ["buffer", "replay"],
	},
	windowsShell: {
		id: "windows-shell",
		section: SettingsSection.Terminal,
		label: "settings.terminal.shell.label",
		description: "settings.terminal.shell.openTabs",
		keywords: ["windows shell", "powershell", "cmd", "pwsh"],
		requiresProtocolVersion: WINDOWS_SHELL_SETTINGS_PROTOCOL_VERSION,
		when: (context: SettingsCatalogContext) => context.hostPlatform === "win32",
	},
	settleIdle: {
		id: "settle-idle",
		section: SettingsSection.Workspaces,
		label: "settings.workspaces.title",
		description: "settings.workspaces.description",
		keywords: ["idle", "settled", "shelf"],
	},
	githubCli: {
		id: "github-cli",
		section: SettingsSection.Github,
		label: "settings.github.cli",
		description: "settings.github.description",
		keywords: ["gh", "auth", "login"],
	},
	notifications: {
		id: "notifications-enabled",
		section: SettingsSection.Notifications,
		label: "settings.notifications.enable",
		description: "settings.notifications.browserDescription",
		keywords: ["alert"],
	},
	usageAnalytics: {
		id: "usage-analytics",
		section: SettingsSection.Privacy,
		label: "panels.analytics.shareLabel",
		description: "panels.analytics.shareDescription",
		keywords: ["analytics", "telemetry", "usage"],
	},
	softwareUpdates: {
		id: "software-updates",
		section: SettingsSection.Updates,
		label: "updates.settings.title",
		keywords: ["version", "release", "check"],
	},
	survey: {
		id: "feedback-survey",
		section: SettingsSection.Feedback,
		label: "settings.feedback.takeSurvey",
		description: "settings.feedback.surveyDescription",
		keywords: ["feedback"],
		when: (context: SettingsCatalogContext) => context.survey,
	},
	discord: {
		id: "feedback-discord",
		section: SettingsSection.Feedback,
		label: "settings.feedback.joinDiscord",
		description: "settings.feedback.discordDescription",
		keywords: ["feedback", "community"],
	},
	feedbackEmail: {
		id: "feedback-email",
		section: SettingsSection.Feedback,
		label: "settings.feedback.emailLabel",
		keywords: ["feedback", "mail", "contact"],
	},
} as const satisfies Record<string, SettingEntry>;

export const SETTINGS_CATALOG: readonly SettingEntry[] = Object.values(SETTING);

export interface SettingProps {
	settingId: string;
	label: string;
	description: string | undefined;
}

export function settingProps(t: Translator, entry: SettingEntry): SettingProps {
	return {
		settingId: entry.id,
		label: t(entry.label),
		description: entry.description === undefined ? undefined : t(entry.description),
	};
}

export function availableSettings(
	groups: readonly SettingsNavGroup[],
	context: SettingsCatalogContext,
): SettingEntry[] {
	const sections = new Set<SettingsSection>([
		SettingsSection.Feedback,
		...groups.flatMap((group) => group.sections.map((section) => section.id)),
	]);
	const { protocolVersion } = context;
	return SETTINGS_CATALOG.filter(
		(entry) =>
			sections.has(entry.section) &&
			(entry.requiresProtocolVersion === undefined ||
				(protocolVersion !== null && protocolVersion >= entry.requiresProtocolVersion)) &&
			(entry.when?.(context) ?? true),
	);
}
