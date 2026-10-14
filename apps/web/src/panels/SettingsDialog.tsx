import {
	RiBrainLine as Brain,
	RiDownloadCloud2Line as DownloadCloud,
	RiGithubFill as GitHub,
	RiKeyLine as KeyRound,
	RiLayoutTop2Line as LayoutPanelTop,
	RiLayoutGridLine as LayoutTemplate,
	type RemixiconComponentType as LucideIcon,
	RiChat2Line as MessageSquareText,
	RiNotification3Line as NotificationBell,
	RiPaletteLine as Palette,
	RiPlugLine as Plug,
	RiRefreshLine as Refresh,
	RiShieldCheckLine as ShieldCheck,
	RiTerminalBoxLine as SquareTerminal,
} from "@remixicon/react";
import { DEFAULT_MODEL_PROTOCOL_VERSION, MCP_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@thinkrail/ui/dialog";
import { cn } from "@thinkrail/ui/utils";
import type { ReactNode } from "react";
import { SettingsSection, useAppStore } from "@/store";
import { AppearanceSettings } from "./AppearanceSettings";
import { ChatSettings } from "./ChatSettings";
import { FeedbackSettings } from "./FeedbackSettings";
import { GithubSettings } from "./GithubSettings";
import { McpSettings } from "./McpSettings";
import { ModelsSettings } from "./ModelsSettings";
import { NotificationsSettings } from "./NotificationsSettings";
import { PrivacySettings } from "./PrivacySettings";
import { ProvidersSettings } from "./ProvidersSettings";
import { TemplatesSettings } from "./TemplatesSettings";
import { TerminalSettings } from "./TerminalSettings";

interface NavSection {
	id: SettingsSection;
	label: string;
	icon: LucideIcon;
	requiresInjectedContent?: true;
	requiresProtocolVersion?: number;
}

interface NavGroup {
	label: string;
	sections: NavSection[];
}

const NAV_GROUPS: NavGroup[] = [
	{
		label: "Agent",
		sections: [
			{
				id: SettingsSection.Models,
				label: "Models",
				icon: Brain,
				requiresProtocolVersion: DEFAULT_MODEL_PROTOCOL_VERSION,
			},
			{ id: SettingsSection.Providers, label: "Providers", icon: KeyRound },
			{
				id: SettingsSection.Mcp,
				label: "MCP servers",
				icon: Plug,
				requiresProtocolVersion: MCP_PROTOCOL_VERSION,
			},
		],
	},
	{
		label: "Interface",
		sections: [
			{ id: SettingsSection.Chat, label: "Chat", icon: MessageSquareText },
			{ id: SettingsSection.Appearance, label: "Appearance", icon: Palette },
			{ id: SettingsSection.Layout, label: "Layout", icon: LayoutPanelTop },
			{ id: SettingsSection.Terminal, label: "Terminal", icon: SquareTerminal },
		],
	},
	{
		label: "Integrations",
		sections: [
			{ id: SettingsSection.Github, label: "GitHub", icon: GitHub },
			{ id: SettingsSection.Templates, label: "Prompt Templates", icon: LayoutTemplate },
		],
	},
	{
		label: "System",
		sections: [
			{ id: SettingsSection.Notifications, label: "Notifications", icon: NotificationBell },
			{ id: SettingsSection.Privacy, label: "Privacy", icon: ShieldCheck },
			{
				id: SettingsSection.Updates,
				label: "Updates",
				icon: DownloadCloud,
				requiresInjectedContent: true,
			},
		],
	},
];

export function SettingsDialog({
	layoutSettings,
	updateSettings,
}: {
	layoutSettings: ReactNode;
	updateSettings?: ReactNode;
}) {
	const open = useAppStore((s) => s.settingsOpen);
	const section = useAppStore((s) => s.settingsSection);
	const protocolVersion = useAppStore((s) => s.protocolVersion);

	// Filter sections based on requirements
	const isAvailable = (s: NavSection) =>
		(!s.requiresInjectedContent || updateSettings !== undefined) &&
		(s.requiresProtocolVersion === undefined ||
			(protocolVersion !== null && protocolVersion >= s.requiresProtocolVersion));

	// Get filtered groups (only include groups with at least one available section)
	const filteredGroups = NAV_GROUPS.map((group) => ({
		...group,
		sections: group.sections.filter(isAvailable),
	})).filter((group) => group.sections.length > 0);

	// Determine selected section
	// Feedback is not in NAV_GROUPS but is a valid section accessible via the sidebar card
	const availableSections = filteredGroups.flatMap((g) => g.sections);
	const selectedSection =
		section === SettingsSection.Feedback || availableSections.some((s) => s.id === section)
			? section
			: // Fall back to Appearance (always available) or the first available section
				availableSections.some((s) => s.id === SettingsSection.Appearance)
				? SettingsSection.Appearance
				: (availableSections[0]?.id ?? SettingsSection.Appearance);

	return (
		<Dialog
			open={open}
			onOpenChange={(o) => {
				if (!o) useAppStore.getState().closeSettings();
			}}
		>
			<DialogContent
				data-testid="settings-dialog"
				onEscapeKeyDown={(event) => {
					if (
						document.activeElement instanceof HTMLElement &&
						document.activeElement.hasAttribute("data-line-width-input")
					) {
						event.preventDefault();
					}
				}}
				className="flex h-[80vh] max-h-[85vh] w-full max-w-[52rem] flex-col gap-0 overflow-hidden p-0"
			>
				<DialogHeader className="border-border-default border-b px-16 py-12">
					<DialogTitle>Settings</DialogTitle>
				</DialogHeader>

				<div className="flex min-h-0 flex-1 flex-col md:flex-row">
					<nav
						aria-label="Settings sections"
						className="flex shrink-0 flex-col gap-4 overflow-x-auto border-border-default border-b p-8 md:w-[192px] md:gap-0 md:overflow-x-visible md:overflow-y-auto md:border-r md:border-b-0 md:bg-container-elevated-bg md:p-12"
					>
						{/* Mobile: horizontal scroll of all sections */}
						<div className="flex gap-4 md:hidden">
							{availableSections.map(({ id, label, icon: Icon }) => {
								const active = selectedSection === id;
								return (
									<button
										key={id}
										type="button"
										data-testid={`settings-nav-${id}`}
										data-active={active}
										onClick={() => useAppStore.getState().setSettingsSection(id)}
										className={cn(
											"flex shrink-0 items-center gap-4 rounded-sm px-4 py-4 text-left tr-text-ui outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
											active
												? "bg-primary-subtle text-primary"
												: "text-text-muted hover:bg-control-bg-hovered hover:text-text-default",
										)}
									>
										<Icon className="size-14 shrink-0" />
										{label}
									</button>
								);
							})}
						</div>

						{/* Desktop: grouped sections */}
						<div className="hidden md:flex md:flex-1 md:flex-col md:justify-between">
							<div className="flex flex-col">
								{filteredGroups.map((group, groupIndex) => (
									<div key={group.label} className={cn(groupIndex > 0 && "pt-12")}>
										<span className="block h-28 py-4 tr-text-label-pill text-text-subtle uppercase">
											{group.label}
										</span>
										<div className="flex flex-col gap-2">
											{group.sections.map(({ id, label, icon: Icon }) => {
												const active = selectedSection === id;
												const showRefresh = id === SettingsSection.Providers && active;
												return (
													<div
														key={id}
														className={cn(
															"relative flex h-28 w-full shrink-0 items-center rounded-sm",
															active && "bg-primary-subtle",
														)}
													>
														<button
															type="button"
															data-testid={`settings-nav-${id}`}
															data-active={active}
															onClick={() => useAppStore.getState().setSettingsSection(id)}
															className={cn(
																"flex h-28 flex-1 items-center gap-4 rounded-sm px-8 text-left tr-text-ui outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
																active
																	? "text-primary"
																	: "text-text-muted hover:bg-control-bg-hovered hover:text-text-default",
															)}
														>
															<Icon className="size-14 shrink-0" />
															{label}
														</button>
														{showRefresh && (
															<button
																type="button"
																data-testid="providers-refresh"
																aria-label="Refresh providers"
																onClick={(e) => {
																	e.stopPropagation();
																	useAppStore.getState().requestProvidersRefresh();
																}}
																className="mr-4 flex size-20 shrink-0 items-center justify-center rounded-sm text-text-muted outline-none transition-colors hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
															>
																<Refresh className="size-14" />
															</button>
														)}
													</div>
												);
											})}
										</div>
									</div>
								))}
							</div>

							{/* Interview invitation in footer */}
							<button
								type="button"
								data-testid="settings-feedback-notice"
								onClick={() => useAppStore.getState().setSettingsSection(SettingsSection.Feedback)}
								className="rounded-sm border border-primary-soft bg-control-bg px-12 py-8 text-left outline-none transition-colors hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-primary"
							>
								<span className="tr-text-ui text-primary">
									Earn 100 credits for honest feedback
								</span>
							</button>
						</div>
					</nav>

					<div className="min-h-0 flex-1 overflow-y-auto p-16">
						{selectedSection === SettingsSection.Models ? (
							<ModelsSettings />
						) : selectedSection === SettingsSection.Providers ? (
							<ProvidersSettings />
						) : selectedSection === SettingsSection.Mcp ? (
							<McpSettings />
						) : selectedSection === SettingsSection.Chat ? (
							<ChatSettings />
						) : selectedSection === SettingsSection.Appearance ? (
							<AppearanceSettings />
						) : selectedSection === SettingsSection.Layout ? (
							layoutSettings
						) : selectedSection === SettingsSection.Terminal ? (
							<TerminalSettings />
						) : selectedSection === SettingsSection.Github ? (
							<GithubSettings />
						) : selectedSection === SettingsSection.Templates ? (
							<TemplatesSettings />
						) : selectedSection === SettingsSection.Notifications ? (
							<NotificationsSettings />
						) : selectedSection === SettingsSection.Privacy ? (
							<PrivacySettings />
						) : selectedSection === SettingsSection.Updates && updateSettings !== undefined ? (
							updateSettings
						) : selectedSection === SettingsSection.Feedback ? (
							<FeedbackSettings />
						) : (
							<AppearanceSettings />
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
