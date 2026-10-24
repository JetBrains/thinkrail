import {
	RiArrowRightLine as ArrowRight,
	RiCheckLine as Check,
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
	RiComputerLine as Device,
	RiPaletteLine as Palette,
} from "@remixicon/react";
import {
	type AppConfigUpdate,
	type SystemThemePair,
	THEME_SYSTEM_PROTOCOL_VERSION,
	type ThemeId,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { type Translator, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useState, useSyncExternalStore } from "react";
import { toast, useAppStore } from "@/store";
import {
	deriveSystemThemePair,
	getThemes,
	onSystemAppearanceChange,
	readSystemAppearance,
	resolveTheme,
	resolveThemePreference,
	type ThemeDescriptor,
	type ThemeResolution,
} from "@/themes";
import { errorText, getTransport } from "@/transport";
import { LineWidthControl } from "./LineWidthSettings";
import { SegmentedControl, type SegmentedControlOption } from "./SegmentedControl";
import { SettingsGroup, SettingsPageContainer } from "./SettingsGroup";
import { SettingsNotice } from "./SettingsNotice";
import { SETTINGS_ROWS_CONTAINER, SettingsRow } from "./SettingsRow";

type Appearance = ThemeDescriptor["appearance"];
type Contrast = ThemeDescriptor["contrast"];
type ThemeModeOption = "system" | Appearance;

const BUNDLED_THEME_LABELS: Readonly<Record<string, MessageKey>> = {
	dark: "settings.appearance.themeName.dark",
	light: "settings.appearance.themeName.light",
	"high-contrast-dark": "settings.appearance.themeName.highContrastDark",
	"high-contrast-light": "settings.appearance.themeName.highContrastLight",
	"minimal-dark": "settings.appearance.themeName.minimalDark",
	"minimal-light": "settings.appearance.themeName.minimalLight",
};

function themeLabel(t: Translator, theme: Pick<ThemeDescriptor, "id" | "label">): string {
	const key = BUNDLED_THEME_LABELS[theme.id];
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

function ThemeDropdown({
	appearance,
	themes,
	resolution,
	disabled,
	onSelect,
}: {
	appearance: Appearance;
	themes: readonly ThemeDescriptor[];
	resolution: ThemeResolution;
	disabled: boolean;
	onSelect: (id: ThemeId) => void;
}) {
	const t = useT();
	const label =
		appearance === "light"
			? t("settings.appearance.lightThemeTrigger", { theme: themeLabel(t, resolution.theme) })
			: t("settings.appearance.darkThemeTrigger", { theme: themeLabel(t, resolution.theme) });
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="outline"
					disabled={disabled}
					aria-label={label}
					data-testid={`system-theme-${appearance}-trigger`}
					className="h-32 justify-between"
				>
					<span className="truncate">{themeLabel(t, resolution.theme)}</span>
					<ChevronDown className="size-16" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-[var(--radix-dropdown-menu-trigger-width)]">
				<DropdownMenuRadioGroup value={resolution.theme.id} onValueChange={onSelect}>
					{themes.map((theme) => (
						<DropdownMenuRadioItem
							key={theme.id}
							value={theme.id}
							data-testid={`system-theme-${appearance}-option-${theme.id}`}
						>
							{theme.id === resolution.theme.id ? (
								<Check className="size-14 text-primary" />
							) : (
								<span className="size-14" />
							)}
							<span>{themeLabel(t, theme)}</span>
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function ThemeList({
	themes,
	activeId,
	disabled,
	onSelect,
}: {
	themes: readonly ThemeDescriptor[];
	activeId: ThemeId;
	disabled: boolean;
	onSelect: (id: ThemeId) => void;
}) {
	const t = useT();
	return (
		<div className="flex flex-col gap-4">
			{themes.map(({ id, label, appearance, contrast }) => {
				const active = id === activeId;
				return (
					<button
						key={id}
						type="button"
						disabled={disabled}
						aria-pressed={active}
						data-testid={`theme-option-${id}`}
						data-theme-id={id}
						data-appearance={appearance}
						data-contrast={contrast}
						data-active={active}
						onClick={() => onSelect(id)}
						className={cn(
							"flex items-center gap-8 rounded-sm border px-12 py-8 text-left tr-text-ui outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
							"disabled:pointer-events-none disabled:border-control-disabled-border disabled:text-control-disabled-text",
							active
								? "border-primary-muted bg-clip-padding bg-primary-subtle text-text-default"
								: "border-border-default text-text-muted hover:bg-control-bg-hovered hover:text-text-default",
						)}
					>
						<span className="flex-1">{themeLabel(t, { id, label })}</span>
						{active ? <Check className="size-16 shrink-0 text-primary" /> : null}
					</button>
				);
			})}
		</div>
	);
}

function Disclosure({
	label,
	summary,
	expanded,
	testId,
	onToggle,
	children,
}: {
	label: string;
	summary: string;
	expanded: boolean;
	testId: string;
	onToggle: () => void;
	children: ReactNode;
}) {
	const Chevron = expanded ? ChevronDown : ChevronRight;
	return (
		<div className="flex flex-col border-border-muted border-b">
			<button
				type="button"
				onClick={onToggle}
				aria-expanded={expanded}
				data-testid={testId}
				className="flex w-full items-center gap-8 py-12 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary"
			>
				<span className="flex-1 tr-text-ui text-text-default">{label}</span>
				<span className="truncate tr-text-metadata text-text-muted">{summary}</span>
				<Chevron className="size-20 shrink-0 text-text-muted" aria-hidden="true" />
			</button>
			{expanded ? children : null}
		</div>
	);
}

export function AppearanceSettings() {
	const t = useT();
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const theme = useAppStore((state) => state.theme);
	const themeMode = useAppStore((state) => state.themeMode);
	const systemThemePair = useAppStore((state) => state.systemThemePair);
	const [pending, setPending] = useState(false);
	const [expanded, setExpanded] = useState(false);
	const systemAppearance = useSyncExternalStore(onSystemAppearanceChange, readSystemAppearance);

	const themes = getThemes();
	const systemSupported = (protocolVersion ?? 0) >= THEME_SYSTEM_PROTOCOL_VERSION;
	const activeTheme = resolveTheme(theme);
	const fixedResolution = resolveThemePreference({ theme, themeMode: "fixed" });
	const pair = systemThemePair ?? deriveSystemThemePair(theme);
	const preference = { theme, themeMode: "system" as const, systemThemePair: pair };
	const currentResolution = resolveThemePreference(preference, systemAppearance);
	const lightResolution = resolveThemePreference(preference, "light");
	const darkResolution = resolveThemePreference(preference, "dark");
	const systemMode = systemSupported && themeMode === "system";
	const effectiveMode: ThemeModeOption = systemMode ? "system" : activeTheme.appearance;
	const currentContrast = (systemMode ? currentResolution.theme : activeTheme).contrast;

	const modeTarget = (appearance: Appearance): ThemeDescriptor | null =>
		systemMode
			? (appearance === "light" ? lightResolution : darkResolution).theme
			: appearanceTarget(themes, activeTheme, appearance);

	const contrastTargets = (contrast: Contrast) =>
		systemMode
			? {
					light: counterpart(themes, lightResolution.theme, "light", contrast),
					dark: counterpart(themes, darkResolution.theme, "dark", contrast),
				}
			: { fixed: counterpart(themes, activeTheme, activeTheme.appearance, contrast) };

	const contrastAvailable = (contrast: Contrast) =>
		Object.values(contrastTargets(contrast)).some((target) => target !== null);

	const modeOptions: SegmentedControlOption<ThemeModeOption>[] = [
		...(systemSupported
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
			disabled: !modeTarget("light"),
		},
		{
			id: "dark",
			label: t("settings.appearance.mode.dark"),
			testId: "theme-mode-dark",
			disabled: !modeTarget("dark"),
		},
	];

	const contrastOptions: SegmentedControlOption<Contrast>[] = [
		{
			id: "normal",
			label: t("common.default"),
			testId: "contrast-default",
			disabled: !contrastAvailable("normal"),
		},
		{
			id: "high",
			label: t("settings.appearance.contrast.high"),
			testId: "contrast-high",
			disabled: !contrastAvailable("high"),
		},
	];

	const update = (config: AppConfigUpdate) => {
		if (pending) return;
		setPending(true);
		getTransport()
			.request("settings.update", { config })
			.catch((err: unknown) => toast.error(errorText(err), t("settings.appearance.changeFailed")))
			.finally(() => setPending(false));
	};

	const selectMode = (mode: ThemeModeOption) => {
		if (mode === effectiveMode) return;
		if (mode === "system") {
			update({ themeMode: "system", systemThemePair: pair });
			return;
		}
		const target = modeTarget(mode);
		if (target) update({ theme: target.id, themeMode: "fixed" });
	};

	const selectFixed = (id: ThemeId) => {
		if (id === theme) return;
		update({ theme: id, themeMode: "fixed" });
	};

	const selectSystem = (appearance: Appearance, id: ThemeId) => {
		const next: SystemThemePair = { ...pair, [appearance]: id };
		if (next.light === pair.light && next.dark === pair.dark) return;
		update({ systemThemePair: next });
	};

	const selectContrast = (contrast: Contrast) => {
		if (contrast === currentContrast) return;
		const targets = contrastTargets(contrast);
		if ("fixed" in targets) {
			if (targets.fixed) update({ theme: targets.fixed.id, themeMode: "fixed" });
			return;
		}
		const next: SystemThemePair = {
			light: targets.light?.id ?? pair.light,
			dark: targets.dark?.id ?? pair.dark,
		};
		if (next.light !== pair.light || next.dark !== pair.dark) update({ systemThemePair: next });
	};

	const fallbacks = systemMode
		? [
				{ appearance: "light", resolution: lightResolution },
				{ appearance: "dark", resolution: darkResolution },
			].filter(({ resolution }) => resolution.fallback)
		: fixedResolution.fallback
			? [{ appearance: null, resolution: fixedResolution }]
			: [];

	return (
		<SettingsPageContainer testId="settings-appearance">
			<SettingsGroup title={t("settings.appearance.themeGroup")}>
				<SettingsRow
					label={t("settings.appearance.themeMode")}
					control={
						<SegmentedControl
							name="theme-mode"
							label={t("settings.appearance.themeMode")}
							options={modeOptions}
							value={effectiveMode}
							disabled={pending}
							onSelect={selectMode}
							testId="theme-mode-control"
						/>
					}
				/>
				{fallbacks.length > 0 ? (
					<div className="flex flex-col gap-4 border-border-muted border-b py-12">
						{fallbacks.map(({ appearance, resolution }) => (
							<SettingsNotice
								key={appearance ?? "fixed"}
								variant="warning"
								testId="theme-fallback-warning"
							>
								{appearance === "light"
									? t("settings.appearance.fallback.light", {
											theme: themeLabel(t, resolution.theme),
										})
									: appearance === "dark"
										? t("settings.appearance.fallback.dark", {
												theme: themeLabel(t, resolution.theme),
											})
										: t("settings.appearance.fallback.fixed", {
												theme: themeLabel(t, resolution.theme),
											})}
							</SettingsNotice>
						))}
					</div>
				) : null}
				{systemMode ? (
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
								{themeLabel(t, currentResolution.theme)}
							</span>
						}
					/>
				) : null}
				{systemMode ? (
					<Disclosure
						label={t("settings.appearance.themePair")}
						summary={`${themeLabel(t, lightResolution.theme)} / ${themeLabel(t, darkResolution.theme)}`}
						expanded={expanded}
						testId="theme-pair-toggle"
						onToggle={() => setExpanded((value) => !value)}
					>
						<div className={cn(SETTINGS_ROWS_CONTAINER, "pb-12")}>
							<SettingsRow
								label={t("settings.appearance.lightTheme")}
								control={
									<ThemeDropdown
										appearance="light"
										themes={themes.filter((candidate) => candidate.appearance === "light")}
										resolution={lightResolution}
										disabled={pending}
										onSelect={(id) => selectSystem("light", id)}
									/>
								}
							/>
							<SettingsRow
								label={t("settings.appearance.darkTheme")}
								control={
									<ThemeDropdown
										appearance="dark"
										themes={themes.filter((candidate) => candidate.appearance === "dark")}
										resolution={darkResolution}
										disabled={pending}
										onSelect={(id) => selectSystem("dark", id)}
									/>
								}
							/>
						</div>
					</Disclosure>
				) : (
					<Disclosure
						label={t("settings.appearance.theme")}
						summary={themeLabel(t, activeTheme)}
						expanded={expanded}
						testId="theme-toggle"
						onToggle={() => setExpanded((value) => !value)}
					>
						<div className="pb-12">
							<ThemeList
								themes={themes}
								activeId={activeTheme.id}
								disabled={pending}
								onSelect={selectFixed}
							/>
						</div>
					</Disclosure>
				)}
				<SettingsRow
					label={t("settings.appearance.contrastLevel")}
					control={
						<SegmentedControl
							name="contrast-level"
							label={t("settings.appearance.contrastLevel")}
							options={contrastOptions}
							value={currentContrast}
							disabled={pending}
							onSelect={selectContrast}
							testId="contrast-level-control"
						/>
					}
				/>
			</SettingsGroup>
			<SettingsGroup title={t("settings.appearance.editorGroup")}>
				<LineWidthControl kind="file" />
			</SettingsGroup>
		</SettingsPageContainer>
	);
}
