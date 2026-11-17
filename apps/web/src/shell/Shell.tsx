import {
	RiCircleLine as Circle,
	RiCircleFill,
	RiSearchLine,
	RiShareCircleFill,
	RiSettings3Line as Settings,
	RiShareCircleLine as WikiIcon,
} from "@remixicon/react";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { LocalKeymapProvider } from "@thinkrail/ui/local-keys";
import { useEffect, useState } from "react";
import { useContinuations } from "../chat/continuations";
import { openFindInFiles } from "../findInFiles";
import {
	applyFontPreference,
	DEFAULT_FONT_PREFERENCE,
	installUserFonts,
	writeFontsHint,
} from "../fonts";
import { NotificationPermissionPrompt, useAttentionNotifications } from "../notifications";
import { AnalyticsConsentDialog } from "../panels/AnalyticsConsentDialog";
import { canStartProjectlessChat } from "../panels/chatActions";
import { NewWorkspaceDialog } from "../panels/NewWorkspaceDialog";
import { SettingsDialog } from "../panels/SettingsDialog";
import { SurveyInvitationDialog } from "../panels/SurveyInvitationDialog";
import { SurveyWindow } from "../panels/SurveyWindow";
import { Toaster } from "../panels/Toaster";
import { useBranchStatus } from "../panels/useBranchStatus";
import { WikiPage } from "../panels/WikiPage";
import { useCreationChatHandoff, WorkspaceCreationView } from "../panels/WorkspaceCreation";
import { useWikiPageState } from "../panels/wikiPageState";
import { SearchSettings } from "../search";
import {
	isChatWorkspace,
	SettingsSection,
	selectActiveWorkspace,
	selectAnalyticsConsentPromptOpen,
	selectContextProject,
	selectContextRepoProject,
	selectOnboardingActive,
	selectRepoWikiSupported,
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
	hostUrl,
	runHostUpdate,
	supportsFonts,
	supportsHostUpdateRun,
	supportsUserThemes,
} from "../transport";
import { UpdateInstallSurfaces, UpdateReadyButton, UpdateSettings, useUpdates } from "../updates";
import { AppShortcuts } from "./AppShortcuts";
import { BrandLogo } from "./BrandLogo";
import {
	closeActiveItem,
	focusCenterGroup,
	focusChatComposer,
	focusProjects,
	focusTerminal,
	showFiles,
	toggleBottomPanel,
	toggleLeftSide,
	toggleReviewPanel,
	toggleRightSide,
} from "./chordActions";
import { ExtensionOverlays } from "./ExtensionOverlays";
import { installEscapeLeavesField } from "./escapeLeavesField";
import { FindInFilesHost } from "./FindInFilesHost";
import { installFocusRecovery } from "./focusRecovery";
import { JbcentralQuotaTopbar } from "./JbcentralQuotaTopbar";
import { KeybindingEditor } from "./KeybindingEditor";
import { useKeybindingLabel, useLocalKeymap } from "./keybindingState";
import { LayoutSettings } from "./LayoutSettings";
import { useLocalLayoutState } from "./layoutState";
import { LocationBar } from "./locationBar";
import { NativeWindowControls } from "./NativeWindowControls";
import { PROJECT_HOME_PROJECTS_REGION_ID, ProjectHome } from "./ProjectHome";
import { installRegionTracker, pressRegionKey } from "./regions";
import { SearchPaletteHost } from "./SearchPaletteHost";
import { ShortcutsDialogHost } from "./ShortcutsDialog";
import { ReviewChangesButton, SidebarToggle, TerminalToggle } from "./TopbarControls";
import { hasNativeShortcuts, readSettingsShortcutLabel } from "./useAppShortcuts";
import { useCollapsibleRegion } from "./useCollapsibleRegion";
import { useGlobalHotkeys } from "./useGlobalHotkeys";
import { useNativeWindowControls } from "./useNativeWindowControls";
import { WorkspaceWorkbench } from "./WorkspaceWorkbench";
import { runActiveTabAction } from "./workbenchCommands";

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
	return (
		<LocalKeymapProvider value={useLocalKeymap()}>
			<ShellLayout />
		</LocalKeymapProvider>
	);
}

function ShellLayout() {
	const t = useT();
	useLocalLayoutState();
	useAttentionNotifications();
	useContinuations();
	const status = useAppStore((s) => s.status);
	const analyticsConsentOpen = useAppStore(selectAnalyticsConsentPromptOpen);
	const onboardingActive = useAppStore(selectOnboardingActive);
	const StatusDot = status === "connected" ? RiCircleFill : Circle;
	const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId);
	const activeWorkspace = useAppStore(selectActiveWorkspace);
	const contextProject = useAppStore(selectContextProject);
	const contextRepoProject = useAppStore(selectContextRepoProject);
	const activeChat = activeWorkspace !== null && isChatWorkspace(activeWorkspace);
	const wikiSupported = useAppStore(selectRepoWikiSupported);
	const wikiOpen = useWikiPageState((state) => state.openFor === activeWorkspaceId);
	const canOpenWiki = wikiSupported && activeWorkspaceId !== null && !activeChat;
	const {
		review: openReview,
		url: openReviewUrl,
		status: branchStatus,
		noteOpenReview,
		refreshBranchStatus,
	} = useBranchStatus(activeChat ? null : activeWorkspace, status, { pollChecks: true });
	const locationReview =
		openReview && openReviewUrl ? { ...openReview, url: openReviewUrl } : openReview;
	const hasActiveWorkspace = activeWorkspaceId != null;
	const protocolVersion = useAppStore((s) => s.protocolVersion);
	const updates = useUpdates(supportsHostUpdateRun(protocolVersion) ? runHostUpdate : null);
	const windowControls = useNativeWindowControls();
	const [newWorkspace, setNewWorkspace] = useState<{
		projectId: string | null;
		initialPrompt?: string;
	} | null>(null);
	const activeCreation = useAppStore((s) =>
		s.activeCreationId ? s.workspaceCreations[s.activeCreationId] : undefined,
	);
	const workspaceRetryDraft = useAppStore((s) => s.workspaceRetryDraft);
	useCreationChatHandoff();
	const canStartChat = useAppStore(canStartProjectlessChat);
	const openNewWork = (initialPrompt?: string): boolean => {
		if (!contextRepoProject && !canStartChat) return false;
		if (newWorkspace !== null || workspaceRetryDraft !== null) return false;
		setNewWorkspace({
			projectId: contextRepoProject?.id ?? null,
			...(initialPrompt === undefined ? {} : { initialPrompt }),
		});
		return true;
	};

	const homeProjects = useCollapsibleRegion<HTMLDivElement>(PROJECT_HOME_PROJECTS_REGION_ID);
	const leftSideVisible = useAppStore((s) => s.workbenchFrame?.left.visible ?? false);
	const rightSideVisible = useAppStore((s) => s.workbenchFrame?.right.visible ?? false);
	const searchShortcut = useKeybindingLabel("search.open");
	const [nativeShortcuts] = useState(hasNativeShortcuts);
	const newWorkspaceShortcut = useKeybindingLabel("workspace.new", { browser: !nativeShortcuts });

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
	const interfaceFont = useAppStore((s) => s.interfaceFont);
	const codeFont = useAppStore((s) => s.codeFont);
	const codeFontSize = useAppStore((s) => s.codeFontSize);
	const codeLigatures = useAppStore((s) => s.codeLigatures);
	const fontWeightOffset = useAppStore((s) => s.fontWeightOffset);
	const userFonts = useAppStore((s) => s.userFonts);
	const fontsSupported = supportsFonts(protocolVersion);
	useEffect(() => {
		if (welcomeGeneration === 0) return;
		if (!fontsSupported) {
			installUserFonts([]);
			applyFontPreference(DEFAULT_FONT_PREFERENCE);
			writeFontsHint(DEFAULT_FONT_PREFERENCE, []);
			return;
		}
		const preference = { interfaceFont, codeFont, codeFontSize, codeLigatures, fontWeightOffset };
		if (userFonts) installUserFonts(userFonts.files, hostUrl);
		applyFontPreference(preference);
		if (userFonts) writeFontsHint(preference, userFonts.files);
	}, [
		welcomeGeneration,
		fontsSupported,
		interfaceFont,
		codeFont,
		codeFontSize,
		codeLigatures,
		fontWeightOffset,
		userFonts,
	]);
	useEffect(installRegionTracker, []);
	useEffect(installFocusRecovery, []);
	useEffect(installEscapeLeavesField, []);
	useGlobalHotkeys({
		onProjects: () => toggleLeftSide(homeProjects.toggle),
		...(hasActiveWorkspace
			? {
					onWorkspace: toggleRightSide,
					onBottom: toggleBottomPanel,
					onFocusGroup: focusCenterGroup,
					onTerminal: focusTerminal,
					onFiles: () => showFiles("all"),
					...(activeChat ? {} : { onChanges: () => showFiles("changed") }),
					onSplitRight: runActiveTabAction,
					onMoveTab: runActiveTabAction,
				}
			: {}),
		onCloseTab: closeActiveItem,
		...(contextRepoProject || canStartChat ? { onNewWorkspace: () => void openNewWork() } : {}),
		onSearch: () => useAppStore.getState().openSearch(),
		onShortcuts: () => useAppStore.getState().openShortcuts(),
		onFindInFiles: openFindInFiles,
		onNextRegion: () => pressRegionKey(1),
		onPreviousRegion: () => pressRegionKey(-1),
		onComposer: focusChatComposer,
		onFocusProjects: () => focusProjects(homeProjects.toggle),
	});
	return (
		<div data-testid="shell" className="grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_1fr]">
			<header
				data-testid="topbar"
				data-region="topbar"
				data-region-kind="topbar"
				className="relative window-drag flex h-topbar-row min-w-0 select-none items-center border-b border-border-muted bg-container-header-bg px-12"
			>
				<div
					aria-hidden="true"
					data-testid="window-chrome-inset-left"
					className="w-window-chrome-inset-left shrink-0"
				/>
				<div className="flex min-w-0 flex-1 items-center gap-8 self-stretch pr-12">
					{onboardingActive ? null : (
						<SidebarToggle
							open={hasActiveWorkspace ? leftSideVisible : !homeProjects.collapsed}
							onToggle={() => toggleLeftSide(homeProjects.toggle)}
						/>
					)}
					<BrandLogo />
					{contextProject ? (
						<LocationBar
							project={contextProject}
							workspace={activeWorkspace}
							review={activeWorkspace ? locationReview : null}
							branchStatus={branchStatus}
							noteOpenReview={noteOpenReview}
							refreshBranchStatus={refreshBranchStatus}
							newWorkspaceShortcut={newWorkspaceShortcut}
							onNewWorkspace={() => openNewWork()}
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
					{activeWorkspaceId ? (
						<ReviewChangesButton
							workspaceId={activeWorkspaceId}
							gitWorkspaceId={activeChat ? null : activeWorkspaceId}
							onToggle={() => toggleReviewPanel(rightSideVisible, activeChat ? "all" : "changed")}
						/>
					) : null}
					{activeWorkspaceId ? <TerminalToggle onToggle={toggleBottomPanel} /> : null}
					{canOpenWiki && activeWorkspaceId ? (
						<IconButton
							variant="ghost"
							size="m"
							icon={wikiOpen ? RiShareCircleFill : WikiIcon}
							label={t("shell.topbar.wiki")}
							tooltip={t("shell.topbar.wiki")}
							selected={wikiOpen}
							data-testid="open-wiki"
							onClick={() => useWikiPageState.getState().toggle(activeWorkspaceId)}
						/>
					) : null}
					<IconButton
						variant="ghost"
						size="m"
						icon={RiSearchLine}
						label={t("shell.search.open")}
						tooltip={
							searchShortcut
								? t("shell.search.openWithShortcut", { shortcut: searchShortcut })
								: t("shell.search.open")
						}
						data-testid="open-search"
						onClick={() => useAppStore.getState().openSearch()}
					/>
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
					keyboardSettings={
						<SearchSettings openShortcut={searchShortcut} shortcuts={<KeybindingEditor />} />
					}
					updateSettings={updates ? <UpdateSettings updates={updates} /> : undefined}
				/>
				{newWorkspace !== null ? (
					<NewWorkspaceDialog
						open
						projectId={newWorkspace.projectId}
						{...(newWorkspace.initialPrompt === undefined
							? {}
							: { initialPrompt: newWorkspace.initialPrompt })}
						onOpenChange={(isOpen) => {
							if (!isOpen) setNewWorkspace(null);
						}}
					/>
				) : workspaceRetryDraft !== null ? (
					<NewWorkspaceDialog
						open
						projectId={workspaceRetryDraft.projectId}
						retryDraft={workspaceRetryDraft}
						onOpenChange={(isOpen) => {
							if (!isOpen) useAppStore.getState().clearWorkspaceRetry();
						}}
					/>
				) : null}
			</header>
			{hasActiveWorkspace && activeWorkspaceId ? (
				<div data-testid="workspace-shell-layout" className="relative h-full min-h-0 min-w-0">
					<div className="h-full min-h-0 min-w-0" inert={wikiOpen && canOpenWiki}>
						<WorkspaceWorkbench workspaceId={activeWorkspaceId} />
					</div>
					{wikiOpen && canOpenWiki ? <WikiPage workspaceId={activeWorkspaceId} /> : null}
				</div>
			) : (
				<ProjectHome
					projects={homeProjects}
					{...(activeCreation ? { main: <WorkspaceCreationView creation={activeCreation} /> } : {})}
				/>
			)}
			{onboardingActive ? null : analyticsConsentOpen ? (
				<AnalyticsConsentDialog />
			) : (
				<SurveyInvitationDialog />
			)}
			<SurveyWindow />
			<SearchPaletteHost
				onNewWorkspace={(_projectId, initialPrompt) => openNewWork(initialPrompt)}
				onToggleProjectsHome={homeProjects.toggle}
				hasUpdateSettings={updates !== null}
			/>
			<FindInFilesHost />
			<ShortcutsDialogHost />
			<NotificationPermissionPrompt />
			<Toaster />
			<UpdateInstallSurfaces updates={updates} />
			<AppShortcuts />
			<ExtensionOverlays />
		</div>
	);
}
