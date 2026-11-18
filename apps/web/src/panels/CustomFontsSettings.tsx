import { RiUploadCloud2Line as Upload } from "@remixicon/react";
import {
	USER_FONT_EXTENSIONS,
	type UserFontFile,
	type UserFontFileErrorCode,
	type UserFontsSnapshot,
} from "@thinkrail/contracts";
import { type Translator, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { useRef, useState } from "react";
import { namedFamilies } from "@/fonts";
import { SettingsGroup, SettingsNotice } from "@/settingsKit";
import { useAppStore } from "@/store";
import { uploadUserFont } from "@/transport";
import { FamilyName, FontBadge } from "./FontPicker";
import { customFamilies } from "./fontCatalog";
import {
	type FolderActions,
	SettingsFileIssue,
	type SettingsFileIssueItem,
	SettingsFileIssues,
	SettingsFolderRow,
	useFolderActions,
} from "./SettingsFolder";
import { SETTING, settingProps } from "./settingsCatalog";

type UploadOutcome = UserFontFile | { fileName: string; ok: false; error: "upload-failed" };

function errorLabel(t: Translator, error: UserFontFileErrorCode | "upload-failed"): string {
	switch (error) {
		case "too-large":
			return t("settings.appearance.customFonts.error.tooLarge");
		case "too-many":
			return t("settings.appearance.customFonts.error.tooMany");
		case "unsupported-collection":
			return t("settings.appearance.customFonts.error.unsupportedCollection");
		case "invalid-font":
			return t("settings.appearance.customFonts.error.invalidFont");
		case "unreadable":
			return t("settings.appearance.customFonts.error.unreadable");
		case "upload-failed":
			return t("settings.appearance.customFonts.error.uploadFailed");
	}
}

function fileIssues(t: Translator, outcomes: readonly UploadOutcome[]): SettingsFileIssueItem[] {
	return outcomes.flatMap((outcome) =>
		outcome.ok
			? []
			: [
					{
						fileName: outcome.fileName,
						label: errorLabel(t, outcome.error),
						detail: "detail" in outcome ? outcome.detail : undefined,
					},
				],
	);
}

export interface CustomFontsViewProps extends FolderActions {
	snapshot: UserFontsSnapshot;
	inUse: ReadonlySet<string>;
	outcomes: readonly UploadOutcome[];
	busy: boolean;
	onFiles: (files: File[]) => void;
}

export function CustomFontsView({
	snapshot,
	inUse,
	outcomes,
	busy,
	onFiles,
	onCopyFolder,
	onRevealFolder,
}: CustomFontsViewProps) {
	const t = useT();
	const input = useRef<HTMLInputElement>(null);
	const [dragging, setDragging] = useState(false);
	const families = [...customFamilies(snapshot)];
	const empty = families.length === 0;
	const issues = fileIssues(t, snapshot.files);
	const added = [
		...new Set(outcomes.flatMap((outcome) => (outcome.ok ? [outcome.face.family] : []))),
	];
	const failed = fileIssues(t, outcomes);
	return (
		<SettingsGroup
			title={t("settings.appearance.customFonts.title")}
			description={t("settings.appearance.customFonts.description")}
			testId="custom-fonts"
		>
			<section
				aria-label={t("settings.appearance.customFonts.drop")}
				data-testid="custom-fonts-drop"
				data-setting-row={SETTING.customFonts.id}
				data-setting-id={SETTING.customFonts.id}
				data-dragging={dragging}
				data-empty={empty || undefined}
				onDragOver={(event) => {
					event.preventDefault();
					setDragging(true);
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={(event) => {
					event.preventDefault();
					setDragging(false);
					onFiles([...event.dataTransfer.files]);
				}}
				className="my-12 flex flex-wrap items-center gap-12 rounded-md border border-border-default border-dashed px-16 py-12 transition-colors data-[dragging=true]:border-primary data-[dragging=true]:bg-primary-subtle"
			>
				<Upload className="size-20 shrink-0 text-text-muted" aria-hidden="true" />
				<div className="flex min-w-160 flex-1 flex-col gap-2">
					<span className="tr-text-ui text-text-default">
						{empty
							? t("settings.appearance.customFonts.empty")
							: t("settings.appearance.customFonts.drop")}
					</span>
					<span className="text-text-muted tr-text-metadata">
						{empty
							? t("settings.appearance.customFonts.emptyHint")
							: t("settings.appearance.customFonts.dropHint")}
					</span>
				</div>
				<Button
					variant="outline"
					size="m"
					tabIndex={0}
					aria-busy={busy || undefined}
					data-setting-stop=""
					data-testid="custom-fonts-choose"
					onClick={() => input.current?.click()}
				>
					{t("settings.appearance.customFonts.choose")}
				</Button>
				<input
					ref={input}
					type="file"
					multiple
					accept={USER_FONT_EXTENSIONS.join(",")}
					data-testid="custom-fonts-input"
					className="sr-only"
					tabIndex={-1}
					onChange={(event) => {
						onFiles([...(event.currentTarget.files ?? [])]);
						event.currentTarget.value = "";
					}}
				/>
			</section>
			<div
				role="status"
				className={cn("flex flex-col gap-4", (added.length > 0 || failed.length > 0) && "pb-12")}
			>
				{added.length > 0 ? (
					<SettingsNotice variant="success" testId="custom-fonts-added">
						{t("settings.appearance.customFonts.added", { families: added.join(", ") })}
					</SettingsNotice>
				) : null}
				{failed.map((issue) => (
					<SettingsFileIssue key={issue.fileName} issue={issue} testIdPrefix="custom-font-issue" />
				))}
			</div>
			{empty ? null : (
				<ul aria-label={t("settings.appearance.customFonts.title")} className="flex flex-col">
					{families.map(([family, entry]) => (
						<li
							key={family}
							data-testid="custom-font-family"
							data-font-family={family}
							className="flex items-center gap-8 border-border-muted border-b py-8"
						>
							<div className="flex min-w-0 flex-1 flex-col gap-2">
								<FamilyName
									family={family}
									role={entry.monospace ? "code" : "interface"}
									className="break-words text-text-default"
								>
									{family}
								</FamilyName>
								<span className="break-all text-text-muted tr-code-text">
									{entry.files.join(", ")}
								</span>
							</div>
							{entry.monospace ? (
								<FontBadge>{t("settings.appearance.fonts.picker.mono")}</FontBadge>
							) : null}
							{inUse.has(family) ? (
								<FontBadge>{t("settings.appearance.customFonts.inUse")}</FontBadge>
							) : null}
						</li>
					))}
				</ul>
			)}
			<SettingsFolderRow
				{...settingProps(t, SETTING.fontsFolder)}
				folder={snapshot.dir}
				hint={t("settings.appearance.customFonts.removeHint")}
				testIdPrefix="custom-fonts"
				onCopyFolder={onCopyFolder}
				onRevealFolder={onRevealFolder}
			/>
			<SettingsFileIssues issues={issues} testIdPrefix="custom-font-issue" />
		</SettingsGroup>
	);
}

export function CustomFontsGroup() {
	const snapshot = useAppStore((state) => state.userFonts);
	const interfaceFont = useAppStore((state) => state.interfaceFont);
	const codeFont = useAppStore((state) => state.codeFont);
	const folderActions = useFolderActions("fonts.reveal");
	const [outcomes, setOutcomes] = useState<UploadOutcome[]>([]);
	const [uploading, setUploading] = useState(0);
	if (!snapshot) return null;
	const upload = (files: File[]) => {
		if (files.length === 0) return;
		if (uploading === 0) setOutcomes([]);
		setUploading((count) => count + 1);
		void Promise.all(
			files.map((file) =>
				uploadUserFont(file).catch(
					(): UploadOutcome => ({ fileName: file.name, ok: false, error: "upload-failed" }),
				),
			),
		).then((results) => {
			setOutcomes((current) => {
				const merged = new Map(current.map((outcome) => [outcome.fileName, outcome]));
				for (const result of results) {
					merged.delete(result.fileName);
					merged.set(result.fileName, result);
				}
				return [...merged.values()];
			});
			setUploading((count) => count - 1);
		});
	};
	return (
		<CustomFontsView
			snapshot={snapshot}
			inUse={namedFamilies([interfaceFont, codeFont])}
			outcomes={outcomes}
			busy={uploading > 0}
			onFiles={upload}
			{...folderActions}
		/>
	);
}
