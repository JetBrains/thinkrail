import { RiComputerLine } from "@remixicon/react";
import { BUNDLED_LOCALES, languageName, resolveLocale, SYSTEM_LOCALE } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import type { SavedHost } from "@thinkrail/remote-client";
import {
	SegmentedControl,
	type SegmentedControlOption,
	SettingsGroup,
	SettingsPageContainer,
	SettingsRadioCards,
	type SettingsRadioChoice,
	SettingsRow,
} from "@thinkrail/ui/settings";
import type { PairState } from "./App";
import { Screen } from "./layout";
import { PairActions } from "./PairForm";
import type { ContrastChoice, DevicePreferences, ThemeChoice } from "./preferences";
import { BRAND } from "./Welcome";

/** The phone's settings: its paired computers and pairing another, then the IDE Settings rows that make sense on a device (theme, language), kept on the device. */
export function SettingsScreen({
	hosts,
	pair,
	onPair,
	preferences,
	onChange,
	backLabel,
	onBack,
}: {
	hosts: SavedHost[];
	pair: PairState;
	onPair: (link: string) => Promise<boolean>;
	preferences: DevicePreferences;
	onChange: (preferences: DevicePreferences) => void;
	backLabel: string;
	onBack: () => void;
}) {
	const t = useT();
	const themeOptions: SegmentedControlOption<ThemeChoice>[] = [
		{ id: "system", label: t("settings.appearance.mode.system"), testId: "theme-mode-system" },
		{ id: "light", label: t("settings.appearance.mode.light"), testId: "theme-mode-light" },
		{ id: "dark", label: t("settings.appearance.mode.dark"), testId: "theme-mode-dark" },
	];
	const contrastOptions: SegmentedControlOption<ContrastChoice>[] = [
		{ id: "normal", label: t("common.default"), testId: "contrast-default" },
		{ id: "high", label: t("settings.appearance.contrast.high"), testId: "contrast-high" },
	];
	const systemTag = resolveLocale(SYSTEM_LOCALE, BUNDLED_LOCALES, navigator.languages);
	const languages: SettingsRadioChoice<string>[] = [
		{
			id: SYSTEM_LOCALE,
			label: t("settings.language.system.label"),
			description: t("settings.language.system.description", {
				language: languageName(systemTag),
			}),
			testId: "language-system",
		},
		...BUNDLED_LOCALES.map((tag) => ({ tag, name: languageName(tag) }))
			.sort((a, b) => a.name.localeCompare(b.name))
			.map(
				({ tag, name }): SettingsRadioChoice<string> => ({
					id: tag,
					label: name,
					description: tag,
					testId: `language-${tag}`,
				}),
			),
	];

	return (
		<Screen title={t("settings.dialog.title")} back={{ label: backLabel, onBack }}>
			<div className="p-16">
				<section className="mb-24 flex flex-col items-center gap-8 rounded-lg border border-border-default bg-container-elevated-bg px-16 py-40 text-center">
					<span className="text-primary tr-brand-hero">{BRAND}</span>
					<span className="text-text-muted tr-text-ui">{t("mobile.welcome.tagline")}</span>
				</section>
				<SettingsPageContainer testId="mobile-settings">
					<SettingsGroup
						title={t("mobile.settings.computers")}
						description={t("mobile.projects.addHint")}
					>
						{hosts.map((host) => (
							<div
								key={host.hostKey}
								className="flex min-h-touch items-center gap-12 border-b border-border-muted py-8"
							>
								<RiComputerLine aria-hidden className="size-20 shrink-0 text-text-muted" />
								<span className="min-w-0 flex-1 truncate text-text-default tr-text-ui">
									{host.label}
								</span>
							</div>
						))}
						<div className="pt-12">
							<PairActions pair={pair} onPair={onPair} />
						</div>
					</SettingsGroup>
					<SettingsGroup title={t("settings.appearance.themeGroup")}>
						<SettingsRow
							label={t("settings.appearance.themeMode")}
							control={
								<SegmentedControl
									name="theme-mode"
									label={t("settings.appearance.themeMode")}
									options={themeOptions}
									value={preferences.theme}
									onSelect={(theme) => onChange({ ...preferences, theme })}
								/>
							}
						/>
						<SettingsRow
							label={t("settings.appearance.contrastLevel")}
							control={
								<SegmentedControl
									name="contrast"
									label={t("settings.appearance.contrastLevel")}
									options={contrastOptions}
									value={preferences.contrast}
									onSelect={(contrast) => onChange({ ...preferences, contrast })}
								/>
							}
						/>
					</SettingsGroup>
					<SettingsGroup
						title={t("settings.language.title")}
						description={t("settings.language.description")}
					>
						<SettingsRadioCards
							name="ui-language"
							label={t("settings.language.title")}
							choices={languages}
							value={
								languages.some((choice) => choice.id === preferences.locale)
									? preferences.locale
									: SYSTEM_LOCALE
							}
							onSelect={(locale) => onChange({ ...preferences, locale })}
						/>
					</SettingsGroup>
				</SettingsPageContainer>
			</div>
		</Screen>
	);
}
