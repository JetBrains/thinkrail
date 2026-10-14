import {
	RiCheckLine as Check,
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
} from "@remixicon/react";
import {
	type AppConfigUpdate,
	type SystemThemePair,
	THEME_SYSTEM_PROTOCOL_VERSION,
	type ThemeId,
} from "@thinkrail/contracts";
import { Button } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { cn } from "@thinkrail/ui/utils";
import { useState, useSyncExternalStore } from "react";
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
import { getTransport } from "@/transport";
import { SegmentedControl, type SegmentedControlOption } from "./SegmentedControl";
import { SETTINGS_ROWS_CONTAINER, SettingsRow } from "./SettingsRow";

type ThemeModeOption = "system" | "light" | "dark";
type ContrastLevel = "default" | "high";

const MODE_OPTIONS: SegmentedControlOption<ThemeModeOption>[] = [
	{ id: "system", label: "System", testId: "theme-mode-system" },
	{ id: "light", label: "Light", testId: "theme-mode-light" },
	{ id: "dark", label: "Dark", testId: "theme-mode-dark" },
];

const CONTRAST_OPTIONS: SegmentedControlOption<ContrastLevel>[] = [
	{ id: "default", label: "Default", testId: "contrast-default" },
	{ id: "high", label: "High", testId: "contrast-high" },
];

/** Get the current contrast level based on the resolved theme */
function getContrastLevel(themeDescriptor: ThemeDescriptor): ContrastLevel {
	return themeDescriptor.contrast === "high" ? "high" : "default";
}

/** Find a theme variant with the specified contrast level and appearance */
function findContrastVariant(
	themes: readonly ThemeDescriptor[],
	currentTheme: ThemeDescriptor,
	targetContrast: ContrastLevel,
): ThemeDescriptor | null {
	const targetContrastValue = targetContrast === "high" ? "high" : "normal";
	return (
		themes.find(
			(theme) =>
				theme.appearance === currentTheme.appearance && theme.contrast === targetContrastValue,
		) ?? null
	);
}

/** Compact dropdown for theme selection in settings rows */
function ThemeDropdownCompact({
	themes,
	resolution,
	disabled,
	testIdPrefix,
	onSelect,
}: {
	themes: readonly ThemeDescriptor[];
	resolution: ThemeResolution;
	disabled: boolean;
	testIdPrefix: string;
	onSelect: (id: ThemeId) => void;
}) {
	return (
		<div className="flex flex-col gap-4">
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="outline"
						disabled={disabled}
						aria-label={resolution.theme.label}
						data-testid={`${testIdPrefix}-trigger`}
						className="h-32 justify-between"
					>
						<span className="truncate">{resolution.theme.label}</span>
						<ChevronDown className="size-16" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align="end"
					className="min-w-[var(--radix-dropdown-menu-trigger-width)]"
				>
					<DropdownMenuRadioGroup value={resolution.theme.id} onValueChange={onSelect}>
						{themes.map((theme) => (
							<DropdownMenuRadioItem
								key={theme.id}
								value={theme.id}
								data-testid={`${testIdPrefix}-option-${theme.id}`}
							>
								{theme.id === resolution.theme.id ? (
									<Check className="size-14 text-primary" />
								) : (
									<span className="size-14" />
								)}
								<span>{theme.label}</span>
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
				</DropdownMenuContent>
			</DropdownMenu>
			{resolution.fallback && (
				<p className="tr-text-metadata text-feedback-warning">
					Theme unavailable. Using {resolution.theme.label}.
				</p>
			)}
		</div>
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
	return (
		<div className="flex flex-col gap-4">
			{themes.map(({ id, label }) => {
				const active = id === activeId;
				return (
					<button
						key={id}
						type="button"
						disabled={disabled}
						aria-pressed={active}
						data-testid={`theme-option-${id}`}
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
						<span className="flex-1">{label}</span>
						{active && <Check className="size-16 shrink-0 text-primary" />}
					</button>
				);
			})}
		</div>
	);
}

export function AppearanceSettings() {
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const theme = useAppStore((state) => state.theme);
	const themeMode = useAppStore((state) => state.themeMode);
	const systemThemePair = useAppStore((state) => state.systemThemePair);
	const [pending, setPending] = useState(false);
	const systemAppearance = useSyncExternalStore(onSystemAppearanceChange, readSystemAppearance);

	const themes = getThemes();
	const systemSupported = (protocolVersion ?? 0) >= THEME_SYSTEM_PROTOCOL_VERSION;
	const activeTheme = resolveTheme(theme);
	const pair = systemThemePair ?? deriveSystemThemePair(theme);
	const preference = { theme, themeMode: "system" as const, systemThemePair: pair };
	const currentResolution = resolveThemePreference(preference, systemAppearance);
	const lightResolution = resolveThemePreference(preference, "light");
	const darkResolution = resolveThemePreference(preference, "dark");

	// Derive the effective mode option from the stored mode and theme
	const effectiveMode: ThemeModeOption =
		systemSupported && themeMode === "system" ? "system" : activeTheme.appearance;

	// Get current contrast level from the resolved theme
	const currentContrast = getContrastLevel(
		effectiveMode === "system" ? currentResolution.theme : activeTheme,
	);

	// Filter themes by appearance and contrast for display
	const lightThemes = themes.filter((t) => t.appearance === "light");
	const darkThemes = themes.filter((t) => t.appearance === "dark");
	const normalLightThemes = lightThemes.filter((t) => t.contrast === "normal");
	const normalDarkThemes = darkThemes.filter((t) => t.contrast === "normal");

	const update = (config: AppConfigUpdate) => {
		if (pending) return;
		setPending(true);
		getTransport()
			.request("settings.update", { config })
			.catch(() => toast.error("Couldn't change theme"))
			.finally(() => setPending(false));
	};

	const selectMode = (mode: ThemeModeOption) => {
		if (mode === effectiveMode) return;

		if (mode === "system") {
			// Switch to system mode with the current pair
			update({ themeMode: "system", systemThemePair: pair });
		} else {
			// Switch to fixed mode with the appropriate theme for the selected appearance
			// Prefer normal contrast themes when switching modes
			const targetTheme = (mode === "light" ? normalLightThemes : normalDarkThemes)[0];
			if (targetTheme) {
				update({ theme: targetTheme.id, themeMode: "fixed" });
			}
		}
	};

	const selectFixed = (id: ThemeId) => {
		if (id === theme) return;
		update({ theme: id, themeMode: "fixed" });
	};

	const selectSystem = (appearance: "light" | "dark", id: ThemeId) => {
		const next: SystemThemePair = { ...pair, [appearance]: id };
		if (next.light === pair.light && next.dark === pair.dark) return;
		update({ systemThemePair: next });
	};

	const selectContrast = (level: ContrastLevel) => {
		if (level === currentContrast) return;

		if (effectiveMode === "system") {
			// For system mode, update both themes in the pair
			const lightVariant = findContrastVariant(themes, lightResolution.theme, level);
			const darkVariant = findContrastVariant(themes, darkResolution.theme, level);
			if (lightVariant && darkVariant) {
				update({ systemThemePair: { light: lightVariant.id, dark: darkVariant.id } });
			}
		} else {
			// For fixed mode, switch to the variant with the target contrast
			const variant = findContrastVariant(themes, activeTheme, level);
			if (variant) {
				update({ theme: variant.id, themeMode: "fixed" });
			}
		}
	};

	// Get the themes to display based on current mode and contrast
	const getThemesForDisplay = () => {
		const targetContrast = currentContrast === "high" ? "high" : "normal";
		if (effectiveMode === "light") {
			return lightThemes.filter((t) => t.contrast === targetContrast);
		}
		if (effectiveMode === "dark") {
			return darkThemes.filter((t) => t.contrast === targetContrast);
		}
		return [];
	};

	const [themePairExpanded, setThemePairExpanded] = useState(false);

	return (
		<div data-testid="settings-appearance" className={SETTINGS_ROWS_CONTAINER}>
			{/* Theme mode row */}
			<SettingsRow
				label="Theme mode"
				control={
					<SegmentedControl
						name="theme-mode"
						label="Theme mode"
						options={systemSupported ? MODE_OPTIONS : MODE_OPTIONS.filter((o) => o.id !== "system")}
						value={effectiveMode}
						disabled={pending}
						onSelect={selectMode}
						testId="theme-mode-control"
					/>
				}
			/>

			{/* Theme pair collapsible (system mode) or Theme collapsible (fixed mode) */}
			{effectiveMode === "system" ? (
				<div className="flex flex-col border-border-muted border-b">
					<button
						type="button"
						onClick={() => setThemePairExpanded((v) => !v)}
						aria-expanded={themePairExpanded}
						data-testid="theme-pair-toggle"
						className="flex w-full items-start gap-8 py-12 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary"
					>
						<span className="flex-1 tr-text-ui text-text-default">Theme pair</span>
						{/* Chevron right-aligned */}
						<span className="mt-2 shrink-0">
							{themePairExpanded ? (
								<ChevronDown className="size-20 text-text-muted" aria-hidden="true" />
							) : (
								<ChevronRight className="size-20 text-text-muted" aria-hidden="true" />
							)}
						</span>
					</button>
					{themePairExpanded && (
						<div className={`${SETTINGS_ROWS_CONTAINER} pb-12`}>
							<SettingsRow
								label="Light theme"
								control={
									<ThemeDropdownCompact
										themes={lightThemes}
										resolution={lightResolution}
										disabled={pending}
										testIdPrefix="system-theme-light"
										onSelect={(id) => selectSystem("light", id)}
									/>
								}
							/>
							<SettingsRow
								label="Dark theme"
								control={
									<ThemeDropdownCompact
										themes={darkThemes}
										resolution={darkResolution}
										disabled={pending}
										testIdPrefix="system-theme-dark"
										onSelect={(id) => selectSystem("dark", id)}
									/>
								}
							/>
						</div>
					)}
				</div>
			) : (
				<div className="flex flex-col border-border-muted border-b">
					<button
						type="button"
						onClick={() => setThemePairExpanded((v) => !v)}
						aria-expanded={themePairExpanded}
						data-testid="theme-toggle"
						className="flex w-full items-start gap-8 py-12 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary"
					>
						<span className="flex-1 tr-text-ui text-text-default">Theme</span>
						{/* Chevron right-aligned */}
						<span className="mt-2 shrink-0">
							{themePairExpanded ? (
								<ChevronDown className="size-20 text-text-muted" aria-hidden="true" />
							) : (
								<ChevronRight className="size-20 text-text-muted" aria-hidden="true" />
							)}
						</span>
					</button>
					{themePairExpanded && (
						<div className="pb-12">
							<ThemeList
								themes={getThemesForDisplay()}
								activeId={activeTheme.id}
								disabled={pending}
								onSelect={selectFixed}
							/>
						</div>
					)}
				</div>
			)}

			{/* Contrast level row */}
			<SettingsRow
				label="Contrast level"
				control={
					<SegmentedControl
						name="contrast-level"
						label="Contrast level"
						options={CONTRAST_OPTIONS}
						value={currentContrast}
						disabled={pending}
						onSelect={selectContrast}
						testId="contrast-level-control"
					/>
				}
			/>
		</div>
	);
}
