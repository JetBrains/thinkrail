import { RiTranslateAi as Translate } from "@remixicon/react";
import { applyLocale, getLocale, LOCALE_LABELS, type Locale, t } from "@/i18n";
import { SettingsRadioCards, type SettingsRadioChoice } from "./SettingsRadioCards";

/**
 * Language picker.
 *
 * Switching persists the choice and reloads, because copy is read by module-level constants and by the
 * native application menu as well as by components — a reload is what makes them agree. The panel is
 * the only place the reload is observable, so it says so.
 *
 * The option that selects a language describes that language in its own words, so its own copy must
 * not depend on the active locale: only the English option reads through `t`, and only because it is
 * the one whose copy is English anyway.
 */
const CHOICES: SettingsRadioChoice<Locale>[] = [
	{
		id: "zh-CN",
		label: LOCALE_LABELS["zh-CN"],
		description: "界面以简体中文显示；Spec、Workspace、Review 等术语保留英文。",
		testId: "language-option-zh-CN",
	},
	{
		id: "en",
		label: LOCALE_LABELS.en,
		description: t("Interface copy in English, exactly as shipped upstream."),
		testId: "language-option-en",
	},
];

export function LanguageSettings() {
	const current = getLocale();
	return (
		<section data-testid="settings-language" className="flex flex-col gap-8">
			<div className="flex flex-col gap-4">
				<h3 className="tr-title-section flex items-center gap-4 text-text-default">
					<Translate className="size-14 shrink-0 text-text-muted" aria-hidden="true" />
					{t("Language")}
				</h3>
				<p className="tr-text-metadata text-text-muted">
					{t(
						"Switching reloads the app, menu bar included, because both read their copy once at startup.",
					)}
				</p>
			</div>
			<SettingsRadioCards
				name="language"
				label={t("Interface language")}
				choices={CHOICES}
				value={current}
				onSelect={(locale) => applyLocale(locale)}
			/>
		</section>
	);
}
