import { RiSearchLine } from "@remixicon/react";
import type {
	ExtensionBrowseEntry,
	ExtensionBrowseResult,
	WsErrorCode,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { cn } from "@thinkrail/ui/utils";
import { extensionApiFit } from "@/extensions";
import {
	SETTINGS_LIST_PRIMARY,
	SETTINGS_ROW_FOCUS,
	SETTINGS_ROW_INSET,
	SETTINGS_ROWS,
	SETTINGS_TAG,
	SettingsGroup,
	SettingsLine,
	SettingsList,
	SettingsNotice,
	useSettingsListRow,
} from "@/settingsKit";
import { CHIP_CLASS } from "./PiPackagesSettings";
import { SETTING } from "./settingsCatalog";

export const AUTHORING_GUIDE_URL = "https://thinkrail.ai/docs/build-an-extension/";

export type ExtensionBrowseRead =
	| { status: "loading" }
	| { status: "failed"; code: WsErrorCode | undefined }
	| { status: "loaded"; result: ExtensionBrowseResult };

const FAILURE_COPY: Partial<Record<WsErrorCode, MessageKey>> = {
	EXTENSION_CATALOG_OFFLINE: "settings.extensionBrowse.failed.offline",
	EXTENSION_CATALOG_INVALID: "settings.extensionBrowse.failed.invalid",
};

const INPUT_CLASS =
	"h-32 w-full rounded-sm border border-control-border-default bg-control-bg pr-8 pl-24 tr-text-ui text-text-default transition-colors placeholder:text-text-muted focus:border-control-border-active focus-visible:focus-ring";

export function matchesBrowseQuery(entry: ExtensionBrowseEntry, query: string): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	return [entry.title, entry.name, entry.description, entry.author].some((field) =>
		field?.toLowerCase().includes(needle),
	);
}

type SideProps = ReturnType<typeof useSettingsListRow>["sideProps"];

function ExternalLink({
	href,
	label,
	testId,
	sideProps,
}: {
	href: string;
	label: string;
	testId: string;
	sideProps?: SideProps;
}) {
	return (
		<a
			tabIndex={0}
			{...sideProps}
			data-testid={testId}
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			className="tr-text-metadata text-primary underline underline-offset-2 focus-visible:focus-ring"
		>
			{label} ↗
		</a>
	);
}

export function ExtensionBrowseCard({
	entry,
	onInstall,
}: {
	entry: ExtensionBrowseEntry;
	onInstall: (entry: ExtensionBrowseEntry) => void;
}) {
	const t = useT();
	const { rowProps, primaryProps, sideProps } = useSettingsListRow(entry.name);
	const title = entry.title ?? entry.name;
	const fit = extensionApiFit(entry.api);
	const installable = !entry.installed && fit === "compatible";
	return (
		<li
			{...rowProps}
			data-testid="extension-browse-card"
			data-name={entry.name}
			className={cn(
				"flex flex-wrap items-start gap-8 border-border-muted border-b py-6 last:border-b-0",
				SETTINGS_ROW_INSET,
				SETTINGS_ROW_FOCUS,
			)}
		>
			<button
				type="button"
				{...primaryProps}
				{...(installable
					? { "aria-haspopup": "dialog" as const, onClick: () => onInstall(entry) }
					: { "aria-disabled": true })}
				className={cn(SETTINGS_LIST_PRIMARY, "min-w-[12rem]")}
			>
				<span className="flex min-w-0 max-w-full flex-wrap items-center gap-x-8 gap-y-4">
					<span className="wrap-anywhere tr-title-compact text-text-default">{title}</span>
					<span className="tr-text-metadata text-text-muted">{entry.version}</span>
					{entry.halves.includes("server") ? (
						<span
							data-testid="extension-browse-tools"
							className={cn("tr-text-metadata", CHIP_CLASS)}
						>
							{t("settings.extensionBrowse.agentTools")}
						</span>
					) : null}
					{entry.halves.includes("web") ? (
						<span
							data-testid="extension-browse-cards"
							className={cn("tr-text-metadata", CHIP_CLASS)}
						>
							{t("settings.installedExtensions.chatCards")}
						</span>
					) : null}
					{entry.installed ? (
						<span
							data-testid="extension-browse-installed"
							className={cn(SETTINGS_TAG, "text-text-muted")}
						>
							{t("settings.extensionBrowse.installed")}
						</span>
					) : fit === "compatible" ? null : (
						<span
							data-testid="extension-browse-incompatible"
							className={cn(SETTINGS_TAG, "border-feedback-warning text-feedback-warning")}
						>
							{fit === "builtForOlderApp"
								? t("settings.installedExtensions.incompatible.older")
								: t("settings.installedExtensions.incompatible.newer")}
						</span>
					)}
				</span>
				<span className="wrap-anywhere tr-text-metadata text-text-muted">
					{[entry.name, entry.author].filter(Boolean).join(" · ")}
				</span>
				{entry.description ? (
					<span className="tr-text-ui text-text-default break-words">{entry.description}</span>
				) : null}
				{entry.installed || fit === "compatible" ? null : (
					<span
						data-testid="extension-browse-incompatible-hint"
						className="wrap-anywhere tr-text-metadata text-text-muted"
					>
						{t("settings.extensionBrowse.incompatibleHint", { api: entry.api })}
					</span>
				)}
			</button>
			<div className="ml-auto flex shrink-0 flex-wrap items-center gap-8 self-center">
				<ExternalLink
					href={entry.npm}
					label={t("settings.extensionBrowse.npm")}
					testId="extension-browse-npm"
					sideProps={sideProps}
				/>
				{entry.repository ? (
					<ExternalLink
						href={entry.repository}
						label={t("settings.extensionBrowse.repository")}
						testId="extension-browse-repository"
						sideProps={sideProps}
					/>
				) : null}
				{installable ? (
					<Button
						variant="outline"
						size="m"
						{...sideProps}
						data-testid="extension-browse-install"
						onClick={() => onInstall(entry)}
					>
						{t("settings.extensionBrowse.install")}
					</Button>
				) : null}
			</div>
		</li>
	);
}

export interface ExtensionBrowseProps {
	read: ExtensionBrowseRead;
	query: string;
	onQueryChange: (query: string) => void;
	onRetry: () => void;
	onInstall: (entry: ExtensionBrowseEntry) => void;
}

export function ExtensionBrowse({
	read,
	query,
	onQueryChange,
	onRetry,
	onInstall,
}: ExtensionBrowseProps) {
	const t = useT();
	const entries = read.status === "loaded" ? read.result.extensions : [];
	const shown = entries.filter((entry) => matchesBrowseQuery(entry, query));
	return (
		<SettingsGroup
			testId="settings-extension-browse"
			title={t("settings.extensionBrowse.title")}
			description={
				<span data-testid="extension-browse-trust">
					{t("settings.extensionBrowse.description")}
				</span>
			}
		>
			<div
				data-setting-id={SETTING.extensionBrowse.id}
				data-status={read.status}
				className={SETTINGS_ROWS}
			>
				{read.status === "loading" ? <LoadingRegion rows={2} className="py-8" /> : null}
				{read.status === "failed" ? (
					<div className="py-8">
						<SettingsNotice
							variant="error"
							rowId="extension-browse-failed"
							testId="extension-browse-failed"
							action={
								<Button
									variant="outline"
									size="s"
									tabIndex={0}
									data-testid="extension-browse-retry"
									onClick={onRetry}
								>
									{t("common.retry")}
								</Button>
							}
						>
							<span className="flex flex-col gap-2 break-words">
								<span>
									{t(
										(read.code && FAILURE_COPY[read.code]) ??
											"settings.extensionBrowse.failed.unreachable",
									)}
								</span>
								<span className="text-text-muted">
									{t("settings.extensionBrowse.failed.installedWork")}
								</span>
							</span>
						</SettingsNotice>
					</div>
				) : null}
				{read.status === "loaded" && entries.length === 0 ? (
					<SettingsLine
						rowId="extension-browse-empty"
						testId="extension-browse-empty"
						className="flex flex-col items-start gap-2 py-8"
					>
						<span className="tr-text-ui text-text-default">
							{t("settings.extensionBrowse.empty")}
						</span>
						<span className="tr-text-metadata text-text-muted">
							{t("settings.extensionBrowse.emptyHint")}
						</span>
						<ExternalLink
							href={AUTHORING_GUIDE_URL}
							label={t("settings.extensionBrowse.guide")}
							testId="extension-browse-guide"
						/>
					</SettingsLine>
				) : null}
				{read.status === "loaded" && entries.length > 0 ? (
					<>
						<SettingsLine
							rowId="extension-browse-search"
							className="border-border-muted border-b py-8"
						>
							<div className="relative flex items-center">
								<RiSearchLine
									aria-hidden
									className="pointer-events-none absolute left-8 size-14 text-text-muted"
								/>
								<input
									data-testid="extension-browse-search"
									type="text"
									tabIndex={0}
									aria-label={t("settings.extensionBrowse.searchLabel")}
									className={INPUT_CLASS}
									value={query}
									placeholder={t("settings.extensionBrowse.searchPlaceholder")}
									spellCheck={false}
									autoComplete="off"
									onChange={(event) => onQueryChange(event.currentTarget.value)}
									onKeyDown={(event) => {
										if (event.key !== "Escape" || query === "") return;
										if (isImeComposing(event.nativeEvent)) return;
										event.preventDefault();
										onQueryChange("");
									}}
								/>
							</div>
						</SettingsLine>
						{shown.length === 0 ? (
							<p
								data-testid="extension-browse-no-match"
								className="py-8 tr-text-metadata text-text-muted"
							>
								{t("settings.extensionBrowse.noMatch", { query: query.trim() })}
							</p>
						) : (
							<SettingsList
								focusList="extension-browse"
								label={t("settings.extensionBrowse.title")}
								rowIds={shown.map((entry) => entry.name)}
								testId="extension-browse-list"
							>
								{shown.map((entry) => (
									<ExtensionBrowseCard key={entry.name} entry={entry} onInstall={onInstall} />
								))}
							</SettingsList>
						)}
					</>
				) : null}
			</div>
		</SettingsGroup>
	);
}
