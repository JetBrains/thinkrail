import {
	RiCheckLine as Check,
	RiArrowDownSLine as ChevronDown,
	RiArrowLeftSLine as ChevronLeft,
	RiArrowRightSLine as ChevronRight,
	RiArrowUpSLine as ChevronUp,
	RiGuideLine as Guide,
	RiParagraph as Pilcrow,
} from "@remixicon/react";
import type { GitFileChange, GitStatus } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { diffRendererSupportsLayout } from "@thinkrail/resource-renderers";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { ToggleSegment } from "@thinkrail/ui/toggle-segment";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso } from "react-virtuoso";
import { usePhoneViewport } from "@/lib";
import {
	type ChangesTab,
	selectDiffBaseRef,
	selectDiffTabTargetRef,
	toast,
	useAppStore,
} from "../store";
import { errorText, wsErrorCode } from "../transport";
import { ChangesFileSection } from "./ChangesFileSection";
import { ChangesReviewGuide, guideSteps } from "./ChangesReviewGuide";
import { LARGE_SCOPE_FILES, scopeKey, scopeLabel, sectionCollapsedByDefault } from "./changesModel";
import { DiffStatBadge } from "./DiffStatBadge";
import { peekGitStatus, readGitStatus } from "./gitStatusCache";
import { HeaderIconButton } from "./HeaderIconButton";
import { ownsReviewShortcut } from "./reviewShortcuts";
import { SendAllReviewsButton } from "./SendReviewButton";
import { createSectionContentCache } from "./sectionContentCache";
import { useReviewReveal } from "./useReviewReveal";
import { useWorkspaceRead } from "./useWorkspaceRead";
import { useWorkspaceTurns } from "./useWorkspaceTurns";

const VIEWED_KEY = "v";
const NEXT_UNREVIEWED_KEY = "j";

interface ReviewListContext {
	tailHeight: number;
	fileCount: number;
}

function ReviewListFooter({ context }: { context?: ReviewListContext }) {
	const t = useT();
	return (
		<div
			data-testid="changes-review-end"
			style={{ minHeight: context?.tailHeight ?? 0 }}
			className="px-12 py-16 text-center tr-text-metadata text-text-subtle"
		>
			{t("changes.review.end", { count: context?.fileCount ?? 0 })}
		</div>
	);
}

const REVIEW_LIST_COMPONENTS = { Footer: ReviewListFooter };
const NOOP_TOGGLE = () => {};

export function ChangesReviewPane({ tab }: { tab: ChangesTab }) {
	const t = useT();
	const { workspaceId, scope } = tab;
	const mobile = usePhoneViewport();
	const [error, setError] = useState<string | null>(null);
	const [scopeGone, setScopeGone] = useState(false);
	const warnedRef = useRef(false);
	const baseRef = useAppStore((state) => selectDiffBaseRef(state, workspaceId));
	const targetRef = useAppStore((state) => selectDiffTabTargetRef(state, { workspaceId, scope }));
	const [status, setStatus] = useState<GitStatus | null>(() =>
		peekGitStatus(workspaceId, scope, targetRef),
	);
	const [statusSettled, setStatusSettled] = useState(false);
	const layout = useAppStore((state) => state.changesLayout);
	const setStoreLayout = useAppStore((state) => state.setChangesLayout);
	const setView = useAppStore((state) => state.setChangesTabView);
	const setIgnoreWhitespace = useAppStore((state) => state.setChangesTabIgnoreWhitespace);
	const setViewed = useAppStore((state) => state.setChangesTabViewed);
	const setActivePath = useAppStore((state) => state.setChangesTabActivePath);
	const setCollapsed = useAppStore((state) => state.setChangesTabCollapsed);
	const requestReveal = useAppStore((state) => state.requestChangesTabReveal);
	const [cache] = useState(createSectionContentCache);
	const turns = useWorkspaceTurns(workspaceId);
	const reviewGuide = useAppStore((state) => state.reviewsByWorkspace[workspaceId]?.review.guide);
	const reviewComments = useAppStore((state) => state.reviewsByWorkspace[workspaceId]?.comments);
	const guideAvailable = useMemo(
		() => reviewGuide !== undefined || guideSteps(reviewGuide, reviewComments).length > 0,
		[reviewComments, reviewGuide],
	);
	const [guideHidden, setGuideHidden] = useState(false);
	const guideOpen = guideAvailable && !guideHidden && layout === "stacked" && !mobile;
	const [largeNoticeDismissed, setLargeNoticeDismissed] = useState(false);

	const readKey = `${scopeKey(scope)}:${targetRef}`;
	const { reload } = useWorkspaceRead(
		workspaceId,
		(id) => readGitStatus(id, scope, targetRef),
		{
			onResult: (result) => {
				setStatus(result);
				setStatusSettled(true);
				setError(null);
				setScopeGone(false);
				warnedRef.current = false;
			},
			onFailure: (_id, failure) => {
				setStatusSettled(true);
				if (wsErrorCode(failure) === "UNKNOWN_COMMIT") {
					setStatus(null);
					setScopeGone(true);
					setError(
						scope.kind === "turn" ? t("changes.review.turnGone") : t("changes.review.commitGone"),
					);
					return;
				}
				if (status && !warnedRef.current) {
					warnedRef.current = true;
					toast.error(t("changes.refreshFailed", { error: errorText(failure) }));
				}
				setError(errorText(failure));
			},
			onSwitch: () => {
				setStatus(peekGitStatus(workspaceId, scope, targetRef));
				setStatusSettled(false);
				setError(null);
				setScopeGone(false);
				warnedRef.current = false;
			},
		},
		readKey,
	);

	const files = useMemo(() => status?.changes ?? [], [status]);
	const viewedSet = useMemo(() => new Set(tab.viewed), [tab.viewed]);
	const isCollapsed = useCallback(
		(change: GitFileChange) => tab.collapsed[change.path] ?? sectionCollapsedByDefault(change),
		[tab.collapsed],
	);
	const totals = useMemo(
		() =>
			files.reduce(
				(sum, change) => ({
					added: sum.added + (change.added ?? 0),
					removed: sum.removed + (change.removed ?? 0),
				}),
				{ added: 0, removed: 0 },
			),
		[files],
	);
	const viewedCount = files.filter((change) => viewedSet.has(change.path)).length;
	const view = mobile ? "inline" : (tab.view ?? "split");
	const layoutToggleAvailable = useMemo(
		() =>
			!mobile &&
			files.some((change) =>
				diffRendererSupportsLayout(
					workspaceId,
					change.path,
					scope,
					tab.sections[change.path]?.rendererId,
					mobile,
				),
			),
		[files, mobile, scope, tab.sections, workspaceId],
	);
	const ignoreWhitespace = tab.ignoreWhitespace ?? false;

	const [lastIndex, setLastIndex] = useState(0);
	const foundIndex = files.findIndex((change) => change.path === tab.activePath);
	if (foundIndex >= 0 && foundIndex !== lastIndex) setLastIndex(foundIndex);
	const currentIndex =
		foundIndex >= 0 ? foundIndex : Math.min(lastIndex, Math.max(0, files.length - 1));
	const current = files[currentIndex];

	const {
		virtuoso,
		attachScroller,
		tailHeight,
		spyActiveSection,
		onTotalListHeightChanged,
		handoffPath,
		startHandoff,
	} = useReviewReveal({
		workspaceId,
		tabId: tab.id,
		files,
		status,
		statusSettled,
		readKey,
		layout,
		reveal: tab.reveal,
		activePath: tab.activePath,
	});
	const setLayout = (next: typeof layout) => {
		startHandoff(next === "stacked" && layout === "single" ? (current?.path ?? null) : null);
		setStoreLayout(next);
	};

	useEffect(() => {
		if (!status || tab.reveal) return;
		if (tab.activePath !== null && files.some((change) => change.path === tab.activePath)) return;
		if (tab.activePath !== null && !statusSettled) return;
		setActivePath(workspaceId, tab.id, current?.path ?? null);
	}, [
		current,
		files,
		setActivePath,
		status,
		statusSettled,
		tab.activePath,
		tab.id,
		tab.reveal,
		workspaceId,
	]);

	const setPathViewed = useCallback(
		(path: string, next: boolean) => setViewed(workspaceId, tab.id, path, next),
		[setViewed, tab.id, workspaceId],
	);
	const toggleCollapsed = useCallback(
		(change: GitFileChange) => {
			const latest = useAppStore
				.getState()
				.tabsByWorkspace[workspaceId]?.find((candidate) => candidate.id === tab.id);
			const collapsed =
				(latest?.kind === "changes" ? latest.collapsed[change.path] : undefined) ??
				sectionCollapsedByDefault(change);
			setCollapsed(workspaceId, tab.id, { [change.path]: !collapsed });
		},
		[setCollapsed, tab.id, workspaceId],
	);
	const goTo = (change: GitFileChange | undefined) => {
		if (!change) return;
		if (layout === "single") setActivePath(workspaceId, tab.id, change.path);
		else requestReveal(workspaceId, tab.id, change.path);
	};
	const step = (delta: number) => goTo(files[currentIndex + delta]);
	const nextUnreviewed = () => {
		const after = files.slice(currentIndex + 1).find((change) => !viewedSet.has(change.path));
		goTo(after ?? files.find((change) => !viewedSet.has(change.path)));
	};
	const markViewedAndAdvance = () => {
		if (!current) return;
		const wasViewed = viewedSet.has(current.path);
		setViewed(workspaceId, tab.id, current.path, !wasViewed);
		if (!wasViewed && layout === "single") step(1);
	};
	const markAllViewed = () =>
		setViewed(
			workspaceId,
			tab.id,
			files.map((change) => change.path),
			true,
		);

	useEffect(() => {
		if (!status) return;
		const onKey = (event: KeyboardEvent) => {
			if (!ownsReviewShortcut(event, tab)) return;
			const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
			if (event.altKey && event.key === "ArrowDown") {
				event.preventDefault();
				step(1);
			} else if (event.altKey && event.key === "ArrowUp") {
				event.preventDefault();
				step(-1);
			} else if (plain && event.key === VIEWED_KEY) {
				event.preventDefault();
				markViewedAndAdvance();
			} else if (plain && event.key === NEXT_UNREVIEWED_KEY) {
				event.preventDefault();
				nextUnreviewed();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	const targetLabel =
		scope.kind === "branch"
			? t("changes.review.versusBase", { ref: baseRef })
			: scope.kind === "uncommitted"
				? t("changes.review.worktree")
				: scope.kind === "turn"
					? t("changes.review.agentSnapshot")
					: null;
	const showLargeNotice =
		layout === "stacked" && files.length > LARGE_SCOPE_FILES && !largeNoticeDismissed;

	return (
		<div data-testid="changes-review" className="flex h-full min-h-0 flex-col">
			<div
				data-testid="changes-review-toolbar"
				role="toolbar"
				aria-label={t("changes.review.toolbar")}
				className="flex h-32 shrink-0 items-center gap-4 border-border-default border-b bg-container-header-bg px-12"
			>
				<span
					data-testid="changes-review-scope"
					className="flex min-w-0 shrink items-baseline gap-4 truncate tr-text-metadata"
				>
					<span className="text-text-default">{scopeLabel(t, scope, [], turns)}</span>
					{targetLabel ? <span className="truncate text-text-muted">{targetLabel}</span> : null}
				</span>
				{status ? (
					<span
						data-testid="changes-review-summary"
						className="flex min-w-0 shrink items-center gap-4 truncate tr-text-metadata text-text-muted"
					>
						<span>{t("changes.review.fileCount", { count: files.length })}</span>
						<DiffStatBadge added={totals.added} removed={totals.removed} />
						<span data-testid="changes-review-viewed-count">
							{t("changes.review.viewedCount", { viewed: viewedCount, total: files.length })}
						</span>
					</span>
				) : null}
				<span className="ml-auto flex shrink-0 items-center gap-4">
					<SendAllReviewsButton
						workspaceId={workspaceId}
						testid="changes-review-send"
						verb={t("changes.review.sendVerb")}
					/>
					{layout === "stacked" && files.length > 0 ? (
						<>
							<HeaderIconButton
								testid="changes-review-collapse-all"
								label={t("changes.review.collapseAll")}
								onClick={() =>
									setCollapsed(
										workspaceId,
										tab.id,
										Object.fromEntries(files.map((change) => [change.path, true])),
									)
								}
							>
								<ChevronUp className="size-14" />
							</HeaderIconButton>
							<HeaderIconButton
								testid="changes-review-expand-all"
								label={t("changes.review.expandAll")}
								onClick={() =>
									setCollapsed(
										workspaceId,
										tab.id,
										Object.fromEntries(files.map((change) => [change.path, false])),
									)
								}
							>
								<ChevronDown className="size-14" />
							</HeaderIconButton>
						</>
					) : null}
					{guideAvailable && layout === "stacked" && !mobile ? (
						<HeaderIconButton
							testid="changes-review-guide-toggle"
							label={guideOpen ? t("changes.review.hideGuide") : t("changes.review.showGuide")}
							active={guideOpen}
							onClick={() => setGuideHidden((hidden) => !hidden)}
						>
							<Guide className="size-14" />
						</HeaderIconButton>
					) : null}
					<HeaderIconButton
						testid="changes-review-toggle-whitespace"
						label={t("changes.review.hideWhitespace")}
						active={ignoreWhitespace}
						onClick={() => setIgnoreWhitespace(workspaceId, tab.id, !ignoreWhitespace)}
					>
						<Pilcrow className="size-14" />
					</HeaderIconButton>
					{layoutToggleAvailable ? (
						<>
							<ToggleSegment
								testid="changes-review-toggle-split"
								label={t("changes.review.split")}
								active={view === "split"}
								onClick={() => setView(workspaceId, tab.id, "split")}
							/>
							<ToggleSegment
								testid="changes-review-toggle-inline"
								label={t("changes.review.inline")}
								active={view === "inline"}
								onClick={() => setView(workspaceId, tab.id, "inline")}
							/>
							<span className="mx-4 h-16 w-px bg-border-default" />
						</>
					) : null}
					<ToggleSegment
						testid="changes-review-layout-stacked"
						label={t("changes.review.stacked")}
						active={layout === "stacked"}
						onClick={() => setLayout("stacked")}
					/>
					<ToggleSegment
						testid="changes-review-layout-single"
						label={t("changes.review.oneFile")}
						active={layout === "single"}
						onClick={() => setLayout("single")}
					/>
				</span>
			</div>
			{status === null && error !== null ? (
				<div data-testid="changes-review-error" className="flex flex-col items-start gap-4 p-12">
					<p className="tr-text-metadata text-feedback-error">
						{scopeGone ? error : t("changes.readFailed", { error })}
					</p>
					{scopeGone ? (
						<button
							type="button"
							data-testid="changes-review-all-changes"
							onClick={() =>
								useAppStore.getState().requestChangesView(workspaceId, null, { kind: "branch" })
							}
							className="rounded-sm px-4 py-2 tr-text-metadata text-text-muted transition-colors hover:bg-control-bg-hovered hover:text-text-default"
						>
							{t("changes.review.allChanges")}
						</button>
					) : (
						<button
							type="button"
							data-testid="changes-review-retry"
							onClick={reload}
							className="rounded-sm px-4 py-2 tr-text-metadata text-text-muted transition-colors hover:bg-control-bg-hovered hover:text-text-default"
						>
							{t("common.retry")}
						</button>
					)}
				</div>
			) : status === null ? (
				<LoadingRegion rows={8} className="p-12" />
			) : files.length === 0 ? (
				<p data-testid="changes-review-empty" className="p-12 tr-text-metadata text-text-muted">
					{t("changes.empty")}
				</p>
			) : (
				<div className="relative flex min-h-0 flex-1 flex-col">
					{(layout === "single" || handoffPath !== null) && current ? (
						<>
							<div
								data-testid="changes-review-walk"
								className="flex h-32 shrink-0 items-center gap-4 border-border-default border-b bg-container-header-bg px-12"
							>
								<HeaderIconButton
									testid="changes-review-prev"
									label={t("changes.review.previousFile")}
									disabled={currentIndex === 0}
									onClick={() => step(-1)}
								>
									<ChevronLeft className="size-14" />
								</HeaderIconButton>
								<span
									data-testid="changes-review-counter"
									className="tr-text-metadata tabular-nums text-text-muted"
								>
									{currentIndex + 1} / {files.length}
								</span>
								<HeaderIconButton
									testid="changes-review-next"
									label={t("changes.review.nextFile")}
									disabled={currentIndex >= files.length - 1}
									onClick={() => step(1)}
								>
									<ChevronRight className="size-14" />
								</HeaderIconButton>
								<button
									type="button"
									data-testid="changes-review-mark-viewed"
									aria-pressed={viewedSet.has(current.path)}
									onClick={markViewedAndAdvance}
									className={`ml-auto flex h-24 items-center gap-4 rounded-sm border px-8 tr-text-metadata outline-none focus-visible:ring-2 focus-visible:ring-primary ${
										viewedSet.has(current.path)
											? "border-primary text-primary"
											: "border-control-border-default text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
									}`}
								>
									<Check className="size-14" />
									{viewedSet.has(current.path)
										? t("changes.review.viewed")
										: t("changes.review.markViewed")}
									<kbd className="rounded-xs border border-control-border-default px-4 tr-code-text text-text-subtle">
										{VIEWED_KEY.toUpperCase()}
									</kbd>
								</button>
							</div>
							<div className="min-h-0 flex-1">
								<ChangesFileSection
									key={current.path}
									workspaceId={workspaceId}
									tabId={tab.id}
									scope={scope}
									tabView={tab.view}
									ignoreWhitespace={ignoreWhitespace}
									section={tab.sections[current.path]}
									keptList={tab.kept[current.path]}
									change={current}
									mode="single"
									collapsed={false}
									collapsedByDefault={false}
									viewed={viewedSet.has(current.path)}
									cache={cache}
									onToggleCollapsed={NOOP_TOGGLE}
									onSetViewed={setPathViewed}
								/>
							</div>
						</>
					) : null}
					{layout === "stacked" ? (
						<div
							className={
								handoffPath !== null ? "invisible absolute inset-0 flex" : "flex min-h-0 flex-1"
							}
						>
							{guideOpen ? (
								<ChangesReviewGuide
									tab={tab}
									files={files}
									guide={reviewGuide}
									comments={reviewComments}
									onReveal={(path, commentId) =>
										requestReveal(workspaceId, tab.id, path, commentId)
									}
								/>
							) : null}
							<div className="relative min-h-0 flex-1 bg-container-content-bg">
								{showLargeNotice ? (
									<div
										data-testid="changes-review-large-notice"
										className="flex items-center gap-8 border-border-default border-b bg-feedback-info-subtle px-12 py-4 tr-text-metadata text-text-muted"
									>
										<span>{t("changes.review.largeNotice", { count: files.length })}</span>
										<button
											type="button"
											onClick={() => setLayout("single")}
											className="text-text-default underline-offset-2 hover:underline"
										>
											{t("changes.review.switchToOneFile")}
										</button>
										<button
											type="button"
											onClick={() => setLargeNoticeDismissed(true)}
											className="ml-auto text-text-subtle hover:text-text-default"
										>
											{t("common.dismiss")}
										</button>
									</div>
								) : null}
								<Virtuoso<GitFileChange, ReviewListContext>
									ref={virtuoso}
									data={files}
									computeItemKey={(_index, change) => change.path}
									className="h-full min-h-0 [overflow-anchor:none]"
									increaseViewportBy={{ top: 200, bottom: 600 }}
									scrollerRef={attachScroller}
									onScroll={spyActiveSection}
									rangeChanged={spyActiveSection}
									totalListHeightChanged={onTotalListHeightChanged}
									itemContent={(_index, change) => (
										<ChangesFileSection
											workspaceId={workspaceId}
											tabId={tab.id}
											scope={scope}
											tabView={tab.view}
											ignoreWhitespace={ignoreWhitespace}
											section={tab.sections[change.path]}
											keptList={tab.kept[change.path]}
											change={change}
											mode="stacked"
											collapsed={isCollapsed(change)}
											collapsedByDefault={sectionCollapsedByDefault(change)}
											viewed={viewedSet.has(change.path)}
											cache={cache}
											onToggleCollapsed={toggleCollapsed}
											onSetViewed={setPathViewed}
										/>
									)}
									context={{ tailHeight, fileCount: files.length }}
									components={REVIEW_LIST_COMPONENTS}
								/>
								<div
									data-testid="changes-review-triage"
									className="absolute inset-x-0 bottom-0 flex h-32 items-center gap-8 overflow-hidden whitespace-nowrap border-border-default border-t bg-container-header-bg px-12"
								>
									<span className="shrink-0 tr-text-metadata text-text-muted">
										{t("changes.review.progress", { viewed: viewedCount, total: files.length })}
									</span>
									<progress
										data-testid="changes-review-progress"
										aria-label={t("changes.review.progressLabel")}
										max={Math.max(files.length, 1)}
										value={viewedCount}
										className="h-4 w-120 min-w-0 shrink appearance-none overflow-hidden rounded-xs bg-control-bg-hovered accent-primary [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-control-bg-hovered [&::-webkit-progress-value]:bg-primary"
									/>
									<span className="ml-auto flex shrink-0 items-center gap-4">
										<button
											type="button"
											data-testid="changes-review-next-unreviewed"
											disabled={viewedCount >= files.length}
											onClick={nextUnreviewed}
											className="flex h-24 items-center gap-4 rounded-sm border border-control-border-default px-8 tr-text-metadata text-text-muted outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary disabled:text-control-disabled-text disabled:hover:bg-transparent"
										>
											{t("changes.review.nextUnreviewed")}
											<kbd className="rounded-xs border border-control-border-default px-4 tr-code-text text-text-subtle">
												{NEXT_UNREVIEWED_KEY.toUpperCase()}
											</kbd>
										</button>
										<button
											type="button"
											data-testid="changes-review-mark-all"
											disabled={viewedCount >= files.length}
											onClick={markAllViewed}
											className="flex h-24 items-center gap-4 rounded-sm border border-control-border-default px-8 tr-text-metadata text-text-muted outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary disabled:text-control-disabled-text disabled:hover:bg-transparent"
										>
											<Check className="size-14" />
											{t("changes.review.markAllViewed")}
										</button>
									</span>
								</div>
							</div>
						</div>
					) : null}
				</div>
			)}
		</div>
	);
}
