import {
	RiArrowRightLine as ArrowRight,
	RiComputerLine as Device,
	RiPaletteLine as Palette,
} from "@remixicon/react";
import {
	type AppConfigUpdate,
	type SystemThemePair,
	THEME_SYSTEM_PROTOCOL_VERSION,
	type ThemeId,
	type ThemeMode,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { type Translator, useT } from "@thinkrail/locales/react";
import { useRef, useSyncExternalStore } from "react";
import {
	SettingsChoice,
	type SettingsChoiceOption,
	SettingsGroup,
	SettingsNotice,
	SettingsPage,
	SettingsRow,
} from "@/settingsKit";
import { toast, useAppStore } from "@/store";
import {
	deriveSystemThemePair,
	getThemes,
	getUserThemeIssues,
	onSystemAppearanceChange,
	onThemesChange,
	readSystemAppearance,
	resolveTheme,
	resolveThemePreference,
	type ThemeDescriptor,
	type ThemeResolution,
} from "@/themes";
import { errorText, getTransport } from "@/transport";
import { CustomThemesGroup } from "./CustomThemesSettings";
import { useFolderActions } from "./SettingsFolder";
import { THEME_RESET_PATCH } from "./settingDefaults";
import { SETTING, settingProps } from "./settingsCatalog";

type Appearance = ThemeDescriptor["appearance"];
type Contrast = ThemeDescriptor["contrast"];
export type ThemeModeOption = "system" | Appearance;

const BUNDLED_THEME_LABELS: Readonly<Record<string, MessageKey>> = {
	dark: "settings.appearance.themeName.dark",
	light: "settings.appearance.themeName.light",
	"high-contrast-dark": "settings.appearance.themeName.highContrastDark",
	"high-contrast-light": "settings.appearance.themeName.highContrastLight",
	"minimal-dark": "settings.appearance.themeName.minimalDark",
	"minimal-light": "settings.appearance.themeName.minimalLight",
};

const LIST_DESCRIPTIONS = {
	light: "settings.appearance.lightThemeDescription",
	dark: "settings.appearance.darkThemeDescription",
} as const satisfies Record<Appearance, MessageKey>;

function themeLabel(t: Translator, theme: Pick<ThemeDescriptor, "id" | "label">): string {
	const key = Object.hasOwn(BUNDLED_THEME_LABELS, theme.id)
		? BUNDLED_THEME_LABELS[theme.id]
		: undefined;
	return key ? t(key) : theme.label;
}

function familyKey(id: ThemeId): string {
	return id.replace(/(^|-)(light|dark)$/, "").replace(/^high-contrast-?/, "");
}

function counterpart(
	themes: readonly ThemeDescriptor[],
	from: ThemeDescriptor,
	appearance: Appearance,
	contrast: Contrast,
): ThemeDescriptor | null {
	const candidates = themes.filter(
		(theme) => theme.appearance === appearance && theme.contrast === contrast,
	);
	const family = familyKey(from.id);
	return (
		candidates.find((theme) => familyKey(theme.id) === family) ??
		candidates.find((theme) => familyKey(theme.id) === "") ??
		candidates[0] ??
		null
	);
}

function appearanceTarget(
	themes: readonly ThemeDescriptor[],
	from: ThemeDescriptor,
	appearance: Appearance,
): ThemeDescriptor | null {
	if (from.appearance === appearance) return from;
	return (
		counterpart(themes, from, appearance, from.contrast) ??
		themes.find((theme) => theme.appearance === appearance) ??
		null
	);
}

interface ThemeInputs {
	theme: ThemeId;
	themeMode: ThemeMode;
	systemThemePair: SystemThemePair | undefined;
	systemSupported: boolean;
	systemAppearance: Appearance;
	themes: readonly ThemeDescriptor[];
}

function themeView({
	theme,
	themeMode,
	systemThemePair,
	systemSupported,
	systemAppearance,
	themes,
}: ThemeInputs) {
	const activeTheme = resolveTheme(theme);
	const pair = systemThemePair ?? deriveSystemThemePair(theme);
	const preference = { theme, themeMode: "system" as const, systemThemePair: pair };
	const light = resolveThemePreference(preference, "light");
	const dark = resolveThemePreference(preference, "dark");
	const current = resolveThemePreference(preference, systemAppearance);
	const systemMode = systemSupported && themeMode === "system";
	const effectiveMode: ThemeModeOption = systemMode ? "system" : activeTheme.appearance;
	return {
		themes,
		theme,
		activeTheme,
		pair,
		light,
		dark,
		current,
		fixed: resolveThemePreference({ theme, themeMode: "fixed" }),
		systemSupported,
		systemMode,
		effectiveMode,
		contrast: (systemMode ? current.theme : activeTheme).contrast,
	};
}

type ThemeView = ReturnType<typeof themeView>;

function shownId(resolution: ThemeResolution): ThemeId {
	return resolution.fallback ? resolution.requestedId : resolution.theme.id;
}
type ThemeUpdate = (view: ThemeView) => AppConfigUpdate | null;

function storeThemeView(): ThemeView {
	const state = useAppStore.getState();
	return themeView({
		theme: state.theme,
		themeMode: state.themeMode,
		systemThemePair: state.systemThemePair,
		systemSupported: (state.protocolVersion ?? 0) >= THEME_SYSTEM_PROTOCOL_VERSION,
		systemAppearance: readSystemAppearance(),
		themes: getThemes(),
	});
}

function modeTarget(view: ThemeView, appearance: Appearance): ThemeDescriptor | null {
	return view.systemMode
		? view[appearance].theme
		: appearanceTarget(view.themes, view.activeTheme, appearance);
}

function contrastTargets(view: ThemeView, contrast: Contrast) {
	return view.systemMode
		? {
				light: counterpart(view.themes, view.light.theme, "light", contrast),
				dark: counterpart(view.themes, view.dark.theme, "dark", contrast),
			}
		: { fixed: counterpart(view.themes, view.activeTheme, view.activeTheme.appearance, contrast) };
}

function contrastAvailable(view: ThemeView, contrast: Contrast): boolean {
	return Object.values(contrastTargets(view, contrast)).some((target) => target !== null);
}

function modeUpdate(view: ThemeView, mode: ThemeModeOption): AppConfigUpdate | null {
	if (mode === view.effectiveMode) return null;
	if (mode === "system") return { themeMode: "system", systemThemePair: view.pair };
	const target = modeTarget(view, mode);
	return target ? { theme: target.id, themeMode: "fixed" } : null;
}

function themeUpdate(view: ThemeView, appearance: Appearance, id: ThemeId): AppConfigUpdate | null {
	if (!view.systemMode) return id === view.theme ? null : { theme: id, themeMode: "fixed" };
	const next: SystemThemePair = { ...view.pair, [appearance]: id };
	return next.light === view.pair.light && next.dark === view.pair.dark
		? null
		: { systemThemePair: next };
}

function contrastUpdate(view: ThemeView, contrast: Contrast): AppConfigUpdate | null {
	if (contrast === view.contrast) return null;
	const targets = contrastTargets(view, contrast);
	if ("fixed" in targets)
		return targets.fixed ? { theme: targets.fixed.id, themeMode: "fixed" } : null;
	const next: SystemThemePair = {
		light: targets.light?.id ?? view.pair.light,
		dark: targets.dark?.id ?? view.pair.dark,
	};
	return next.light !== view.pair.light || next.dark !== view.pair.dark
		? { systemThemePair: next }
		: null;
}

interface ThemeWriter {
	busy: boolean;
	queued: ThemeUpdate | null;
}

function writeTheme(writer: ThemeWriter, update: ThemeUpdate, onError: (err: unknown) => void) {
	if (writer.busy) {
		writer.queued = update;
		return;
	}
	const config = update(storeThemeView());
	if (!config) return;
	writer.busy = true;
	void getTransport()
		.request("settings.update", { config })
		.catch(onError)
		.finally(() => {
			writer.busy = false;
			const next = writer.queued;
			writer.queued = null;
			if (next) writeTheme(writer, next, onError);
		});
}

export interface ThemeListsProps {
	mode: ThemeModeOption;
	themes: readonly ThemeDescriptor[];
	selected: Readonly<Record<Appearance, ThemeId>>;
	defaults: Readonly<Record<Appearance, ThemeId>>;
	onSelect: (appearance: Appearance, id: ThemeId) => void;
}

export function ThemeLists({ mode, themes, selected, defaults, onSelect }: ThemeListsProps) {
	const t = useT();
	const list = (appearance: Appearance, card: boolean) => {
		const props = settingProps(t, appearance === "light" ? SETTING.lightTheme : SETTING.darkTheme);
		const options = themes
			.filter((theme) => theme.appearance === appearance)
			.map(
				(theme): SettingsChoiceOption<ThemeId> => ({
					id: theme.id,
					label: themeLabel(t, theme),
					testId: `theme-option-${theme.id}`,
				}),
			);
		return (
			<SettingsRow
				{...props}
				description={card ? t(LIST_DESCRIPTIONS[appearance]) : undefined}
				reset={{
					changed: selected[appearance] !== defaults[appearance],
					onReset: () => onSelect(appearance, defaults[appearance]),
				}}
				layout={card ? "card" : "stacked"}
				testId={`theme-list-${appearance}`}
				control={
					<SettingsChoice
						label={props.label}
						layout="list"
						cost="cheap"
						options={options}
						value={selected[appearance]}
						onSelect={(id) => onSelect(appearance, id)}
					/>
				}
			/>
		);
	};
	if (mode !== "system") return list(mode, false);
	return (
		<div className="@container border-border-muted border-b py-12">
			<div className="grid grid-cols-1 gap-12 @md:grid-cols-2">
				{list("light", true)}
				{list("dark", true)}
			</div>
		</div>
	);
}

export function AppearanceSettings() {
	const t = useT();
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const theme = useAppStore((state) => state.theme);
	const themeMode = useAppStore((state) => state.themeMode);
	const systemThemePair = useAppStore((state) => state.systemThemePair);
	const userThemes = useAppStore((state) => state.userThemes);
	const appVersion = useAppStore((state) => state.hostAppVersion);
	const systemAppearance = useSyncExternalStore(onSystemAppearanceChange, readSystemAppearance);
	const themes = useSyncExternalStore(onThemesChange, getThemes);
	const userThemeIssues = useSyncExternalStore(onThemesChange, getUserThemeIssues);
	const themesFolderActions = useFolderActions("themes.reveal");
	const writer = useRef<ThemeWriter>({ busy: false, queued: null });

	const view = themeView({
		theme,
		themeMode,
		systemThemePair,
		systemSupported: (protocolVersion ?? 0) >= THEME_SYSTEM_PROTOCOL_VERSION,
		systemAppearance,
		themes,
	});
	const defaultMode = resolveTheme(THEME_RESET_PATCH.theme).appearance;
	const hiddenList =
		view.effectiveMode === "light"
			? SETTING.darkTheme.id
			: view.effectiveMode === "dark"
				? SETTING.lightTheme.id
				: undefined;
	const listDefaults = deriveSystemThemePair(THEME_RESET_PATCH.theme);

	const send = (update: ThemeUpdate) =>
		writeTheme(writer.current, update, (err) =>
			toast.error(errorText(err), t("settings.appearance.changeFailed")),
		);

	const modeOptions: SettingsChoiceOption<ThemeModeOption>[] = [
		...(view.systemSupported
			? [
					{
						id: "system" as const,
						label: t("settings.appearance.mode.system"),
						testId: "theme-mode-system",
					},
				]
			: []),
		{
			id: "light",
			label: t("settings.appearance.mode.light"),
			testId: "theme-mode-light",
			disabled: !modeTarget(view, "light"),
		},
		{
			id: "dark",
			label: t("settings.appearance.mode.dark"),
			testId: "theme-mode-dark",
			disabled: !modeTarget(view, "dark"),
		},
	];

	const contrastOptions: SettingsChoiceOption<Contrast>[] = [
		{
			id: "normal",
			label: t("common.default"),
			testId: "contrast-default",
			disabled: !contrastAvailable(view, "normal"),
		},
		{
			id: "high",
			label: t("settings.appearance.contrast.high"),
			testId: "contrast-high",
			disabled: !contrastAvailable(view, "high"),
		},
	];

	const fallbacks = view.systemMode
		? [
				{ appearance: "light", resolution: view.light },
				{ appearance: "dark", resolution: view.dark },
			].filter(({ resolution }) => resolution.fallback)
		: view.fixed.fallback
			? [{ appearance: null, resolution: view.fixed }]
			: [];

	const fallbackText = (appearance: string | null, label: string) =>
		appearance === "light"
			? t("settings.appearance.fallback.light", { theme: label })
			: appearance === "dark"
				? t("settings.appearance.fallback.dark", { theme: label })
				: t("settings.appearance.fallback.fixed", { theme: label });

	return (
		<SettingsPage
			title={t("settings.nav.appearance")}
			description={t("settings.appearance.description")}
			testId="settings-appearance"
		>
			<SettingsGroup title={t("settings.appearance.themeGroup")}>
				<div data-setting-id={hiddenList}>
					<SettingsRow
						{...settingProps(t, SETTING.themeMode)}
						control={
							<SettingsChoice
								label={t("settings.appearance.themeMode")}
								options={modeOptions}
								value={view.effectiveMode}
								cost="cheap"
								onSelect={(mode) => send((fresh) => modeUpdate(fresh, mode))}
								testId="theme-mode-control"
							/>
						}
						reset={{
							changed: view.effectiveMode !== defaultMode,
							onReset: () => send(() => THEME_RESET_PATCH),
						}}
					/>
				</div>
				{fallbacks.length > 0 ? (
					<div className="flex flex-col gap-4 border-border-muted border-b py-12">
						{fallbacks.map(({ appearance, resolution }) => (
							<SettingsNotice
								key={appearance ?? "fixed"}
								variant="warning"
								testId="theme-fallback-warning"
							>
								{fallbackText(appearance, themeLabel(t, resolution.theme))}
							</SettingsNotice>
						))}
					</div>
				) : null}
				{view.systemMode ? (
					<SettingsRow
						label={t("settings.appearance.currentOnDevice")}
						testId="system-theme-current"
						control={
							<span className="flex items-center gap-4 tr-text-ui text-text-default">
								<Device className="size-14 shrink-0 text-text-muted" />
								{systemAppearance === "light"
									? t("settings.appearance.mode.light")
									: t("settings.appearance.mode.dark")}
								<ArrowRight className="size-14 shrink-0 text-text-muted" />
								<Palette className="size-14 shrink-0 text-text-muted" />
								{themeLabel(t, view.current.theme)}
							</span>
						}
					/>
				) : null}
				<ThemeLists
					mode={view.effectiveMode}
					themes={themes}
					selected={
						view.systemMode
							? { light: shownId(view.light), dark: shownId(view.dark) }
							: { light: shownId(view.fixed), dark: shownId(view.fixed) }
					}
					defaults={listDefaults}
					onSelect={(appearance, id) => send((fresh) => themeUpdate(fresh, appearance, id))}
				/>
				<SettingsRow
					{...settingProps(t, SETTING.contrast)}
					control={
						<SettingsChoice
							label={t("settings.appearance.contrastLevel")}
							options={contrastOptions}
							value={view.contrast}
							cost="cheap"
							onSelect={(contrast) => send((fresh) => contrastUpdate(fresh, contrast))}
							testId="contrast-level-control"
						/>
					}
					reset={{
						changed: view.contrast !== "normal" && contrastAvailable(view, "normal"),
						onReset: () => send((fresh) => contrastUpdate(fresh, "normal")),
					}}
				/>
			</SettingsGroup>
			<CustomThemesGroup
				snapshot={userThemes}
				issues={userThemeIssues}
				appVersion={appVersion}
				{...themesFolderActions}
			/>
		</SettingsPage>
	);
}
