import {
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
	RiMore2Line as MoreVertical,
} from "@remixicon/react";
import type {
	PiBuiltinExtension,
	PiLooseExtension,
	PiPackageResource,
	PiPackageResourceType,
	PiPackageScope,
	PiPackageSummary,
	PiPackagesCatalog,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { type Translator, useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { Switch } from "@thinkrail/ui/switch";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useState } from "react";
import {
	SETTINGS_LIST_PRIMARY,
	SETTINGS_TAG,
	SettingsGroup,
	SettingsList,
	SettingsNotice,
	SettingsRow,
	useSettingsListRow,
} from "@/settingsKit";
import { SETTING } from "./settingsCatalog";

/** `rowKey` is the row the action came from — what the page marks busy or shows an error on. */
export type PiPackageAction =
	| { kind: "togglePackage"; rowKey: string; target: PiPackageSummary; enabled: boolean }
	| {
			kind: "toggleResource";
			rowKey: string;
			path: string;
			type: PiPackageResourceType;
			scope: PiPackageScope;
			enabled: boolean;
	  }
	| { kind: "update"; rowKey: string; target: PiPackageSummary }
	| { kind: "reveal"; rowKey: string; path: string }
	| { kind: "remove"; rowKey: string; target: PiPackageSummary };

/** The key a row's transient state (busy, error, expanded) hangs on. */
export function piPackageKey(target: { scope: PiPackageScope; source: string }): string {
	return `${target.scope}\0${target.source}`;
}

export const CHIP_CLASS = "rounded-full bg-control-bg-selected px-8 text-text-muted";

const KIND_LABEL: Record<PiPackageSummary["kind"], MessageKey> = {
	npm: "settings.packages.kind.npm",
	git: "settings.packages.kind.git",
	local: "settings.packages.kind.local",
};
const SCOPE_LABEL: Record<PiPackageScope, MessageKey> = {
	user: "settings.packages.scope.user",
	project: "settings.packages.scope.project",
};
const RESOURCE_LABEL: Record<PiPackageResourceType, MessageKey> = {
	extensions: "settings.packages.resources.extensions",
	skills: "settings.packages.resources.skills",
	prompts: "settings.packages.resources.prompts",
};
const BUILTIN_COPY: Record<string, { title: MessageKey; description: MessageKey }> = {
	mcp: {
		title: "settings.packages.builtin.mcp.title",
		description: "settings.packages.builtin.mcp.description",
	},
	"tool-search": {
		title: "settings.packages.builtin.tool-search.title",
		description: "settings.packages.builtin.tool-search.description",
	},
};

/** The tool and `/command` names one loaded extension registered. */
export function resourceChips(resource: { tools?: string[]; commands?: string[] }): string[] {
	return [...(resource.tools ?? []), ...(resource.commands ?? []).map((command) => `/${command}`)];
}

export function packageChips(resources: readonly PiPackageResource[]): string[] {
	return resources
		.filter((resource) => resource.type === "extensions" && resource.enabled)
		.flatMap(resourceChips);
}

function firstLoadError(
	resources: readonly { enabled: boolean; error?: string }[],
): string | undefined {
	return resources.find((resource) => resource.enabled && resource.error)?.error;
}

function Chips({ chips, dim }: { chips: readonly string[]; dim: boolean }) {
	if (chips.length === 0) return null;
	return (
		<span className="flex flex-wrap gap-4">
			{chips.map((chip) => (
				<code
					key={chip}
					data-testid={`package-chip-${chip}`}
					className={cn("tr-code-text-small", CHIP_CLASS, dim && "text-text-subtle")}
				>
					{chip}
				</code>
			))}
		</span>
	);
}

type SideProps = ReturnType<typeof useSettingsListRow>["sideProps"];

function LoadError({
	error,
	sideProps,
	onReveal,
}: {
	error: string;
	sideProps: SideProps;
	onReveal: () => void;
}) {
	const t = useT();
	return (
		<SettingsNotice
			variant="error"
			testId="package-load-error"
			className="mt-4"
			action={
				<Button
					variant="ghost"
					size="s"
					{...sideProps}
					data-testid="package-load-error-reveal"
					onClick={onReveal}
				>
					{t("settings.packages.openFolder")}
				</Button>
			}
		>
			<span className="break-words">{t("settings.packages.failedToLoad", { error })}</span>
		</SettingsNotice>
	);
}

function ResourceList({
	summary,
	installedPath,
	busy,
	sideProps,
	onAction,
}: {
	summary: PiPackageSummary;
	installedPath: string;
	busy: boolean;
	sideProps: SideProps;
	onAction: (action: PiPackageAction) => void;
}) {
	const t = useT();
	const groups = (["extensions", "skills", "prompts"] as const)
		.map((type) => ({ type, items: summary.resources.filter((r) => r.type === type) }))
		.filter((group) => group.items.length > 0);
	return (
		<div
			data-testid="package-resources"
			className="ml-24 flex flex-col gap-8 rounded-sm bg-control-bg px-12 py-8"
		>
			{groups.map((group) => (
				<div key={group.type} className="flex flex-col gap-2">
					<span className="tr-text-label-pill text-text-subtle">
						{t(RESOURCE_LABEL[group.type])}
					</span>
					{group.items.map((resource) => (
						<div
							key={resource.path}
							data-testid={`package-resource-${resource.displayName}`}
							className="flex items-center justify-between gap-12 py-2"
						>
							<span className="flex min-w-0 flex-col">
								<span className="wrap-anywhere tr-code-text-small text-text-default">
									{resource.displayName}
								</span>
								<span className="wrap-anywhere tr-code-text-small text-text-subtle">
									{resource.path}
								</span>
								{resource.type === "extensions" && resource.enabled ? (
									<span className="wrap-anywhere tr-text-metadata text-text-muted">
										{resourceChips(resource).join(" · ")}
									</span>
								) : null}
							</span>
							{resource.enabled ? null : (
								<span className="shrink-0 tr-text-metadata text-text-muted">
									{t("settings.packages.resourceOff")}
								</span>
							)}
						</div>
					))}
				</div>
			))}
			<div className="flex flex-wrap gap-8 pt-4">
				<Button
					variant="outline"
					size="s"
					{...sideProps}
					data-testid="package-reveal"
					disabled={busy}
					onClick={() =>
						onAction({ kind: "reveal", rowKey: piPackageKey(summary), path: installedPath })
					}
				>
					{t("settings.packages.openFolder")}
				</Button>
				<Button
					variant="outline"
					size="s"
					tone="danger"
					{...sideProps}
					data-testid="package-remove"
					disabled={busy}
					onClick={() =>
						onAction({ kind: "remove", rowKey: piPackageKey(summary), target: summary })
					}
				>
					{t("settings.packages.remove")}
				</Button>
			</div>
		</div>
	);
}

/** The list row id of a package: its scope and source, which pi keys a declaration by. */
export function packageRowId(target: { scope: PiPackageScope; source: string }): string {
	return `${target.scope}:${target.source}`;
}

export function looseRowId(entry: { path: string }): string {
	return `file:${entry.path}`;
}

interface RowMenuControl {
	menuOpen?: boolean | undefined;
	onMenuOpenChange?: ((open: boolean) => void) | undefined;
}

function menuControl({ menuOpen = false, onMenuOpenChange }: RowMenuControl) {
	return onMenuOpenChange ? { open: menuOpen, onOpenChange: onMenuOpenChange } : {};
}

export function PackageRow({
	summary,
	updateAvailable,
	expanded,
	busy,
	error,
	menuOpen,
	onMenuOpenChange,
	onToggleExpanded,
	onAction,
}: {
	summary: PiPackageSummary;
	updateAvailable: boolean;
	expanded: boolean;
	busy: boolean;
	error: string | undefined;
	onToggleExpanded: () => void;
	onAction: (action: PiPackageAction) => void;
} & RowMenuControl) {
	const t = useT();
	const { rowProps, primaryProps, sideProps } = useSettingsListRow(packageRowId(summary));
	const rowKey = piPackageKey(summary);
	const installedPath = summary.installedPath;
	const off = !summary.enabled;
	const loadError = off ? undefined : firstLoadError(summary.resources);
	const Caret = expanded ? ChevronDown : ChevronRight;
	return (
		<li
			{...rowProps}
			data-testid="package-row"
			data-enabled={off ? "false" : "true"}
			data-identity={summary.identity}
			data-scope={summary.scope}
			data-installed={installedPath === undefined ? "false" : "true"}
			className="flex flex-col gap-4 border-border-muted border-b py-6 last:border-b-0"
		>
			<div className="flex flex-wrap items-center gap-8">
				<button
					type="button"
					{...primaryProps}
					{...(installedPath === undefined
						? { "aria-haspopup": "menu" as const, onClick: () => onMenuOpenChange?.(true) }
						: {
								"data-testid": "package-expand",
								"aria-expanded": expanded,
								"aria-label": t(
									expanded ? "settings.packages.collapse" : "settings.packages.expand",
									{ name: summary.name },
								),
								onClick: onToggleExpanded,
							})}
					className={cn(SETTINGS_LIST_PRIMARY, "min-w-[12rem]")}
				>
					<span className="flex min-w-0 max-w-full flex-wrap items-center gap-x-8 gap-y-4">
						{installedPath === undefined ? null : (
							<Caret aria-hidden className="size-14 shrink-0 text-text-muted" />
						)}
						<span
							className={cn(
								"wrap-anywhere tr-title-compact",
								off ? "text-text-muted" : "text-text-default",
							)}
						>
							{summary.name}
						</span>
						<span data-testid="package-kind" className={cn(SETTINGS_TAG, "text-text-muted")}>
							{t(KIND_LABEL[summary.kind])}
						</span>
						<span data-testid="package-scope" className={cn(SETTINGS_TAG, "text-text-muted")}>
							{t(SCOPE_LABEL[summary.scope])}
						</span>
						{updateAvailable ? (
							<span
								data-testid="package-update-available"
								className={cn(SETTINGS_TAG, "border-feedback-warning text-feedback-warning")}
							>
								{t("settings.packages.updateAvailable")}
							</span>
						) : null}
						{installedPath === undefined ? (
							<span
								data-testid="package-not-installed"
								className={cn(SETTINGS_TAG, "border-feedback-warning text-feedback-warning")}
							>
								{t("settings.packages.notInstalled")}
							</span>
						) : null}
					</span>
					<span
						className={cn(
							"wrap-anywhere tr-text-metadata",
							off ? "text-text-subtle" : "text-text-muted",
						)}
					>
						{[
							summary.source,
							installedPath === undefined ? t("settings.packages.notInstalledHint") : null,
							summary.version
								? t("settings.packages.installed", { version: summary.version })
								: null,
							summary.description ?? null,
						]
							.filter((part): part is string => part !== null)
							.join(" · ")}
					</span>
					<Chips chips={packageChips(summary.resources)} dim={off} />
				</button>
				<div className="ml-auto flex shrink-0 items-center gap-8">
					{installedPath === undefined ? null : (
						<Switch
							checked={summary.enabled}
							label={t("settings.packages.enable", { name: summary.name })}
							testId="package-toggle"
							{...sideProps}
							disabled={busy}
							onCheckedChange={(enabled) =>
								onAction({ kind: "togglePackage", rowKey, target: summary, enabled })
							}
						/>
					)}
					<DropdownMenu {...menuControl({ menuOpen, onMenuOpenChange })}>
						<DropdownMenuTrigger asChild>
							<IconButton
								icon={MoreVertical}
								label={t("settings.packages.more", { name: summary.name })}
								{...sideProps}
								data-testid="package-menu"
							/>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							{updateAvailable ? (
								<DropdownMenuItem
									data-testid="package-menu-update"
									disabled={busy}
									onSelect={() => onAction({ kind: "update", rowKey, target: summary })}
								>
									{t("settings.packages.update")}
								</DropdownMenuItem>
							) : null}
							{installedPath === undefined ? null : (
								<DropdownMenuItem
									data-testid="package-menu-reveal"
									disabled={busy}
									onSelect={() => onAction({ kind: "reveal", rowKey, path: installedPath })}
								>
									{t("settings.packages.openFolder")}
								</DropdownMenuItem>
							)}
							<DropdownMenuItem
								data-testid="package-menu-remove"
								disabled={busy}
								onSelect={() => onAction({ kind: "remove", rowKey, target: summary })}
							>
								{t("settings.packages.remove")}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>
			{summary.shadowed ? (
				<span data-testid="package-shadowed" className="px-4 tr-text-metadata text-text-subtle">
					{t("settings.packages.shadowed")}
				</span>
			) : null}
			{loadError && installedPath !== undefined ? (
				<LoadError
					error={loadError}
					sideProps={sideProps}
					onReveal={() => onAction({ kind: "reveal", rowKey, path: installedPath })}
				/>
			) : null}
			{error ? (
				<SettingsNotice variant="error" testId="package-action-error" className="mt-4">
					{error}
				</SettingsNotice>
			) : null}
			{expanded && installedPath !== undefined ? (
				<ResourceList
					summary={summary}
					installedPath={installedPath}
					busy={busy}
					sideProps={sideProps}
					onAction={onAction}
				/>
			) : null}
		</li>
	);
}

export function LooseRow({
	entry,
	busy,
	error,
	menuOpen,
	onMenuOpenChange,
	onAction,
}: {
	entry: PiLooseExtension;
	busy: boolean;
	error: string | undefined;
	onAction: (action: PiPackageAction) => void;
} & RowMenuControl) {
	const t = useT();
	const { rowProps, primaryProps, sideProps } = useSettingsListRow(looseRowId(entry));
	const off = !entry.enabled;
	return (
		<li
			{...rowProps}
			data-testid="loose-extension-row"
			data-enabled={off ? "false" : "true"}
			data-path={entry.path}
			data-scope={entry.scope}
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
								"wrap-anywhere tr-code-text",
								off ? "text-text-muted" : "text-text-default",
							)}
						>
							{entry.displayName}
						</span>
						<span className={cn(SETTINGS_TAG, "text-text-muted")}>
							{t("settings.packages.kind.file")}
						</span>
						<span className={cn(SETTINGS_TAG, "text-text-muted")}>
							{t(SCOPE_LABEL[entry.scope])}
						</span>
					</span>
					<span
						className={cn(
							"wrap-anywhere tr-text-metadata",
							off ? "text-text-subtle" : "text-text-muted",
						)}
					>
						<span className="tr-code-text-small">{entry.path}</span>
						{` · ${t("settings.packages.looseHint")}`}
					</span>
					<Chips chips={resourceChips(entry)} dim={off} />
				</button>
				<div className="ml-auto flex shrink-0 items-center gap-8">
					<Switch
						checked={entry.enabled}
						label={t("settings.packages.enableResource", { name: entry.displayName })}
						testId="loose-extension-toggle"
						{...sideProps}
						disabled={busy}
						onCheckedChange={(enabled) =>
							onAction({
								kind: "toggleResource",
								rowKey: entry.path,
								path: entry.path,
								type: "extensions",
								scope: entry.scope,
								enabled,
							})
						}
					/>
					<DropdownMenu {...menuControl({ menuOpen, onMenuOpenChange })}>
						<DropdownMenuTrigger asChild>
							<IconButton
								icon={MoreVertical}
								label={t("settings.packages.more", { name: entry.displayName })}
								{...sideProps}
								data-testid="loose-extension-menu"
							/>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem
								disabled={busy}
								onSelect={() => onAction({ kind: "reveal", rowKey: entry.path, path: entry.path })}
							>
								{t("settings.packages.openFolder")}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>
			{!off && entry.error ? (
				<LoadError
					error={entry.error}
					sideProps={sideProps}
					onReveal={() => onAction({ kind: "reveal", rowKey: entry.path, path: entry.path })}
				/>
			) : null}
			{error ? (
				<SettingsNotice variant="error" testId="package-action-error" className="mt-4">
					{error}
				</SettingsNotice>
			) : null}
		</li>
	);
}

export interface PiPackagesGroupProps {
	catalog: PiPackagesCatalog | "loading" | "failed";
	/** `scope\0source` keys the last update check flagged. */
	updates: ReadonlySet<string>;
	checkingUpdates: boolean;
	/** The last manual or on-mount update check's failure, shown under the group header. */
	checkError?: string | undefined;
	busy: ReadonlySet<string>;
	errors: ReadonlyMap<string, string>;
	expanded: ReadonlySet<string>;
	onToggleExpanded: (key: string) => void;
	onAction: (action: PiPackageAction) => void;
	onUpdateAll: () => void;
	onCheckUpdates: () => void;
	onRetry?: (() => void) | undefined;
}

export function PiPackagesGroup({
	catalog,
	updates,
	checkingUpdates,
	checkError,
	busy,
	errors,
	expanded,
	onToggleExpanded,
	onAction,
	onUpdateAll,
	onCheckUpdates,
	onRetry,
}: PiPackagesGroupProps) {
	const t = useT();
	const [menuFor, setMenuFor] = useState<string | null>(null);
	const group = (children: ReactNode) => (
		<SettingsGroup
			testId="settings-packages"
			title={t("settings.catalog.installedPackages.label")}
			description={t("settings.extensions.group.installedDescription")}
		>
			{children}
		</SettingsGroup>
	);
	if (catalog === "loading") return group(<LoadingRegion rows={2} className="py-8" />);
	if (catalog === "failed") {
		return group(
			<SettingsNotice
				variant="error"
				testId="packages-failed"
				action={
					onRetry ? (
						<Button
							variant="outline"
							size="s"
							tabIndex={0}
							data-testid="packages-retry"
							onClick={onRetry}
						>
							{t("common.retry")}
						</Button>
					) : undefined
				}
			>
				{t("settings.packages.loadFailed")}
			</SettingsNotice>,
		);
	}
	const ordered = [...catalog.packages].sort((a, b) =>
		a.scope === b.scope ? a.name.localeCompare(b.name) : a.scope === "user" ? -1 : 1,
	);
	const menuProps = (id: string) => ({
		menuOpen: menuFor === id,
		onMenuOpenChange: (open: boolean) => setMenuFor(open ? id : null),
	});
	const removable = (id: string) => ordered.find((summary) => packageRowId(summary) === id);
	return group(
		<>
			{catalog.projectSettingsPath && !catalog.projectTrusted ? (
				<SettingsNotice variant="info" testId="packages-project-untrusted" className="mb-8">
					{t("settings.packages.projectUntrusted")}
				</SettingsNotice>
			) : null}
			<SettingsRow
				rowId="packages-updates"
				label={t("settings.packages.updatesLabel")}
				description={
					checkError ? (
						<span data-testid="packages-check-error" className="text-feedback-error">
							{checkError}
						</span>
					) : updates.size > 0 ? (
						t("settings.packages.updatesAvailable", { count: updates.size })
					) : undefined
				}
				control={
					<Button
						variant="outline"
						size="m"
						tabIndex={0}
						data-testid="packages-check-updates"
						disabled={checkingUpdates}
						onClick={onCheckUpdates}
					>
						{t(
							checkingUpdates
								? "settings.packages.checkingUpdates"
								: "settings.packages.checkUpdates",
						)}
					</Button>
				}
				sides={
					updates.size > 0 ? (
						<Button
							variant="primary"
							size="m"
							tabIndex={0}
							data-setting-side=""
							data-testid="packages-update-all"
							onClick={onUpdateAll}
						>
							{t("settings.packages.updateAll")}
						</Button>
					) : null
				}
			/>
			{ordered.length === 0 && catalog.loose.length === 0 ? (
				<div
					data-testid="packages-empty"
					data-setting-id={SETTING.installedPackages.id}
					className="flex flex-col gap-2 py-8"
				>
					<span className="tr-text-ui text-text-default">{t("settings.packages.empty")}</span>
					<span className="tr-text-metadata text-text-muted">
						{t("settings.packages.emptyHint")}
					</span>
				</div>
			) : (
				<SettingsList
					focusList="packages"
					label={t("settings.catalog.installedPackages.label")}
					rowIds={[...ordered.map(packageRowId), ...catalog.loose.map(looseRowId)]}
					settingId={SETTING.installedPackages.id}
					testId="packages-list"
					onRemove={(id) => {
						const target = removable(id);
						if (target && !busy.has(piPackageKey(target))) {
							onAction({ kind: "remove", rowKey: piPackageKey(target), target });
						}
					}}
					onMenu={setMenuFor}
				>
					{ordered.map((summary) => {
						const key = piPackageKey(summary);
						return (
							<PackageRow
								key={key}
								summary={summary}
								updateAvailable={updates.has(key)}
								expanded={expanded.has(key)}
								busy={busy.has(key)}
								error={errors.get(key)}
								{...menuProps(packageRowId(summary))}
								onToggleExpanded={() => onToggleExpanded(key)}
								onAction={onAction}
							/>
						);
					})}
					{catalog.loose.map((entry) => (
						<LooseRow
							key={entry.path}
							entry={entry}
							busy={busy.has(entry.path)}
							error={errors.get(entry.path)}
							{...menuProps(looseRowId(entry))}
							onAction={onAction}
						/>
					))}
				</SettingsList>
			)}
		</>,
	);
}

export function GalleryLink({ side = false }: { side?: boolean }) {
	const t = useT();
	return (
		<a
			data-testid="packages-gallery-link"
			href="https://pi.dev/packages"
			target="_blank"
			rel="noopener noreferrer"
			tabIndex={0}
			data-setting-side={side ? "" : undefined}
			className="tr-text-metadata text-primary underline underline-offset-2 focus-visible:focus-ring"
		>
			{t("settings.packages.gallery")} ↗
		</a>
	);
}

function builtinTitle(t: Translator, name: string): string {
	const copy = BUILTIN_COPY[name];
	return copy ? t(copy.title) : name;
}

export function PiBuiltinsGroup({
	builtins,
	settingsPath,
	projectSettingsPath,
	busy,
	errors,
	onToggle,
}: {
	builtins: readonly PiBuiltinExtension[];
	settingsPath: string;
	/** Named instead of `settingsPath` when a repository entry decides a built-in. */
	projectSettingsPath?: string | undefined;
	busy: ReadonlySet<string>;
	errors: ReadonlyMap<string, string>;
	onToggle: (builtin: PiBuiltinExtension, enabled: boolean) => void;
}) {
	const t = useT();
	if (builtins.length === 0) return null;
	return (
		<SettingsGroup
			testId="settings-builtins"
			title={t("settings.extensions.group.builtin")}
			description={
				<span className="wrap-anywhere">
					{t("settings.extensions.group.builtinDescription", {
						path: builtins.some((b) => b.scope === "project")
							? (projectSettingsPath ?? settingsPath)
							: settingsPath,
					})}
				</span>
			}
		>
			<div data-setting-id={SETTING.piBuiltins.id} className="flex flex-col">
				{builtins.map((builtin) => {
					const copy = BUILTIN_COPY[builtin.name];
					const key = `builtin:${builtin.name}`;
					const error = errors.get(key);
					return (
						<SettingsRow
							key={builtin.name}
							rowId={key}
							testId={`builtin-row-${builtin.name}`}
							label={builtinTitle(t, builtin.name)}
							description={
								<span className="flex flex-col gap-2">
									{copy ? <span>{t(copy.description)}</span> : null}
									<code className="tr-code-text-small text-text-subtle">{key}</code>
									{error ? (
										<SettingsNotice variant="error" testId="package-action-error" className="mt-4">
											{error}
										</SettingsNotice>
									) : null}
								</span>
							}
							control={
								<Switch
									checked={builtin.enabled}
									label={t("settings.packages.enable", { name: builtinTitle(t, builtin.name) })}
									testId={`builtin-toggle-${builtin.name}`}
									tabIndex={0}
									disabled={busy.has(key)}
									onCheckedChange={(enabled) => onToggle(builtin, enabled)}
								/>
							}
						/>
					);
				})}
			</div>
		</SettingsGroup>
	);
}
