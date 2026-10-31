import type { UserThemesSnapshot } from "@thinkrail/contracts";
import { T, type Translator, useT } from "@thinkrail/locales/react";
import type { ReactNode } from "react";
import type { UserThemeIssue } from "@/themes";
import { repoSourceUrl } from "./LanguageSettings";
import { type FolderActions, SettingsFileIssues, SettingsFolderRow } from "./SettingsFolder";
import { SettingsGroup } from "./SettingsGroup";

const EXAMPLE_THEME_PATH = "apps/web/src/themes/bundled/dark.theme.json";

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

function ExampleLink({ href, children }: { href: string; children?: ReactNode }) {
	return (
		<a
			data-testid="custom-themes-example"
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			className="text-primary underline underline-offset-2 hover:opacity-80"
		>
			{children}
		</a>
	);
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
	const folder = snapshot.dir;
	return (
		<SettingsGroup title={t("settings.appearance.custom.title")} testId="custom-themes">
			<p className="py-12 tr-text-metadata text-text-muted">
				<T
					i18nKey="settings.appearance.custom.steps"
					components={[
						<ExampleLink key="example" href={repoSourceUrl(appVersion, EXAMPLE_THEME_PATH)} />,
					]}
				/>
			</p>
			<SettingsFolderRow
				label={t("settings.appearance.custom.folder")}
				folder={folder}
				testIdPrefix="custom-themes"
				noBorder={issues.length === 0}
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
