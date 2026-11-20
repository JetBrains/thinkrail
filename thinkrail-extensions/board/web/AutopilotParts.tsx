import { RiRobot2Line } from "@remixicon/react";
import { type Translator, useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import { type AutopilotPause, type AutopilotView, autopilotState } from "./roadmapApi";

/** The state line's words: on, off, or paused with its reason. */
export function autopilotStateText(
	t: Translator,
	view: Pick<AutopilotView, "on" | "pausedReason">,
): string {
	const pause: AutopilotPause | null = view.on ? view.pausedReason : null;
	if (!view.on) return t("board.autopilot.state.off");
	if (!pause) return t("board.autopilot.state.on");
	switch (pause.kind) {
		case "review":
			return t("board.autopilot.state.pausedReview", { n: pause.count, limit: pause.limit });
		case "needs_you":
			return t("board.autopilot.state.pausedNeedsYou", { n: pause.count, limit: pause.limit });
		case "orchestrator":
			return t("board.autopilot.state.pausedOrchestrator");
	}
}

/** Autopilot's state line, its running agents against the cap, and the next ready cards. */
export function AutopilotFacts({
	view,
	onCard,
}: {
	view: AutopilotView;
	onCard?: (cardId: string) => void;
}) {
	const t = useT();
	const state = autopilotState(view);
	return (
		<div className="flex flex-col gap-4">
			<span className="flex flex-wrap items-center gap-8">
				<span
					data-testid="board-autopilot-state"
					data-state={state}
					className={cn(
						"flex items-center gap-4 rounded-full px-8 tr-text-label-pill",
						state === "on"
							? "bg-primary-subtle text-primary"
							: state === "paused"
								? "bg-feedback-warning-subtle text-feedback-warning"
								: "bg-control-bg-selected text-text-muted",
					)}
				>
					<RiRobot2Line aria-hidden className="size-12 shrink-0" />
					{autopilotStateText(t, view)}
				</span>
				<span data-testid="board-autopilot-agents" className="tr-text-metadata text-text-muted">
					{view.cap > 0
						? t("board.autopilot.agents", { n: view.running, cap: view.cap })
						: t("board.autopilot.agentsNoCap", { n: view.running })}
				</span>
			</span>
			{view.ready.length > 0 ? (
				<ul aria-label={t("board.autopilot.next")} className="flex flex-col gap-2">
					{view.ready.map((card) => (
						<li
							key={card.id}
							data-testid="board-autopilot-ready"
							data-card-id={card.id}
							data-stale={card.stale || undefined}
							className="flex min-w-0 items-center gap-8 tr-text-metadata"
						>
							{onCard ? (
								<button
									type="button"
									onClick={() => onCard(card.id)}
									className="min-w-0 truncate rounded-sm text-left text-text-default hover:underline focus-visible:focus-ring"
								>
									{t("board.card.blockOption", { id: card.id, title: card.title })}
								</button>
							) : (
								<span className="min-w-0 truncate text-text-default">
									{t("board.card.blockOption", { id: card.id, title: card.title })}
								</span>
							)}
							{card.size ? <span className="shrink-0 text-text-muted">{card.size}</span> : null}
							{card.stale ? (
								<span className="shrink-0 text-feedback-warning">{t("board.autopilot.stale")}</span>
							) : card.offered ? (
								<span className="shrink-0 text-text-subtle">{t("board.autopilot.offered")}</span>
							) : null}
						</li>
					))}
				</ul>
			) : (
				<span className="tr-text-metadata text-text-subtle">{t("board.autopilot.noneReady")}</span>
			)}
		</div>
	);
}
