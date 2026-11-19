import {
	type RemixiconComponentType,
	RiCheckboxCircleFill,
	RiCheckboxCircleLine,
	RiErrorWarningLine,
	RiFileList3Line,
	RiFlag2Line,
	RiGithubLine,
	RiGitPullRequestLine,
	RiLoader4Line,
	RiQuestionLine,
} from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { DiffStatBadge } from "@thinkrail/ui/diff-stat-badge";
import { cn } from "@thinkrail/ui/utils";
import {
	type AgentBadge,
	type AttemptLive,
	agentBadge,
	type Card,
	type LastAction,
	latestLive,
	shownId,
	type TaskSpecRef,
	workingAction,
} from "./api";
import { BADGE_LABELS, TYPE_LABELS, taskSpecStatusLabel } from "./labels";

export const FIELD =
	"w-full min-w-0 rounded-sm border border-control-border-default bg-control-bg px-8 py-4 tr-text-ui text-text-default placeholder:text-text-subtle focus:border-control-border-active focus-visible:focus-ring";

const BADGE_LOOKS: Readonly<
	Record<AgentBadge, { icon: RemixiconComponentType; className: string }>
> = {
	working: { icon: RiLoader4Line, className: "bg-primary-subtle text-primary" },
	waiting: { icon: RiQuestionLine, className: "bg-feedback-warning-subtle text-feedback-warning" },
	failed: { icon: RiErrorWarningLine, className: "bg-feedback-error-subtle text-feedback-error" },
	finished: {
		icon: RiCheckboxCircleLine,
		className: "bg-feedback-success-subtle text-feedback-success",
	},
	unread: { icon: RiCheckboxCircleFill, className: "bg-primary-subtle text-primary" },
};

export function AgentBadgeChip({ badge }: { badge: AgentBadge | null }) {
	const t = useT();
	if (!badge) return null;
	const { icon: Icon, className } = BADGE_LOOKS[badge];
	return (
		<span
			data-testid="board-agent-badge"
			data-badge={badge}
			className={cn(
				"inline-flex shrink-0 items-center gap-4 rounded-full px-8 py-2 tr-text-label-pill",
				className,
			)}
		>
			<Icon
				aria-hidden
				className={cn("size-12", badge === "working" && "motion-safe:animate-spin")}
			/>
			{t(BADGE_LABELS[badge])}
		</span>
	);
}

export function PlanProgress({ plan }: { plan: AttemptLive["plan"] }) {
	const t = useT();
	if (!plan || plan.total === 0) return null;
	const done = plan.total - plan.open;
	return (
		<span data-testid="board-plan" className="flex min-w-0 items-center gap-4">
			<progress
				value={done}
				max={plan.total}
				aria-label={t("board.card.planLabel", { done, total: plan.total })}
				className="h-4 w-48 min-w-0 shrink appearance-none overflow-hidden rounded-xs bg-control-bg-hovered accent-primary [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-control-bg-hovered [&::-webkit-progress-value]:bg-primary"
			/>
			<span className="tr-text-metadata tabular-nums text-text-muted">
				{t("board.card.plan", { done, total: plan.total })}
			</span>
		</span>
	);
}

export function PrChip({ pr }: { pr: AttemptLive["pr"] }) {
	const t = useT();
	if (!pr) return null;
	return (
		<span
			data-testid="board-pr"
			data-state={pr.state}
			className="inline-flex shrink-0 items-center gap-2 tr-text-metadata text-text-muted"
		>
			<RiGitPullRequestLine aria-hidden className="size-12" />
			{t("board.card.pr", { number: pr.number, state: pr.state })}
		</span>
	);
}

/** Where a card comes from, when not the board itself: a task-spec or a GitHub issue. */
export function SourceBadge({ card }: { card: Pick<Card, "source"> }) {
	const t = useT();
	const { source } = card;
	if (source.kind === "native") return null;
	const Icon = source.kind === "github" ? RiGithubLine : RiFileList3Line;
	return (
		<span
			data-testid="board-source"
			data-source={source.kind}
			title={
				source.kind === "github"
					? t("board.source.githubTitle", { number: source.number })
					: t("board.source.taskSpecTitle", { id: source.ref })
			}
			className="inline-flex shrink-0 items-center gap-2 text-text-muted"
		>
			<Icon aria-hidden className="size-12" />
			{source.kind === "github" ? t("board.source.github") : t("board.source.taskSpec")}
		</span>
	);
}

const STATUS_LOOKS: Readonly<Record<string, string>> = {
	draft: "bg-control-bg-selected text-text-muted",
	active: "bg-primary-subtle text-primary",
	stale: "bg-feedback-warning-subtle text-feedback-warning",
	done: "bg-feedback-success-subtle text-feedback-success",
};

export function TaskSpecStatus({ status }: { status: string | null }) {
	const t = useT();
	return (
		<span
			data-testid="board-task-spec-status"
			data-status={status ?? undefined}
			className={cn(
				"inline-flex shrink-0 rounded-full px-8 tr-text-label-pill",
				(status && STATUS_LOOKS[status]) ?? "bg-control-bg-selected text-text-muted",
			)}
		>
			{taskSpecStatusLabel(t, status)}
		</span>
	);
}

/** A card's task-specs on its tile: each one's title and status. */
export function TaskSpecLine({ specs }: { specs: readonly TaskSpecRef[] }) {
	if (specs.length === 0) return null;
	return (
		<span className="flex min-w-0 flex-wrap items-center gap-4">
			{specs.map((spec) => (
				<span
					key={`${spec.workspaceId}:${spec.id}`}
					data-testid="board-task-spec"
					data-spec-id={spec.id}
					className="flex min-w-0 items-center gap-4 tr-text-metadata text-text-muted"
				>
					<RiFileList3Line aria-hidden className="size-12 shrink-0" />
					<span className="min-w-0 truncate">{spec.title}</span>
					<TaskSpecStatus status={spec.status} />
				</span>
			))}
		</span>
	);
}

export function CardMeta({
	card,
}: {
	card: Pick<Card, "id" | "type" | "size" | "sizeSuggested" | "source" | "virtual">;
}) {
	const t = useT();
	return (
		<span className="flex min-w-0 items-center gap-4 tr-text-metadata text-text-subtle">
			<span className="truncate tr-code-text-small text-text-muted">{shownId(card)}</span>
			<SourceBadge card={card} />
			<span>{t(TYPE_LABELS[card.type])}</span>
			{card.size ? (
				<span
					data-testid="board-size"
					data-suggested={card.sizeSuggested || undefined}
					title={card.sizeSuggested ? t("board.card.sizeSuggested") : undefined}
					className={card.sizeSuggested ? "italic" : undefined}
				>
					{card.sizeSuggested ? t("board.card.sizeSuggestedShort", { size: card.size }) : card.size}
				</span>
			) : null}
		</span>
	);
}

/** The initiative a card serves, as a small chip on its tile. */
export function InitiativeChip({ card }: { card: Pick<Card, "initiative"> }) {
	const t = useT();
	const { initiative } = card;
	if (!initiative) return null;
	return (
		<span
			data-testid="board-card-initiative"
			data-initiative-id={initiative.id}
			title={t("board.roadmap.card.chipTitle", { id: initiative.id, title: initiative.title })}
			className="flex min-w-0 items-center gap-2 self-start rounded-xs bg-control-bg-selected px-4 tr-text-metadata text-text-muted"
		>
			<RiFlag2Line aria-hidden className="size-12 shrink-0" />
			<span className="min-w-0 truncate">{initiative.title}</span>
		</span>
	);
}

/** A chat's most recent tool start: the tool and its target, monospace, cut to one line. */
export function LastActionLine({ action }: { action: LastAction | undefined }) {
	const t = useT();
	if (!action) return null;
	const text = action.target ? `${action.tool} ${action.target}` : action.tool;
	return (
		<span
			data-testid="board-last-action"
			data-tool={action.tool}
			title={t("board.lastAction", { action: text })}
			className="flex min-w-0 items-center gap-4 tr-code-text-small text-text-muted"
		>
			<span className="shrink-0 text-text-default">{action.tool}</span>
			{action.target ? <span className="min-w-0 truncate">{action.target}</span> : null}
		</span>
	);
}

/** The latest attempt's live line: agent badge, plan progress, diff and PR, and what a working agent does. */
export function LiveLine({ card }: { card: Pick<Card, "live"> }) {
	const live = latestLive(card);
	const badge = agentBadge(card);
	if (!live?.open && !badge) return null;
	return (
		<>
			<span className="flex min-w-0 flex-wrap items-center gap-8">
				<AgentBadgeChip badge={badge} />
				<PlanProgress plan={live?.plan ?? null} />
				{live?.diff ? (
					<span data-testid="board-diff" className="flex">
						<DiffStatBadge added={live.diff.added} removed={live.diff.removed} />
					</span>
				) : null}
				<PrChip pr={live?.pr ?? null} />
			</span>
			<LastActionLine action={workingAction(card)} />
		</>
	);
}

/** Start pressed past a human-attention limit: the question, with Start anyway and Not now. */
export function StartWarning({
	text,
	onAnyway,
	onCancel,
}: {
	text: string;
	onAnyway: () => void;
	onCancel: () => void;
}) {
	const t = useT();
	return (
		<div
			role="alert"
			data-testid="board-start-warning"
			className="flex flex-col gap-4 rounded-xs bg-feedback-warning-subtle p-4"
		>
			<span className="tr-text-metadata text-feedback-warning">{text}</span>
			<span className="flex flex-wrap gap-4">
				<Button variant="outline" size="s" data-testid="board-start-anyway" onClick={onAnyway}>
					{t("board.wip.startAnyway")}
				</Button>
				<Button variant="ghost" size="s" onClick={onCancel}>
					{t("board.wip.notNow")}
				</Button>
			</span>
		</div>
	);
}
