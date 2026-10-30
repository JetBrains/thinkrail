import {
	RiExternalLinkLine as ExternalLink,
	RiPlayLine as Play,
	RiRobot2Line as Robot,
	RiSparklingLine as Sparkling,
	RiStarFill as StarFill,
	RiStarLine as StarLine,
	RiStopLine as Stop,
	RiTerminalBoxLine as Terminal,
} from "@remixicon/react";
import type { ProjectRun, RunExecution, RunTarget, Workspace } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@thinkrail/ui/dialog";
import { Textarea } from "@thinkrail/ui/textarea";
import { cn } from "@thinkrail/ui/utils";
import { useState } from "react";
import { useNow } from "../components/useNow";
import { relativeTime } from "../lib";
import { executionForTarget, isLiveRun, selectSupportsRun, useAppStore } from "../store";
import { errorText, getTransport, wsErrorCode } from "../transport";
import { failed, runAvailable, statusChip, targetName } from "./runActions";
import { SettingsSwitch } from "./SettingsSwitch";
import { useRunHydration } from "./useRunHydration";
import { useRunRunner } from "./useRunRunner";

const CHIP_TONE: Record<ReturnType<typeof statusChip>["tone"], string> = {
	neutral: "bg-control-bg-selected text-text-muted",
	success: "bg-feedback-success-subtle text-feedback-success",
	warning: "bg-feedback-warning-subtle text-feedback-warning",
	info: "bg-feedback-info-subtle text-feedback-info",
};

function Section({
	title,
	action,
	children,
	testId,
}: {
	title: string;
	action?: React.ReactNode;
	children: React.ReactNode;
	testId?: string;
}) {
	return (
		<section
			data-testid={testId}
			className="flex flex-col gap-6 border-border-muted border-b px-12 py-10"
		>
			<header className="flex h-20 items-center justify-between gap-8">
				<h3 className="truncate tr-text-metadata text-text-subtle uppercase tracking-wide">
					{title}
				</h3>
				{action}
			</header>
			{children}
		</section>
	);
}

function StatusChip({ execution }: { execution: RunExecution }) {
	const t = useT();
	const chip = statusChip(t, execution);
	return (
		<span
			data-testid="run-target-status"
			data-status={execution.status}
			className={cn(
				"inline-flex h-20 shrink-0 items-center gap-4 whitespace-nowrap rounded-full px-8 tr-text-emphasis",
				CHIP_TONE[chip.tone],
			)}
		>
			{chip.label}
		</span>
	);
}

function TargetRow({
	target,
	primary,
	execution,
	workspaceId,
	onSetPrimary,
}: {
	target: RunTarget;
	primary: boolean;
	execution: RunExecution | null;
	workspaceId: string;
	onSetPrimary: () => void;
}) {
	const t = useT();
	const runner = useRunRunner(workspaceId, null);
	const live = execution !== null && isLiveRun(execution);
	const port = execution?.ports[target.ports?.[0] ?? ""];
	return (
		<li
			data-testid="run-target"
			data-target={target.id}
			className="flex items-center gap-8 rounded-sm px-4 py-4 hover:bg-control-bg-hovered"
		>
			<IconButton
				variant="ghost"
				size="s"
				icon={primary ? StarFill : StarLine}
				label={primary ? t("panels.run.panel.primary") : t("panels.run.panel.setPrimary")}
				data-testid="run-target-primary"
				data-primary={primary}
				className={cn(primary ? "text-primary" : "text-text-subtle")}
				onClick={onSetPrimary}
			/>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate tr-text-emphasis text-text-default">{targetName(target)}</span>
				<span className="truncate font-mono tr-text-metadata text-text-subtle">
					{target.command}
					{target.kind === "task" ? ` · ${t("panels.run.panel.oneShot")}` : ""}
					{port !== undefined ? ` · :${port}` : ""}
				</span>
			</span>
			{execution ? <StatusChip execution={execution} /> : null}
			{execution?.status === "listening" && execution.url ? (
				<IconButton
					variant="ghost"
					size="s"
					icon={ExternalLink}
					label={t("panels.run.open")}
					data-testid="run-target-open"
					onClick={() => runner.openUrl(execution.url ?? "")}
				/>
			) : null}
			{execution ? (
				<IconButton
					variant="ghost"
					size="s"
					icon={Terminal}
					label={t("panels.run.showTerminal")}
					data-testid="run-target-terminal"
					onClick={() => runner.run({ kind: "showTerminal", tabKey: execution.tabKey })}
				/>
			) : null}
			{live ? (
				<IconButton
					variant="ghost"
					size="s"
					icon={Stop}
					label={t("panels.run.stop")}
					data-testid="run-target-stop"
					disabled={execution.status === "stopping"}
					onClick={() => runner.run({ kind: "stop", targetId: target.id })}
				/>
			) : (
				<IconButton
					variant="ghost"
					size="s"
					icon={Play}
					label={t("panels.run.start.label", { target: targetName(target) })}
					data-testid="run-target-start"
					onClick={() => runner.run({ kind: "start", targetId: target.id, prepare: true })}
				/>
			)}
		</li>
	);
}

function RecipeEditor({
	projectId,
	run,
	onClose,
}: {
	projectId: string;
	run: ProjectRun;
	onClose: () => void;
}) {
	const t = useT();
	const [text, setText] = useState(() =>
		JSON.stringify(run.document?.recipe ?? template(), null, 2),
	);
	const [errors, setErrors] = useState<string[]>([]);
	const [conflict, setConflict] = useState(false);
	const [saving, setSaving] = useState(false);
	const revision = run.document?.revision ?? 0;

	const save = async () => {
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch (error) {
			setErrors([t("panels.run.editor.invalidJson", { error: errorText(error) })]);
			return;
		}
		setSaving(true);
		const outcome = await getTransport()
			.request("run.setRecipe", { projectId, recipe: parsed, expectedRevision: revision })
			.then(() => null)
			.catch((error: unknown) => error);
		setSaving(false);
		if (outcome === null) {
			onClose();
			return;
		}
		if (wsErrorCode(outcome) === "RUN_RECIPE_CONFLICT") {
			setConflict(true);
			setErrors([]);
		} else {
			setConflict(false);
			setErrors(errorText(outcome).split("; "));
		}
	};

	return (
		<Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
			<DialogContent data-testid="run-recipe-editor" className="max-w-2xl">
				<DialogHeader>
					<DialogTitle>{t("panels.run.editor.title")}</DialogTitle>
					<DialogDescription>{t("panels.run.editor.description")}</DialogDescription>
				</DialogHeader>
				<Textarea
					data-testid="run-recipe-text"
					value={text}
					onChange={(event) => setText(event.target.value)}
					spellCheck={false}
					className="min-h-[320px] resize-y font-mono tr-text-metadata"
				/>
				{conflict ? (
					<p data-testid="run-recipe-conflict" className="tr-text-metadata text-feedback-warning">
						{t("panels.run.editor.conflict")}
					</p>
				) : null}
				{errors.length > 0 ? (
					<ul
						data-testid="run-recipe-errors"
						className="flex flex-col gap-2 tr-text-metadata text-feedback-error"
					>
						{errors.map((error) => (
							<li key={error}>{error}</li>
						))}
					</ul>
				) : null}
				<DialogFooter>
					<Button variant="ghost" size="m" onClick={onClose}>
						{t("panels.run.editor.cancel")}
					</Button>
					<Button
						size="m"
						data-testid="run-recipe-save"
						loading={saving}
						onClick={() => void save()}
					>
						{t("panels.run.editor.save")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function template(): unknown {
	return {
		version: 1,
		ports: { PORT: 3000 },
		prepare: [],
		targets: [
			{
				id: "dev",
				command: "npm run dev",
				kind: "serve",
				ports: ["PORT"],
				url: `http://localhost:\${PORT}/`,
			},
		],
		primary: "dev",
	};
}

export function RunPanel({ workspace }: { workspace: Workspace }) {
	const t = useT();
	const now = useNow();
	const supported = useAppStore(selectSupportsRun);
	const hostPlatform = useAppStore((state) => state.hostPlatform);
	const run = useAppStore((state) => state.runByProject[workspace.projectId]);
	const state = useAppStore((s) => s.runByWorkspace[workspace.id]);
	useRunHydration(workspace.id, workspace.projectId);
	const runner = useRunRunner(workspace.id, workspace.projectId);
	const [editing, setEditing] = useState(false);
	const pushToast = useAppStore((s) => s.pushToast);

	if (!runAvailable({ supported, hostPlatform })) {
		return (
			<p data-testid="run-panel-unavailable" className="p-12 tr-text-ui text-text-muted">
				{hostPlatform === "win32" ? t("panels.run.panel.windows") : t("panels.run.panel.olderHost")}
			</p>
		);
	}
	const document = run?.document ?? null;
	if (!run || !document) {
		return (
			<div data-testid="run-panel-empty" className="flex flex-col gap-12 p-12">
				<p className="tr-text-ui text-text-muted">{t("panels.run.panel.empty")}</p>
				<div>
					<Button
						size="m"
						iconLeft={Sparkling}
						data-testid="run-panel-setup"
						onClick={() => runner.run({ kind: "setUp" })}
					>
						{t("panels.run.setUp.label")}
					</Button>
				</div>
			</div>
		);
	}
	const { recipe } = document;
	const assigned = run.ports[workspace.id] ?? {};
	const prepareExecution = executionForTarget(state, null);
	const latestFailed = state?.executions.find((execution) => failed(execution)) ?? null;
	const setPrimary = (targetId: string) => {
		if (targetId === recipe.primary) return;
		void getTransport()
			.request("run.setPrimary", {
				projectId: workspace.projectId,
				targetId,
				expectedRevision: document.revision,
			})
			.catch((error) =>
				pushToast({
					variant: "error",
					title: t("panels.run.panel.setPrimaryFailed"),
					message: errorText(error),
				}),
			);
	};
	const setSetting = (patch: Partial<ProjectRun["settings"]>) => {
		void getTransport()
			.request("run.setSettings", { projectId: workspace.projectId, settings: patch })
			.catch((error) =>
				pushToast({
					variant: "error",
					title: t("panels.run.panel.settingsFailed"),
					message: errorText(error),
				}),
			);
	};

	return (
		<div data-testid="run-panel" className="flex flex-col">
			<Section title={t("panels.run.panel.targets")} testId="run-panel-targets">
				<ul className="-mx-4 flex flex-col">
					{recipe.targets.map((target) => (
						<TargetRow
							key={target.id}
							target={target}
							primary={target.id === recipe.primary}
							execution={executionForTarget(state, target.id)}
							workspaceId={workspace.id}
							onSetPrimary={() => setPrimary(target.id)}
						/>
					))}
				</ul>
			</Section>
			<Section
				title={t("panels.run.panel.prepare")}
				testId="run-panel-prepare"
				action={
					<Button
						variant="ghost"
						size="s"
						data-testid="run-panel-prepare-now"
						disabled={prepareExecution !== null && isLiveRun(prepareExecution)}
						onClick={() => runner.run({ kind: "start", targetId: null, prepare: true })}
					>
						{t("panels.run.panel.prepareNow")}
					</Button>
				}
			>
				{recipe.prepare.length === 0 ? (
					<p className="tr-text-metadata text-text-subtle">{t("panels.run.panel.noPrepare")}</p>
				) : (
					<ul className="flex flex-col gap-2">
						{recipe.prepare.map((command) => (
							<li key={command} className="truncate font-mono tr-text-metadata text-text-muted">
								{command}
							</li>
						))}
					</ul>
				)}
				{prepareExecution ? (
					<div className="flex items-center gap-8">
						<StatusChip execution={prepareExecution} />
						<span className="tr-text-metadata text-text-subtle">
							{relativeTime(t, prepareExecution.endedAt ?? prepareExecution.startedAt, now)}
						</span>
					</div>
				) : null}
			</Section>
			<Section
				title={t("panels.run.panel.recipe")}
				testId="run-panel-recipe"
				action={
					<Button
						variant="ghost"
						size="s"
						data-testid="run-panel-edit"
						onClick={() => setEditing(true)}
					>
						{t("panels.run.panel.edit")}
					</Button>
				}
			>
				<dl className="grid grid-cols-[auto_1fr] gap-x-12 gap-y-4 tr-text-metadata">
					<dt className="text-text-subtle">{t("panels.run.panel.ports")}</dt>
					<dd data-testid="run-panel-ports" className="font-mono text-text-default">
						{Object.keys(recipe.ports).length === 0
							? t("panels.run.panel.noPorts")
							: Object.entries(recipe.ports)
									.map(([name, natural]) => `${name}=${assigned[name] ?? natural}`)
									.join(" ")}
					</dd>
					<dt className="text-text-subtle">{t("panels.run.panel.learned")}</dt>
					<dd className="text-text-default">
						{t("panels.run.panel.learnedBy", {
							when: relativeTime(t, document.learnedAt, now),
							who:
								document.learnedBy === "user"
									? t("panels.run.panel.learnedByUser")
									: t("panels.run.panel.learnedByAgent"),
						})}
					</dd>
					{recipe.notes ? (
						<>
							<dt className="text-text-subtle">{t("panels.run.panel.notes")}</dt>
							<dd data-testid="run-panel-notes" className="whitespace-pre-wrap text-text-default">
								{recipe.notes}
							</dd>
						</>
					) : null}
				</dl>
				<div className="flex flex-wrap gap-6">
					<Button
						variant="outline"
						size="s"
						iconLeft={Sparkling}
						data-testid="run-panel-setup-again"
						onClick={() => runner.run({ kind: "setUp" })}
					>
						{t("panels.run.panel.setUpAgain")}
					</Button>
					<Button
						variant="outline"
						size="s"
						iconLeft={Robot}
						data-testid="run-panel-fix"
						onClick={() => runner.run({ kind: "fix", execution: latestFailed })}
					>
						{t("panels.run.fix.label")}
					</Button>
				</div>
			</Section>
			<Section title={t("panels.run.panel.settings")} testId="run-panel-settings">
				<div className="flex items-center justify-between gap-8">
					<span className="tr-text-ui text-text-default">{t("panels.run.panel.autoOpen")}</span>
					<SettingsSwitch
						checked={run.settings.autoOpen}
						label={t("panels.run.panel.autoOpen")}
						testId="run-panel-auto-open"
						onChange={(checked) => setSetting({ autoOpen: checked })}
					/>
				</div>
				<div className="flex items-center justify-between gap-8">
					<span className="tr-text-ui text-text-default">{t("panels.run.panel.agentMayRun")}</span>
					<SettingsSwitch
						checked={run.settings.agentMayRun}
						label={t("panels.run.panel.agentMayRun")}
						testId="run-panel-agent-may-run"
						onChange={(checked) => setSetting({ agentMayRun: checked })}
					/>
				</div>
				<p className="tr-text-metadata text-text-subtle">{t("panels.run.panel.remoteNote")}</p>
			</Section>
			{editing ? (
				<RecipeEditor projectId={workspace.projectId} run={run} onClose={() => setEditing(false)} />
			) : null}
		</div>
	);
}
