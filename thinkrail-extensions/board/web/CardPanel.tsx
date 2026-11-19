import {
	RiAddLine,
	RiChat3Line,
	RiCloseLine,
	RiDeleteBinLine,
	RiExternalLinkLine,
} from "@remixicon/react";
import type { PanelHost, PanelProps } from "@thinkrail/extension-api/web";
import { type Translator, useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { Textarea } from "@thinkrail/ui/textarea";
import { type ReactNode, useId, useState } from "react";
import {
	agentBadge,
	CARD_SIZES,
	CARD_TYPES,
	type Card,
	type CardDetail,
	type CardPatch,
	deleteCard,
	loadBoard,
	loadCard,
	type Transition,
	updateCard,
} from "./api";
import { AgentBadgeChip, CardMeta, FIELD, PlanProgress, PrChip } from "./CardParts";
import { ACTOR_LABELS, columnTitle, TYPE_LABELS, WORKFLOW_LABELS } from "./labels";
import { StartSection } from "./StartSection";
import { useBoardChanged, useHostQuery } from "./useHostQuery";

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="flex flex-col gap-4">
			<h3 className="tr-text-eyebrow text-text-muted">{title}</h3>
			{children}
		</section>
	);
}

/** A text field that writes on blur or Enter, when its value changed; keyed by the saved value. */
function SavedInput({
	value,
	label,
	testId,
	onSave,
}: {
	value: string;
	label: string;
	testId: string;
	onSave: (value: string) => void;
}) {
	const [draft, setDraft] = useState(value);
	const save = () => {
		const trimmed = draft.trim();
		if (trimmed && trimmed !== value) onSave(trimmed);
		else setDraft(value);
	};
	return (
		<input
			data-testid={testId}
			aria-label={label}
			value={draft}
			onChange={(event) => setDraft(event.currentTarget.value)}
			onBlur={save}
			onKeyDown={(event) => {
				if (event.key !== "Enter" || isImeComposing(event.nativeEvent)) return;
				event.preventDefault();
				save();
			}}
			className={`${FIELD} tr-title-compact`}
		/>
	);
}

function SavedTextarea({
	value,
	label,
	onSave,
}: {
	value: string;
	label: string;
	onSave: (value: string) => void;
}) {
	const [draft, setDraft] = useState(value);
	return (
		<Textarea
			data-testid="board-card-description"
			aria-label={label}
			rows={4}
			value={draft}
			onChange={(event) => setDraft(event.currentTarget.value)}
			onBlur={() => {
				if (draft !== value) onSave(draft);
			}}
		/>
	);
}

/** An editable list of short strings: acceptance criteria, spec refs. */
function ItemList({
	items,
	label,
	addLabel,
	testId,
	onChange,
}: {
	items: readonly string[];
	label: string;
	addLabel: string;
	testId: string;
	onChange: (items: string[]) => void;
}) {
	const t = useT();
	const [draft, setDraft] = useState("");
	const add = () => {
		const trimmed = draft.trim();
		if (!trimmed) return;
		onChange([...items, trimmed]);
		setDraft("");
	};
	return (
		<div data-testid={testId} className="flex flex-col gap-4">
			<ul className="flex flex-col gap-2">
				{items.map((item, index) => (
					<li
						key={`${index}:${item}`}
						data-testid={`${testId}-item`}
						className="flex items-start gap-4 tr-text-ui text-text-default"
					>
						<span className="min-w-0 flex-1 wrap-anywhere">{item}</span>
						<IconButton
							icon={RiCloseLine}
							size="s"
							label={t("board.card.removeItem", { item })}
							onClick={() => onChange(items.filter((_, position) => position !== index))}
						/>
					</li>
				))}
			</ul>
			<form
				className="flex items-center gap-4"
				onSubmit={(event) => {
					event.preventDefault();
					add();
				}}
			>
				<input
					data-testid={`${testId}-add`}
					aria-label={label}
					placeholder={addLabel}
					value={draft}
					onChange={(event) => setDraft(event.currentTarget.value)}
					className={FIELD}
				/>
				<IconButton
					icon={RiAddLine}
					size="s"
					type="submit"
					label={addLabel}
					disabled={!draft.trim()}
				/>
			</form>
		</div>
	);
}

function placementText(t: Translator, placement: Transition["from"]): string {
	return placement ? columnTitle(t, placement.column) : t("board.activity.none");
}

function Activity({ transitions }: { transitions: readonly Transition[] }) {
	const t = useT();
	if (transitions.length === 0)
		return <span className="tr-text-metadata text-text-subtle">{t("board.activity.empty")}</span>;
	return (
		<ol data-testid="board-activity" className="flex flex-col gap-2">
			{[...transitions].reverse().map((transition) => (
				<li
					key={`${transition.at}:${transition.reason}`}
					data-testid="board-activity-item"
					data-actor={transition.actor}
					className="flex flex-wrap items-baseline gap-4 tr-text-metadata text-text-muted"
				>
					<time
						className="tabular-nums text-text-subtle"
						dateTime={new Date(transition.at).toISOString()}
					>
						{new Date(transition.at).toLocaleString()}
					</time>
					<span className="text-text-default">
						{transition.from === null
							? t("board.activity.created", { to: placementText(t, transition.to) })
							: t("board.activity.move", {
									from: placementText(t, transition.from),
									to: placementText(t, transition.to),
								})}
					</span>
					<span>{t(ACTOR_LABELS[transition.actor])}</span>
					{transition.from === null ? null : (
						<span className="text-text-subtle">{transition.reason}</span>
					)}
				</li>
			))}
		</ol>
	);
}

function Attempts({ host, projectId, card }: { host: PanelHost; projectId: string; card: Card }) {
	const t = useT();
	if (card.attempts.length === 0)
		return <span className="tr-text-metadata text-text-subtle">{t("board.attempts.empty")}</span>;
	return (
		<ul data-testid="board-attempts" className="flex flex-col gap-8">
			{card.attempts.map((attempt, index) => {
				const live = card.live[index];
				const badge = index === card.attempts.length - 1 ? agentBadge(card) : null;
				return (
					<li
						key={attempt.workspaceId}
						data-testid="board-attempt"
						data-open={live?.open || undefined}
						className="flex flex-col gap-4 rounded-sm border border-border-muted p-8"
					>
						<span className="flex flex-wrap items-center gap-8 tr-text-metadata text-text-muted">
							<span className="text-text-default">{t(WORKFLOW_LABELS[attempt.workflow])}</span>
							<time dateTime={new Date(attempt.startedAt).toISOString()}>
								{new Date(attempt.startedAt).toLocaleString()}
							</time>
							<AgentBadgeChip badge={badge} />
							{live?.open ? null : (
								<span className="text-text-subtle">
									{attempt.merged ? t("board.attempts.merged") : t("board.attempts.closed")}
								</span>
							)}
						</span>
						{live?.chat ? (
							<span className="truncate tr-text-ui text-text-default">{live.chat.title}</span>
						) : null}
						<span className="flex flex-wrap items-center gap-8">
							<PlanProgress plan={live?.plan ?? null} />
							<PrChip pr={live?.pr ?? null} />
						</span>
						{attempt.notes.map((note) => (
							<span key={note.at} className="tr-text-metadata text-text-muted wrap-anywhere">
								{note.text}
							</span>
						))}
						{live?.open ? (
							<span className="flex flex-wrap gap-4">
								<Button
									variant="outline"
									size="s"
									iconLeft={RiExternalLinkLine}
									data-testid="board-attempt-workspace"
									onClick={() =>
										host.openWorkspace({ workspaceId: attempt.workspaceId, projectId })
									}
								>
									{t("board.attempts.openWorkspace")}
								</Button>
								<Button
									variant="outline"
									size="s"
									iconLeft={RiChat3Line}
									data-testid="board-attempt-chat"
									onClick={() =>
										host.openChat({
											projectId,
											workspaceId: attempt.workspaceId,
											sessionId: attempt.sessionId,
										})
									}
								>
									{t("board.attempts.openChat")}
								</Button>
							</span>
						) : null}
					</li>
				);
			})}
		</ul>
	);
}

function BlocksEditor({
	host,
	projectId,
	card,
	onChange,
}: {
	host: PanelHost;
	projectId: string;
	card: Card;
	onChange: (blocks: string[]) => void;
}) {
	const t = useT();
	const id = useId();
	const board = useHostQuery(`blocks:${projectId}`, (signal) => loadBoard(host, projectId, signal));
	useBoardChanged(host, projectId, board.reload);
	const others =
		board.state.kind === "ready"
			? board.state.value.cards.filter(
					(other) => other.id !== card.id && !card.blocks.includes(other.id),
				)
			: [];
	return (
		<div className="flex flex-col gap-4">
			<ul className="flex flex-wrap gap-4">
				{card.blocks.map((blocked) => (
					<li
						key={blocked}
						data-testid="board-card-block"
						className="flex items-center gap-2 rounded-full bg-control-bg-selected pl-8 tr-text-metadata text-text-default"
					>
						{blocked}
						<IconButton
							icon={RiCloseLine}
							size="s"
							label={t("board.card.removeItem", { item: blocked })}
							onClick={() => onChange(card.blocks.filter((other) => other !== blocked))}
						/>
					</li>
				))}
			</ul>
			<label htmlFor={id} className="sr-only">
				{t("board.card.addBlock")}
			</label>
			<select
				id={id}
				data-testid="board-card-add-block"
				value=""
				disabled={others.length === 0}
				onChange={(event) => {
					const picked = event.currentTarget.value;
					if (picked) onChange([...card.blocks, picked]);
				}}
				className={FIELD}
			>
				<option value="">{t("board.card.addBlock")}</option>
				{others.map((other) => (
					<option key={other.id} value={other.id}>
						{t("board.card.blockOption", { id: other.id, title: other.title })}
					</option>
				))}
			</select>
		</div>
	);
}

function DeleteCard({ onDelete }: { onDelete: () => void }) {
	const t = useT();
	const [confirming, setConfirming] = useState(false);
	return confirming ? (
		<span className="flex flex-wrap items-center gap-4">
			<span className="tr-text-metadata text-text-muted">{t("board.card.deleteConfirm")}</span>
			<Button
				variant="destructive"
				size="s"
				data-testid="board-card-delete-confirm"
				onClick={onDelete}
			>
				{t("board.card.delete")}
			</Button>
			<Button variant="ghost" size="s" onClick={() => setConfirming(false)}>
				{t("board.card.keep")}
			</Button>
		</span>
	) : (
		<Button
			variant="ghost"
			size="s"
			tone="danger"
			iconLeft={RiDeleteBinLine}
			data-testid="board-card-delete"
			className="self-start"
			onClick={() => setConfirming(true)}
		>
			{t("board.card.delete")}
		</Button>
	);
}

function CardDetails({
	host,
	detail,
	onPatch,
	onDelete,
	onReload,
}: {
	host: PanelHost;
	detail: CardDetail;
	onPatch: (patch: CardPatch) => void;
	onDelete: () => void;
	onReload: () => void;
}) {
	const t = useT();
	const id = useId();
	const { card, projectId } = detail;
	return (
		<div className="flex flex-col gap-16 p-12">
			<div className="flex flex-col gap-4">
				<span className="flex flex-wrap items-center gap-8">
					<CardMeta card={card} />
					<span data-testid="board-card-column" className="tr-text-metadata text-text-muted">
						{columnTitle(t, card.column)}
					</span>
				</span>
				<SavedInput
					key={card.title}
					value={card.title}
					label={t("board.card.titleLabel")}
					testId="board-card-title"
					onSave={(title) => onPatch({ title })}
				/>
			</div>
			<div className="flex flex-wrap items-end gap-8">
				<label htmlFor={`${id}-type`} className="flex flex-col gap-2">
					<span className="tr-text-metadata text-text-muted">{t("board.card.type")}</span>
					<select
						id={`${id}-type`}
						data-testid="board-card-type"
						value={card.type}
						onChange={(event) => {
							const type = CARD_TYPES.find((value) => value === event.currentTarget.value);
							if (type) onPatch({ type });
						}}
						className={FIELD}
					>
						{CARD_TYPES.map((type) => (
							<option key={type} value={type}>
								{t(TYPE_LABELS[type])}
							</option>
						))}
					</select>
				</label>
				<label htmlFor={`${id}-size`} className="flex flex-col gap-2">
					<span className="tr-text-metadata text-text-muted">{t("board.card.size")}</span>
					<select
						id={`${id}-size`}
						data-testid="board-card-size"
						value={card.size ?? ""}
						onChange={(event) => {
							const size = CARD_SIZES.find((value) => value === event.currentTarget.value);
							onPatch({ size: size ?? null });
						}}
						className={FIELD}
					>
						<option value="">{t("board.card.sizeNone")}</option>
						{CARD_SIZES.map((size) => (
							<option key={size} value={size}>
								{size}
							</option>
						))}
					</select>
				</label>
				{card.size && card.sizeSuggested ? (
					<Button
						variant="outline"
						size="s"
						data-testid="board-card-confirm-size"
						onClick={() => onPatch({ size: card.size ?? null })}
					>
						{t("board.card.confirmSize")}
					</Button>
				) : null}
			</div>
			<Section title={t("board.card.description")}>
				<SavedTextarea
					key={card.description}
					value={card.description}
					label={t("board.card.description")}
					onSave={(description) => onPatch({ description })}
				/>
			</Section>
			<Section title={t("board.card.acceptance")}>
				<ItemList
					items={card.acceptance}
					label={t("board.card.acceptance")}
					addLabel={t("board.card.addAcceptance")}
					testId="board-card-acceptance"
					onChange={(acceptance) => onPatch({ acceptance })}
				/>
			</Section>
			<Section title={t("board.card.blocks")}>
				<BlocksEditor
					host={host}
					projectId={projectId}
					card={card}
					onChange={(blocks) => onPatch({ blocks })}
				/>
				{card.blockedBy.length > 0 ? (
					<span className="tr-text-metadata text-feedback-warning">
						{t("board.card.blockedBy", { ids: card.blockedBy.join(", ") })}
					</span>
				) : null}
			</Section>
			<Section title={t("board.card.specs")}>
				<ItemList
					items={card.specRefs}
					label={t("board.card.specs")}
					addLabel={t("board.card.addSpec")}
					testId="board-card-specs"
					onChange={(specRefs) => onPatch({ specRefs })}
				/>
			</Section>
			<Section title={t("board.attempts.title")}>
				<Attempts host={host} projectId={projectId} card={card} />
			</Section>
			<StartSection
				key={`${card.id}:${card.type}:${card.size ?? ""}`}
				host={host}
				card={card}
				onStarted={onReload}
			/>
			<Section title={t("board.activity.title")}>
				<Activity transitions={detail.transitions} />
			</Section>
			<DeleteCard onDelete={onDelete} />
		</div>
	);
}

/** A card in Peek: its details, attempts, the Start form and its activity. */
export default function CardPanel({ host, params }: PanelProps) {
	const t = useT();
	const cardId = params.cardId ?? "";
	const [deleted, setDeleted] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const card = useHostQuery(cardId || null, (signal) => loadCard(host, cardId, signal));
	const projectId =
		card.state.kind === "ready" ? card.state.value.projectId : (params.projectId ?? null);
	useBoardChanged(host, projectId, card.reload);
	const write = (run: () => Promise<unknown>) =>
		run().then(
			() => {
				setError(null);
				card.reload();
			},
			(failure: unknown) => {
				setError(failure instanceof Error ? failure.message : t("board.error.unknown"));
				card.reload();
			},
		);
	if (deleted)
		return (
			<div data-testid="board-card-deleted" className="p-16 tr-text-ui text-text-muted">
				{t("board.card.deleted", { id: cardId })}
			</div>
		);
	return (
		<div
			data-testid="board-card-panel"
			data-card-id={cardId}
			className="h-full min-h-0 overflow-auto"
		>
			{error ? (
				<p role="alert" className="px-12 pt-8 tr-text-metadata text-feedback-error wrap-anywhere">
					{error}
				</p>
			) : null}
			{card.state.kind === "loading" ? (
				<LoadingRegion rows={10} label={t("board.loading")} className="p-16" />
			) : card.state.kind === "error" ? (
				<div className="flex flex-col items-start gap-8 p-16">
					<span className="tr-text-ui text-text-muted">{t("board.error.card")}</span>
					<span className="tr-text-metadata text-text-subtle wrap-anywhere">
						{card.state.message}
					</span>
					<Button variant="outline" size="m" onClick={card.reload}>
						{t("board.retry")}
					</Button>
				</div>
			) : (
				<CardDetails
					host={host}
					detail={card.state.value}
					onPatch={(patch) => void write(() => updateCard(host, cardId, patch))}
					onDelete={() =>
						void deleteCard(host, cardId).then(
							() => setDeleted(true),
							(failure: unknown) =>
								setError(failure instanceof Error ? failure.message : t("board.error.unknown")),
						)
					}
					onReload={card.reload}
				/>
			)}
		</div>
	);
}
