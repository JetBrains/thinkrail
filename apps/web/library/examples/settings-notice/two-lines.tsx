import { T, useT } from "@thinkrail/locales/react";
import { SettingsNotice } from "@/panels/SettingsNotice";

export default function TwoLines() {
	const t = useT();
	return (
		<SettingsNotice variant="info" testId="project-templates-unavailable">
			<p>{t("settings.templates.openProject")}</p>
			<p className="tr-text-metadata text-text-muted">
				<T
					i18nKey="settings.templates.projectLocation"
					components={[<code key="path" className="tr-code-text" />]}
				/>
			</p>
		</SettingsNotice>
	);
}
