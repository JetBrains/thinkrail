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
import type { ReactNode } from "react";
import { SettingsNotice } from "./SettingsNotice";

/** `rowKey` is the row the action came from — what the page marks busy or shows an error on. */
export type PiPackageAction =
	| { kind: "togglePackage"; rowKey: string; identity: string; enabled: boolean }
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
const TAG_CLASS = "shrink-0 rounded-xs border border-border-default px-4 tr-text-label-pill";

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

function LoadError({
	error,
	path,
	onReveal,
}: {
	error: string;
	path: string;
	onReveal: () => void;
}) {
	const t = useT();
	return (
		<SettingsNotice
			variant="error"
			testId="package-load-error"
			className="mt-8"
			action={
				<Button variant="ghost" size="s" data-testid="package-load-error-reveal" onClick={onReveal}>
					{t("settings.packages.openFolder")}
				</Button>
			}
		>
			<span className="break-words" title={path}>
				{t("settings.packages.failedToLoad", { error })}
			</span>
		</SettingsNotice>
	);
}

function ResourceList({
	summary,
	installedPath,
	busy,
	onAction,
}: {
	summary: PiPackageSummary;
	installedPath: string;
	busy: boolean;
	onAction: (action: PiPackageAction) => void;
}) {
	const t = useT();
	const groups = (["extensions", "skills", "prompts"] as const)
		.map((type) => ({ type, items: summary.resources.filter((r) => r.type === type) }))
		.filter((group) => group.items.length > 0);
	return (
		<div
			data-testid="package-resources"
			className="mt-8 flex flex-col gap-8 rounded-sm border border-border-default bg-container-elevated-bg px-12 py-8"
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
								<span
									className="truncate tr-code-text-small text-text-default"
									title={resource.path}
								>
									{resource.displayName}
								</span>
								{resource.type === "extensions" && resource.enabled ? (
									<span className="truncate tr-text-metadata text-text-muted">
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

function RowShell({
	testId,
	dataAttributes,
	off,
	caret,
	children,
	actions,
}: {
	testId: string;
	dataAttributes?: Record<string, string | undefined>;
	off: boolean;
	caret?: ReactNode;
	children: ReactNode;
	actions: ReactNode;
}) {
	return (
		<li
			data-testid={testId}
			data-enabled={off ? "false" : "true"}
			{...dataAttributes}
			className="flex items-start gap-8 px-12 py-8"
		>
			<span className="flex w-16 shrink-0 justify-center pt-2">{caret}</span>
			<div className="flex min-w-0 flex-1 flex-col gap-4">{children}</div>
			<div className="flex shrink-0 items-center gap-8 pt-2">{actions}</div>
		</li>
	);
}

export function PackageRow({
	summary,
	updateAvailable,
	expanded,
	busy,
	error,
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
}) {
	const t = useT();
	const rowKey = piPackageKey(summary);
	const installedPath = summary.installedPath;
	const off = !summary.enabled;
	const loadError = off ? undefined : firstLoadError(summary.resources);
	const titleClass = off ? "text-text-muted" : "text-text-default";
	return (
		<RowShell
			testId="package-row"
			dataAttributes={{
				"data-identity": summary.identity,
				"data-scope": summary.scope,
				"data-installed": installedPath === undefined ? "false" : "true",
			}}
			off={off}
			caret={
				installedPath === undefined ? undefined : (
					<IconButton
						icon={expanded ? ChevronDown : ChevronRight}
						size="s"
						label={t(expanded ? "settings.packages.collapse" : "settings.packages.expand", {
							name: summary.name,
						})}
						data-testid="package-expand"
						aria-expanded={expanded}
						onClick={onToggleExpanded}
					/>
				)
			}
			actions={
				<>
					{installedPath === undefined ? null : (
						<Switch
							checked={summary.enabled}
							label={t("settings.packages.enable", { name: summary.name })}
							testId="package-toggle"
							disabled={busy}
							onCheckedChange={(enabled) =>
								onAction({ kind: "togglePackage", rowKey, identity: summary.identity, enabled })
							}
						/>
					)}
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<IconButton
								icon={MoreVertical}
								label={t("settings.packages.more", { name: summary.name })}
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
				</>
			}
		>
			<div className="flex min-w-0 flex-wrap items-center gap-x-8 gap-y-4">
				<span className={cn("min-w-0 truncate tr-title-compact", titleClass)} title={summary.name}>
					{summary.name}
				</span>
				<span data-testid="package-kind" className={cn(TAG_CLASS, "text-text-muted")}>
					{t(KIND_LABEL[summary.kind])}
				</span>
				<span data-testid="package-scope" className={cn(TAG_CLASS, "text-text-muted")}>
					{t(SCOPE_LABEL[summary.scope])}
				</span>
				{updateAvailable ? (
					<span
						data-testid="package-update-available"
						className={cn(TAG_CLASS, "border-feedback-warning text-feedback-warning")}
					>
						{t("settings.packages.updateAvailable")}
					</span>
				) : null}
				{installedPath === undefined ? (
					<span
						data-testid="package-not-installed"
						className={cn(TAG_CLASS, "border-feedback-warning text-feedback-warning")}
					>
						{t("settings.packages.notInstalled")}
					</span>
				) : null}
			</div>
			<span
				className={cn("truncate tr-text-metadata", off ? "text-text-subtle" : "text-text-muted")}
			>
				{[
					summary.source,
					installedPath === undefined ? t("settings.packages.notInstalledHint") : null,
					summary.version ? t("settings.packages.installed", { version: summary.version }) : null,
					summary.description ?? null,
				]
					.filter((part): part is string => part !== null)
					.join(" · ")}
			</span>
			{summary.shadowed ? (
				<span data-testid="package-shadowed" className="tr-text-metadata text-text-subtle">
					{t("settings.packages.shadowed")}
				</span>
			) : null}
			<Chips chips={packageChips(summary.resources)} dim={off} />
			{loadError && installedPath !== undefined ? (
				<LoadError
					error={loadError}
					path={installedPath}
					onReveal={() => onAction({ kind: "reveal", rowKey, path: installedPath })}
				/>
			) : null}
			{error ? (
				<SettingsNotice variant="error" testId="package-action-error" className="mt-8">
					{error}
				</SettingsNotice>
			) : null}
			{expanded && installedPath !== undefined ? (
				<ResourceList
					summary={summary}
					installedPath={installedPath}
					busy={busy}
					onAction={onAction}
				/>
			) : null}
		</RowShell>
	);
}

export function LooseRow({
	entry,
	busy,
	error,
	onAction,
}: {
	entry: PiLooseExtension;
	busy: boolean;
	error: string | undefined;
	onAction: (action: PiPackageAction) => void;
}) {
	const t = useT();
	const off = !entry.enabled;
	return (
		<RowShell
			testId="loose-extension-row"
			dataAttributes={{ "data-path": entry.path, "data-scope": entry.scope }}
			off={off}
			actions={
				<>
					<Switch
						checked={entry.enabled}
						label={t("settings.packages.enableResource", { name: entry.displayName })}
						testId="loose-extension-toggle"
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
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<IconButton
								icon={MoreVertical}
								label={t("settings.packages.more", { name: entry.displayName })}
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
				</>
			}
		>
			<div className="flex min-w-0 flex-wrap items-center gap-x-8 gap-y-4">
				<span
					className={cn(
						"min-w-0 truncate tr-code-text",
						off ? "text-text-muted" : "text-text-default",
					)}
					title={entry.path}
				>
					{entry.displayName}
				</span>
				<span className={cn(TAG_CLASS, "text-text-muted")}>{t("settings.packages.kind.file")}</span>
				<span className={cn(TAG_CLASS, "text-text-muted")}>{t(SCOPE_LABEL[entry.scope])}</span>
			</div>
			<span
				className={cn("truncate tr-text-metadata", off ? "text-text-subtle" : "text-text-muted")}
			>
				<span className="tr-code-text-small">{entry.path}</span> ·{" "}
				{t("settings.packages.looseHint")}
			</span>
			<Chips chips={resourceChips(entry)} dim={off} />
			{!off && entry.error ? (
				<LoadError
					error={entry.error}
					path={entry.path}
					onReveal={() => onAction({ kind: "reveal", rowKey: entry.path, path: entry.path })}
				/>
			) : null}
			{error ? (
				<SettingsNotice variant="error" testId="package-action-error" className="mt-8">
					{error}
				</SettingsNotice>
			) : null}
		</RowShell>
	);
}

export interface PiPackagesGroupProps {
	catalog: PiPackagesCatalog | "loading" | "failed";
	disabledPackages: readonly string[];
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
	onInstall?: () => void;
}

export function PiPackagesGroup({
	catalog,
	disabledPackages,
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
	onInstall,
}: PiPackagesGroupProps) {
	const t = useT();
	const header = (
		<div className="flex flex-wrap items-baseline justify-between gap-8 pb-8">
			<span className="flex flex-col gap-2">
				<h4 className="tr-text-label-pill text-text-subtle">
					{t("settings.extensions.group.installed")}
				</h4>
				<p className="tr-text-metadata text-text-muted">
					{t("settings.extensions.group.installedDescription")}
				</p>
			</span>
			{catalog !== "loading" && catalog !== "failed" ? (
				<span className="flex flex-wrap items-center gap-8 tr-text-metadata text-text-muted">
					{updates.size > 0 ? (
						<Button
							variant="ghost"
							size="s"
							data-testid="packages-update-all"
							onClick={onUpdateAll}
						>
							{t("settings.packages.updateAll")}
						</Button>
					) : null}
					<Button
						variant="ghost"
						size="s"
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
				</span>
			) : null}
		</div>
	);
	if (catalog === "loading") {
		return (
			<section data-testid="settings-packages">
				{header}
				<LoadingRegion rows={2} className="py-8" />
			</section>
		);
	}
	if (catalog === "failed") {
		return (
			<section data-testid="settings-packages">
				{header}
				<p
					data-testid="packages-failed"
					className="rounded-sm border border-border-default bg-container-elevated-bg px-12 py-8 text-text-muted tr-text-metadata"
				>
					{t("settings.packages.loadFailed")}
				</p>
			</section>
		);
	}
	const ordered = [...catalog.packages].sort((a, b) =>
		a.scope === b.scope ? a.name.localeCompare(b.name) : a.scope === "user" ? -1 : 1,
	);
	return (
		<section data-testid="settings-packages" className="flex flex-col">
			{header}
			{catalog.projectSettingsPath && !catalog.projectTrusted ? (
				<SettingsNotice variant="info" testId="packages-project-untrusted" className="mb-8">
					{t("settings.packages.projectUntrusted")}
				</SettingsNotice>
			) : null}
			{checkError ? (
				<SettingsNotice variant="error" testId="packages-check-error" className="mb-8">
					{checkError}
				</SettingsNotice>
			) : null}
			{ordered.length === 0 && catalog.loose.length === 0 ? (
				<div
					data-testid="packages-empty"
					className="flex flex-col items-start gap-8 rounded-sm border border-border-default px-12 py-12"
				>
					<span className="tr-text-ui text-text-default">{t("settings.packages.empty")}</span>
					<span className="tr-text-metadata text-text-muted">
						{t("settings.packages.emptyHint")}
					</span>
					<span className="flex flex-wrap items-center gap-8">
						{onInstall ? (
							<Button
								variant="outline"
								size="s"
								data-testid="packages-empty-install"
								onClick={onInstall}
							>
								{t("settings.extensions.install")}
							</Button>
						) : null}
						<GalleryLink />
					</span>
				</div>
			) : (
				<ul className="flex flex-col divide-y divide-border-default rounded-sm border border-border-default bg-control-bg">
					{ordered.map((summary) => {
						const key = piPackageKey(summary);
						return (
							<PackageRow
								key={key}
								summary={{ ...summary, enabled: !disabledPackages.includes(summary.identity) }}
								updateAvailable={updates.has(key)}
								expanded={expanded.has(key)}
								busy={busy.has(key)}
								error={errors.get(key)}
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
							onAction={onAction}
						/>
					))}
				</ul>
			)}
		</section>
	);
}

export function GalleryLink() {
	const t = useT();
	return (
		<a
			data-testid="packages-gallery-link"
			href="https://pi.dev/packages"
			target="_blank"
			rel="noopener noreferrer"
			className="tr-text-metadata text-primary underline underline-offset-2"
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
		<section data-testid="settings-builtins" className="flex flex-col">
			<div className="flex flex-col gap-2 pb-8">
				<h4 className="tr-text-label-pill text-text-subtle">
					{t("settings.extensions.group.builtin")}
				</h4>
				<p className="tr-text-metadata text-text-muted">
					{t("settings.extensions.group.builtinDescription", {
						path: builtins.some((b) => b.scope === "project")
							? (projectSettingsPath ?? settingsPath)
							: settingsPath,
					})}
				</p>
			</div>
			<ul className="flex flex-col divide-y divide-border-default rounded-sm border border-border-default bg-control-bg">
				{builtins.map((builtin) => {
					const copy = BUILTIN_COPY[builtin.name];
					const key = `builtin:${builtin.name}`;
					const error = errors.get(key);
					return (
						<li
							key={builtin.name}
							data-testid={`builtin-row-${builtin.name}`}
							className="flex items-start justify-between gap-12 px-12 py-8"
						>
							<div className="flex min-w-0 flex-col gap-4">
								<span className="flex flex-wrap items-center gap-x-8 gap-y-4">
									<span className="tr-title-compact text-text-default">
										{builtinTitle(t, builtin.name)}
									</span>
									<code className={cn(TAG_CLASS, "tr-code-text-small text-text-muted")}>{key}</code>
								</span>
								{copy ? (
									<span className="tr-text-metadata text-text-muted">{t(copy.description)}</span>
								) : null}
								{error ? (
									<SettingsNotice variant="error" testId="package-action-error" className="mt-4">
										{error}
									</SettingsNotice>
								) : null}
							</div>
							<Switch
								checked={builtin.enabled}
								label={t("settings.packages.enable", { name: builtinTitle(t, builtin.name) })}
								testId={`builtin-toggle-${builtin.name}`}
								disabled={busy.has(key)}
								onCheckedChange={(enabled) => onToggle(builtin, enabled)}
							/>
						</li>
					);
				})}
			</ul>
		</section>
	);
}
