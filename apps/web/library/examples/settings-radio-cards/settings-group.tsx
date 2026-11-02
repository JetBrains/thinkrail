import { languageName, SYSTEM_LOCALE } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import { SettingsGroup } from "@/panels/SettingsGroup";
import { SettingsRadioCards } from "@/panels/SettingsRadioCards";

export default function InSettingsGroup() {
	const t = useT();
	const [locale, setLocale] = useState(SYSTEM_LOCALE);
	return (
		<div className="w-full">
			<SettingsGroup
				title={t("settings.language.title")}
				description={t("settings.language.description")}
			>
				<div className="py-12">
					<SettingsRadioCards
						name="ui-language"
						label={t("settings.language.title")}
						choices={[
							{
								id: SYSTEM_LOCALE,
								label: t("settings.language.system.label"),
								description: t("settings.language.system.description", {
									language: languageName("en"),
								}),
								testId: "language-system",
							},
							{
								id: "en",
								label: languageName("en"),
								hint: t("settings.language.source.builtin"),
								description: "en",
								testId: "language-en",
							},
							{
								id: "ja",
								label: languageName("ja"),
								hint: t("settings.language.source.builtin"),
								description: "ja",
								testId: "language-ja",
							},
						]}
						value={locale}
						onSelect={setLocale}
					/>
				</div>
			</SettingsGroup>
		</div>
	);
}
