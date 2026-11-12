import {
	RiArrowLeftSLine as ChevronLeft,
	RiArrowRightSLine as ChevronRight,
	RiRobot2Line as Robot,
} from "@remixicon/react";
import type { GitFileChange, ReviewComment, ReviewGuide } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Button, IconButton } from "@thinkrail/ui/button";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { ChangesTab } from "../store";
import { splitPath } from "./changesModel";
import { sendReviewBatch, sendReviewComment } from "./reviewSend";
import { ownsReviewShortcut } from "./reviewShortcuts";

const NEXT_KEY = "n";
const PREVIOUS_KEY = "p";

export type GuideStep =
	| { kind: "read"; path: string; why: string; order: number }
	| { kind: "finding"; comment: ReviewComment; path: string | null };

export function guideSteps(
	guide: ReviewGuide | undefined,
	comments: readonly ReviewComment[] | undefined,
): GuideStep[] {
	const steps: GuideStep[] = (guide?.readingOrder ?? []).map((step, order) => ({
		kind: "read",
		path: step.path,
		why: step.why,
		order,
	}));
	const findings = (comments ?? [])
		.filter(
			(comment) =>
				comment.author === "agent" && (comment.status === "draft" || comment.status === "sent"),
		)
		.sort((a, b) => (a.anchor?.path ?? "").localeCompare(b.anchor?.path ?? ""));
	for (const comment of findings) {
		steps.push({ kind: "finding", comment, path: comment.anchor?.path ?? null });
	}
	return steps;
}

export function guideStepKey(step: GuideStep): string {
	return step.kind === "read" ? `read:${step.order}:${step.path}` : `finding:${step.comment.id}`;
}

export function guideCursorIndex(
	steps: readonly GuideStep[],
	cursor: { key: string; index: number } | null,
): number {
	if (!cursor) return -1;
	const found = steps.findIndex((step) => guideStepKey(step) === cursor.key);
	return found >= 0 ? found : Math.min(cursor.index, steps.length) - 1;
}

export function nextGuideStep(
	steps: readonly GuideStep[],
	inScope: ReadonlySet<string>,
	from: number,
	delta: 1 | -1,
): number | null {
	for (let hop = 1; hop <= steps.length; hop += 1) {
		const index = (from + delta * hop + steps.length) % steps.length;
		const step = steps[index];
		if (step && (step.path === null || inScope.has(step.path))) return index;
	}
	return null;
}

export function ChangesReviewGuide({
	tab,
	files,
	guide,
	comments,
	onReveal,
}: {
	tab: ChangesTab;
	files: readonly GitFileChange[];
	guide: ReviewGuide | undefined;
	comments: readonly ReviewComment[] | undefined;
	onReveal: (path: string, commentId?: string) => void;
}) {
	const t = useT();
	const { workspaceId } = tab;
	const steps = useMemo(() => guideSteps(guide, comments), [guide, comments]);
	const [cursorAt, setCursorAt] = useState<{ key: string; index: number } | null>(null);
	const cursor = guideCursorIndex(steps, cursorAt);
	const inScope = useMemo(() => new Set(files.map((change) => change.path)), [files]);
	const findings = steps.filter(
		(step): step is Extract<GuideStep, { kind: "finding" }> => step.kind === "finding",
	);
	const openFindingIds = findings
		.filter((step) => step.comment.status === "draft")
		.map((step) => step.comment.id);

	const [sending, setSending] = useState(false);
	const send = (operation: () => Promise<void>) => {
		if (sending) return;
		setSending(true);
		const done = () => setSending(false);
		void Promise.resolve().then(operation).then(done, done);
	};

	const go = (index: number) => {
		const step = steps[index];
		if (!step) return;
		setCursorAt({ key: guideStepKey(step), index });
		if (step.path) onReveal(step.path, step.kind === "finding" ? step.comment.id : undefined);
	};
	const stepFrom = (from: number, delta: 1 | -1) => {
		const index = nextGuideStep(steps, inScope, from, delta);
		if (index !== null) go(index);
	};
	const next = () => stepFrom(cursor, 1);
	const previous = () => stepFrom(Math.max(cursor, 0), -1);

	useEffect(() => {
		if (steps.length === 0) return;
		const onKey = (event: KeyboardEvent) => {
			if (!ownsReviewShortcut(event, tab)) return;
			if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
			if (event.key === NEXT_KEY) {
				event.preventDefault();
				next();
			} else if (event.key === PREVIOUS_KEY) {
				event.preventDefault();
				previous();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	const readSteps = steps.filter((step) => step.kind === "read");
	return (
		<aside
			data-testid="changes-review-guide"
			className="flex w-[280px] shrink-0 flex-col border-border-default border-r bg-container-sidebar-bg"
		>
			<div className="min-h-0 flex-1 overflow-auto">
				<GuideHeading>{t("changes.guide.heading")}</GuideHeading>
				{guide ? (
					<p
						data-testid="changes-review-guide-summary"
						className="px-12 pb-8 tr-text-metadata text-text-muted"
					>
						<span
							className={`mr-4 rounded-xs px-4 ${
								guide.verdict === "approve"
									? "bg-feedback-success-subtle text-feedback-success"
									: "bg-feedback-warning-subtle text-feedback-warning"
							}`}
						>
							{guide.verdict === "approve"
								? t("changes.guide.approved")
								: t("changes.guide.changesRequested")}
						</span>
						{guide.summary}
					</p>
				) : (
					<p className="px-12 pb-8 tr-text-metadata text-text-subtle">
						{t("changes.guide.noSummary")}
					</p>
				)}
				{readSteps.length > 0 ? (
					<>
						<GuideHeading>{t("changes.guide.readingOrder")}</GuideHeading>
						<ol className="flex flex-col">
							{steps.map((step, index) =>
								step.kind === "read" ? (
									<li key={guideStepKey(step)}>
										<button
											type="button"
											data-testid="changes-review-guide-step"
											data-active={cursor === index ? true : undefined}
											disabled={!inScope.has(step.path)}
											onClick={() => go(index)}
											className={`flex w-full items-start gap-8 border-l-2 px-12 py-4 text-left outline-none hover:bg-control-bg-hovered focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary disabled:opacity-50 disabled:hover:bg-transparent ${
												cursor === index
													? "border-primary bg-control-bg-selected"
													: "border-transparent"
											}`}
										>
											<span
												className={`mt-2 flex size-16 shrink-0 items-center justify-center rounded-full border tr-text-metadata ${
													cursor > index
														? "border-primary bg-primary text-text-on-primary"
														: "border-control-border-active text-text-muted"
												}`}
											>
												{index + 1}
											</span>
											<span className="flex min-w-0 flex-col">
												<span className="tr-text-metadata text-text-default">{step.why}</span>
												<span className="truncate tr-code-text text-text-subtle">
													{splitPath(step.path).dir}
													<span className="text-text-muted">{splitPath(step.path).base}</span>
												</span>
											</span>
										</button>
									</li>
								) : null,
							)}
						</ol>
					</>
				) : null}
				<GuideHeading>{t("changes.guide.findings", { count: findings.length })}</GuideHeading>
				{findings.length === 0 ? (
					<p className="px-12 pb-8 tr-text-metadata text-text-subtle">
						{t("changes.guide.noFindings")}
					</p>
				) : (
					<ul className="flex flex-col gap-4 px-8 pb-8">
						{steps.map((step, index) =>
							step.kind === "finding" ? (
								<li key={step.comment.id}>
									<div
										data-testid="changes-review-guide-finding"
										data-active={cursor === index ? true : undefined}
										className={`rounded-md border p-8 ${
											cursor === index
												? "border-feedback-warning bg-feedback-warning-subtle"
												: "border-control-border-default"
										}`}
									>
										<button
											type="button"
											onClick={() => go(index)}
											className="flex w-full flex-col items-start gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary"
										>
											<span className="flex items-center gap-4 tr-text-metadata text-text-subtle">
												<Robot className="size-12" />
												{step.comment.status === "sent"
													? t("changes.guide.findingSent")
													: t("changes.guide.findingOpen")}
											</span>
											<span className="tr-text-metadata text-text-default">
												{step.comment.body}
											</span>
											{step.path ? (
												<span className="truncate tr-code-text text-text-subtle">{step.path}</span>
											) : null}
										</button>
										{step.comment.status === "draft" ? (
											<Button
												size="s"
												data-testid="changes-review-guide-fix"
												disabled={sending}
												onClick={() => send(() => sendReviewComment(workspaceId, step.comment.id))}
												className="mt-8"
											>
												{t("changes.guide.fixOne")}
											</Button>
										) : null}
									</div>
								</li>
							) : null,
						)}
					</ul>
				)}
			</div>
			<div className="flex shrink-0 items-center gap-4 border-border-default border-t px-8 py-4">
				<IconButton
					variant="outline"
					icon={ChevronLeft}
					label={t("changes.guide.previous", { key: PREVIOUS_KEY.toUpperCase() })}
					data-testid="changes-review-guide-prev"
					disabled={steps.length === 0}
					onClick={previous}
				/>
				<Button
					size="m"
					iconRight={ChevronRight}
					data-testid="changes-review-guide-next"
					disabled={steps.length === 0}
					onClick={next}
					className="flex-1"
				>
					{cursor < 0
						? t("changes.guide.start")
						: cursor + 1 < steps.length
							? t("common.next")
							: t("changes.guide.restart")}
					<span className="tabular-nums">
						{cursor < 0 ? "" : `${cursor + 1} / ${steps.length}`}
					</span>
					<kbd className="rounded-xs border border-current px-4 tr-code-text">
						{NEXT_KEY.toUpperCase()}
					</kbd>
				</Button>
				<Button
					variant="outline"
					size="m"
					iconLeft={Robot}
					data-testid="changes-review-guide-apply"
					disabled={sending || openFindingIds.length === 0}
					onClick={() => send(() => sendReviewBatch(workspaceId, openFindingIds))}
					tooltip={t("changes.guide.applyTitle")}
				>
					{t("changes.guide.apply")}
				</Button>
			</div>
		</aside>
	);
}

function GuideHeading({ children }: { children: ReactNode }) {
	return <h4 className="px-12 pt-12 pb-4 tr-text-eyebrow text-text-subtle">{children}</h4>;
}
