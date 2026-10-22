import {
	RiCircleLine as Circle,
	RiCircleFill,
	RiSettings3Line as Settings,
} from "@remixicon/react";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { useEffect, useState } from "react";
import { NotificationPermissionPrompt, useAttentionNotifications } from "../notifications";
import { AnalyticsConsentDialog } from "../panels/AnalyticsConsentDialog";
import { InterviewPromptDialog } from "../panels/InterviewPromptDialog";
import { NewWorkspaceDialog } from "../panels/NewWorkspaceDialog";
import { SettingsDialog } from "../panels/SettingsDialog";
import { Toaster } from "../panels/Toaster";
import { useBranchStatus } from "../panels/useBranchStatus";
import {
	SettingsSection,
	selectActiveWorkspace,
	selectAnalyticsConsentPromptOpen,
	selectContextProject,
	useAppStore,
} from "../store";
import {
	applyThemePreference,
	clearUserThemes,
	installUserThemes,
	onSystemAppearanceChange,
	readThemeHint,
	writeThemeHint,
} from "../themes";
import {
	type ConnectionStatus,
	runHostUpdate,
	supportsHostUpdateRun,
	supportsUserThemes,
} from "../transport";
import { UpdateInstallSurfaces, UpdateReadyButton, UpdateSettings, useUpdates } from "../updates";
import { AppShortcuts } from "./AppShortcuts";
import { BrandLogo } from "./BrandLogo";
import { JbcentralQuotaTopbar } from "./JbcentralQuotaTopbar";
import { LayoutSettings } from "./LayoutSettings";
import { useLocalLayoutState } from "./layoutState";
import { LocationBar } from "./locationBar";
import { NativeWindowControls } from "./NativeWindowControls";
import { PROJECT_HOME_PROJECTS_REGION_ID, ProjectHome } from "./ProjectHome";
import { SessionSwitcher } from "./SessionSwitcher";
import { readSettingsShortcutLabel } from "./useAppShortcuts";
import { useCollapsibleRegion } from "./useCollapsibleRegion";
import { useGlobalHotkeys } from "./useGlobalHotkeys";
import { useNativeWindowControls } from "./useNativeWindowControls";
import { WorkspaceWorkbench } from "./WorkspaceWorkbench";

const STATUS_LABEL = {
	connected: "shell.connection.connected",
	connecting: "shell.connection.connecting",
	disconnected: "shell.connection.disconnected",
} satisfies Record<ConnectionStatus, MessageKey>;

const STATUS_DOT: Record<ConnectionStatus, string> = {
	connected: "text-feedback-success",
	connecting: "text-feedback-warning",
	disconnected: "text-feedback-error",
};

export function Shell() {
	const t = useT();
	useLocalLayoutState();
	useAttentionNotifications();
	const status = useAppStore((s) => s.status);
	const analyticsConsentOpen = useAppStore(selectAnalyticsConsentPromptOpen);
	const StatusDot = status === "connected" ? RiCircleFill : Circle;
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	const activeWorkspace = useAppStore(selectActiveWorkspace);
	const contextProject = useAppStore(selectContextProject);
	const {
		review: openReview,
		url: openReviewUrl,
		status: branchStatus,
		noteOpenReview,
		refreshBranchStatus,
	} = useBranchStatus(activeWorkspace, status, { pollChecks: true });
	const locationReview =
		openReview && openReviewUrl ? { ...openReview, url: openReviewUrl } : openReview;
	const hasActiveWorkspace = activeWorkspaceId != null;
	const protocolVersion = useAppStore((s) => s.protocolVersion);
	const updates = useUpdates(supportsHostUpdateRun(protocolVersion) ? runHostUpdate : null);
	const windowControls = useNativeWindowControls();
	const [newWorkspaceProjectId, setNewWorkspaceProjectId] = useState<string | null>(null);
	const sessionSwitcherOpen = useAppStore((s) => s.sessionSwitcherOpen);

	const homeProjects = useCollapsibleRegion<HTMLDivElement>(PROJECT_HOME_PROJECTS_REGION_ID);

	const [themeHint] = useState(readThemeHint);
	const [settingsShortcut] = useState(readSettingsShortcutLabel);
	const welcomeGeneration = useAppStore((s) => s.welcomeGeneration);
	const theme = useAppStore((s) => s.theme);
	const themeMode = useAppStore((s) => s.themeMode);
	const systemThemePair = useAppStore((s) => s.systemThemePair);
	const userThemes = useAppStore((s) => s.userThemes);
	const userThemesUnsupported = welcomeGeneration > 0 && !supportsUserThemes(protocolVersion);
	useEffect(() => {
		if (userThemes) installUserThemes(userThemes.files);
		else if (userThemesUnsupported) clearUserThemes();
		const preference =
			welcomeGeneration === 0
				? themeHint
				: { theme, themeMode, ...(systemThemePair ? { systemThemePair } : {}) };
		const apply = () => applyThemePreference(preference);
		apply();
		if (welcomeGeneration > 0) writeThemeHint(preference);
		return preference.themeMode === "system" ? onSystemAppearanceChange(apply) : undefined;
	}, [
		themeHint,
		welcomeGeneration,
		theme,
		themeMode,
		systemThemePair,
		userThemes,
		userThemesUnsupported,
	]);
	useGlobalHotkeys({
		onProjects: hasActiveWorkspace
			? () => {
					if (!activeWorkspaceId) return;
					useAppStore.getState().enqueueLayoutIntent({
						kind: "toggle-side",
						workspaceId: activeWorkspaceId,
						side: "left",
					});
				}
			: homeProjects.toggle,
		...(hasActiveWorkspace
			? {
					onWorkspace: () => {
						if (!activeWorkspaceId) return;
						useAppStore.getState().enqueueLayoutIntent({
							kind: "toggle-side",
							workspaceId: activeWorkspaceId,
							side: "right",
						});
					},
					onBottom: () => {
						if (!activeWorkspaceId) return;
						useAppStore.getState().enqueueLayoutIntent({
							kind: "toggle-bottom",
							workspaceId: activeWorkspaceId,
						});
					},
				}
			: {}),
		...(contextProject
			? { onNewWorkspace: () => setNewWorkspaceProjectId(contextProject.id) }
			: {}),
		onSessionSwitcher: () => useAppStore.getState().toggleSessionSwitcher(),
	});
	return (
		<div data-testid="shell" className="grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr]">
			<header
				data-testid="topbar"
				className="relative window-drag flex h-topbar-row min-w-0 select-none items-center border-b border-border-default bg-container-header-bg px-16"
			>
				<div
					aria-hidden="true"
					data-testid="window-chrome-inset-left"
					className="w-window-chrome-inset-left shrink-0"
				/>
				<div className="flex min-w-0 flex-1 items-center gap-12 self-stretch pr-12">
					<BrandLogo />
					{contextProject ? (
						<LocationBar
							project={contextProject}
							workspace={activeWorkspace}
							review={activeWorkspace ? locationReview : null}
							branchStatus={branchStatus}
							noteOpenReview={noteOpenReview}
							refreshBranchStatus={refreshBranchStatus}
							onNewWorkspace={() => setNewWorkspaceProjectId(contextProject.id)}
						/>
					) : null}
				</div>
				<div
					data-testid="topbar-actions"
					className="window-no-drag ml-auto flex shrink-0 items-center gap-12"
				>
					{updates ? (
						<UpdateReadyButton
							updates={updates}
							onOpen={() => useAppStore.getState().openSettings(SettingsSection.Updates)}
						/>
					) : null}
					<JbcentralQuotaTopbar />
					<span
						data-testid="connection-status"
						data-status={status}
						role="status"
						aria-label={t(STATUS_LABEL[status])}
						className="inline-flex items-center gap-8 tr-text-ui text-text-muted"
					>
						<StatusDot
							aria-hidden="true"
							className={`size-8 shrink-0 fill-current ${STATUS_DOT[status]}`}
						/>
						<span aria-hidden="true" className="hidden sm:inline">
							{t(STATUS_LABEL[status])}
						</span>
					</span>
					<IconButton
						variant="ghost"
						size="m"
						icon={Settings}
						label={t("shell.topbar.settings")}
						tooltip={
							settingsShortcut
								? t("shell.topbar.settingsWithShortcut", { shortcut: settingsShortcut })
								: t("shell.topbar.settings")
						}
						data-testid="open-settings"
						onClick={() => useAppStore.getState().openSettings()}
					/>
				</div>
				<div
					aria-hidden="true"
					data-testid="window-chrome-inset-right"
					className="w-window-chrome-inset-right shrink-0"
				/>
				{windowControls ? (
					<NativeWindowControls
						state={windowControls.state}
						onMinimize={windowControls.minimize}
						onToggleMaximize={windowControls.toggleMaximize}
						onClose={windowControls.close}
					/>
				) : null}
				<SettingsDialog
					layoutSettings={<LayoutSettings />}
					updateSettings={updates ? <UpdateSettings updates={updates} /> : undefined}
				/>
				{newWorkspaceProjectId !== null ? (
					<NewWorkspaceDialog
						open
						projectId={newWorkspaceProjectId}
						onOpenChange={(isOpen) => {
							if (!isOpen) setNewWorkspaceProjectId(null);
						}}
					/>
				) : null}
			</header>
			{hasActiveWorkspace && activeWorkspaceId ? (
				<div data-testid="workspace-shell-layout" className="h-full min-h-0 min-w-0">
					<WorkspaceWorkbench workspaceId={activeWorkspaceId} />
				</div>
			) : (
				<ProjectHome projects={homeProjects} />
			)}
			{analyticsConsentOpen ? <AnalyticsConsentDialog /> : <InterviewPromptDialog />}
			<SessionSwitcher
				open={sessionSwitcherOpen}
				onOpenChange={(open) => {
					const store = useAppStore.getState();
					if (open) store.openSessionSwitcher();
					else store.closeSessionSwitcher();
				}}
			/>
			<NotificationPermissionPrompt />
			<Toaster />
			<UpdateInstallSurfaces updates={updates} />
			<AppShortcuts />
		</div>
	);
}
