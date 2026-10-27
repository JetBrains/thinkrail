import {
	RiFileCopyLine as Copy,
	RiExternalLinkLine as ExternalLink,
	RiFolderOpenLine as FolderOpen,
} from "@remixicon/react";
import type { LocalLocaleFileErrorCode, LocalLocalesSnapshot } from "@thinkrail/contracts";
import { languageName, SYSTEM_LOCALE } from "@thinkrail/locales";
import { T, useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { type ReactNode, useMemo } from "react";
import {
	effectiveLocale,
	type LanguageOption,
	type LanguageSource,
	languageOptions,
	useSystemLanguages,
} from "@/i18n";
import { copyText } from "@/lib";
import { toast, useAppStore } from "@/store";
import { errorText, getTransport } from "@/transport";
import { SettingsGroup, SettingsPageContainer } from "./SettingsGroup";
import { SettingsRadioCards, type SettingsRadioChoice } from "./SettingsRadioCards";
import { SettingsRow } from "./SettingsRow";

const REPO_URL = "https://github.com/JetBrains/thinkrail";
export const CONTRIBUTE_TRANSLATIONS_URL = `${REPO_URL}/blob/main/CONTRIBUTING.md#translations`;

export function repoSourceUrl(appVersion: string | null, path: string): string {
	const released =
		appVersion && /^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(appVersion) && appVersion !== "0.0.0";
	return `${REPO_URL}/blob/${released ? `v${appVersion}` : "main"}/${path}`;
}

export function englishSourceUrl(appVersion: string | null): string {
	return repoSourceUrl(appVersion, "packages/locales/en.json");
}

function InlineLink({ href, children }: { href: string; children?: ReactNode }) {
	return (
		<a
			data-testid="language-english-source"
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			className="text-primary underline underline-offset-2 hover:opacity-80"
		>
			{children}
		</a>
	);
}

function useSourceLabel(): (source: LanguageSource) => string {
	const t = useT();
	return (source) =>
		source === "builtin"
			? t("settings.language.source.builtin")
			: source === "local"
				? t("settings.language.source.local")
				: t("settings.language.source.customized");
}

function useErrorLabel(): (error: LocalLocaleFileErrorCode) => string {
	const t = useT();
	return (error) => {
		switch (error) {
			case "invalid-name":
				return t("settings.language.error.invalidName");
			case "duplicate":
				return t("settings.language.error.duplicate");
			case "too-large":
				return t("settings.language.error.tooLarge");
			case "too-many":
				return t("settings.language.error.tooMany");
			case "unreadable":
				return t("settings.language.error.unreadable");
			case "invalid-json":
				return t("settings.language.error.invalidJson");
			case "not-object":
				return t("settings.language.error.notObject");
		}
	};
}

function choiceId(option: LanguageOption): string {
	return option.kind === "language"
		? option.tag
		: option.kind === "missing"
			? `missing:${option.tag}`
			: `broken:${option.fileName}`;
}

export function LanguageSettings() {
	const t = useT();
	const preference = useAppStore((s) => s.locale);
	const snapshot = useAppStore((s) => s.localLocales);
	const appVersion = useAppStore((s) => s.hostAppVersion);
	const systemLanguages = useSystemLanguages();

	const select = (next: string) => {
		if (next === preference) return;
		getTransport()
			.request("settings.update", { config: { locale: next } })
			.catch((error) => toast.error(errorText(error, t("settings.language.changeFailed"))));
	};

	const copyFolder = async (folder: string) => {
		if (await copyText(folder)) toast.success(t("settings.language.folderCopied"));
	};

	const revealFolder = () => {
		getTransport()
			.request("locales.reveal", {})
			.catch((error) => toast.error(errorText(error, t("settings.language.openFolderFailed"))));
	};

	return (
		<LanguagePage
			preference={preference}
			snapshot={snapshot}
			appVersion={appVersion}
			systemLanguages={systemLanguages.split(",")}
			onSelect={select}
			onCopyFolder={(folder) => void copyFolder(folder)}
			onRevealFolder={revealFolder}
		/>
	);
}

export interface LanguagePageProps {
	preference: string;
	snapshot: LocalLocalesSnapshot | null;
	appVersion: string | null;
	systemLanguages: readonly string[];
	onSelect: (preference: string) => void;
	onCopyFolder: (folder: string) => void;
	onRevealFolder: () => void;
}

export function LanguagePage({
	preference,
	snapshot,
	appVersion,
	systemLanguages,
	onSelect,
	onCopyFolder,
	onRevealFolder,
}: LanguagePageProps) {
	const t = useT();
	const sourceLabel = useSourceLabel();
	const errorLabel = useErrorLabel();
	const options = useMemo(() => languageOptions(preference, snapshot), [preference, snapshot]);
	const systemTag = effectiveLocale(SYSTEM_LOCALE, snapshot, systemLanguages);
	const folder = snapshot?.dir;

	const choices: SettingsRadioChoice<string>[] = [
		{
			id: SYSTEM_LOCALE,
			label: t("settings.language.system.label"),
			description: t("settings.language.system.description", { language: languageName(systemTag) }),
			testId: "language-system",
		},
		...options.map((option): SettingsRadioChoice<string> => {
			if (option.kind === "language") {
				return {
					id: choiceId(option),
					label: option.name,
					hint: sourceLabel(option.source),
					description: option.tag,
					testId: `language-${option.tag}`,
				};
			}
			if (option.kind === "missing") {
				return {
					id: choiceId(option),
					label: languageName(option.tag),
					hint: t("settings.language.source.missing"),
					description: t("settings.language.missingDescription", { tag: option.tag }),
					testId: `language-missing-${option.tag}`,
					disabled: true,
				};
			}
			return {
				id: choiceId(option),
				label: option.fileName,
				hint: t("settings.language.source.broken"),
				description: option.detail
					? `${errorLabel(option.error)} ${option.detail}`
					: errorLabel(option.error),
				testId: `language-broken-${option.fileName}`,
				disabled: true,
			};
		}),
	];

	const value = options.some((option) => option.kind === "missing")
		? `missing:${preference}`
		: preference;

	return (
		<SettingsPageContainer testId="settings-language">
			<SettingsGroup
				title={t("settings.language.title")}
				description={t("settings.language.description")}
			>
				<div className="py-12">
					<SettingsRadioCards
						name="ui-language"
						label={t("settings.language.title")}
						choices={choices}
						value={value}
						onSelect={onSelect}
					/>
				</div>
			</SettingsGroup>
			<SettingsGroup title={t("settings.language.add.title")} testId="language-add">
				<p className="py-12 tr-text-metadata text-text-muted">
					<T
						i18nKey="settings.language.add.steps"
						components={[<InlineLink key="en" href={englishSourceUrl(appVersion)} />]}
					/>
				</p>
				{folder ? (
					<SettingsRow
						label={t("settings.language.folder.label")}
						description={
							<code data-testid="language-folder-path" className="tr-code-text break-all">
								{folder}
							</code>
						}
						testId="language-folder"
						control={
							<div className="flex gap-8">
								<Button
									variant="outline"
									size="m"
									iconLeft={Copy}
									onClick={() => onCopyFolder(folder)}
								>
									{t("settings.language.folder.copy")}
								</Button>
								<Button
									variant="outline"
									size="m"
									iconLeft={FolderOpen}
									data-testid="language-open-folder"
									onClick={onRevealFolder}
								>
									{t("settings.language.folder.open")}
								</Button>
							</div>
						}
					/>
				) : null}
				<SettingsRow
					label={t("settings.language.contribute.label")}
					description={t("settings.language.contribute.description")}
					noBorder
					control={
						<a
							data-testid="language-contribute"
							href={CONTRIBUTE_TRANSLATIONS_URL}
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-4 tr-text-ui text-primary underline-offset-2 hover:underline"
						>
							<ExternalLink className="size-14" />
							{t("settings.language.contribute.link")}
						</a>
					}
				/>
			</SettingsGroup>
		</SettingsPageContainer>
	);
}
