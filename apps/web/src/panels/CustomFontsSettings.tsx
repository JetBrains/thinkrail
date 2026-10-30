import {
	RiFileCopyLine as Copy,
	RiFolderOpenLine as FolderOpen,
	RiUploadCloud2Line as Upload,
} from "@remixicon/react";
import {
	type FontFamilyRef,
	USER_FONT_EXTENSIONS,
	type UserFontFile,
	type UserFontFileErrorCode,
	type UserFontsSnapshot,
} from "@thinkrail/contracts";
import { type Translator, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useRef, useState } from "react";
import { copyText } from "@/lib";
import { toast, useAppStore } from "@/store";
import { errorText, getTransport, uploadUserFont } from "@/transport";
import { FamilyName, FontBadge } from "./FontPicker";
import { customFontFiles, usedFamilies } from "./fontCatalog";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsNotice } from "./SettingsNotice";
import { SettingsRow } from "./SettingsRow";

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

function FileIssue({ outcome }: { outcome: Exclude<UploadOutcome, { ok: true }> }) {
	const t = useT();
	return (
		<SettingsNotice variant="warning" testId={`custom-font-issue-${outcome.fileName}`}>
			<span className="flex flex-col gap-4">
				<span className="tr-code-text">{outcome.fileName}</span>
				<span>{errorLabel(t, outcome.error)}</span>
				{"detail" in outcome && outcome.detail ? (
					<span className="break-words text-text-muted">{outcome.detail}</span>
				) : null}
			</span>
		</SettingsNotice>
	);
}

export interface CustomFontsViewProps {
	snapshot: UserFontsSnapshot;
	inUse: ReadonlySet<string>;
	outcomes: readonly UploadOutcome[];
	busy: boolean;
	onFiles: (files: File[]) => void;
	onCopyFolder: (folder: string) => void;
	onRevealFolder: () => void;
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
	const families = new Map<string, { files: string[]; monospace: boolean }>();
	for (const file of customFontFiles(snapshot)) {
		const previous = families.get(file.face.family);
		families.set(file.face.family, {
			files: [...(previous?.files ?? []), file.fileName],
			monospace: (previous?.monospace ?? false) || file.face.monospace,
		});
	}
	const issues = snapshot.files.filter((file) => !file.ok);
	const added = [
		...new Set(outcomes.flatMap((outcome) => (outcome.ok ? [outcome.face.family] : []))),
	];
	const failed = outcomes.filter((outcome) => !outcome.ok);
	return (
		<SettingsGroup
			title={t("settings.appearance.customFonts.title")}
			description={t("settings.appearance.customFonts.description")}
			testId="custom-fonts"
		>
			<section
				aria-label={t("settings.appearance.customFonts.drop")}
				data-testid="custom-fonts-drop"
				data-dragging={dragging}
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
				className="mb-12 flex flex-col items-center gap-8 rounded-md border border-border-default border-dashed px-16 py-16 text-center transition-colors data-[dragging=true]:border-primary data-[dragging=true]:bg-primary-subtle"
			>
				<Upload className="size-20 text-text-muted" aria-hidden="true" />
				<span className="tr-text-ui text-text-default">
					{t("settings.appearance.customFonts.drop")}
				</span>
				<span className="text-text-muted tr-text-metadata">
					{t("settings.appearance.customFonts.dropHint")}
				</span>
				<Button
					variant="outline"
					size="m"
					loading={busy}
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
			{added.length > 0 || failed.length > 0 ? (
				<div className="flex flex-col gap-4 pb-12">
					{added.length > 0 ? (
						<SettingsNotice variant="success" testId="custom-fonts-added">
							{t("settings.appearance.customFonts.added", { families: added.join(", ") })}
						</SettingsNotice>
					) : null}
					{failed.map((outcome) => (
						<FileIssue key={outcome.fileName} outcome={outcome} />
					))}
				</div>
			) : null}
			{[...families].map(([family, entry]) => (
				<div
					key={family}
					data-testid="custom-font-family"
					data-font-family={family}
					className="flex items-center gap-8 border-border-muted border-b py-8"
				>
					<div className="flex min-w-0 flex-1 flex-col gap-2">
						<FamilyName
							family={family}
							role={entry.monospace ? "code" : "interface"}
							className="truncate text-text-default"
						>
							{family}
						</FamilyName>
						<span className="truncate text-text-muted tr-code-text">{entry.files.join(", ")}</span>
					</div>
					{entry.monospace ? (
						<FontBadge>{t("settings.appearance.fonts.picker.mono")}</FontBadge>
					) : null}
					{inUse.has(family) ? (
						<FontBadge>{t("settings.appearance.customFonts.inUse")}</FontBadge>
					) : null}
				</div>
			))}
			<SettingsRow
				label={t("settings.appearance.customFonts.folder")}
				description={
					<>
						<code data-testid="custom-fonts-folder-path" className="break-all tr-code-text">
							{snapshot.dir}
						</code>
						<span className="block">{t("settings.appearance.customFonts.removeHint")}</span>
					</>
				}
				noBorder={issues.length === 0}
				control={
					<div className="flex gap-8">
						<Button
							variant="outline"
							size="m"
							iconLeft={Copy}
							onClick={() => onCopyFolder(snapshot.dir)}
						>
							{t("settings.language.folder.copy")}
						</Button>
						<Button
							variant="outline"
							size="m"
							iconLeft={FolderOpen}
							data-testid="custom-fonts-open-folder"
							onClick={onRevealFolder}
						>
							{t("settings.language.folder.open")}
						</Button>
					</div>
				}
			/>
			{issues.length > 0 ? (
				<div className="flex flex-col gap-4 py-12">
					{issues.map((issue) =>
						issue.ok ? null : <FileIssue key={issue.fileName} outcome={issue} />,
					)}
				</div>
			) : null}
		</SettingsGroup>
	);
}

export function CustomFontsGroup() {
	const t = useT();
	const snapshot = useAppStore((state) => state.userFonts);
	const interfaceFont = useAppStore((state) => state.interfaceFont);
	const codeFont = useAppStore((state) => state.codeFont);
	const [outcomes, setOutcomes] = useState<UploadOutcome[]>([]);
	const [busy, setBusy] = useState(false);
	if (!snapshot) return null;
	const refs: FontFamilyRef[] = [interfaceFont, codeFont].flatMap((choice) => [
		...(choice.family ? [choice.family] : []),
		...choice.fallbacks,
	]);
	const upload = (files: File[]) => {
		if (files.length === 0) return;
		setBusy(true);
		void Promise.all(
			files.map((file) =>
				uploadUserFont(file).catch(
					(): UploadOutcome => ({ fileName: file.name, ok: false, error: "upload-failed" }),
				),
			),
		).then((results) => {
			setOutcomes(results);
			setBusy(false);
		});
	};
	return (
		<CustomFontsView
			snapshot={snapshot}
			inUse={usedFamilies(snapshot.files, refs)}
			outcomes={outcomes}
			busy={busy}
			onFiles={upload}
			onCopyFolder={(folder) =>
				void copyText(folder).then((copied) => {
					if (copied) toast.success(t("settings.language.folderCopied"));
				})
			}
			onRevealFolder={() =>
				void getTransport()
					.request("fonts.reveal", {})
					.catch((error: unknown) =>
						toast.error(errorText(error, t("settings.language.openFolderFailed"))),
					)
			}
		/>
	);
}
