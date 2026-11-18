import {
	RiCheckLine as Check,
	RiCloseLine as Close,
	RiMore2Line as MoreVertical,
	RiAddLine as Plus,
	RiShieldCheckLine as ShieldCheck,
} from "@remixicon/react";
import type {
	McpConfigFileError,
	McpListResult,
	McpServerEntryInput,
	McpServerScope,
	McpServerSummary,
	Workspace,
} from "@thinkrail/contracts";
import type { MessageKey } from "@thinkrail/locales";
import { currentTranslator, type Translator, t as translate, useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { SkeletonRows } from "@thinkrail/ui/skeleton";
import { Switch } from "@thinkrail/ui/switch";
import { cn } from "@thinkrail/ui/utils";
import { useEffect, useMemo, useState } from "react";
import { LoginDialog, type LoginState } from "@/auth";
import { useNow } from "@/components/useNow";
import type { McpStateTone } from "@/lib";
import {
	SETTINGS_LIST_PRIMARY,
	SETTINGS_ROWS,
	SETTINGS_TAG,
	SettingsGroup,
	SettingsList,
	SettingsNotice,
	SettingsPage,
	SettingsRow,
	useSettingsListRow,
} from "@/settingsKit";
import {
	deriveMcpServerRows,
	type McpRowState,
	type McpServerRow,
	type McpWorkspaceProjection,
	selectActiveWorkspace,
	selectChatTitle,
	selectLoginBusy,
	toast,
	useAppStore,
} from "@/store";
import {
	errorText,
	getTransport,
	reloadSessionResourcesWithSkillBaseline,
	requestMcpList,
	requestUserMcpList,
	supportsUserMcp,
	watchMcpWorkspace,
} from "@/transport";
import { ConfirmDialog } from "./ConfirmDialog";
import {
	McpAddDialog,
	type McpAddResult,
	McpApproveDialog,
	type McpApproveTarget,
	McpDetailsDialog,
	McpEditDialog,
	type McpEditTarget,
	McpLogDialog,
	type McpLogRead,
} from "./McpServerDialogs";
import {
	MCP_EXPOSURE_HINT,
	MCP_EXPOSURES,
	type McpEditableExposure,
	projectEntryFrom,
} from "./mcpEntries";
import { MCP_PRESETS, type McpPreset } from "./mcpPresets";
import {
	type McpChatFailure,
	type McpRowAction,
	type McpRowView,
	type McpSettingChange,
	mcpChatFailureText,
	mcpEntryUpdate,
	mcpExposureLabel,
	mcpHandledElsewhereText,
	mcpRenderedTarget,
	mcpRowView,
	mcpSaveFeedback,
	mcpSettingWrite,
	mcpUserRowView,
	mcpUserServerWrite,
} from "./mcpServerView";
import { startChatInTab } from "./openChat";
import { SETTING, settingProps } from "./settingsCatalog";
import { useUserMcpList } from "./useUserMcpList";

const TONE_TEXT: Record<McpStateTone, string> = {
	success: "text-feedback-success",
	working: "text-primary",
	warning: "text-feedback-warning",
	error: "text-feedback-error",
	info: "text-feedback-info",
	neutral: "text-text-muted",
};

const TONE_DOT: Record<McpStateTone, string> = {
	success: "bg-feedback-success",
	working: "bg-primary motion-safe:animate-working",
	warning: "bg-feedback-warning",
	error: "bg-feedback-error",
	info: "bg-feedback-info",
	neutral: "bg-text-subtle",
};

const ACTION_LABEL = {
	"sign-in": "mcp.action.signIn",
	review: "mcp.action.review",
	edit: "common.edit",
	"test-connection": "mcp.action.testConnection",
	reconnect: "mcp.action.reconnect",
	reload: "mcp.action.reload",
	"open-chat": "mcp.action.openChat",
	"show-log": "mcp.action.showLog",
} as const satisfies Record<McpRowAction, MessageKey>;

const CHIP_CLASS = cn(SETTINGS_TAG, "text-text-muted");

const USER_LIST = "mcp:user";
const PROJECT_LIST = "mcp:project";

type Settled<T> = { ok: true; value: T } | { ok: false; error: string };

interface RowError {
	text: string;
	state?: McpRowState;
}

function rowErrorText(error: RowError | undefined, state: McpRowState): string | undefined {
	return error && (error.state === undefined || error.state === state) ? error.text : undefined;
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
	const next = { ...record };
	delete next[key];
	return next;
}

async function settle<T>(work: () => Promise<T>): Promise<Settled<T>> {
	try {
		return { ok: true, value: await work() };
	} catch (error) {
		return { ok: false, error: errorText(error) };
	}
}

async function readProjectEntry(workspaceId: string, name: string): Promise<McpServerEntryInput> {
	const { content } = await getTransport().request("fs.readFile", {
		workspaceId,
		path: ".pi/mcp.json",
	});
	return projectEntryFrom(content, name);
}

async function refreshOnFailure(
	workspaceId: string,
	write: () => Promise<McpListResult>,
): Promise<McpListResult> {
	try {
		return await write();
	} catch (error) {
		void requestMcpList("mcp.list", { workspaceId }).catch(() => {});
		throw error;
	}
}

export async function approveMcpServer(
	workspaceId: string,
	summary: McpServerSummary,
): Promise<McpListResult> {
	const fingerprint = summary.approval?.fingerprint;
	if (!fingerprint) throw new Error(translate("mcp.approveDialog.nothingToApprove"));
	return refreshOnFailure(workspaceId, () =>
		requestMcpList("mcp.approve", { workspaceId, name: summary.name, fingerprint }),
	);
}

function cancelLoginQuietly(loginId: string): void {
	void getTransport()
		.request("provider.loginCancel", { loginId })
		.catch(() => {});
}

function writeSetting(
	workspaceId: string,
	row: McpServerRow,
	change: McpSettingChange,
): Promise<McpListResult> {
	return refreshOnFailure(workspaceId, async () => {
		const entry =
			row.summary.scope === "project"
				? await readProjectEntry(workspaceId, row.summary.name)
				: null;
		const write = mcpSettingWrite(workspaceId, row.summary, change, entry);
		return write.method === "mcp.update"
			? requestMcpList("mcp.update", write.params)
			: requestMcpList("mcp.setProjectOverride", write.params);
	});
}

/** What a list of MCP servers reads and writes through: a workspace's projection, or the user servers alone. */
export interface McpOps {
	readonly workspaceId: string | undefined;
	reread: () => Promise<McpListResult>;
	add: (scope: McpServerScope, name: string, entry: McpServerEntryInput) => Promise<McpListResult>;
	remove: (summary: McpServerSummary) => Promise<McpListResult>;
	setting: (row: McpServerRow, change: McpSettingChange) => Promise<McpListResult>;
	feedback: (result: McpListResult) => string;
	view: (t: Translator, row: McpServerRow, now: number) => McpRowView;
}

export function workspaceOps(workspaceId: string): McpOps {
	return {
		workspaceId,
		reread: () => requestMcpList("mcp.list", { workspaceId }),
		add: (scope, name, entry) => requestMcpList("mcp.add", { workspaceId, scope, name, entry }),
		remove: (summary) =>
			refreshOnFailure(workspaceId, () =>
				requestMcpList("mcp.remove", {
					workspaceId,
					name: summary.name,
					...mcpRenderedTarget(summary),
				}),
			),
		setting: (row, change) => writeSetting(workspaceId, row, change),
		feedback: mcpSaveFeedback,
		view: mcpRowView,
	};
}

export function userOps(
	write: (work: () => Promise<McpListResult>) => Promise<McpListResult>,
): McpOps {
	return {
		workspaceId: undefined,
		reread: () => write(() => requestUserMcpList("mcp.list", {})),
		add: (_scope, name, entry) =>
			write(() => requestUserMcpList("mcp.add", { scope: "user", name, entry })),
		remove: (summary) =>
			write(() =>
				requestUserMcpList("mcp.remove", {
					scope: "user",
					name: summary.name,
					expectedFingerprint: summary.fingerprint,
				}),
			),
		setting: (row, change) =>
			write(() => requestUserMcpList("mcp.setUserServer", mcpUserServerWrite(row.summary, change))),
		feedback: () => translate("mcp.saveFeedback.allProjects"),
		view: mcpUserRowView,
	};
}

async function addServers(
	ops: McpOps,
	servers: { name: string; entry: McpServerEntryInput }[],
	scope: McpServerScope,
): Promise<{ results: McpAddResult[]; last: McpListResult | null }> {
	const results: McpAddResult[] = [];
	let last: McpListResult | null = null;
	for (const server of servers) {
		const outcome = await settle(() => ops.add(scope, server.name, server.entry));
		results.push({ name: server.name, error: outcome.ok ? null : outcome.error });
		if (outcome.ok) last = outcome.value;
	}
	return { results, last };
}

/** The sign-in this list shows: an MCP login started from the same workspace, or from none. */
export function mcpLoginFor(
	login: LoginState | null,
	workspaceId: string | undefined,
): LoginState | null {
	return login?.target?.kind === "mcp" && login.target.workspaceId === workspaceId ? login : null;
}

type McpRowCommand =
	| { kind: "toggle"; enabled: boolean }
	| { kind: "exposure"; exposure: McpEditableExposure }
	| { kind: "revoke-tool"; tool: string }
	| { kind: McpRowAction | "sign-out" | "remove" | "share" | "details" };

function lockedSettings(row: McpServerRow): boolean {
	return (
		row.state === "pending-approval" ||
		row.state === "invalid-config" ||
		row.state === "replaced" ||
		row.state === "handled-elsewhere"
	);
}

function toggleLabel(t: Translator, summary: McpServerSummary, inProject: boolean): string {
	const key =
		inProject && summary.scope === "user"
			? summary.enabled
				? "mcp.server.disableInProject"
				: "mcp.server.enableInProject"
			: summary.enabled
				? "mcp.server.disable"
				: "mcp.server.enable";
	return t(key, { name: summary.name });
}

export function McpServerRowView({
	row,
	view,
	inProject = true,
	readOnly,
	busy,
	error,
	menuOpen = false,
	onMenuOpenChange,
	onCommand,
}: {
	row: McpServerRow;
	view: McpRowView;
	inProject?: boolean;
	readOnly: boolean;
	busy: boolean;
	error: string | undefined;
	menuOpen?: boolean;
	onMenuOpenChange?: (open: boolean) => void;
	onCommand: (command: McpRowCommand) => void;
}) {
	const t = useT();
	const { rowProps, primaryProps, sideProps } = useSettingsListRow(row.key);
	const { summary } = row;
	const inert = readOnly || busy;
	const settingsDisabled = inert || lockedSettings(row);
	const { action, secondary } = view;
	return (
		<li
			{...rowProps}
			data-testid="mcp-server-row"
			data-name={summary.name}
			data-scope={summary.scope}
			data-state={row.state}
			data-attention={row.attention || undefined}
			className="flex flex-col gap-4 border-border-muted border-b py-6 last:border-b-0"
		>
			<div className="flex flex-wrap items-center gap-8">
				<button
					type="button"
					{...primaryProps}
					data-testid="mcp-server-details"
					className={cn(SETTINGS_LIST_PRIMARY, "min-w-[12rem]")}
					onClick={() => onCommand({ kind: "details" })}
				>
					<span className="flex min-w-0 max-w-full flex-wrap items-center gap-x-8 gap-y-4">
						<span className="wrap-anywhere tr-title-compact text-text-default">{summary.name}</span>
						<span data-testid="mcp-server-transport" className={CHIP_CLASS}>
							{summary.transport === "stdio" ? t("mcp.transport.stdio") : t("mcp.transport.http")}
							{summary.transport === "stdio" ? (
								<span className="sr-only">{` ${t("mcp.server.stdioSrOnly")}`}</span>
							) : null}
						</span>
						<span
							data-testid="mcp-server-exposure"
							data-exposure={summary.effectiveExposure}
							className={CHIP_CLASS}
						>
							{mcpExposureLabel(t, summary.effectiveExposure)}
						</span>
					</span>
					<span className="flex min-w-0 max-w-full flex-wrap items-center gap-x-4 tr-text-metadata">
						<span aria-hidden className={cn("size-6 shrink-0 rounded-full", TONE_DOT[view.tone])} />
						<span data-testid="mcp-server-status" className={TONE_TEXT[view.tone]}>
							{view.label}
						</span>
						{view.reason ? (
							<span className="wrap-break-word min-w-0 text-text-muted">· {view.reason}</span>
						) : null}
					</span>
				</button>
				<div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-8">
					{secondary ? (
						<Button
							variant="ghost"
							size="m"
							{...sideProps}
							data-testid="mcp-server-secondary"
							data-action={secondary}
							disabled={inert}
							onClick={() => onCommand({ kind: secondary })}
						>
							{t(ACTION_LABEL[secondary])}
						</Button>
					) : null}
					{action ? (
						<Button
							variant={action === "review" || action === "sign-in" ? "primary" : "outline"}
							size="m"
							{...sideProps}
							data-testid="mcp-server-action"
							data-action={action}
							disabled={inert}
							onClick={() => onCommand({ kind: action })}
						>
							{t(ACTION_LABEL[action])}
						</Button>
					) : null}
					<DropdownMenu
						{...(onMenuOpenChange ? { open: menuOpen, onOpenChange: onMenuOpenChange } : {})}
					>
						<DropdownMenuTrigger asChild>
							<IconButton
								icon={MoreVertical}
								label={t("mcp.server.more", { name: summary.name })}
								{...sideProps}
								data-testid="mcp-server-menu"
							/>
						</DropdownMenuTrigger>
						<McpRowMenu
							row={row}
							inProject={inProject}
							inert={inert}
							settingsDisabled={settingsDisabled}
							onCommand={onCommand}
						/>
					</DropdownMenu>
					<Switch
						checked={summary.enabled}
						label={toggleLabel(t, summary, inProject)}
						testId="mcp-server-toggle"
						{...sideProps}
						disabled={settingsDisabled}
						onCheckedChange={(enabled) => onCommand({ kind: "toggle", enabled })}
					/>
				</div>
			</div>
			{summary.alwaysAllowed && summary.alwaysAllowed.length > 0 ? (
				<div
					data-testid="mcp-always-allowed"
					className="flex flex-wrap items-center gap-4 px-4 text-text-muted tr-text-metadata"
				>
					<span className="shrink-0">{t("mcp.server.alwaysAllowed")}</span>
					{summary.alwaysAllowed.map(({ tool, label }) => (
						<span
							key={tool}
							data-testid="mcp-always-allowed-tool"
							data-tool={tool}
							className="flex min-w-0 items-center gap-2 rounded-xs border border-border-default pl-4 text-text-default"
						>
							<span className="wrap-anywhere min-w-0">{label}</span>
							<IconButton
								icon={Close}
								label={t("mcp.server.revokeTool", { tool: label })}
								size="s"
								{...sideProps}
								data-testid="mcp-always-allowed-revoke"
								disabled={inert}
								onClick={() => onCommand({ kind: "revoke-tool", tool })}
							/>
						</span>
					))}
				</div>
			) : null}
			{error ? (
				<p
					role="alert"
					className="whitespace-pre-line break-words px-4 text-feedback-error tr-text-metadata"
				>
					{error}
				</p>
			) : null}
		</li>
	);
}

export function McpRowMenu({
	row,
	inProject,
	inert,
	settingsDisabled,
	onCommand,
}: {
	row: McpServerRow;
	inProject: boolean;
	inert: boolean;
	settingsDisabled: boolean;
	onCommand: (command: McpRowCommand) => void;
}) {
	const t = useT();
	const { summary } = row;
	const pendingProject = summary.scope === "project" && row.state === "pending-approval";
	return (
		<DropdownMenuContent align="end">
			<DropdownMenuItem
				data-testid="mcp-menu-details"
				onSelect={() => onCommand({ kind: "details" })}
			>
				{t("mcp.menu.details")}
			</DropdownMenuItem>
			<DropdownMenuSub>
				<DropdownMenuSubTrigger data-testid="mcp-menu-exposure" disabled={settingsDisabled}>
					{t("mcp.exposure.menuAria", { exposure: mcpExposureLabel(t, summary.effectiveExposure) })}
				</DropdownMenuSubTrigger>
				<DropdownMenuSubContent className="max-w-[20rem]">
					<DropdownMenuLabel>
						{inProject && summary.scope === "user"
							? t("mcp.exposure.menuTitleInProject")
							: t("mcp.exposure.menuTitle")}
					</DropdownMenuLabel>
					<DropdownMenuRadioGroup
						value={summary.effectiveExposure}
						onValueChange={(value) => {
							const exposure = MCP_EXPOSURES.find((candidate) => candidate === value);
							if (exposure && exposure !== summary.effectiveExposure) {
								onCommand({ kind: "exposure", exposure });
							}
						}}
					>
						{MCP_EXPOSURES.map((exposure) => (
							<DropdownMenuRadioItem
								key={exposure}
								value={exposure}
								data-testid={`mcp-exposure-${exposure}`}
								className="items-start"
							>
								{exposure === summary.effectiveExposure ? (
									<Check className="mt-2" />
								) : (
									<span aria-hidden className="size-14 shrink-0" />
								)}
								<span className="flex flex-col gap-2">
									<span>{mcpExposureLabel(t, exposure)}</span>
									<span className="text-text-muted tr-text-metadata">
										{t(MCP_EXPOSURE_HINT[exposure])}
									</span>
								</span>
							</DropdownMenuRadioItem>
						))}
					</DropdownMenuRadioGroup>
					{summary.exposure === "codemode" ? (
						<p className="px-8 py-4 text-text-muted tr-text-metadata">
							{t("mcp.exposure.codemodeNote")}
						</p>
					) : null}
				</DropdownMenuSubContent>
			</DropdownMenuSub>
			{row.effective && summary.oauth ? (
				<>
					<DropdownMenuItem
						data-testid="mcp-menu-sign-in"
						disabled={inert}
						onSelect={() => onCommand({ kind: "sign-in" })}
					>
						{t("mcp.action.signIn")}
					</DropdownMenuItem>
					<DropdownMenuItem
						data-testid="mcp-menu-sign-out"
						disabled={inert}
						onSelect={() => onCommand({ kind: "sign-out" })}
					>
						{t("mcp.menu.signOut")}
					</DropdownMenuItem>
				</>
			) : null}
			{row.effective && summary.transport === "http" ? (
				<DropdownMenuItem
					data-testid="mcp-menu-test-connection"
					disabled={inert}
					onSelect={() => onCommand({ kind: "test-connection" })}
				>
					{t("mcp.action.testConnection")}
				</DropdownMenuItem>
			) : null}
			<DropdownMenuItem
				data-testid="mcp-menu-show-log"
				disabled={inert}
				onSelect={() => onCommand({ kind: "show-log" })}
			>
				{t("mcp.action.showLog")}
			</DropdownMenuItem>
			{pendingProject ? (
				<DropdownMenuItem
					data-testid="mcp-menu-review"
					disabled={inert}
					onSelect={() => onCommand({ kind: "review" })}
				>
					{t("mcp.action.review")}
				</DropdownMenuItem>
			) : summary.scope === "user" ? (
				<DropdownMenuItem data-testid="mcp-menu-edit" disabled className="items-start">
					<span className="flex min-w-0 flex-col gap-2">
						<span>{t("common.edit")}</span>
						<span className="break-all text-text-muted tr-text-metadata">
							{t("mcp.menu.editDirectly", { source: summary.source })}
						</span>
					</span>
				</DropdownMenuItem>
			) : (
				<DropdownMenuItem
					data-testid="mcp-menu-edit"
					disabled={inert || row.state === "handled-elsewhere"}
					onSelect={() => onCommand({ kind: "edit" })}
				>
					{t("common.edit")}
				</DropdownMenuItem>
			)}
			{inProject && summary.scope === "user" && summary.projectOverride ? (
				<DropdownMenuItem
					data-testid="mcp-menu-share"
					disabled={inert}
					onSelect={() => onCommand({ kind: "share" })}
				>
					{t("mcp.menu.share")}
				</DropdownMenuItem>
			) : null}
			<DropdownMenuSeparator />
			<DropdownMenuItem
				data-testid="mcp-menu-remove"
				disabled={inert}
				onSelect={() => onCommand({ kind: "remove" })}
				className="text-feedback-error"
			>
				{t("common.remove")}
			</DropdownMenuItem>
		</DropdownMenuContent>
	);
}

export function McpConfigFileErrors({ errors }: { errors: readonly McpConfigFileError[] }) {
	const t = useT();
	const bySource = new Map<string, string[]>();
	for (const { source, message } of errors) {
		bySource.set(source, [...(bySource.get(source) ?? []), message]);
	}
	if (bySource.size === 0) return null;
	return (
		<ul className="flex flex-col gap-4" data-testid="mcp-config-errors">
			{[...bySource].map(([source, messages]) => (
				<li key={source} role="alert" data-testid="mcp-config-error" data-source={source}>
					<SettingsNotice variant="error">
						<span className="flex min-w-0 flex-col gap-2 tr-text-metadata">
							<span className="break-all">{t("mcp.configError.problemIn", { source })}</span>
							{messages.map((message) => (
								<span key={message} className="break-words text-text-muted">
									{message}
								</span>
							))}
							<span className="text-text-muted">{t("mcp.configError.hint")}</span>
						</span>
					</SettingsNotice>
				</li>
			))}
		</ul>
	);
}

export function McpConfirmBanner({ inProject = true }: { inProject?: boolean }) {
	const t = useT();
	return (
		<SettingsNotice
			variant="info"
			testId="mcp-confirm-banner"
			icon={inProject ? <ShieldCheck className="size-14" /> : undefined}
		>
			<span className="flex flex-col gap-2">
				<span data-testid="mcp-host-notice">{t("mcp.hostNotice")}</span>
				{inProject ? (
					<span data-testid="mcp-confirm-text">{t("mcp.settings.confirmBanner")}</span>
				) : null}
			</span>
		</SettingsNotice>
	);
}

export function McpEmptyState({
	disabled,
	focusList = USER_LIST,
	settingId,
	onAdd,
	onImport,
	onPreset,
}: {
	disabled: boolean;
	focusList?: string;
	settingId?: string | undefined;
	onAdd: () => void;
	onImport: () => void;
	onPreset: (preset: McpPreset) => void;
}) {
	const t = useT();
	return (
		<div
			data-testid="mcp-empty"
			data-setting-row={settingId ?? "mcp-empty"}
			data-setting-id={settingId}
			className="flex flex-col items-start gap-12 py-8"
		>
			<p className="tr-text-ui text-text-default">{t("mcp.empty.title")}</p>
			{MCP_PRESETS.length > 0 ? (
				<ul className="flex w-full flex-col gap-4" data-testid="mcp-empty-presets">
					{MCP_PRESETS.map((preset) => (
						<li key={preset.id} className="flex items-center gap-8">
							<span className="flex min-w-0 flex-1 flex-col">
								<span className="tr-title-compact text-text-default">{t(preset.title)}</span>
								<span className="break-words text-text-muted tr-text-metadata">
									{t(preset.description)}
								</span>
							</span>
							<Button
								variant="outline"
								size="m"
								iconLeft={Plus}
								tabIndex={0}
								data-setting-side=""
								aria-label={t("mcp.empty.addPreset", { name: t(preset.title) })}
								disabled={disabled}
								onClick={() => onPreset(preset)}
							>
								{t("common.add")}
							</Button>
						</li>
					))}
				</ul>
			) : null}
			<div className="flex flex-wrap gap-8">
				<Button
					variant="primary"
					size="m"
					iconLeft={Plus}
					tabIndex={0}
					data-testid="mcp-empty-add"
					data-setting-stop=""
					data-focus-fallback={focusList}
					disabled={disabled}
					onClick={onAdd}
				>
					{t("mcp.empty.add")}
				</Button>
				<Button
					variant="outline"
					size="m"
					tabIndex={0}
					data-testid="mcp-empty-import"
					data-setting-side=""
					disabled={disabled}
					onClick={onImport}
				>
					{t("mcp.empty.import")}
				</Button>
			</div>
		</div>
	);
}

export function McpSettings() {
	const workspace = useAppStore(selectActiveWorkspace);
	const protocolVersion = useAppStore((s) => s.protocolVersion);
	if (workspace) return <McpWorkspaceSettings key={workspace.id} workspace={workspace} />;
	if (supportsUserMcp(protocolVersion)) return <McpUserSettings />;
	return <McpNoWorkspace />;
}

export function McpNoWorkspace() {
	const t = useT();
	return (
		<SettingsPage
			testId="settings-mcp"
			title={t("settings.nav.mcp")}
			description={t("mcp.settings.introNoWorkspace")}
		>
			<p data-testid="mcp-no-workspace" className="text-text-muted tr-text-ui">
				{t("mcp.settings.noWorkspace")}
			</p>
		</SettingsPage>
	);
}

function McpWorkspaceSettings({ workspace }: { workspace: Workspace }) {
	const workspaceId = workspace.id;
	const project = useAppStore((s) => s.projects.find((p) => p.id === workspace.projectId));
	const projection = useAppStore((s) => s.mcpByWorkspace[workspaceId]);
	const connected = useAppStore((s) => s.status === "connected");
	const welcome = useAppStore((s) => s.welcomeGeneration);
	const trusted = project?.piResourceTrust === "granted";
	const [readFailure, setReadFailure] = useState<string | null>(null);
	const [readAttempt, setReadAttempt] = useState(0);

	useEffect(() => {
		if (!connected) return;
		return watchMcpWorkspace(workspaceId, (error) =>
			setReadFailure(error === null ? null : errorText(error)),
		);
	}, [workspaceId, connected, welcome, trusted, readAttempt]);

	return (
		<McpServersPanel
			ops={workspaceOps(workspaceId)}
			workspace={workspace}
			projectName={project?.name}
			trusted={trusted}
			projection={projection}
			readFailure={readFailure}
			onRetry={() => setReadAttempt((attempt) => attempt + 1)}
		/>
	);
}

function McpUserSettings() {
	const list = useUserMcpList();
	return (
		<McpServersPanel
			ops={userOps(list.write)}
			workspace={null}
			projectName={undefined}
			trusted={false}
			projection={list.projection}
			readFailure={list.readFailure}
			onRetry={list.retry}
		/>
	);
}

type AddRequest = { tier: "form" | "json"; preset?: McpPreset; key: number };

export function McpServersPanel({
	ops,
	workspace,
	projectName,
	trusted,
	projection,
	readFailure,
	onRetry,
}: {
	ops: McpOps;
	workspace: Workspace | null;
	projectName: string | undefined;
	trusted: boolean;
	projection: McpWorkspaceProjection | undefined;
	readFailure: string | null;
	onRetry: () => void;
}) {
	const t = useT();
	const workspaceId = workspace?.id;
	const inProject = workspace !== null;
	const connected = useAppStore((s) => s.status === "connected");
	const activeLogin = useAppStore((s) => s.activeLogin);
	const loginBusy = useAppStore(selectLoginBusy);
	const now = useNow();
	const rows = useMemo(
		() =>
			deriveMcpServerRows(projection, now).filter(
				(row) => trusted || row.summary.scope !== "project",
			),
		[projection, now, trusted],
	);
	const [busy, setBusy] = useState<Record<string, true>>({});
	const [rowErrors, setRowErrors] = useState<Record<string, RowError>>({});
	const [feedback, setFeedback] = useState<string | null>(null);
	const [adding, setAdding] = useState<AddRequest | null>(null);
	const [editing, setEditing] = useState<McpEditTarget | null>(null);
	const [approving, setApproving] = useState<McpApproveTarget | null>(null);
	const [details, setDetails] = useState<string | null>(null);
	const [removing, setRemoving] = useState<McpServerRow | null>(null);
	const [menuFor, setMenuFor] = useState<string | null>(null);
	const [log, setLog] = useState<{ key: string; read: McpLogRead } | null>(null);

	useEffect(() => {
		if (trusted) return;
		setEditing(null);
		setApproving(null);
		setRemoving((current) => (current?.summary.scope === "project" ? null : current));
	}, [trusted]);

	const handledElsewhere = projection?.handledElsewhere ?? null;
	const readOnly = !connected || handledElsewhere !== null;
	const servers = projection?.servers ?? null;
	const configErrors = projection?.configErrors ?? [];
	const mcpLogin = mcpLoginFor(activeLogin, workspaceId);
	const userRows = rows.filter((row) => row.summary.scope === "user");
	const projectRows = rows.filter((row) => row.summary.scope === "project");

	const run = async (
		row: McpServerRow,
		work: () => Promise<McpListResult | null>,
		errorState?: McpRowState,
	) => {
		setBusy((previous) => ({ ...previous, [row.key]: true }));
		setRowErrors((previous) => without(previous, row.key));
		setFeedback(null);
		const outcome = await settle(work);
		setBusy((previous) => without(previous, row.key));
		if (!outcome.ok) {
			const error = { text: outcome.error, ...(errorState ? { state: errorState } : {}) };
			setRowErrors((previous) => ({ ...previous, [row.key]: error }));
		} else if (outcome.value) setFeedback(ops.feedback(outcome.value));
	};

	const runInChats = (
		row: McpServerRow,
		chatWorkspaceId: string,
		request: (sessionId: string) => Promise<unknown>,
	) =>
		run(
			row,
			async () => {
				const failures: McpChatFailure[] = [];
				for (const sessionId of row.sessions.reporting) {
					try {
						await request(sessionId);
					} catch (error) {
						const chat = selectChatTitle(
							currentTranslator(),
							useAppStore.getState(),
							chatWorkspaceId,
							sessionId,
						);
						failures.push({ chat, error: errorText(error) });
					}
				}
				const failure = mcpChatFailureText(failures, row.sessions.reporting.length);
				if (failure) throw new Error(failure);
				return null;
			},
			row.state,
		);

	const openLog = async (row: McpServerRow) => {
		setLog({ key: row.key, read: { state: "reading" } });
		const name = row.summary.name;
		const outcome = await settle(() =>
			getTransport().request(
				"mcp.readLog",
				workspaceId === undefined ? { name } : { workspaceId, name },
			),
		);
		const read: McpLogRead = outcome.ok
			? { state: "read", log: outcome.value }
			: { state: "failed", error: outcome.error };
		setLog((current) =>
			current?.key === row.key && current.read.state === "reading"
				? { key: row.key, read }
				: current,
		);
	};

	const startProbe = (
		row: McpServerRow,
		method: "mcp.login" | "mcp.testConnection" | "mcp.logout",
	) => {
		if (!useAppStore.getState().reserveLogin()) return;
		const name = row.summary.name;
		const params = workspaceId === undefined ? { name } : { workspaceId, name };
		return run(row, () =>
			Promise.resolve()
				.then(async () => {
					if (method === "mcp.logout") {
						await getTransport().request(method, params);
						toast.success(t("mcp.toast.signedOut", { name }));
						return ops.reread();
					}
					const { loginId } = await getTransport().request(method, params);
					if (
						workspaceId !== undefined &&
						useAppStore.getState().removedWorkspaceIds[workspaceId]
					) {
						cancelLoginQuietly(loginId);
						return null;
					}
					useAppStore
						.getState()
						.beginLogin(
							loginId,
							`mcp:${name}`,
							workspaceId === undefined
								? { kind: "mcp", serverName: name }
								: { kind: "mcp", workspaceId, serverName: name },
						);
					return null;
				})
				.finally(() => useAppStore.getState().finishLoginStart()),
		);
	};

	const projectTrustedNow = () =>
		workspace !== null &&
		useAppStore.getState().projects.find((p) => p.id === workspace.projectId)?.piResourceTrust ===
			"granted";

	const openEdit = async (row: McpServerRow) => {
		if (row.summary.scope !== "project" || workspaceId === undefined) return;
		const read = await settle(() => readProjectEntry(workspaceId, row.summary.name));
		if (!projectTrustedNow()) return;
		if (read.ok) setEditing({ summary: row.summary, entry: read.value });
		else setRowErrors((previous) => ({ ...previous, [row.key]: { text: read.error } }));
	};

	const openReview = async (row: McpServerRow) => {
		if (workspaceId === undefined) return;
		const read = await settle(() => readProjectEntry(workspaceId, row.summary.name));
		if (!projectTrustedNow()) return;
		setApproving({
			summary: row.summary,
			entry: read.ok ? read.value : null,
			readError: read.ok ? null : read.error,
		});
	};

	const onWorkspaceCommand = (wsId: string, row: McpServerRow, command: McpRowCommand) => {
		const name = row.summary.name;
		switch (command.kind) {
			case "revoke-tool":
				void run(row, () =>
					refreshOnFailure(wsId, () =>
						requestMcpList("mcp.revokeToolGrant", { workspaceId: wsId, name, tool: command.tool }),
					),
				);
				return;
			case "reconnect":
				void runInChats(row, wsId, (sessionId) =>
					getTransport().request("mcp.reconnect", { workspaceId: wsId, sessionId, name }),
				);
				return;
			case "reload":
				void runInChats(row, wsId, async (sessionId) => {
					const { syncedTick } = await reloadSessionResourcesWithSkillBaseline(wsId, {
						sessionId,
					});
					useAppStore.getState().markSkillsSynced(sessionId, syncedTick);
				});
				return;
			case "open-chat":
				useAppStore.getState().closeSettings();
				void startChatInTab(wsId);
				return;
			case "share":
				void run(row, () =>
					refreshOnFailure(wsId, () =>
						requestMcpList("mcp.shareWithRepo", { workspaceId: wsId, name }),
					),
				);
				return;
			case "edit":
				void openEdit(row);
				return;
			case "review":
				void openReview(row);
				return;
		}
	};

	const onCommand = (row: McpServerRow, command: McpRowCommand) => {
		switch (command.kind) {
			case "toggle":
				void run(row, () => ops.setting(row, { enabled: command.enabled }));
				return;
			case "exposure":
				void run(row, () => ops.setting(row, { exposure: command.exposure }));
				return;
			case "sign-in":
				void startProbe(row, "mcp.login");
				return;
			case "test-connection":
				void startProbe(row, "mcp.testConnection");
				return;
			case "sign-out":
				void startProbe(row, "mcp.logout");
				return;
			case "show-log":
				void openLog(row);
				return;
			case "remove":
				setRemoving(row);
				return;
			case "details":
				setDetails(row.key);
				return;
			default:
				if (workspaceId !== undefined) onWorkspaceCommand(workspaceId, row, command);
		}
	};

	const requestRemove = (key: string) => {
		const row = rows.find((candidate) => candidate.key === key);
		if (!row || readOnly || busy[row.key] || loginBusy) return;
		setRemoving(row);
	};

	const openAdd = (tier: AddRequest["tier"], preset?: McpPreset) =>
		setAdding({ tier, ...(preset ? { preset } : {}), key: Date.now() });

	const renderRows = (list: readonly McpServerRow[]) =>
		list.map((row) => (
			<McpServerRowView
				key={row.key}
				row={row}
				view={ops.view(t, row, now)}
				inProject={inProject}
				readOnly={readOnly}
				busy={!!busy[row.key] || loginBusy}
				error={rowErrorText(rowErrors[row.key], row.state)}
				menuOpen={menuFor === row.key}
				onMenuOpenChange={(open) => setMenuFor(open ? row.key : null)}
				onCommand={(command) => onCommand(row, command)}
			/>
		));

	const serverList = (
		focusList: string,
		label: string,
		settingId: string,
		testId: string,
		list: readonly McpServerRow[],
	) => (
		<SettingsList
			focusList={focusList}
			label={label}
			rowIds={list.map((row) => row.key)}
			settingId={settingId}
			testId={testId}
			onRemove={requestRemove}
			onMenu={setMenuFor}
		>
			{renderRows(list)}
		</SettingsList>
	);

	const detailRow = rows.find((row) => row.key === details);
	const logRow = log ? rows.find((row) => row.key === log.key) : undefined;
	const userLabel = t("settings.catalog.mcpUserServers.label");
	const projectLabel = t("settings.catalog.mcpProjectServers.label");
	return (
		<>
			<SettingsPage
				testId="settings-mcp"
				title={t("settings.nav.mcp")}
				description={
					!inProject
						? t("mcp.settings.introNoWorkspace")
						: projectName === undefined
							? t("mcp.settings.introThisProject")
							: t("mcp.settings.intro", { project: projectName })
				}
			>
				<div className="flex flex-col gap-12">
					<McpConfirmBanner inProject={inProject} />
					{handledElsewhere ? (
						<SettingsNotice variant="warning" testId="mcp-handled-elsewhere">
							{mcpHandledElsewhereText(t, handledElsewhere.by)}
						</SettingsNotice>
					) : null}
					<McpConfigFileErrors errors={configErrors} />
					{feedback ? (
						<p
							role="status"
							data-testid="mcp-feedback"
							className="text-text-muted tr-text-metadata"
						>
							{feedback}
						</p>
					) : null}
					{servers && servers.length > 0 ? (
						<div className={SETTINGS_ROWS}>
							<SettingsRow
								{...settingProps(t, SETTING.mcpAdd)}
								description={
									inProject
										? t("mcp.settings.addDescription")
										: t("mcp.settings.addDescriptionUser")
								}
								control={
									<Button
										variant="primary"
										size="m"
										iconLeft={Plus}
										tabIndex={0}
										data-testid="mcp-add"
										data-focus-fallback={PROJECT_LIST}
										disabled={readOnly}
										onClick={() => openAdd("form")}
									>
										{t("mcp.settings.addServer")}
									</Button>
								}
							/>
						</div>
					) : null}
				</div>
				{servers === null ? (
					readFailure ? (
						<div className="flex flex-col items-start gap-8">
							<p role="alert" data-testid="mcp-error" className="text-text-muted tr-text-ui">
								{t("mcp.settings.readFailed", { error: readFailure })}
							</p>
							<Button
								variant="outline"
								size="m"
								tabIndex={0}
								data-testid="mcp-retry"
								onClick={onRetry}
							>
								{t("common.retry")}
							</Button>
						</div>
					) : (
						<SkeletonRows rows={3} label={t("mcp.settings.loading")} />
					)
				) : (
					<SettingsGroup
						testId="mcp-user-servers"
						title={userLabel}
						scope="allProjects"
						description={t("mcp.settings.userGroupDescription")}
					>
						{userRows.length > 0 ? (
							serverList(
								USER_LIST,
								userLabel,
								SETTING.mcpUserServers.id,
								"mcp-server-list",
								userRows,
							)
						) : (
							<div data-setting-id={SETTING.mcpUserServers.id}>
								<McpEmptyState
									disabled={readOnly}
									focusList={USER_LIST}
									settingId={servers.length === 0 ? SETTING.mcpAdd.id : undefined}
									onAdd={() => openAdd("form")}
									onImport={() => openAdd("json")}
									onPreset={(preset) => openAdd("form", preset)}
								/>
							</div>
						)}
						{inProject ? null : (
							<p
								data-testid="mcp-project-servers-hint"
								className="pt-8 text-text-muted tr-text-metadata"
							>
								{t("mcp.settings.projectServersHint")}
							</p>
						)}
					</SettingsGroup>
				)}
				{servers !== null && inProject ? (
					<SettingsGroup
						testId="mcp-project-servers"
						title={projectLabel}
						scope="project"
						description={t("mcp.settings.projectGroupDescription")}
					>
						{!trusted ? (
							<p data-testid="mcp-untrusted" className="py-8 text-text-muted tr-text-metadata">
								{t("mcp.settings.untrusted")}
							</p>
						) : projectRows.length > 0 ? (
							serverList(
								PROJECT_LIST,
								projectLabel,
								SETTING.mcpProjectServers.id,
								"mcp-project-server-list",
								projectRows,
							)
						) : (
							<p
								data-testid="mcp-project-empty"
								data-setting-id={SETTING.mcpProjectServers.id}
								className="py-8 text-text-muted tr-text-metadata"
							>
								{t("mcp.settings.projectEmpty")}
							</p>
						)}
					</SettingsGroup>
				) : null}
			</SettingsPage>
			{adding ? (
				<McpAddDialog
					key={adding.key}
					open
					initialTier={adding.tier}
					initialPreset={adding.preset}
					existing={servers ?? []}
					projectScopeAvailable={trusted}
					userOnly={!inProject}
					onOpenChange={(open) => {
						if (!open) setAdding(null);
					}}
					onAdd={async (added, scope) => {
						setFeedback(null);
						const { results, last } = await addServers(ops, added, scope);
						if (last) setFeedback(ops.feedback(last));
						return results;
					}}
					onEnableInProject={
						workspaceId === undefined
							? undefined
							: async (name) => {
									const outcome = await settle(() =>
										requestMcpList("mcp.setProjectOverride", { workspaceId, name, enabled: true }),
									);
									if (!outcome.ok) {
										const key = `user:${name}`;
										setRowErrors((previous) => ({
											...previous,
											[key]: {
												text: t("mcp.settings.enableInProjectFailed", { error: outcome.error }),
											},
										}));
									} else setFeedback(ops.feedback(outcome.value));
								}
					}
				/>
			) : null}
			{editing && workspaceId !== undefined ? (
				<McpEditDialog
					key={editing.summary.name}
					target={editing}
					onClose={() => setEditing(null)}
					onSave={async (entry) => {
						const outcome = await settle(() =>
							refreshOnFailure(workspaceId, () =>
								requestMcpList("mcp.update", mcpEntryUpdate(workspaceId, editing.summary, entry)),
							),
						);
						if (!outcome.ok) return outcome.error;
						setFeedback(ops.feedback(outcome.value));
						return null;
					}}
				/>
			) : null}
			{approving && workspaceId !== undefined ? (
				<McpApproveDialog
					key={approving.summary.name}
					target={approving}
					onClose={() => setApproving(null)}
					onApprove={async () => {
						const outcome = await settle(() => approveMcpServer(workspaceId, approving.summary));
						if (!outcome.ok) return outcome.error;
						setFeedback(ops.feedback(outcome.value));
						return null;
					}}
				/>
			) : null}
			{detailRow ? (
				<McpDetailsDialog
					row={detailRow}
					view={ops.view(t, detailRow, now)}
					onClose={() => setDetails(null)}
				/>
			) : null}
			{log && logRow ? (
				<McpLogDialog row={logRow} read={log.read} onClose={() => setLog(null)} />
			) : null}
			<ConfirmDialog
				open={removing !== null}
				onOpenChange={(open) => {
					if (!open) setRemoving(null);
				}}
				title={t("mcp.remove.title", { name: removing?.summary.name ?? "" })}
				description={
					removing ? t("mcp.remove.description", { source: removing.summary.source }) : undefined
				}
				confirmLabel={t("common.remove")}
				destructive
				confirmTestId="mcp-remove-confirm"
				onConfirm={() => {
					const row = removing;
					if (!row) return;
					void run(row, () => ops.remove(row.summary));
				}}
			/>
			{mcpLogin?.target ? (
				<LoginDialog
					key={mcpLogin.loginId}
					state={mcpLogin}
					providerName={mcpLogin.target.serverName}
					onReply={(value) => {
						getTransport()
							.request("provider.loginReply", { loginId: mcpLogin.loginId, value })
							.catch((err) => toast.error(errorText(err), t("mcp.login.submitFailed")));
						useAppStore.getState().clearLoginInput();
					}}
					onCancel={() => {
						getTransport()
							.request("provider.loginCancel", { loginId: mcpLogin.loginId })
							.catch(() => {});
						useAppStore.getState().clearLogin();
					}}
					onClose={() => {
						useAppStore.getState().clearLogin();
						void ops.reread().catch(() => {});
					}}
				/>
			) : null}
		</>
	);
}
