import {
	RiCheckLine as Check,
	RiArrowDownSLine as ChevronDown,
	RiCloseLine as Close,
	RiMore2Line as MoreVertical,
	RiAddLine as Plus,
	RiShieldCheckLine as ShieldCheck,
	RiAlertLine as TriangleAlert,
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
import { currentTranslator, t as translate, useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { SkeletonRows } from "@thinkrail/ui/skeleton";
import { Switch } from "@thinkrail/ui/switch";
import { IconTooltip } from "@thinkrail/ui/tooltip";
import { cn } from "@thinkrail/ui/utils";
import { useEffect, useMemo, useState } from "react";
import { LoginDialog } from "@/auth";
import { useNow } from "@/components/useNow";
import type { McpStateTone } from "@/lib";
import {
	deriveMcpServerRows,
	type McpRowState,
	type McpServerRow,
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
	SCOPE_LABEL,
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
} from "./mcpServerView";
import { startChatInTab } from "./openChat";

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

const CHIP_CLASS =
	"shrink-0 rounded-xs border border-border-default px-4 tr-text-label-pill text-text-muted";

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

async function addServers(
	workspaceId: string,
	servers: { name: string; entry: McpServerEntryInput }[],
	scope: McpServerScope,
): Promise<{ results: McpAddResult[]; last: McpListResult | null }> {
	const results: McpAddResult[] = [];
	let last: McpListResult | null = null;
	for (const server of servers) {
		const outcome = await settle(() =>
			requestMcpList("mcp.add", { workspaceId, scope, name: server.name, entry: server.entry }),
		);
		results.push({ name: server.name, error: outcome.ok ? null : outcome.error });
		if (outcome.ok) last = outcome.value;
	}
	return { results, last };
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

export function setMcpServerEnabled(
	workspaceId: string,
	row: McpServerRow,
	enabled: boolean,
): Promise<McpListResult> {
	return writeSetting(workspaceId, row, { enabled });
}

type McpRowCommand =
	| { kind: "toggle"; enabled: boolean }
	| { kind: "exposure"; exposure: McpEditableExposure }
	| { kind: "revoke-tool"; tool: string }
	| { kind: McpRowAction | "sign-out" | "remove" | "share" | "details" };

export function lockedSettings(row: McpServerRow): boolean {
	return (
		row.state === "pending-approval" ||
		row.state === "invalid-config" ||
		row.state === "replaced" ||
		row.state === "handled-elsewhere"
	);
}

export function McpServerRowView({
	row,
	view,
	readOnly,
	busy,
	error,
	onCommand,
}: {
	row: McpServerRow;
	view: McpRowView;
	readOnly: boolean;
	busy: boolean;
	error: string | undefined;
	onCommand: (command: McpRowCommand) => void;
}) {
	const t = useT();
	const { summary } = row;
	const inert = readOnly || busy;
	const settingsDisabled = inert || lockedSettings(row);
	const pendingProject = summary.scope === "project" && row.state === "pending-approval";
	const { action, secondary } = view;
	return (
		<li
			data-testid="mcp-server-row"
			data-name={summary.name}
			data-scope={summary.scope}
			data-state={row.state}
			data-attention={row.attention || undefined}
			className="flex flex-col gap-4 rounded-sm border border-border-default bg-control-bg px-12 py-8"
		>
			<div className="flex flex-wrap items-center gap-8">
				<div className="flex min-w-[12rem] flex-1 flex-col gap-2">
					<div className="flex min-w-0 flex-wrap items-center gap-x-8 gap-y-4">
						<span
							className="min-w-0 max-w-full truncate tr-title-compact text-text-default"
							title={summary.name}
						>
							{summary.name}
						</span>
						<span data-testid="mcp-server-scope" className={CHIP_CLASS}>
							{t(SCOPE_LABEL[summary.scope])}
						</span>
						{summary.transport === "stdio" ? (
							<IconTooltip label={t("mcp.server.stdioTooltip")} wrapTrigger>
								<span data-testid="mcp-server-transport" className={CHIP_CLASS}>
									{t("mcp.transport.stdio")}
									<span className="sr-only">{` ${t("mcp.server.stdioSrOnly")}`}</span>
								</span>
							</IconTooltip>
						) : (
							<span data-testid="mcp-server-transport" className={CHIP_CLASS}>
								{t("mcp.transport.http")}
							</span>
						)}
						<ExposureMenu
							summary={summary}
							disabled={settingsDisabled}
							onChange={(exposure) => onCommand({ kind: "exposure", exposure })}
						/>
					</div>
					<div className="flex min-w-0 items-center gap-4 tr-text-metadata">
						<span aria-hidden className={cn("size-6 shrink-0 rounded-full", TONE_DOT[view.tone])} />
						<span
							data-testid="mcp-server-status"
							className={cn("shrink-0 whitespace-nowrap", TONE_TEXT[view.tone])}
						>
							{view.label}
						</span>
						{view.reason ? (
							<span className="min-w-0 truncate text-text-muted" title={view.reason}>
								· {view.reason}
							</span>
						) : null}
					</div>
				</div>
				<div className="ml-auto flex shrink-0 items-center gap-8">
					{secondary ? (
						<Button
							variant="ghost"
							size="m"
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
							data-testid="mcp-server-action"
							data-action={action}
							disabled={inert}
							onClick={() => onCommand({ kind: action })}
						>
							{t(ACTION_LABEL[action])}
						</Button>
					) : null}
					<Switch
						checked={summary.enabled}
						label={t(
							summary.scope === "user"
								? summary.enabled
									? "mcp.server.disableInProject"
									: "mcp.server.enableInProject"
								: summary.enabled
									? "mcp.server.disable"
									: "mcp.server.enable",
							{ name: summary.name },
						)}
						testId="mcp-server-toggle"
						disabled={settingsDisabled}
						onCheckedChange={(enabled) => onCommand({ kind: "toggle", enabled })}
					/>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<IconButton
								icon={MoreVertical}
								label={t("mcp.server.more", { name: summary.name })}
								data-testid="mcp-server-menu"
							/>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
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
							{summary.scope === "user" && summary.projectOverride ? (
								<DropdownMenuItem
									data-testid="mcp-menu-share"
									disabled={inert}
									onSelect={() => onCommand({ kind: "share" })}
								>
									{t("mcp.menu.share")}
								</DropdownMenuItem>
							) : null}
							<DropdownMenuItem
								data-testid="mcp-menu-details"
								onSelect={() => onCommand({ kind: "details" })}
							>
								{t("mcp.menu.details")}
							</DropdownMenuItem>
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
					</DropdownMenu>
				</div>
			</div>
			{summary.alwaysAllowed && summary.alwaysAllowed.length > 0 ? (
				<div
					data-testid="mcp-always-allowed"
					className="flex flex-wrap items-center gap-4 text-text-muted tr-text-metadata"
				>
					<span className="shrink-0">{t("mcp.server.alwaysAllowed")}</span>
					{summary.alwaysAllowed.map(({ tool, label }) => (
						<span
							key={tool}
							data-testid="mcp-always-allowed-tool"
							data-tool={tool}
							className="flex min-w-0 items-center gap-2 rounded-xs border border-border-default pl-4 text-text-default"
						>
							<span className="min-w-0 truncate" title={tool}>
								{label}
							</span>
							<IconButton
								icon={Close}
								label={t("mcp.server.revokeTool", { tool: label })}
								size="s"
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
					className="whitespace-pre-line break-words text-feedback-error tr-text-metadata"
				>
					{error}
				</p>
			) : null}
		</li>
	);
}

function ExposureMenu({
	summary,
	disabled,
	onChange,
}: {
	summary: McpServerRow["summary"];
	disabled: boolean;
	onChange: (exposure: McpEditableExposure) => void;
}) {
	const t = useT();
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					data-testid="mcp-server-exposure"
					data-exposure={summary.effectiveExposure}
					aria-label={t("mcp.exposure.menuAria", { exposure: summary.effectiveExposure })}
					disabled={disabled}
					className={cn(
						CHIP_CLASS,
						"inline-flex items-center gap-2 outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary disabled:text-control-disabled-text disabled:hover:bg-transparent",
					)}
				>
					{mcpExposureLabel(t, summary.effectiveExposure)}
					<ChevronDown className="size-12" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="max-w-[20rem]">
				<DropdownMenuLabel>
					{summary.scope === "user"
						? t("mcp.exposure.menuTitleInProject")
						: t("mcp.exposure.menuTitle")}
				</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					value={summary.effectiveExposure}
					onValueChange={(value) => {
						const exposure = MCP_EXPOSURES.find((candidate) => candidate === value);
						if (exposure && exposure !== summary.effectiveExposure) onChange(exposure);
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
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function McpIntro({ projectName }: { projectName: string | undefined }) {
	const t = useT();
	return (
		<div className="flex flex-col gap-4">
			<h3 className="tr-title-section text-text-default">{t("mcp.settings.title")}</h3>
			<p className="text-text-muted tr-text-metadata">
				{projectName === undefined
					? t("mcp.settings.introThisProject")
					: t("mcp.settings.intro", { project: projectName })}
			</p>
		</div>
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
				<li
					key={source}
					role="alert"
					data-testid="mcp-config-error"
					data-source={source}
					className="flex items-start gap-8 rounded-sm border border-border-default border-l-[3px] border-l-feedback-error bg-feedback-error-subtle px-12 py-8 text-text-default tr-text-metadata"
				>
					<TriangleAlert className="mt-2 size-14 shrink-0 text-feedback-error" />
					<span className="flex min-w-0 flex-col gap-2">
						<span className="break-all">{t("mcp.configError.problemIn", { source })}</span>
						{messages.map((message) => (
							<span key={message} className="break-words text-text-muted">
								{message}
							</span>
						))}
						<span className="text-text-muted">{t("mcp.configError.hint")}</span>
					</span>
				</li>
			))}
		</ul>
	);
}

export function McpConfirmBanner() {
	const t = useT();
	return (
		<p
			data-testid="mcp-confirm-banner"
			className="flex items-center gap-8 rounded-sm border border-border-default bg-feedback-info-subtle px-12 py-8 text-text-default tr-text-metadata"
		>
			<ShieldCheck className="size-14 shrink-0 text-feedback-info" />
			{t("mcp.settings.confirmBanner")}
		</p>
	);
}

export function McpEmptyState({
	disabled,
	onAdd,
	onImport,
	onPreset,
}: {
	disabled: boolean;
	onAdd: () => void;
	onImport: () => void;
	onPreset: (preset: McpPreset) => void;
}) {
	const t = useT();
	return (
		<div
			data-testid="mcp-empty"
			className="flex flex-col items-start gap-12 rounded-sm border border-border-default bg-control-bg px-16 py-16"
		>
			<p className="tr-text-ui text-text-default">{t("mcp.empty.title")}</p>
			{MCP_PRESETS.length > 0 ? (
				<ul className="flex w-full flex-col gap-4" data-testid="mcp-empty-presets">
					{MCP_PRESETS.map((preset) => (
						<li key={preset.id} className="flex items-center gap-8">
							<span className="flex min-w-0 flex-1 flex-col">
								<span className="tr-title-compact text-text-default">{t(preset.title)}</span>
								<span className="truncate text-text-muted tr-text-metadata">
									{t(preset.description)}
								</span>
							</span>
							<Button
								variant="outline"
								size="m"
								iconLeft={Plus}
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
					data-testid="mcp-empty-add"
					disabled={disabled}
					onClick={onAdd}
				>
					{t("mcp.empty.add")}
				</Button>
				<Button
					variant="outline"
					size="m"
					data-testid="mcp-empty-import"
					disabled={disabled}
					onClick={onImport}
				>
					{t("mcp.empty.import")}
				</Button>
			</div>
			<p className="text-text-muted tr-text-metadata">{t("mcp.hostNotice")}</p>
		</div>
	);
}

export function McpSettings() {
	const t = useT();
	const workspace = useAppStore(selectActiveWorkspace);
	if (!workspace) {
		return (
			<section data-testid="settings-mcp" className="flex flex-col gap-16">
				<McpIntro projectName={undefined} />
				<p data-testid="mcp-no-workspace" className="text-text-muted tr-text-ui">
					{t("mcp.settings.noWorkspace")}
				</p>
			</section>
		);
	}
	return <McpWorkspaceSettings key={workspace.id} workspace={workspace} />;
}

type AddRequest = { tier: "form" | "json"; preset?: McpPreset; key: number };

function McpWorkspaceSettings({ workspace }: { workspace: Workspace }) {
	const t = useT();
	const workspaceId = workspace.id;
	const project = useAppStore((s) => s.projects.find((p) => p.id === workspace.projectId));
	const projection = useAppStore((s) => s.mcpByWorkspace[workspaceId]);
	const connected = useAppStore((s) => s.status === "connected");
	const welcome = useAppStore((s) => s.welcomeGeneration);
	const activeLogin = useAppStore((s) => s.activeLogin);
	const loginBusy = useAppStore(selectLoginBusy);
	const now = useNow();
	const trusted = project?.piResourceTrust === "granted";
	const rows = useMemo(
		() =>
			deriveMcpServerRows(projection, now).filter(
				(row) => trusted || row.summary.scope !== "project",
			),
		[projection, now, trusted],
	);
	const [readFailure, setReadFailure] = useState<string | null>(null);
	const [readAttempt, setReadAttempt] = useState(0);
	const [busy, setBusy] = useState<Record<string, true>>({});
	const [rowErrors, setRowErrors] = useState<Record<string, RowError>>({});
	const [feedback, setFeedback] = useState<string | null>(null);
	const [adding, setAdding] = useState<AddRequest | null>(null);
	const [editing, setEditing] = useState<McpEditTarget | null>(null);
	const [approving, setApproving] = useState<McpApproveTarget | null>(null);
	const [details, setDetails] = useState<string | null>(null);
	const [removing, setRemoving] = useState<McpServerRow | null>(null);
	const [log, setLog] = useState<{ key: string; read: McpLogRead } | null>(null);

	useEffect(() => {
		if (!connected) return;
		return watchMcpWorkspace(workspaceId, (error) =>
			setReadFailure(error === null ? null : errorText(error)),
		);
	}, [workspaceId, connected, welcome, trusted, readAttempt]);

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
	const mcpLogin =
		activeLogin?.target?.kind === "mcp" && activeLogin.target.workspaceId === workspaceId
			? activeLogin
			: null;

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
		} else if (outcome.value) setFeedback(mcpSaveFeedback(outcome.value));
	};

	const runInChats = (row: McpServerRow, request: (sessionId: string) => Promise<unknown>) =>
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
							workspaceId,
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
		const outcome = await settle(() =>
			getTransport().request("mcp.readLog", { workspaceId, name: row.summary.name }),
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
		return run(row, () =>
			Promise.resolve()
				.then(async () => {
					const name = row.summary.name;
					if (method === "mcp.logout") {
						await getTransport().request(method, { workspaceId, name });
						toast.success(t("mcp.toast.signedOut", { name }));
						return requestMcpList("mcp.list", { workspaceId });
					}
					const { loginId } = await getTransport().request(method, { workspaceId, name });
					if (useAppStore.getState().removedWorkspaceIds[workspaceId]) {
						void getTransport()
							.request("provider.loginCancel", { loginId })
							.catch(() => {});
						return null;
					}
					useAppStore
						.getState()
						.beginLogin(loginId, `mcp:${name}`, { kind: "mcp", workspaceId, serverName: name });
					return null;
				})
				.finally(() => useAppStore.getState().finishLoginStart()),
		);
	};

	const projectTrustedNow = () =>
		useAppStore.getState().projects.find((p) => p.id === workspace.projectId)?.piResourceTrust ===
		"granted";

	const openEdit = async (row: McpServerRow) => {
		if (row.summary.scope !== "project") return;
		const read = await settle(() => readProjectEntry(workspaceId, row.summary.name));
		if (!projectTrustedNow()) return;
		if (read.ok) setEditing({ summary: row.summary, entry: read.value });
		else setRowErrors((previous) => ({ ...previous, [row.key]: { text: read.error } }));
	};

	const openReview = async (row: McpServerRow) => {
		const read = await settle(() => readProjectEntry(workspaceId, row.summary.name));
		if (!projectTrustedNow()) return;
		setApproving({
			summary: row.summary,
			entry: read.ok ? read.value : null,
			readError: read.ok ? null : read.error,
		});
	};

	const onCommand = (row: McpServerRow, command: McpRowCommand) => {
		const name = row.summary.name;
		switch (command.kind) {
			case "toggle":
				void run(row, () => writeSetting(workspaceId, row, { enabled: command.enabled }));
				return;
			case "exposure":
				void run(row, () => writeSetting(workspaceId, row, { exposure: command.exposure }));
				return;
			case "revoke-tool":
				void run(row, () =>
					refreshOnFailure(workspaceId, () =>
						requestMcpList("mcp.revokeToolGrant", { workspaceId, name, tool: command.tool }),
					),
				);
				return;
			case "sign-in":
				void startProbe(row, "mcp.login");
				return;
			case "test-connection":
				void startProbe(row, "mcp.testConnection");
				return;
			case "reconnect":
				void runInChats(row, (sessionId) =>
					getTransport().request("mcp.reconnect", { workspaceId, sessionId, name }),
				);
				return;
			case "reload":
				void runInChats(row, async (sessionId) => {
					const { syncedTick } = await reloadSessionResourcesWithSkillBaseline(workspaceId, {
						sessionId,
					});
					useAppStore.getState().markSkillsSynced(sessionId, syncedTick);
				});
				return;
			case "open-chat":
				useAppStore.getState().closeSettings();
				void startChatInTab(workspaceId);
				return;
			case "show-log":
				void openLog(row);
				return;
			case "sign-out":
				void startProbe(row, "mcp.logout");
				return;
			case "share":
				void run(row, () =>
					refreshOnFailure(workspaceId, () =>
						requestMcpList("mcp.shareWithRepo", { workspaceId, name }),
					),
				);
				return;
			case "remove":
				setRemoving(row);
				return;
			case "details":
				setDetails(row.key);
				return;
			case "edit":
				void openEdit(row);
				return;
			case "review":
				void openReview(row);
				return;
		}
	};

	const detailRow = rows.find((row) => row.key === details);
	const logRow = log ? rows.find((row) => row.key === log.key) : undefined;
	return (
		<section data-testid="settings-mcp" className="flex flex-col gap-16">
			<div className="flex items-start justify-between gap-8">
				<McpIntro projectName={project?.name} />
				{servers && servers.length > 0 ? (
					<Button
						variant="primary"
						size="m"
						iconLeft={Plus}
						data-testid="mcp-add"
						disabled={readOnly}
						onClick={() => setAdding({ tier: "form", key: Date.now() })}
					>
						{t("mcp.settings.addServer")}
					</Button>
				) : null}
			</div>
			<McpConfirmBanner />
			{handledElsewhere ? (
				<p
					data-testid="mcp-handled-elsewhere"
					className="flex items-start gap-8 rounded-sm border border-border-default border-l-[3px] border-l-feedback-warning bg-feedback-warning-subtle px-12 py-8 text-text-default tr-text-metadata"
				>
					<TriangleAlert className="mt-2 size-14 shrink-0 text-feedback-warning" />
					{mcpHandledElsewhereText(t, handledElsewhere.by)}
				</p>
			) : null}
			{!trusted ? (
				<p data-testid="mcp-untrusted" className="text-text-muted tr-text-metadata">
					{t("mcp.settings.untrusted")}
				</p>
			) : null}
			<McpConfigFileErrors errors={configErrors} />
			{feedback ? (
				<p role="status" data-testid="mcp-feedback" className="text-text-muted tr-text-metadata">
					{feedback}
				</p>
			) : null}
			{servers === null ? (
				readFailure ? (
					<div className="flex flex-col items-start gap-8">
						<p role="alert" data-testid="mcp-error" className="text-text-muted tr-text-ui">
							{t("mcp.settings.readFailed", { error: readFailure })}
						</p>
						<Button
							variant="outline"
							size="m"
							data-testid="mcp-retry"
							onClick={() => setReadAttempt((attempt) => attempt + 1)}
						>
							{t("common.retry")}
						</Button>
					</div>
				) : (
					<SkeletonRows rows={3} label={t("mcp.settings.loading")} />
				)
			) : servers.length === 0 ? (
				<McpEmptyState
					disabled={readOnly}
					onAdd={() => setAdding({ tier: "form", key: Date.now() })}
					onImport={() => setAdding({ tier: "json", key: Date.now() })}
					onPreset={(preset) => setAdding({ tier: "form", preset, key: Date.now() })}
				/>
			) : (
				<ul className="flex flex-col gap-4" data-testid="mcp-server-list">
					{rows.map((row) => (
						<McpServerRowView
							key={row.key}
							row={row}
							view={mcpRowView(t, row, now)}
							readOnly={readOnly}
							busy={!!busy[row.key] || loginBusy}
							error={rowErrorText(rowErrors[row.key], row.state)}
							onCommand={(command) => onCommand(row, command)}
						/>
					))}
				</ul>
			)}

			{adding ? (
				<McpAddDialog
					key={adding.key}
					open
					initialTier={adding.tier}
					initialPreset={adding.preset}
					existing={servers ?? []}
					projectScopeAvailable={trusted}
					onOpenChange={(open) => {
						if (!open) setAdding(null);
					}}
					onAdd={async (servers, scope) => {
						setFeedback(null);
						const { results, last } = await addServers(workspaceId, servers, scope);
						if (last) setFeedback(mcpSaveFeedback(last));
						return results;
					}}
					onEnableInProject={async (name) => {
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
						} else setFeedback(mcpSaveFeedback(outcome.value));
					}}
				/>
			) : null}
			{editing ? (
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
						setFeedback(mcpSaveFeedback(outcome.value));
						return null;
					}}
				/>
			) : null}
			{approving ? (
				<McpApproveDialog
					key={approving.summary.name}
					target={approving}
					onClose={() => setApproving(null)}
					onApprove={async () => {
						const outcome = await settle(() => approveMcpServer(workspaceId, approving.summary));
						if (!outcome.ok) return outcome.error;
						setFeedback(mcpSaveFeedback(outcome.value));
						return null;
					}}
				/>
			) : null}
			{detailRow ? (
				<McpDetailsDialog
					row={detailRow}
					view={mcpRowView(t, detailRow, now)}
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
					void run(row, () =>
						refreshOnFailure(workspaceId, () =>
							requestMcpList("mcp.remove", {
								workspaceId,
								name: row.summary.name,
								...mcpRenderedTarget(row.summary),
							}),
						),
					);
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
						void requestMcpList("mcp.list", { workspaceId }).catch(() => {});
					}}
				/>
			) : null}
		</section>
	);
}
