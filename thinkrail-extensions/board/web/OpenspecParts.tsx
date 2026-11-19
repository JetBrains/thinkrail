import {
	RiCheckboxBlankLine,
	RiCheckboxCircleLine,
	RiCheckboxLine,
	RiCloseLine,
	RiErrorWarningLine,
	RiExternalLinkLine,
	RiInboxArchiveLine,
	RiPlayLine,
	RiShieldCheckLine,
} from "@remixicon/react";
import type { PanelHost } from "@thinkrail/extension-api/web";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { cn } from "@thinkrail/ui/utils";
import { useState } from "react";
import {
	type ArtifactStatus,
	archiveChange,
	type Card,
	type ChangeValidation,
	canApply,
	canArchive,
	deltaText,
	type OpenspecOverlay,
	type OpenspecStatus,
	openChangeFile,
	startCard,
	validateChange,
} from "./api";
import { FIELD } from "./CardParts";
import { Section } from "./Fields";
import { ARTIFACT_STATUS_LABELS, artifactName, STAGE_LABELS } from "./labels";

/** The command that installs the OpenSpec CLI, shown as is. */
export const INSTALL_COMMAND = "npm install -g @fission-ai/openspec";

const ARTIFACT_LOOKS: Readonly<Record<ArtifactStatus, string>> = {
	done: "bg-feedback-success-subtle text-feedback-success",
	ready: "bg-primary-subtle text-primary",
	blocked: "bg-control-bg-selected text-text-subtle",
	skipped: "bg-control-bg-selected text-text-subtle line-through",
};

/** The artifact chain, P · S · D · T for spec-driven: each artifact's initial, looking its status. */
export function ArtifactChain({ change }: { change: Pick<OpenspecOverlay, "artifacts"> }) {
	const t = useT();
	if (change.artifacts.length === 0) return null;
	return (
		<span data-testid="board-openspec-chain" className="inline-flex shrink-0 items-center gap-2">
			{change.artifacts.map((artifact) => (
				<span
					key={artifact.id}
					data-testid="board-openspec-artifact"
					data-artifact={artifact.id}
					data-status={artifact.status}
					title={t("board.openspec.artifactTitle", {
						name: artifactName(t, artifact.id),
						status: t(ARTIFACT_STATUS_LABELS[artifact.status]),
					})}
					className={cn(
						"inline-flex size-16 items-center justify-center rounded-xs tr-text-label-pill",
						ARTIFACT_LOOKS[artifact.status],
					)}
				>
					{artifact.id.charAt(0).toUpperCase()}
				</span>
			))}
		</span>
	);
}

/** `tasks.md` progress: a bar and `x/y tasks`. */
export function TasksProgress({ tasks }: { tasks: OpenspecOverlay["tasks"] }) {
	const t = useT();
	if (tasks.total === 0) return null;
	const { completed: done, total } = tasks;
	return (
		<span data-testid="board-openspec-tasks" className="flex min-w-0 items-center gap-4">
			<progress
				value={done}
				max={total}
				aria-label={t("board.openspec.tasksLabel", { done, total })}
				className="h-4 w-48 min-w-0 shrink appearance-none overflow-hidden rounded-xs bg-control-bg-hovered accent-primary [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-control-bg-hovered [&::-webkit-progress-value]:bg-primary"
			/>
			<span className="tr-text-metadata tabular-nums text-text-muted">
				{t("board.openspec.tasks", { done, total })}
			</span>
		</span>
	);
}

/** The change's delta per capability: `auth +2 ~1`. */
export function DeltaChips({ deltas }: { deltas: OpenspecOverlay["deltas"] }) {
	if (deltas.length === 0) return null;
	return (
		<span className="flex min-w-0 flex-wrap items-center gap-4">
			{deltas.map((delta) => (
				<span
					key={delta.capability}
					data-testid="board-openspec-delta"
					data-capability={delta.capability}
					className="inline-flex min-w-0 items-center gap-4 rounded-xs bg-feedback-info-subtle px-4 tr-text-metadata text-feedback-info"
				>
					<span className="min-w-0 truncate">{delta.capability}</span>
					<span className="shrink-0 tabular-nums">{deltaText(delta)}</span>
				</span>
			))}
		</span>
	);
}

/** `validate --strict`'s last verdict: passed, or its errors and warnings; nothing before one. */
export function ValidationBadge({ validation }: { validation: OpenspecOverlay["validation"] }) {
	const t = useT();
	if (!validation) return null;
	const { valid, errors, warnings } = validation;
	return (
		<span
			data-testid="board-openspec-validation"
			data-valid={valid}
			className={cn(
				"inline-flex shrink-0 items-center gap-2 tr-text-metadata",
				valid ? "text-feedback-success" : "text-feedback-error",
			)}
		>
			{valid ? (
				<RiShieldCheckLine aria-hidden className="size-12" />
			) : (
				<RiErrorWarningLine aria-hidden className="size-12" />
			)}
			{valid
				? t("board.openspec.valid")
				: t("board.openspec.invalid", { count: errors + warnings })}
		</span>
	);
}

/** A change's card on the board: chain and deltas, tasks and validation, the next artifact or its error. */
export function OpenspecTileLines({ change }: { change: OpenspecOverlay }) {
	const t = useT();
	return (
		<span
			data-testid="board-openspec"
			data-stage={change.stage}
			className="flex min-w-0 flex-col gap-4"
		>
			<span className="flex min-w-0 flex-wrap items-center gap-8">
				<ArtifactChain change={change} />
				<DeltaChips deltas={change.deltas} />
			</span>
			<span className="flex min-w-0 flex-wrap items-center gap-8">
				<TasksProgress tasks={change.tasks} />
				<ValidationBadge validation={change.validation} />
				{change.stage === "planning" && change.nextArtifact ? (
					<span data-testid="board-openspec-next" className="tr-text-metadata text-text-subtle">
						{t("board.openspec.next", { artifact: artifactName(t, change.nextArtifact) })}
					</span>
				) : null}
			</span>
			{change.error ? (
				<span
					data-testid="board-openspec-error"
					title={change.error}
					className="truncate tr-text-metadata text-feedback-warning"
				>
					{t("board.openspec.unknownSchema", { schema: change.schema })}
				</span>
			) : null}
		</span>
	);
}

/** Without the CLI the board only reads: what to install, verbatim. */
export function InstallHint({ className }: { className?: string }) {
	const t = useT();
	return (
		<p
			data-testid="board-openspec-install"
			className={cn("tr-text-metadata text-text-muted wrap-anywhere", className)}
		>
			{t("board.openspec.install")}{" "}
			<code className="tr-code-text-small text-text-default">{INSTALL_COMMAND}</code>
		</p>
	);
}

function FileButton({
	host,
	change,
	path,
	label,
}: {
	host: PanelHost;
	change: OpenspecOverlay;
	path: string;
	label: string;
}) {
	const t = useT();
	const here = change.workspaceId === host.scope.workspaceId;
	return (
		<Button
			variant="outline"
			size="s"
			iconLeft={RiExternalLinkLine}
			data-testid="board-openspec-open"
			data-path={path}
			data-target={here ? "peek" : "workspace"}
			onClick={() => openChangeFile(host, change, path)}
		>
			{here ? label : t("board.openspec.openThere", { name: label })}
		</Button>
	);
}

const fileName = (path: string) => path.split("/").at(-1) ?? path;

const OPERATION_LOOKS: Readonly<Record<string, string>> = {
	ADDED: "bg-feedback-success-subtle text-feedback-success",
	MODIFIED: "bg-feedback-warning-subtle text-feedback-warning",
	REMOVED: "bg-feedback-error-subtle text-feedback-error",
	RENAMED: "bg-primary-subtle text-primary",
};

/** One artifact's tab: its files to open in Peek (rendered as markdown there) and, for deltas and tasks, a summary. */
function ArtifactTab({
	host,
	change,
	id,
}: {
	host: PanelHost;
	change: OpenspecOverlay;
	id: string;
}) {
	const t = useT();
	const artifact = change.artifacts.find((candidate) => candidate.id === id);
	if (!artifact) return null;
	if (artifact.files.length === 0)
		return (
			<p data-testid="board-openspec-missing" className="tr-text-metadata text-text-subtle">
				{t("board.openspec.missing", {
					name: artifactName(t, id),
					status: t(ARTIFACT_STATUS_LABELS[artifact.status]),
				})}
			</p>
		);
	if (id === "specs")
		return (
			<ul className="flex flex-col gap-8">
				{change.deltas.map((delta) => (
					<li
						key={delta.capability}
						data-testid="board-openspec-capability"
						className="flex flex-col gap-4 rounded-sm border border-border-muted p-8"
					>
						<span className="flex min-w-0 items-center gap-8">
							<span className="min-w-0 flex-1 truncate tr-text-emphasis text-text-default">
								{delta.capability}
							</span>
							<span className="tr-text-metadata tabular-nums text-feedback-info">
								{deltaText(delta)}
							</span>
						</span>
						<ul className="flex flex-col gap-2">
							{(change.requirements ?? [])
								.filter((requirement) => requirement.capability === delta.capability)
								.map((requirement) => (
									<li
										key={`${requirement.operation}:${requirement.name}`}
										className="flex min-w-0 items-center gap-4 tr-text-metadata text-text-default"
									>
										<span
											className={cn(
												"shrink-0 rounded-xs px-4 tr-text-label-pill",
												OPERATION_LOOKS[requirement.operation] ?? "bg-control-bg-selected",
											)}
										>
											{requirement.operation}
										</span>
										<span className="min-w-0 truncate">{requirement.name}</span>
									</li>
								))}
						</ul>
						<span className="flex">
							<FileButton
								host={host}
								change={change}
								path={delta.path}
								label={t("board.openspec.openDelta")}
							/>
						</span>
					</li>
				))}
			</ul>
		);
	return (
		<div className="flex flex-col gap-8">
			{id === "tasks" && change.taskLines ? (
				<ul data-testid="board-openspec-task-lines" className="flex flex-col gap-2">
					{change.taskLines.map((line) => (
						<li
							key={`${line.path}:${line.line}`}
							data-done={line.done || undefined}
							className="flex min-w-0 items-start gap-4 tr-text-metadata text-text-default data-[done]:text-text-muted"
						>
							{line.done ? (
								<RiCheckboxLine
									aria-hidden
									className="mt-2 size-12 shrink-0 text-feedback-success"
								/>
							) : (
								<RiCheckboxBlankLine aria-hidden className="mt-2 size-12 shrink-0" />
							)}
							<span className="min-w-0 wrap-anywhere">{line.text}</span>
						</li>
					))}
				</ul>
			) : null}
			<span className="flex flex-wrap gap-4">
				{artifact.files.map((path) => (
					<FileButton key={path} host={host} change={change} path={path} label={fileName(path)} />
				))}
			</span>
		</div>
	);
}

function IssueList({ validation }: { validation: ChangeValidation }) {
	const t = useT();
	return (
		<div
			role="status"
			data-testid="board-openspec-issues"
			data-valid={validation.valid}
			className="flex flex-col gap-4"
		>
			<span
				className={cn(
					"inline-flex items-center gap-4 tr-text-metadata",
					validation.valid ? "text-feedback-success" : "text-feedback-error",
				)}
			>
				{validation.valid ? (
					<RiCheckboxCircleLine aria-hidden className="size-12" />
				) : (
					<RiErrorWarningLine aria-hidden className="size-12" />
				)}
				{validation.valid
					? t("board.openspec.validated")
					: t("board.openspec.invalid", { count: validation.errors + validation.warnings })}
			</span>
			{validation.issues.length > 0 ? (
				<ul className="flex flex-col gap-2">
					{validation.issues.map((issue) => (
						<li
							key={`${issue.level}:${issue.path ?? ""}:${issue.line ?? ""}:${issue.message}`}
							data-testid="board-openspec-issue"
							data-level={issue.level}
							className="flex min-w-0 items-baseline gap-4 tr-text-metadata text-text-default"
						>
							<span
								className={cn(
									"shrink-0 tr-text-label-pill",
									issue.level === "ERROR"
										? "text-feedback-error"
										: issue.level === "WARNING"
											? "text-feedback-warning"
											: "text-text-subtle",
								)}
							>
								{issue.level}
							</span>
							{issue.path ? (
								<span className="shrink-0 tr-code-text-small text-text-muted">{issue.path}</span>
							) : null}
							<span className="min-w-0 wrap-anywhere">{issue.message}</span>
						</li>
					))}
				</ul>
			) : null}
		</div>
	);
}

/**
 * An OpenSpec change in Peek: stage, validation and tasks; a tab per artifact (Proposal, Spec deltas,
 * Design, Tasks) whose files open in Peek as markdown; Apply, Validate and Archive in workspace. Without the
 * CLI the actions it needs are disabled and the install command shows.
 */
export function OpenspecSection({
	host,
	projectId,
	card,
	status,
	onChanged,
}: {
	host: PanelHost;
	projectId: string;
	card: Card;
	/** The board's OpenSpec status, `null` while it loads. */
	status: OpenspecStatus | null;
	onChanged: () => void;
}) {
	const t = useT();
	const change = card.openspec;
	const [tab, setTab] = useState<string | null>(null);
	const [busy, setBusy] = useState<"apply" | "validate" | "archive" | null>(null);
	const [validation, setValidation] = useState<ChangeValidation | null>(null);
	const [outcome, setOutcome] = useState<{ error: boolean; text: string } | null>(null);
	if (!change) return null;
	const cli = status?.cli ?? null;
	const shown = tab ?? change.artifacts[0]?.id ?? null;
	const run = (kind: "apply" | "validate" | "archive", action: () => Promise<void>) => {
		setBusy(kind);
		setOutcome(null);
		action()
			.catch((error: unknown) =>
				setOutcome({
					error: true,
					text: error instanceof Error ? error.message : t("board.error.unknown"),
				}),
			)
			.finally(() => setBusy(null));
	};
	const apply = () =>
		run("apply", async () => {
			const started = await startCard(host, card.id, { workflow: "implement" }, projectId);
			const failed = started.kickoffError ?? started.openspecError;
			setOutcome(
				failed
					? { error: true, text: t("board.openspec.applyProblem", { error: failed }) }
					: { error: false, text: t("board.openspec.applied", { change: change.change }) },
			);
			onChanged();
		});
	const validate = () =>
		run("validate", async () => {
			setValidation(await validateChange(host, card.id, projectId));
		});
	const archive = () =>
		run("archive", async () => {
			await archiveChange(host, card.id, projectId);
			setOutcome({
				error: false,
				text: t("board.openspec.archiveAsked", { change: change.change }),
			});
		});
	const noCli = status !== null && !cli;
	return (
		<Section title={t("board.openspec.title")}>
			<div
				data-testid="board-openspec-section"
				data-stage={change.stage}
				className="flex flex-col gap-8"
			>
				<span className="flex flex-wrap items-center gap-8">
					<span
						data-testid="board-openspec-stage"
						className="rounded-full bg-primary-subtle px-8 tr-text-label-pill text-primary"
					>
						{t(STAGE_LABELS[change.stage])}
					</span>
					<ArtifactChain change={change} />
					<TasksProgress tasks={change.tasks} />
					<ValidationBadge validation={change.validation} />
				</span>
				<span className="truncate tr-code-text-small text-text-subtle" title={change.dir}>
					{change.dir}
				</span>
				{change.error ? (
					<p
						data-testid="board-openspec-error"
						className="tr-text-metadata text-feedback-warning wrap-anywhere"
					>
						{change.error}
					</p>
				) : null}
				{change.artifacts.length > 0 ? (
					<div className="flex flex-col gap-8">
						<div
							data-testid="board-openspec-tabs"
							className="flex flex-wrap items-center gap-2 rounded-sm bg-control-bg p-2"
						>
							{change.artifacts.map((artifact) => (
								<ToggleSegment
									key={artifact.id}
									testid={`board-openspec-tab-${artifact.id}`}
									label={artifactName(t, artifact.id)}
									active={shown === artifact.id}
									onClick={() => setTab(artifact.id)}
								/>
							))}
						</div>
						{shown ? <ArtifactTab host={host} change={change} id={shown} /> : null}
					</div>
				) : null}
				<span className="flex flex-wrap gap-4">
					{canApply(card) ? (
						<Button
							variant="primary"
							size="s"
							iconLeft={RiPlayLine}
							loading={busy === "apply"}
							data-testid="board-openspec-apply"
							onClick={apply}
						>
							{t("board.openspec.apply")}
						</Button>
					) : null}
					<Button
						variant="outline"
						size="s"
						iconLeft={RiShieldCheckLine}
						loading={busy === "validate"}
						disabled={!cli || change.archived}
						data-testid="board-openspec-validate"
						onClick={validate}
					>
						{t("board.openspec.validate")}
					</Button>
					{canArchive(card) ? (
						<Button
							variant="outline"
							size="s"
							iconLeft={RiInboxArchiveLine}
							loading={busy === "archive"}
							disabled={!cli}
							data-testid="board-openspec-archive"
							onClick={archive}
						>
							{t("board.openspec.archive")}
						</Button>
					) : null}
				</span>
				{noCli ? <InstallHint /> : null}
				<p className="tr-text-metadata text-text-subtle">{t("board.openspec.archiveHint")}</p>
				{validation ? <IssueList validation={validation} /> : null}
				{outcome ? (
					<p
						role={outcome.error ? "alert" : "status"}
						data-testid="board-openspec-outcome"
						className={cn(
							"tr-text-metadata wrap-anywhere",
							outcome.error ? "text-feedback-error" : "text-text-muted",
						)}
					>
						{outcome.text}
					</p>
				) : null}
			</div>
		</Section>
	);
}

/** "＋ Propose change": the description of the change a chat in Default proposes with the propose skill. */
export function ProposeForm({
	onPropose,
	onCancel,
}: {
	onPropose: (description: string) => Promise<void>;
	onCancel: () => void;
}) {
	const t = useT();
	const [description, setDescription] = useState("");
	const [busy, setBusy] = useState(false);
	const submit = () => {
		const trimmed = description.trim();
		if (!trimmed || busy) return;
		setBusy(true);
		void onPropose(trimmed).finally(() => setBusy(false));
	};
	return (
		<form
			data-testid="board-openspec-propose-form"
			className="flex shrink-0 items-center gap-4 border-border-muted border-b px-8 py-4"
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
		>
			<input
				data-testid="board-openspec-propose-description"
				aria-label={t("board.openspec.proposeLabel")}
				placeholder={t("board.openspec.proposePlaceholder")}
				value={description}
				onChange={(event) => setDescription(event.currentTarget.value)}
				onKeyDown={(event) => {
					if (event.key !== "Escape" || isImeComposing(event.nativeEvent)) return;
					event.preventDefault();
					onCancel();
				}}
				ref={(node) => node?.focus()}
				className={FIELD}
			/>
			<Button
				type="submit"
				size="s"
				loading={busy}
				disabled={!description.trim()}
				data-testid="board-openspec-propose-submit"
			>
				{t("board.openspec.proposeSubmit")}
			</Button>
			<IconButton
				icon={RiCloseLine}
				size="s"
				label={t("board.newCard.cancel")}
				onClick={onCancel}
			/>
		</form>
	);
}
