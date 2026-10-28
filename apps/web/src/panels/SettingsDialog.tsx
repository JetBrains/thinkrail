import { useT } from "@thinkrail/locales/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@thinkrail/ui/dialog";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useEffect } from "react";
import { SettingsSection, useAppStore } from "@/store";
import { loadInAppSurvey } from "@/transport";
import { AppearanceSettings } from "./AppearanceSettings";
import { ChatSettings } from "./ChatSettings";
import { EnvironmentSettings } from "./EnvironmentSettings";
import { ExtensionsSettings } from "./ExtensionsSettings";
import { FeedbackSettings } from "./FeedbackSettings";
import { GithubSettings } from "./GithubSettings";
import { LanguageSettings } from "./LanguageSettings";
import { McpSettings } from "./McpSettings";
import { ModelsSettings } from "./ModelsSettings";
import { NotificationsSettings } from "./NotificationsSettings";
import { PrivacySettings } from "./PrivacySettings";
import { ProvidersSettings } from "./ProvidersSettings";
import { resolveSettingsSection, settingsNavGroups } from "./settingsNav";
import { TemplatesSettings } from "./TemplatesSettings";
import { TerminalSettings } from "./TerminalSettings";
import { WorkspacesSettings } from "./WorkspacesSettings";

export function SettingsDialog({
	layoutSettings,
	updateSettings,
}: {
	layoutSettings: ReactNode;
	updateSettings?: ReactNode;
}) {
	const t = useT();
	const open = useAppStore((s) => s.settingsOpen);
	const section = useAppStore((s) => s.settingsSection);
	const protocolVersion = useAppStore((s) => s.protocolVersion);
	const filteredGroups = settingsNavGroups(protocolVersion, updateSettings !== undefined);
	const selectedSection = resolveSettingsSection(section, filteredGroups);
	const feedbackActive = selectedSection === SettingsSection.Feedback;
	const inAppSurvey = useAppStore((state) => state.inAppSurvey);

	useEffect(() => {
		if (open) loadInAppSurvey();
	}, [open]);

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
						document.activeElement.hasAttribute("data-settings-draft-input")
					) {
						event.preventDefault();
					}
				}}
				className="flex h-[80vh] max-h-[85vh] w-full max-w-[52rem] flex-col gap-0 overflow-hidden p-0"
			>
				<DialogHeader className="border-border-default border-b px-16 py-12">
					<DialogTitle>{t("settings.dialog.title")}</DialogTitle>
				</DialogHeader>

				<div className="flex min-h-0 flex-1 flex-col md:flex-row">
					<nav
						aria-label={t("settings.dialog.sectionsLabel")}
						className="flex shrink-0 gap-4 overflow-x-auto border-border-default border-b p-8 md:w-192 md:flex-col md:gap-12 md:overflow-x-visible md:overflow-y-auto md:border-r md:border-b-0 md:bg-container-elevated-bg md:p-12"
					>
						{filteredGroups.map((group) => (
							<div key={group.label} className="flex shrink-0 md:flex-col">
								<span className="hidden h-28 py-4 tr-text-label-pill text-text-subtle uppercase md:block">
									{t(group.label)}
								</span>
								<div className="flex gap-4 md:flex-col md:gap-2">
									{group.sections.map(({ id, label, icon: Icon }) => {
										const active = selectedSection === id;
										return (
											<button
												key={id}
												type="button"
												data-testid={`settings-nav-${id}`}
												data-active={active}
												onClick={() => useAppStore.getState().setSettingsSection(id)}
												className={cn(
													"flex shrink-0 items-center gap-4 rounded-sm px-4 py-4 text-left tr-text-ui outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary md:h-28 md:w-full md:px-8 md:py-0",
													active
														? "bg-primary-subtle text-primary"
														: "text-text-muted hover:bg-control-bg-hovered hover:text-text-default",
												)}
											>
												<Icon className="size-14 shrink-0" />
												{t(label)}
											</button>
										);
									})}
								</div>
							</div>
						))}

						{inAppSurvey ? (
							<button
								type="button"
								data-testid="settings-nav-feedback"
								data-active={feedbackActive}
								onClick={() => useAppStore.getState().setSettingsSection(SettingsSection.Feedback)}
								className={cn(
									"shrink-0 rounded-sm border border-primary-soft px-8 py-4 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary md:mt-auto md:px-12 md:py-8",
									feedbackActive
										? "bg-primary-subtle"
										: "bg-control-bg hover:bg-control-bg-hovered",
								)}
							>
								<span className="tr-text-ui text-primary">{t("settings.dialog.surveyCta")}</span>
							</button>
						) : null}
					</nav>

					<div className="min-h-0 flex-1 overflow-y-auto p-16">
						{selectedSection === SettingsSection.Models ? (
							<ModelsSettings />
						) : selectedSection === SettingsSection.Providers ? (
							<ProvidersSettings />
						) : selectedSection === SettingsSection.Mcp ? (
							<McpSettings />
						) : selectedSection === SettingsSection.Templates ? (
							<TemplatesSettings />
						) : selectedSection === SettingsSection.Environment ? (
							<EnvironmentSettings />
						) : selectedSection === SettingsSection.Extensions ? (
							<ExtensionsSettings />
						) : selectedSection === SettingsSection.Chat ? (
							<ChatSettings />
						) : selectedSection === SettingsSection.Appearance ? (
							<AppearanceSettings />
						) : selectedSection === SettingsSection.Language ? (
							<LanguageSettings />
						) : selectedSection === SettingsSection.Layout ? (
							layoutSettings
						) : selectedSection === SettingsSection.Terminal ? (
							<TerminalSettings />
						) : selectedSection === SettingsSection.Workspaces ? (
							<WorkspacesSettings />
						) : selectedSection === SettingsSection.Github ? (
							<GithubSettings />
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
