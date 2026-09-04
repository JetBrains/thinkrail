import {
	RiArrowRightLine as ArrowRight,
	RiCheckLine as Check,
	RiArrowDownSLine as ChevronDown,
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
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib";
import { toast, useAppStore } from "@/store";
import {
	deriveSystemThemePair,
	getThemes,
	onThemeSwap,
	readSystemAppearance,
	resolveTheme,
	resolveThemePreference,
	type ThemeDescriptor,
	type ThemeResolution,
} from "@/themes";
import { getTransport } from "@/transport";
import { SettingsRadioCards, type SettingsRadioChoice } from "./SettingsRadioCards";

const MODE_CHOICES: SettingsRadioChoice<ThemeMode>[] = [
	{
		id: "fixed",
		label: "Fixed",
		description: "Use one theme everywhere.",
		testId: "theme-mode-fixed",
	},
	{
		id: "system",
		label: "Match system",
		description: "Follow this device’s light or dark setting.",
		testId: "theme-mode-system",
	},
];

function ThemeSelector({
	appearance,
	themes,
	resolution,
	disabled,
	onSelect,
}: {
	appearance: "light" | "dark";
	themes: readonly ThemeDescriptor[];
	resolution: ThemeResolution;
	disabled: boolean;
	onSelect: (id: ThemeId) => void;
}) {
	const label = appearance === "light" ? "Light theme" : "Dark theme";
	return (
		<div className="flex flex-col gap-4">
			<span className="tr-text-ui text-text-default">{label}</span>
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						variant="outline"
						disabled={disabled}
						aria-label={`${label}: ${resolution.theme.label}`}
						data-testid={`system-theme-${appearance}-trigger`}
						className="w-full justify-between"
					>
						<span className="truncate">{resolution.theme.label}</span>
						<ChevronDown className="size-16" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align="start"
					className="min-w-[var(--radix-dropdown-menu-trigger-width)]"
				>
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
								<span>{theme.label}</span>
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
				</DropdownMenuContent>
			</DropdownMenu>
			{resolution.fallback ? (
				<p className="tr-text-metadata text-feedback-warning">
					Configured theme unavailable in this app version. Using {resolution.theme.label}.
				</p>
			) : null}
		</div>
	);
}

export function AppearanceSettings() {
	const protocolVersion = useAppStore((state) => state.protocolVersion);
	const theme = useAppStore((state) => state.theme);
	const themeMode = useAppStore((state) => state.themeMode);
	const systemThemePair = useAppStore((state) => state.systemThemePair);
	const [pending, setPending] = useState(false);
	const [, setThemeRevision] = useState(0);
	useEffect(() => onThemeSwap(() => setThemeRevision((revision) => revision + 1)), []);

	const themes = getThemes();
	const systemSupported = (protocolVersion ?? 0) >= THEME_SYSTEM_PROTOCOL_VERSION;
	const activeMode = systemSupported ? themeMode : "fixed";
	const activeThemeId = resolveTheme(theme).id;
	const pair = systemThemePair ?? deriveSystemThemePair(theme);
	const systemAppearance = readSystemAppearance();
	const preference = { theme, themeMode: "system" as const, systemThemePair: pair };
	const current = resolveThemePreference(preference, systemAppearance);
	const light = resolveThemePreference(preference, "light");
	const dark = resolveThemePreference(preference, "dark");

	const update = (config: AppConfigUpdate) => {
		if (pending) return;
		setPending(true);
		getTransport()
			.request("settings.update", { config })
			.catch(() => toast.error("Couldn’t change theme"))
			.finally(() => setPending(false));
	};
	const selectMode = (mode: ThemeMode) => {
		if (mode === activeMode) return;
		update(
			mode === "system" ? { themeMode: "system", systemThemePair: pair } : { themeMode: "fixed" },
		);
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

	return (
		<section data-testid="settings-appearance" className="flex flex-col gap-8">
			<div className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">Theme</h3>
				<p className="text-text-muted tr-text-metadata">
					{systemSupported
						? "Your mode and pair are saved on the host. Match system follows each device’s light or dark setting."
						: "Choose the app theme. Your choice is saved on the host and follows you across devices."}
				</p>
			</div>
			{systemSupported ? (
				<SettingsRadioCards
					name="theme-mode"
					label="Theme mode"
					choices={MODE_CHOICES}
					value={activeMode}
					disabled={pending}
					onSelect={selectMode}
				/>
			) : null}
			{activeMode === "fixed" ? (
				<div className="flex flex-col gap-4">
					{themes.map(({ id, label, appearance, contrast }) => {
						const active = id === activeThemeId;
						return (
							<button
								key={id}
								type="button"
								disabled={pending}
								aria-pressed={active}
								data-testid={`theme-option-${id}`}
								data-theme-id={id}
								data-appearance={appearance}
								data-contrast={contrast}
								data-active={active}
								onClick={() => selectFixed(id)}
								className={cn(
									"flex items-center gap-8 rounded-[var(--radius-sm)] border px-12 py-8 text-left tr-text-ui outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:border-control-disabled-border disabled:text-control-disabled-text",
									active
										? "border-primary-muted bg-clip-padding bg-primary-subtle text-text-default"
										: "border-border-default text-text-muted hover:bg-control-bg-hovered hover:text-text-default",
								)}
							>
								<span className="flex-1">{label}</span>
								{active ? <Check className="size-16 shrink-0 text-primary" /> : null}
							</button>
						);
					})}
				</div>
			) : (
				<div className="flex flex-col gap-8">
					<div
						data-testid="system-theme-current"
						className="flex items-center justify-between gap-8"
					>
						<span className="tr-text-metadata text-text-muted">Current on this device</span>
						<span className="flex items-center gap-4 tr-text-ui text-text-default">
							<Device className="size-14 shrink-0 text-text-muted" />
							{systemAppearance === "light" ? "Light" : "Dark"}
							<ArrowRight className="size-14 shrink-0 text-text-muted" />
							<Palette className="size-14 shrink-0 text-text-muted" />
							{current.theme.label}
						</span>
					</div>
					<ThemeSelector
						appearance="light"
						themes={themes.filter((candidate) => candidate.appearance === "light")}
						resolution={light}
						disabled={pending}
						onSelect={(id) => selectSystem("light", id)}
					/>
					<ThemeSelector
						appearance="dark"
						themes={themes.filter((candidate) => candidate.appearance === "dark")}
						resolution={dark}
						disabled={pending}
						onSelect={(id) => selectSystem("dark", id)}
					/>
				</div>
			)}
		</section>
	);
}
