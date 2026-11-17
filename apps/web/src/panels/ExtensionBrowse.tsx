import { RiSearchLine } from "@remixicon/react";
import type {
	ExtensionBrowseEntry,
	ExtensionBrowseResult,
	WsErrorCode,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { cn } from "@thinkrail/ui/utils";
import { useState } from "react";
import { extensionApiFit } from "@/extensions";
import { CHIP_CLASS } from "./PiPackagesSettings";
import { SETTINGS_TAG } from "./SettingsGroup";
import { SettingsNotice } from "./SettingsNotice";

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
	"w-full min-w-0 rounded-sm border border-control-border-default bg-control-bg py-4 pr-8 pl-24 tr-text-ui text-text-default outline-none placeholder:text-text-muted focus-visible:border-control-border-active";

/** Case-insensitive match on what a card shows: title, name, description and author. */
export function matchesBrowseQuery(entry: ExtensionBrowseEntry, query: string): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) return true;
	return [entry.title, entry.name, entry.description, entry.author].some((field) =>
		field?.toLowerCase().includes(needle),
	);
}

function ExternalLink({ href, label, testId }: { href: string; label: string; testId: string }) {
	return (
		<a
			data-testid={testId}
			href={href}
			target="_blank"
			rel="noopener noreferrer"
			className="tr-text-metadata text-primary underline underline-offset-2"
		>
			{label} ↗
		</a>
	);
}

function PreviewImage({ src }: { src: string }) {
	const [broken, setBroken] = useState(false);
	return (
		<div
			data-testid="extension-browse-image-box"
			data-broken={broken ? "true" : "false"}
			className="aspect-video w-full overflow-hidden bg-container-elevated-bg"
		>
			{broken ? null : (
				<img
					data-testid="extension-browse-image"
					src={src}
					alt=""
					loading="lazy"
					decoding="async"
					referrerPolicy="no-referrer"
					className="size-full object-cover"
					onError={() => setBroken(true)}
				/>
			)}
		</div>
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
	const title = entry.title ?? entry.name;
	const compatible = extensionApiFit(entry.api) === "compatible";
	return (
		<li
			data-testid="extension-browse-card"
			data-name={entry.name}
			className="flex min-w-0 flex-col overflow-hidden rounded-sm border border-border-default bg-control-bg"
		>
			{entry.image ? <PreviewImage src={entry.image} /> : null}
			<div className="flex min-w-0 flex-1 flex-col gap-4 px-12 py-8">
				<div className="flex min-w-0 items-baseline justify-between gap-8">
					<span className="min-w-0 truncate tr-title-compact text-text-default" title={title}>
						{title}
					</span>
					<span className="shrink-0 tr-text-metadata text-text-muted">{entry.version}</span>
				</div>
				<span className="truncate tr-text-metadata text-text-muted" title={entry.name}>
					{[entry.name, entry.author].filter(Boolean).join(" · ")}
				</span>
				{entry.description ? (
					<span className="tr-text-ui text-text-default break-words">{entry.description}</span>
				) : null}
				<span className="flex flex-wrap gap-4">
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
				</span>
				<div className="mt-auto flex flex-wrap items-center justify-between gap-8 pt-4">
					<span className="flex flex-wrap items-center gap-8">
						<ExternalLink
							href={entry.npm}
							label={t("settings.extensionBrowse.npm")}
							testId="extension-browse-npm"
						/>
						{entry.repository ? (
							<ExternalLink
								href={entry.repository}
								label={t("settings.extensionBrowse.repository")}
								testId="extension-browse-repository"
							/>
						) : null}
					</span>
					{entry.installed ? (
						<span
							data-testid="extension-browse-installed"
							className={cn(SETTINGS_TAG, "text-text-muted")}
						>
							{t("settings.extensionBrowse.installed")}
						</span>
					) : compatible ? (
						<Button
							variant="outline"
							size="s"
							data-testid="extension-browse-install"
							onClick={() => onInstall(entry)}
						>
							{t("settings.extensionBrowse.install")}
						</Button>
					) : (
						<span
							data-testid="extension-browse-incompatible"
							title={t("settings.extensionBrowse.incompatibleHint", { api: entry.api })}
							className={cn(SETTINGS_TAG, "border-feedback-warning text-feedback-warning")}
						>
							{extensionApiFit(entry.api) === "builtForOlderApp"
								? t("settings.installedExtensions.incompatible.older")
								: t("settings.installedExtensions.incompatible.newer")}
						</span>
					)}
				</div>
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
		<section
			data-testid="settings-extension-browse"
			data-status={read.status}
			className="flex flex-col"
		>
			<div className="flex flex-col gap-2 pb-8">
				<h4 className="tr-text-label-pill text-text-subtle">
					{t("settings.extensionBrowse.title")}
				</h4>
				<p data-testid="extension-browse-trust" className="tr-text-metadata text-text-muted">
					{t("settings.extensionBrowse.description")}
				</p>
			</div>
			{read.status === "loading" ? <LoadingRegion rows={2} className="py-8" /> : null}
			{read.status === "failed" ? (
				<SettingsNotice
					variant="error"
					testId="extension-browse-failed"
					action={
						<Button variant="ghost" size="s" data-testid="extension-browse-retry" onClick={onRetry}>
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
			) : null}
			{read.status === "loaded" && entries.length === 0 ? (
				<div
					data-testid="extension-browse-empty"
					className="flex flex-col items-start gap-8 rounded-sm border border-border-default px-12 py-12"
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
				</div>
			) : null}
			{read.status === "loaded" && entries.length > 0 ? (
				<div className="flex flex-col gap-8">
					<label className="relative flex items-center">
						<span className="sr-only">{t("settings.extensionBrowse.searchLabel")}</span>
						<RiSearchLine className="pointer-events-none absolute left-8 size-14 text-text-muted" />
						<input
							data-testid="extension-browse-search"
							type="search"
							className={INPUT_CLASS}
							value={query}
							placeholder={t("settings.extensionBrowse.searchPlaceholder")}
							spellCheck={false}
							autoComplete="off"
							onChange={(event) => onQueryChange(event.currentTarget.value)}
						/>
					</label>
					{shown.length === 0 ? (
						<p data-testid="extension-browse-no-match" className="tr-text-metadata text-text-muted">
							{t("settings.extensionBrowse.noMatch", { query: query.trim() })}
						</p>
					) : (
						<ul className="grid gap-12 sm:grid-cols-2">
							{shown.map((entry) => (
								<ExtensionBrowseCard key={entry.name} entry={entry} onInstall={onInstall} />
							))}
						</ul>
					)}
				</div>
			) : null}
		</section>
	);
}
