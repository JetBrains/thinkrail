import { RiPlayLine } from "@remixicon/react";
import type { ThinkingLevel } from "@thinkrail/contracts";
import type { PanelHost } from "@thinkrail/extension-api/web";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { useId, useState } from "react";
import {
	attentionWarning,
	type BoardView,
	type Card,
	type HostModel,
	listModels,
	type StartRequest,
	startCard,
	WORKFLOWS,
	type Workflow,
	workflowFor,
} from "./api";
import { FIELD, StartWarning } from "./CardParts";
import { EFFORT_LABELS, startWarningText, WORKFLOW_LABELS } from "./labels";
import { type Loaded, useHostQuery } from "./useHostQuery";

const THINKING_LEVELS: readonly ThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

export interface StartChoice {
	workflow: Workflow;
	/** `""`: the host's default model for a new chat. */
	model: string;
	/** `""`: the host's default effort. */
	effort: ThinkingLevel | "";
	/** `""`: the project's default base. */
	baseRef: string;
}

/** The Start form's defaults: the size's workflow, and the host's model, effort and base. */
export function startDefaults(card: Pick<Card, "type" | "size">): StartChoice {
	return { workflow: workflowFor(card), model: "", effort: "", baseRef: "" };
}

export function startRequest(choice: StartChoice): StartRequest {
	return {
		workflow: choice.workflow,
		...(choice.model ? { model: choice.model } : {}),
		...(choice.effort ? { thinkingLevel: choice.effort } : {}),
		...(choice.baseRef.trim() ? { baseRef: choice.baseRef.trim() } : {}),
	};
}

function effortsOf(models: readonly HostModel[], model: string): readonly ThinkingLevel[] {
	const levels = models.find((candidate) => candidate.id === model)?.thinkingLevels;
	return levels && levels.length > 0 ? levels : THINKING_LEVELS;
}

/**
 * Starts another attempt of the card: a new workspace whose chat takes the card's kickoff. Past a
 * human-attention limit it asks first, as the board's tile does.
 */
export function StartSection({
	host,
	card,
	projectId,
	board,
	onStarted,
}: {
	host: PanelHost;
	card: Card;
	/** The card's board, which stores a GitHub issue's card on its first Start. */
	projectId: string;
	/** That board, for the WIP warning: Start waits while it loads and starts unasked when it failed. */
	board: Loaded<Pick<BoardView, "wip">>;
	onStarted: () => void;
}) {
	const t = useT();
	const id = useId();
	const models = useHostQuery("models", (signal) => listModels(host, signal));
	const [choice, setChoice] = useState<StartChoice>(() => startDefaults(card));
	const [busy, setBusy] = useState(false);
	const [outcome, setOutcome] = useState<{ kind: "error" | "kickoff"; text: string } | null>(null);
	const [confirming, setConfirming] = useState(false);
	const available = models.state.kind === "ready" ? models.state.value : [];
	const view = board.kind === "ready" ? board.value : null;
	const warning = confirming ? attentionWarning(view) : null;
	const set = (patch: Partial<StartChoice>) => setChoice((current) => ({ ...current, ...patch }));
	const start = (anyway = false) => {
		if (!anyway && attentionWarning(view)) {
			setConfirming(true);
			return;
		}
		setConfirming(false);
		setBusy(true);
		setOutcome(null);
		startCard(host, card.id, startRequest(choice), projectId)
			.then(
				(result) => {
					if (result.kickoffError) setOutcome({ kind: "kickoff", text: result.kickoffError });
					onStarted();
				},
				(error: unknown) =>
					setOutcome({
						kind: "error",
						text: error instanceof Error ? error.message : t("board.error.unknown"),
					}),
			)
			.finally(() => setBusy(false));
	};
	return (
		<section data-testid="board-start" className="flex flex-col gap-8">
			<h3 className="tr-text-eyebrow text-text-muted">
				{card.attempts.length > 0 ? t("board.start.again") : t("board.start.title")}
			</h3>
			<div className="grid grid-cols-2 gap-8">
				<label htmlFor={`${id}-workflow`} className="flex flex-col gap-2">
					<span className="tr-text-metadata text-text-muted">{t("board.start.workflow")}</span>
					<select
						id={`${id}-workflow`}
						data-testid="board-start-workflow"
						value={choice.workflow}
						onChange={(event) => {
							const workflow = WORKFLOWS.find((value) => value === event.currentTarget.value);
							if (workflow) set({ workflow });
						}}
						className={FIELD}
					>
						{WORKFLOWS.map((workflow) => (
							<option key={workflow} value={workflow}>
								{t(WORKFLOW_LABELS[workflow])}
							</option>
						))}
					</select>
				</label>
				<label htmlFor={`${id}-base`} className="flex flex-col gap-2">
					<span className="tr-text-metadata text-text-muted">{t("board.start.base")}</span>
					<input
						id={`${id}-base`}
						data-testid="board-start-base"
						value={choice.baseRef}
						placeholder={t("board.start.baseDefault")}
						onChange={(event) => set({ baseRef: event.currentTarget.value })}
						className={FIELD}
					/>
				</label>
				<label htmlFor={`${id}-model`} className="flex flex-col gap-2">
					<span className="tr-text-metadata text-text-muted">{t("board.start.model")}</span>
					<select
						id={`${id}-model`}
						data-testid="board-start-model"
						value={choice.model}
						onChange={(event) => set({ model: event.currentTarget.value, effort: "" })}
						className={FIELD}
					>
						<option value="">{t("board.start.modelDefault")}</option>
						{available.map((model) => (
							<option key={model.id} value={model.id}>
								{model.name}
							</option>
						))}
					</select>
				</label>
				<label htmlFor={`${id}-effort`} className="flex flex-col gap-2">
					<span className="tr-text-metadata text-text-muted">{t("board.start.effort")}</span>
					<select
						id={`${id}-effort`}
						data-testid="board-start-effort"
						value={choice.effort}
						onChange={(event) => {
							const effort = THINKING_LEVELS.find((level) => level === event.currentTarget.value);
							set({ effort: effort ?? "" });
						}}
						className={FIELD}
					>
						<option value="">{t("board.start.effortDefault")}</option>
						{effortsOf(available, choice.model).map((level) => (
							<option key={level} value={level}>
								{t(EFFORT_LABELS[level])}
							</option>
						))}
					</select>
				</label>
			</div>
			<p className="tr-text-metadata text-text-subtle">{t("board.start.prompt")}</p>
			{warning ? (
				<StartWarning
					text={startWarningText(t, warning)}
					onAnyway={() => start(true)}
					onCancel={() => setConfirming(false)}
				/>
			) : (
				<Button
					variant="primary"
					size="m"
					iconLeft={RiPlayLine}
					loading={busy}
					data-testid="board-start-submit"
					disabled={card.category === "triage" || board.kind === "loading"}
					className="self-start"
					onClick={() => start()}
				>
					{t("board.start.submit")}
				</Button>
			)}
			{outcome ? (
				<p
					role="alert"
					data-testid={outcome.kind === "kickoff" ? "board-kickoff-error" : "board-start-error"}
					className="tr-text-metadata text-feedback-error wrap-anywhere"
				>
					{outcome.kind === "kickoff"
						? t("board.start.kickoffError", { error: outcome.text })
						: outcome.text}
				</p>
			) : null}
		</section>
	);
}
