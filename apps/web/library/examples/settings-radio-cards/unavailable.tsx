import { languageName, SYSTEM_LOCALE } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { useState } from "react";
import { SettingsRadioCards } from "@/panels/SettingsRadioCards";

export default function Unavailable() {
	const t = useT();
	// fr.json was selected, then removed from the folder.
	const [value, setValue] = useState("missing:fr");
	return (
		<div className="w-full">
			<SettingsRadioCards
				name="ui-language-unavailable"
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
						id: "missing:fr",
						label: languageName("fr"),
						hint: t("settings.language.source.missing"),
						description: t("settings.language.missingDescription", { tag: "fr" }),
						testId: "language-missing-fr",
						disabled: true,
					},
					{
						id: "broken:german.json",
						label: "german.json",
						hint: t("settings.language.source.broken"),
						description: t("settings.language.error.invalidName"),
						testId: "language-broken-german.json",
						disabled: true,
					},
				]}
				value={value}
				onSelect={setValue}
			/>
		</div>
	);
}
