import { RiCloseLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@thinkrail/ui/dialog";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { useLocalKeys } from "@thinkrail/ui/local-keys";
import {
	type KeyboardEvent,
	type ReactNode,
	type RefObject,
	useEffect,
	useEffectEvent,
	useRef,
	useState,
} from "react";
import { flushSync } from "react-dom";
import { LOCAL_KEY_DEFAULTS } from "@/keybindings";
import {
	escapeStep,
	focusSettingRow,
	holdSettingsEscape,
	jumpToSetting,
	SettingsDialogContainer,
	type SettingsJump,
	SettingsJumpContext,
	useSettingsKeyboard,
	walkKey,
} from "@/settingsKit";
import { SettingsSection, selectInstalledExtensions, useAppStore } from "@/store";
import { loadInAppSurvey, supportsExtensionSettings } from "@/transport";
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
import { SettingsSearchField, SettingsSearchResults } from "./SettingsSearchView";
import { SETTINGS_PANEL_ID, SettingsTabs, settingsTabId } from "./SettingsTabs";
import { SubagentsSettings } from "./SubagentsSettings";
import { useSettingsCatalogContext } from "./settingsCatalog";
import { resolveSettingsSection, settingsNavGroups } from "./settingsNav";
import {
	installedExtensionSearchEntries,
	type SettingsSearchEntry,
	searchSettings,
	settingsSearchEntries,
	settingsSectionLabels,
} from "./settingsSearch";
import { TemplatesSettings } from "./TemplatesSettings";
import { TerminalSettings } from "./TerminalSettings";
import { TextFontsSettings } from "./TextFontsSettings";
import { useProviderStatus } from "./useProviderStatus";
import { VoiceSettings } from "./VoiceSettings";
import { WorkspacesSettings } from "./WorkspacesSettings";

export interface SettingsDialogProps {
	readonly layoutSettings: ReactNode;
	readonly keyboardSettings: ReactNode;
	readonly updateSettings?: ReactNode;
	readonly searchEntries?: readonly SettingsSearchEntry[];
}

interface SectionContent {
	readonly layoutSettings: ReactNode;
	readonly keyboardSettings: ReactNode;
	readonly updateSettings?: ReactNode;
}

function sectionContent(section: SettingsSection, injected: SectionContent): ReactNode {
	switch (section) {
		case SettingsSection.Models:
			return <ModelsSettings />;
		case SettingsSection.Providers:
			return <ProvidersSettings />;
		case SettingsSection.Subagents:
			return <SubagentsSettings />;
		case SettingsSection.Mcp:
			return <McpSettings />;
		case SettingsSection.Templates:
			return <TemplatesSettings />;
		case SettingsSection.Environment:
			return <EnvironmentSettings />;
		case SettingsSection.Extensions:
			return <ExtensionsSettings />;
		case SettingsSection.Chat:
			return <ChatSettings />;
		case SettingsSection.Text:
			return <TextFontsSettings />;
		case SettingsSection.Language:
			return <LanguageSettings />;
		case SettingsSection.Layout:
			return injected.layoutSettings;
		case SettingsSection.Keyboard:
			return injected.keyboardSettings;
		case SettingsSection.Terminal:
			return <TerminalSettings />;
		case SettingsSection.Voice:
			return <VoiceSettings />;
		case SettingsSection.Workspaces:
			return <WorkspacesSettings />;
		case SettingsSection.Github:
			return <GithubSettings />;
		case SettingsSection.Notifications:
			return <NotificationsSettings />;
		case SettingsSection.Privacy:
			return <PrivacySettings />;
		case SettingsSection.Updates:
			return injected.updateSettings ?? <AppearanceSettings />;
		case SettingsSection.Feedback:
			return <FeedbackSettings />;
		default:
			return <AppearanceSettings />;
	}
}

const SELECTED_TAB = '[data-key-scope="settings.nav"] > [role="tab"][aria-selected="true"]';
const RESULT = '[role="option"]';

function focusSelectedTab(root: ParentNode | null | undefined): boolean {
	const tab = root?.querySelector<HTMLElement>(SELECTED_TAB);
	tab?.focus();
	return tab != null;
}

interface JumpOrigin {
	readonly index: number;
	readonly section: SettingsSection;
}

interface SettingsFrameProps extends SettingsDialogProps {
	readonly container: HTMLElement | null;
	readonly lastFocused: RefObject<Map<SettingsSection, string>>;
}

function SettingsFrame({
	layoutSettings,
	keyboardSettings,
	updateSettings,
	searchEntries,
	container,
	lastFocused,
}: SettingsFrameProps) {
	const t = useT();
	const section = useAppStore((s) => s.settingsSection);
	const target = useAppStore((s) => s.settingsTarget);
	const catalogContext = useSettingsCatalogContext();
	const { protocolVersion } = catalogContext;
	const extensionCatalog = useAppStore((s) => s.extensionCatalog);
	useProviderStatus();
	const resultKeys = useLocalKeys("settings", LOCAL_KEY_DEFAULTS.settings);
	const groups = settingsNavGroups(protocolVersion, updateSettings !== undefined);
	const selected = resolveSettingsSection(section, groups);
	const sectionLabels = settingsSectionLabels(t, groups);
	const icons = new Map(groups.flatMap((group) => group.sections.map((s) => [s.id, s.icon])));

	const [query, setQuery] = useState("");
	const [showResults, setShowResults] = useState(false);
	const [jumpFrom, setJumpFrom] = useState<JumpOrigin | null>(null);
	const [active, setActive] = useState(0);
	const [jump, setJump] = useState<SettingsJump | null>(null);
	const results = showResults
		? searchSettings(
				query,
				settingsSearchEntries(t, groups, catalogContext, [
					...(searchEntries ?? []),
					...installedExtensionSearchEntries(
						selectInstalledExtensions(extensionCatalog),
						supportsExtensionSettings(protocolVersion),
					),
				]),
				sectionLabels,
			)
		: [];

	const navRef = useRef<HTMLDivElement>(null);
	const fieldRef = useRef<HTMLInputElement>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const resultsRef = useRef<HTMLDivElement>(null);
	const jumpRun = useRef<AbortController | null>(null);
	const jumpSeq = useRef(0);

	const focusTab = () => focusSelectedTab(navRef.current);
	const focusResult = (index: number) => {
		resultsRef.current?.querySelectorAll<HTMLElement>(RESULT)[index]?.focus();
	};
	const resetScroll = () => {
		if (scrollRef.current) scrollRef.current.scrollTop = 0;
	};
	const stopJump = () => {
		jumpRun.current?.abort();
		jumpRun.current = null;
		setJump(null);
	};
	const clearSearch = () => {
		setQuery("");
		setShowResults(false);
		setJumpFrom(null);
		setActive(0);
	};

	const startJump = (id: string) => {
		stopJump();
		const run = new AbortController();
		jumpRun.current = run;
		jumpSeq.current += 1;
		setJump({ id, seq: jumpSeq.current });
		requestAnimationFrame(() => {
			const panel = panelRef.current;
			if (run.signal.aborted || !panel) return;
			void jumpToSetting(panel, id, run.signal).then((found) => {
				if (run.signal.aborted) return;
				jumpRun.current = null;
				setJump(null);
				if (!found || !panel.contains(document.activeElement)) focusTab();
			});
		});
	};

	const settled = useRef(false);
	const onTarget = useEffectEvent(() => {
		const id = useAppStore.getState().consumeSettingsTarget();
		if (id === null) return;
		if (settled.current) focusTab();
		clearSearch();
		startJump(id);
	});
	useEffect(() => {
		if (target !== null) onTarget();
	}, [target]);
	useEffect(() => {
		settled.current = true;
	}, []);

	const selectSection = (next: SettingsSection) => {
		stopJump();
		clearSearch();
		useAppStore.getState().setSettingsSection(next);
	};

	const enterContent = () => {
		if (showResults) return focusResult(active);
		const panel = panelRef.current;
		if (panel) focusSettingRow<HTMLElement>(panel, lastFocused.current.get(selected) ?? null);
	};

	const focusSearch = () => {
		fieldRef.current?.focus();
		fieldRef.current?.select();
	};

	const onQuery = (next: string) => {
		stopJump();
		setQuery(next);
		setShowResults(next.trim() !== "");
		setJumpFrom(null);
		setActive(0);
		resetScroll();
	};

	const jumpToResult = (index: number) => {
		const result = results[index];
		if (!result) return;
		navRef.current
			?.querySelector<HTMLElement>(`#${settingsTabId(result.entry.section)}`)
			?.focus({ preventScroll: true });
		setShowResults(false);
		setJumpFrom({ index, section: result.entry.section });
		setActive(index);
		useAppStore.getState().setSettingsSection(result.entry.section);
		startJump(result.entry.id);
	};

	const backToResults = () => {
		if (jumpFrom === null) return;
		const { index } = jumpFrom;
		stopJump();
		flushSync(() => {
			setShowResults(true);
			setJumpFrom(null);
			setActive(index);
		});
		resetScroll();
		focusResult(index);
	};

	const onFieldKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		if (event.key === "Escape") {
			event.preventDefault();
			const step = escapeStep({ place: "search", jumped: false, query: query !== "" });
			if (step === "clear") clearSearch();
			else focusTab();
			return;
		}
		if (results.length === 0) return;
		if (event.key === "ArrowDown") {
			event.preventDefault();
			focusResult(0);
		} else if (event.key === "Enter") {
			event.preventDefault();
			jumpToResult(Math.min(active, results.length - 1));
		}
	};

	const onResultKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
		if (event.defaultPrevented || isImeComposing(event.nativeEvent)) return;
		const plain = !(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey);
		if (plain && event.key === "Enter") {
			event.preventDefault();
			return jumpToResult(index);
		}
		const key = walkKey(event.nativeEvent, resultKeys.match(event.nativeEvent));
		if (key === null || key === "reset") return;
		event.preventDefault();
		const last = results.length - 1;
		switch (key) {
			case "escape":
				fieldRef.current?.focus();
				clearSearch();
				return resetScroll();
			case "left":
				return focusTab();
			case "right":
				return jumpToResult(index);
			case "up":
				return index === 0 ? fieldRef.current?.focus() : focusResult(index - 1);
			case "down":
				return focusResult(Math.min(last, index + 1));
			case "home":
				return focusResult(0);
			case "end":
				return focusResult(last);
		}
	};

	const returnsToResults =
		jumpFrom !== null && query.trim() !== "" && jumpFrom.section === selected;
	const keyboard = useSettingsKeyboard({
		toNav: focusTab,
		toResults: returnsToResults ? backToResults : undefined,
		onRowFocus: (rowId) => lastFocused.current.set(selected, rowId),
	});

	return (
		<>
			<div className="flex shrink-0 flex-col border-border-default border-b md:min-h-0 md:w-220 md:border-r md:border-b-0">
				<div className="flex shrink-0 items-center px-16 pt-12 pb-8">
					<DialogTitle>{t("settings.dialog.title")}</DialogTitle>
				</div>
				<SettingsSearchField
					ref={fieldRef}
					query={query}
					onQuery={onQuery}
					onKeyDown={onFieldKeyDown}
					onFocus={() => {
						if (query.trim() === "" || showResults) return;
						stopJump();
						setShowResults(true);
						setJumpFrom(null);
						resetScroll();
					}}
				/>
				<SettingsTabs
					ref={navRef}
					groups={groups}
					selected={selected}
					searching={showResults}
					onSelect={selectSection}
					onEnter={enterContent}
					onSearch={focusSearch}
				/>
			</div>
			<div
				key={selected}
				ref={scrollRef}
				data-testid="settings-scroller"
				className="min-h-0 min-w-0 flex-1 overflow-y-auto"
			>
				<div className="mx-auto flex w-full max-w-760 flex-col p-24">
					{showResults ? (
						<SettingsSearchResults
							ref={resultsRef}
							query={query}
							results={results}
							active={active}
							icons={icons}
							onActive={setActive}
							onJump={jumpToResult}
							onKeyDown={onResultKeyDown}
						/>
					) : null}
					<div
						ref={panelRef}
						role="tabpanel"
						id={SETTINGS_PANEL_ID}
						aria-labelledby={settingsTabId(selected)}
						hidden={showResults}
						data-settings-content=""
						data-key-scope="settings"
						onKeyDown={keyboard.onKeyDown}
						onFocus={keyboard.onFocus}
					>
						<SettingsDialogContainer value={container}>
							<SettingsJumpContext value={jump}>
								{sectionContent(selected, { layoutSettings, keyboardSettings, updateSettings })}
							</SettingsJumpContext>
						</SettingsDialogContainer>
					</div>
				</div>
			</div>
		</>
	);
}

export function SettingsDialog(props: SettingsDialogProps) {
	const t = useT();
	const open = useAppStore((s) => s.settingsOpen);
	const lastFocused = useRef(new Map<SettingsSection, string>());
	const [dialogEl, setDialogEl] = useState<HTMLElement | null>(null);

	useEffect(() => {
		if (open) void loadInAppSurvey();
	}, [open]);

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) useAppStore.getState().closeSettings();
			}}
		>
			<DialogContent
				ref={setDialogEl}
				data-testid="settings-dialog"
				data-settings-dialog=""
				hideClose
				aria-describedby={undefined}
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					const root = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
					if (!focusSelectedTab(root)) root?.focus();
				}}
				onEscapeKeyDown={holdSettingsEscape}
				className="h-[calc(100dvh-2*var(--space-24))] w-[calc(100%-2*var(--space-24))] max-w-1028 gap-0 overflow-hidden p-0 md:flex-row"
			>
				<SettingsFrame {...props} container={dialogEl} lastFocused={lastFocused} />
				<DialogClose asChild>
					<IconButton
						icon={RiCloseLine}
						label={t("common.close")}
						tabIndex={0}
						className="absolute top-12 right-12"
					/>
				</DialogClose>
			</DialogContent>
		</Dialog>
	);
}
