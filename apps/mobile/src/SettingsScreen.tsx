import { BUNDLED_LOCALES, languageName, resolveLocale, SYSTEM_LOCALE } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import {
	SegmentedControl,
	type SegmentedControlOption,
	SettingsGroup,
	SettingsPageContainer,
	SettingsRadioCards,
	type SettingsRadioChoice,
	SettingsRow,
} from "@thinkrail/ui/settings";
import { Screen } from "./layout";
import type { ContrastChoice, DevicePreferences, ThemeChoice } from "./preferences";

/** The phone's own settings — the IDE Settings rows that make sense on a device (theme, language), kept on the device. */
export function SettingsScreen({
	preferences,
	onChange,
	backLabel,
	onBack,
}: {
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
				<SettingsPageContainer testId="mobile-settings">
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
