import type { UserThemesSnapshot } from "@thinkrail/contracts";
import { T, type Translator, useT } from "@thinkrail/locales/react";
import { SettingsGroup } from "@/settingsKit";
import type { UserThemeIssue } from "@/themes";
import { repoSourceUrl, SettingsLink } from "./LanguageSettings";
import { type FolderActions, SettingsFileIssues, SettingsFolderRow } from "./SettingsFolder";
import { SETTING, settingProps } from "./settingsCatalog";

const EXAMPLE_THEME_PATH = "packages/design-tokens/themes/dark.theme.json";

function issueLabel(t: Translator, issue: UserThemeIssue): string {
	switch (issue.error) {
		case "invalid-json":
			return t("settings.appearance.custom.error.invalidJson");
		case "invalid-theme":
			return t("settings.appearance.custom.error.invalidTheme");
		case "id-too-long":
			return t("settings.appearance.custom.error.idTooLong");
		case "duplicate-id":
			return t("settings.appearance.custom.error.duplicateId");
		case "too-large":
			return t("settings.appearance.custom.error.tooLarge");
		case "too-many":
			return t("settings.appearance.custom.error.tooMany");
		case "unreadable":
			return t("settings.appearance.custom.error.unreadable");
	}
}

export interface CustomThemesGroupProps extends FolderActions {
	snapshot: UserThemesSnapshot | null;
	issues: readonly UserThemeIssue[];
	appVersion: string | null;
}

export function CustomThemesGroup({
	snapshot,
	issues,
	appVersion,
	onCopyFolder,
	onRevealFolder,
}: CustomThemesGroupProps) {
	const t = useT();
	if (!snapshot) return null;
	return (
		<SettingsGroup title={t("settings.appearance.custom.title")} testId="custom-themes">
			<SettingsFolderRow
				{...settingProps(t, SETTING.themeFolder)}
				description={
					<T
						i18nKey="settings.appearance.custom.steps"
						components={[
							<SettingsLink
								key="example"
								href={repoSourceUrl(appVersion, EXAMPLE_THEME_PATH)}
								testId="custom-themes-example"
							/>,
						]}
					/>
				}
				folder={snapshot.dir}
				testIdPrefix="custom-themes"
				onCopyFolder={onCopyFolder}
				onRevealFolder={onRevealFolder}
			/>
			<SettingsFileIssues
				testIdPrefix="custom-theme-issue"
				issues={issues.map((issue) => ({
					fileName: issue.fileName,
					label: issueLabel(t, issue),
					detail: issue.detail,
				}))}
			/>
		</SettingsGroup>
	);
}
