import { RiFileCopyLine as Copy, RiFolderOpenLine as FolderOpen } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import type { ReactNode } from "react";
import { copyText } from "@/lib";
import { SettingsNotice, SettingsRow } from "@/settingsKit";
import { toast } from "@/store";
import { errorText, getTransport } from "@/transport";

export type RevealFolderMethod = "locales.reveal" | "themes.reveal" | "fonts.reveal";

export interface FolderActions {
	onCopyFolder: (folder: string) => void;
	onRevealFolder: () => void;
}

export function useFolderActions(method: RevealFolderMethod): FolderActions {
	const t = useT();
	return {
		onCopyFolder: (folder) =>
			void copyText(folder).then((copied) => {
				if (copied) toast.success(t("settings.language.folderCopied"));
			}),
		onRevealFolder: () =>
			void getTransport()
				.request(method, {})
				.catch((error: unknown) =>
					toast.error(errorText(error, t("settings.language.openFolderFailed"))),
				),
	};
}

export function SettingsFolderRow({
	settingId,
	label,
	description,
	folder,
	hint,
	testIdPrefix,
	onCopyFolder,
	onRevealFolder,
}: FolderActions & {
	settingId: string;
	label: string;
	description?: ReactNode;
	folder: string;
	hint?: ReactNode;
	testIdPrefix: string;
}) {
	const t = useT();
	return (
		<SettingsRow
			settingId={settingId}
			label={label}
			testId={`${testIdPrefix}-folder`}
			description={
				<>
					{description ? <span className="block">{description}</span> : null}
					<code data-testid={`${testIdPrefix}-folder-path`} className="break-all tr-code-text">
						{folder}
					</code>
					{hint ? <span className="block">{hint}</span> : null}
				</>
			}
			control={
				<Button
					variant="outline"
					size="m"
					iconLeft={Copy}
					tabIndex={0}
					onClick={() => onCopyFolder(folder)}
				>
					{t("settings.language.folder.copy")}
				</Button>
			}
			sides={
				<Button
					variant="outline"
					size="m"
					iconLeft={FolderOpen}
					tabIndex={0}
					data-testid={`${testIdPrefix}-open-folder`}
					onClick={onRevealFolder}
				>
					{t("settings.language.folder.open")}
				</Button>
			}
		/>
	);
}

export interface SettingsFileIssueItem {
	fileName: string;
	label: string;
	detail?: string | undefined;
}

export function SettingsFileIssue({
	issue,
	testIdPrefix,
}: {
	issue: SettingsFileIssueItem;
	testIdPrefix: string;
}) {
	return (
		<SettingsNotice variant="warning" testId={`${testIdPrefix}-${issue.fileName}`}>
			<span className="flex flex-col gap-4">
				<span className="tr-code-text">{issue.fileName}</span>
				<span>{issue.label}</span>
				{issue.detail ? <span className="break-words text-text-muted">{issue.detail}</span> : null}
			</span>
		</SettingsNotice>
	);
}

export function SettingsFileIssues({
	issues,
	testIdPrefix,
}: {
	issues: readonly SettingsFileIssueItem[];
	testIdPrefix: string;
}) {
	if (issues.length === 0) return null;
	return (
		<div className="flex flex-col gap-4 py-12">
			{issues.map((issue) => (
				<SettingsFileIssue key={issue.fileName} issue={issue} testIdPrefix={testIdPrefix} />
			))}
		</div>
	);
}
