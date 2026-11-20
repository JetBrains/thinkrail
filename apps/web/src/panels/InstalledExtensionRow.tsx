import { RiMore2Line as MoreVertical } from "@remixicon/react";
import type { ExtensionCatalogEntry, ExtensionSettingValues } from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { Switch } from "@thinkrail/ui/switch";
import { cn } from "@thinkrail/ui/utils";
import { EXTENSION_API_VERSION, extensionApiFit, type WebExtensionLoadResult } from "@/extensions";
import {
	SETTINGS_LIST_PRIMARY,
	SETTINGS_TAG,
	SettingsNotice,
	useSettingsListRow,
} from "@/settingsKit";
import { CHIP_CLASS, menuControl, type RowMenuControl } from "./PiPackagesSettings";
import { installedExtensionSettingId } from "./settingsSearch";

export type InstalledExtensionAction =
	| { kind: "toggle"; entry: ExtensionCatalogEntry; enabled: boolean }
	| { kind: "setting"; entry: ExtensionCatalogEntry; key: string; value: boolean }
	| { kind: "update"; entry: ExtensionCatalogEntry }
	| { kind: "remove"; entry: ExtensionCatalogEntry };

export type ExtensionSourceKind = "npm" | "git" | "local";

/** A light reading of a declaration for its tag; the host decides what the source really is. */
export function extensionSourceKind(source: string): ExtensionSourceKind {
	if (source.startsWith("npm:")) return "npm";
	if (/^(git:|github:|https?:|ssh:|git@)/.test(source)) return "git";
	return "local";
}

/** The key an installed row's busy and error state hang on. */
export function installedExtensionKey(
	entry: Pick<ExtensionCatalogEntry, "source" | "name">,
): string {
	return `extension\0${entry.source ?? entry.name}`;
}

/** The Installed list's row id of an extension; a pi package row's id starts with its scope instead. */
export function installedExtensionRowId(
	entry: Pick<ExtensionCatalogEntry, "source" | "name">,
): string {
	return `extension:${entry.source ?? entry.name}`;
}

const SOURCE_KIND_LABEL: Record<ExtensionSourceKind, MessageKey> = {
	npm: "settings.packages.kind.npm",
	git: "settings.packages.kind.git",
	local: "settings.packages.kind.local",
};

export interface InstalledExtensionRowProps extends RowMenuControl {
	entry: ExtensionCatalogEntry;
	enabled: boolean;
	settings: ExtensionSettingValues[string] | undefined;
	settingsSupported: boolean;
	webLoad: WebExtensionLoadResult | undefined;
	updateAvailable: boolean;
	busy: boolean;
	error: string | undefined;
	onAction: (action: InstalledExtensionAction) => void;
}

function IncompatibleNotice({ entry }: { entry: ExtensionCatalogEntry }) {
	const t = useT();
	const fit = extensionApiFit(entry.api);
	return (
		<SettingsNotice variant="warning" testId="installed-extension-incompatible" className="mt-4">
			<span className="flex flex-col gap-2 break-words">
				<span className="text-text-default">
					{fit === "builtForOlderApp"
						? t("settings.installedExtensions.incompatible.older")
						: t("settings.installedExtensions.incompatible.newer")}
				</span>
				{entry.error ? <span className="text-text-muted">{entry.error}</span> : null}
				<span className="text-text-muted">
					{fit === "builtForOlderApp"
						? t("settings.installedExtensions.incompatible.olderHint", {
								version: EXTENSION_API_VERSION,
							})
						: t("settings.installedExtensions.incompatible.newerHint")}
				</span>
			</span>
		</SettingsNotice>
	);
}

export function InstalledExtensionRow({
	entry,
	enabled,
	settings,
	settingsSupported,
	webLoad,
	updateAvailable,
	busy,
	error,
	menuOpen,
	onMenuOpenChange,
	onAction,
}: InstalledExtensionRowProps) {
	const t = useT();
	const { rowProps, primaryProps, sideProps } = useSettingsListRow(installedExtensionRowId(entry));
	const state = entry.state ?? "loaded";
	const runs = state === "loaded";
	const off = runs && !enabled;
	const source = entry.source ?? entry.name;
	const sourceKind = extensionSourceKind(source);
	const hasCards = runs && entry.web !== undefined;
	const webFailed = hasCards && webLoad?.status === "failed" ? webLoad : undefined;
	const dim = off || !runs;
	return (
		<li
			{...rowProps}
			data-testid="installed-extension-row"
			data-setting-id={installedExtensionSettingId(entry.name)}
			data-name={entry.name}
			data-state={state}
			data-enabled={enabled ? "true" : "false"}
			className="flex flex-col gap-4 border-border-muted border-b py-6 last:border-b-0"
		>
			<div className="flex flex-wrap items-center gap-8">
				<button
					type="button"
					{...primaryProps}
					aria-haspopup="menu"
					className={cn(SETTINGS_LIST_PRIMARY, "min-w-[12rem]")}
					onClick={() => onMenuOpenChange?.(true)}
				>
					<span className="flex min-w-0 max-w-full flex-wrap items-center gap-x-8 gap-y-4">
						<span
							className={cn(
								"wrap-anywhere tr-title-compact",
								dim ? "text-text-muted" : "text-text-default",
							)}
						>
							{entry.title}
						</span>
						<span
							data-testid="installed-extension-kind"
							className={cn(SETTINGS_TAG, "border-primary-muted text-primary")}
						>
							{t("settings.installedExtensions.kind")}
						</span>
						<span className={cn(SETTINGS_TAG, "text-text-muted")}>
							{t(SOURCE_KIND_LABEL[sourceKind])}
						</span>
						{state === "failed" ? (
							<span
								data-testid="installed-extension-failed-tag"
								className={cn(SETTINGS_TAG, "border-feedback-error text-feedback-error")}
							>
								{t("settings.installedExtensions.failedTag")}
							</span>
						) : null}
						{state === "incompatible" ? (
							<span
								data-testid="installed-extension-incompatible-tag"
								className={cn(SETTINGS_TAG, "border-feedback-warning text-feedback-warning")}
							>
								{t("settings.installedExtensions.incompatibleTag")}
							</span>
						) : null}
						{updateAvailable ? (
							<span
								data-testid="installed-extension-update-available"
								className={cn(SETTINGS_TAG, "border-feedback-warning text-feedback-warning")}
							>
								{t("settings.packages.updateAvailable")}
							</span>
						) : null}
					</span>
					<span
						className={cn(
							"wrap-anywhere tr-text-metadata",
							dim ? "text-text-subtle" : "text-text-muted",
						)}
					>
						{[
							entry.name,
							source === entry.name ? null : source,
							entry.version ? t("settings.packages.installed", { version: entry.version }) : null,
							entry.description ?? null,
						]
							.filter((part): part is string => part !== null)
							.join(" · ")}
					</span>
					{runs && (entry.tools.length > 0 || hasCards) ? (
						<span className="flex flex-wrap gap-4" data-testid="installed-extension-brings">
							{entry.tools.map((tool) => (
								<code
									key={tool}
									data-testid={`installed-extension-tool-${tool}`}
									className={cn("tr-code-text-small", CHIP_CLASS, off && "text-text-subtle")}
								>
									{tool}
								</code>
							))}
							{hasCards ? (
								<span
									data-testid="installed-extension-cards"
									className={cn("tr-text-metadata", CHIP_CLASS, off && "text-text-subtle")}
								>
									{t("settings.installedExtensions.chatCards")}
								</span>
							) : null}
						</span>
					) : null}
				</button>
				<div className="ml-auto flex shrink-0 items-center gap-8">
					{runs ? (
						<Switch
							checked={enabled}
							label={t("settings.extensions.enable", { title: entry.title })}
							testId={`extension-toggle-${entry.name}`}
							{...sideProps}
							onCheckedChange={(next) => onAction({ kind: "toggle", entry, enabled: next })}
						/>
					) : null}
					<DropdownMenu {...menuControl({ menuOpen, onMenuOpenChange })}>
						<DropdownMenuTrigger asChild>
							<IconButton
								icon={MoreVertical}
								label={t("settings.packages.more", { name: entry.title })}
								{...sideProps}
								data-testid="installed-extension-menu"
							/>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem
								data-testid="installed-extension-menu-update"
								disabled={busy}
								onSelect={() => onAction({ kind: "update", entry })}
							>
								{t("settings.packages.update")}
							</DropdownMenuItem>
							<DropdownMenuItem
								data-testid="installed-extension-menu-remove"
								disabled={busy}
								onSelect={() => onAction({ kind: "remove", entry })}
							>
								{t("settings.packages.remove")}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>
			{state === "failed" ? (
				<SettingsNotice variant="error" testId="installed-extension-error" className="mt-4">
					<span className="flex flex-col gap-2 break-words">
						<span>{entry.error}</span>
						<span className="text-text-muted">{t("settings.installedExtensions.failedHint")}</span>
					</span>
				</SettingsNotice>
			) : null}
			{state === "incompatible" ? <IncompatibleNotice entry={entry} /> : null}
			{webFailed ? (
				<SettingsNotice variant="warning" testId="installed-extension-web-failed" className="mt-4">
					<span className="break-words">
						{t("settings.installedExtensions.webFailed", { error: webFailed.message })}
					</span>
				</SettingsNotice>
			) : null}
			{runs && settingsSupported
				? (entry.settings ?? []).map((setting) => {
						const title = setting.title ?? setting.key;
						return (
							<div
								key={setting.key}
								data-testid={`extension-setting-${entry.name}-${setting.key}`}
								data-setting-id={installedExtensionSettingId(entry.name, setting.key)}
								className="ml-24 flex items-center justify-between gap-12 border-border-default border-l-2 py-2 pl-12"
							>
								<span className="flex min-w-0 flex-col gap-2">
									<span
										className={cn(
											"wrap-anywhere tr-text-ui",
											enabled ? "text-text-default" : "text-text-disabled",
										)}
									>
										{title}
									</span>
									{setting.description ? (
										<span className="wrap-anywhere text-text-muted tr-text-metadata">
											{setting.description}
										</span>
									) : null}
								</span>
								<Switch
									checked={settings?.[setting.key] ?? setting.default}
									disabled={!enabled}
									label={title}
									testId={`extension-setting-toggle-${entry.name}-${setting.key}`}
									{...sideProps}
									onCheckedChange={(value) =>
										onAction({ kind: "setting", entry, key: setting.key, value })
									}
								/>
							</div>
						);
					})
				: null}
			{error ? (
				<SettingsNotice variant="error" testId="installed-extension-action-error" className="mt-4">
					<span className="break-words">{error}</span>
				</SettingsNotice>
			) : null}
		</li>
	);
}
