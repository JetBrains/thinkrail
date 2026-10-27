import { RiFileCopyLine as Copy, RiFolderOpenLine as FolderOpen } from "@remixicon/react";
import type { UserThemesSnapshot } from "@thinkrail/contracts";
import { T, type Translator, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import type { ReactNode } from "react";
import type { UserThemeIssue } from "@/themes";
import { repoSourceUrl } from "./LanguageSettings";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsNotice } from "./SettingsNotice";
import { SettingsRow } from "./SettingsRow";

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

export interface CustomThemesGroupProps {
	snapshot: UserThemesSnapshot | null;
	issues: readonly UserThemeIssue[];
	appVersion: string | null;
	onCopyFolder: (folder: string) => void;
	onRevealFolder: () => void;
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
			<SettingsRow
				label={t("settings.appearance.custom.folder")}
				description={
					<code data-testid="custom-themes-folder-path" className="tr-code-text break-all">
						{folder}
					</code>
				}
				noBorder={issues.length === 0}
				control={
					<div className="flex gap-8">
						<Button variant="outline" size="sm" onClick={() => onCopyFolder(folder)}>
							<Copy className="size-14" />
							{t("settings.language.folder.copy")}
						</Button>
						<Button
							variant="outline"
							size="sm"
							data-testid="custom-themes-open-folder"
							onClick={onRevealFolder}
						>
							<FolderOpen className="size-14" />
							{t("settings.language.folder.open")}
						</Button>
					</div>
				}
			/>
			{issues.length > 0 ? (
				<div className="flex flex-col gap-4 py-12">
					{issues.map((issue) => (
						<SettingsNotice
							key={issue.fileName}
							variant="warning"
							testId={`custom-theme-issue-${issue.fileName}`}
						>
							<span className="flex flex-col gap-4">
								<span className="tr-code-text">{issue.fileName}</span>
								<span>{issueLabel(t, issue)}</span>
								{issue.detail ? (
									<span className="break-words text-text-muted">{issue.detail}</span>
								) : null}
							</span>
						</SettingsNotice>
					))}
				</div>
			) : null}
		</SettingsGroup>
	);
}
