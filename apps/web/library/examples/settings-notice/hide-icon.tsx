import { T, useT } from "@thinkrail/locales/react";
import { SettingsNotice } from "@/panels/SettingsNotice";

export default function HideIcon() {
	const t = useT();
	return (
		<SettingsNotice variant="neutral" hideIcon testId="project-templates-empty">
			<p>{t("settings.templates.projectEmpty")}</p>
			<p className="tr-text-metadata text-text-muted">
				<T
					i18nKey="settings.templates.projectEmptyLocation"
					components={[<code key="path" className="tr-code-text" />]}
				/>
			</p>
		</SettingsNotice>
	);
}
