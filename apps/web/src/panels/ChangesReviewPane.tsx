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
import { useCallback, useEffect, useInsertionEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { usePhoneViewport } from "@/lib";
import { LoadingRegion } from "../components/Skeleton";
import {
	type ChangesTab,
	selectDiffBaseRef,
	selectDiffTabTargetRef,
	toast,
	useAppStore,
} from "../store";
import { errorText, getTransport, wsErrorCode } from "../transport";
import { ChangesFileSection } from "./ChangesFileSection";
import { ChangesReviewGuide, guideSteps } from "./ChangesReviewGuide";
import { LARGE_SCOPE_FILES, scopeKey, scopeLabel, sectionCollapsedByDefault } from "./changesModel";
import { DiffStatBadge } from "./DiffStatBadge";
import { HeaderIconButton } from "./HeaderIconButton";
import { ownsReviewShortcut } from "./reviewShortcuts";
import { SendAllReviewsButton } from "./SendReviewButton";
import { createSectionContentCache } from "./sectionContentCache";
import { ToggleSegment } from "./ToggleSegment";
import { useWorkspaceRead } from "./useWorkspaceRead";
import { useWorkspaceTurns } from "./useWorkspaceTurns";

const SECTION_HEADER_HEIGHT = 32;
const END_NOTE_HEIGHT = 48;
const USER_SCROLL_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

interface ReviewListContext {
	tailHeight: number;
	fileCount: number;
}

function ReviewListFooter({ context }: { context?: ReviewListContext }) {
	return (
		<div
			data-testid="changes-review-end"
			style={{ minHeight: context?.tailHeight ?? 0 }}
			className="px-12 py-16 text-center tr-text-metadata text-text-subtle"
		>
			End of changes · {context?.fileCount ?? 0} {context?.fileCount === 1 ? "file" : "files"}
		</div>
	);
}

const REVIEW_LIST_COMPONENTS = { Footer: ReviewListFooter };
const NOOP_TOGGLE = () => {};

export function ChangesReviewPane({ tab }: { tab: ChangesTab }) {
	const { workspaceId, scope } = tab;
	const mobile = usePhoneViewport();
	const [status, setStatus] = useState<GitStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const warnedRef = useRef(false);
	const baseRef = useAppStore((state) => selectDiffBaseRef(state, workspaceId));
	const targetRef = useAppStore((state) => selectDiffTabTargetRef(state, { workspaceId, scope }));
	const layout = useAppStore((state) => state.changesLayout);
	const setLayout = useAppStore((state) => state.setChangesLayout);
	const setView = useAppStore((state) => state.setChangesTabView);
	const setIgnoreWhitespace = useAppStore((state) => state.setChangesTabIgnoreWhitespace);
	const setViewed = useAppStore((state) => state.setChangesTabViewed);
	const setActivePath = useAppStore((state) => state.setChangesTabActivePath);
	const setCollapsed = useAppStore((state) => state.setChangesTabCollapsed);
	const consumeReveal = useAppStore((state) => state.consumeChangesTabReveal);
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
	const restoredStacked = useRef(false);

	const { reload } = useWorkspaceRead(
		workspaceId,
		(id) => getTransport().request("git.status", { workspaceId: id, scope }),
		{
			onResult: (result) => {
				setStatus(result);
				setError(null);
				warnedRef.current = false;
			},
			onFailure: (_id, failure) => {
				if (wsErrorCode(failure) === "UNKNOWN_COMMIT") {
					setError(
						scope.kind === "turn"
							? "That agent turn's snapshot is no longer in this repository."
							: "That commit is no longer in this branch.",
					);
					return;
				}
				if (status && !warnedRef.current) {
					warnedRef.current = true;
					toast.error(`Could not refresh the changes: ${errorText(failure)}`);
				}
				setError(errorText(failure));
			},
			onSwitch: () => {
				setStatus(null);
				setError(null);
				warnedRef.current = false;
				restoredStacked.current = false;
			},
		},
		`${scopeKey(scope)}:${targetRef}`,
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
	const ignoreWhitespace = tab.ignoreWhitespace ?? false;

	const [lastIndex, setLastIndex] = useState(0);
	const foundIndex = files.findIndex((change) => change.path === tab.activePath);
	if (foundIndex >= 0 && foundIndex !== lastIndex) setLastIndex(foundIndex);
	const currentIndex =
		foundIndex >= 0 ? foundIndex : Math.min(lastIndex, Math.max(0, files.length - 1));
	const current = files[currentIndex];

	const virtuoso = useRef<VirtuosoHandle>(null);
	const scrollerRef = useRef<HTMLElement | null>(null);
	const [tailHeight, setTailHeight] = useState(0);
	const tailObserver = useRef<ResizeObserver | null>(null);
	const settling = useRef<{ path: string; commentId?: string } | null>(null);
	const releaseSettling = useCallback(() => {
		const commentId = settling.current?.commentId;
		settling.current = null;
		if (commentId) useAppStore.getState().clearReviewFocus(commentId);
	}, []);
	const detachScroller = useRef<(() => void) | null>(null);
	const attachScroller = useCallback(
		(element: HTMLElement | Window | null) => {
			detachScroller.current?.();
			detachScroller.current = null;
			tailObserver.current?.disconnect();
			tailObserver.current = null;
			const scroller = element instanceof HTMLElement ? element : null;
			scrollerRef.current = scroller;
			if (!scroller) return;
			const measure = () => {
				setTailHeight(Math.max(0, scroller.clientHeight - SECTION_HEADER_HEIGHT - END_NOTE_HEIGHT));
			};
			measure();
			tailObserver.current = new ResizeObserver(measure);
			tailObserver.current.observe(scroller);
			for (const type of USER_SCROLL_EVENTS)
				scroller.addEventListener(type, releaseSettling, { passive: true, capture: true });
			detachScroller.current = () => {
				for (const type of USER_SCROLL_EVENTS)
					scroller.removeEventListener(type, releaseSettling, true);
			};
		},
		[releaseSettling],
	);
	useEffect(
		() => () => {
			tailObserver.current?.disconnect();
			detachScroller.current?.();
			releaseSettling();
		},
		[releaseSettling],
	);
	const activePathRef = useRef(tab.activePath);
	useInsertionEffect(() => {
		activePathRef.current = tab.activePath;
	});
	const spyFrame = useRef(0);
	const scrollToSection = useCallback(
		(index: number, target: { path: string; commentId?: string }) => {
			releaseSettling();
			settling.current = target;
			virtuoso.current?.scrollToIndex({ index, align: "start" });
		},
		[releaseSettling],
	);
	const revealComment = useCallback(() => {
		const commentId = settling.current?.commentId;
		const scroller = scrollerRef.current;
		if (!commentId || !scroller) return false;
		const card = [...scroller.querySelectorAll<HTMLElement>("[data-comment-id]")].find(
			(element) => element.dataset.commentId === commentId,
		);
		if (!card) return false;
		card.scrollIntoView({ block: "center" });
		return true;
	}, []);
	const spyActiveSection = useCallback(() => {
		if (!restoredStacked.current) return;
		cancelAnimationFrame(spyFrame.current);
		spyFrame.current = requestAnimationFrame(() => {
			if (settling.current) {
				revealComment();
				return;
			}
			const scroller = scrollerRef.current;
			if (!scroller) return;
			const edge = scroller.getBoundingClientRect().top + SECTION_HEADER_HEIGHT / 2;
			let active: string | null = null;
			for (const section of scroller.querySelectorAll<HTMLElement>(
				'[data-testid="changes-section"]',
			)) {
				if (section.getBoundingClientRect().top <= edge) active = section.dataset.path ?? null;
			}
			if (active !== null && active !== activePathRef.current) {
				setActivePath(workspaceId, tab.id, active);
			}
		});
	}, [revealComment, setActivePath, tab.id, workspaceId]);
	useEffect(() => () => cancelAnimationFrame(spyFrame.current), []);
	useEffect(() => {
		const reveal = tab.reveal;
		if (!reveal || !status) return;
		const index = files.findIndex((change) => change.path === reveal.path);
		if (index < 0) {
			consumeReveal(workspaceId, tab.id, null);
			return;
		}
		const target = {
			path: reveal.path,
			...(reveal.commentId ? { commentId: reveal.commentId } : {}),
		};
		releaseSettling();
		consumeReveal(workspaceId, tab.id, target);
		if (layout === "stacked") {
			restoredStacked.current = true;
			scrollToSection(index, target);
		}
	}, [
		consumeReveal,
		files,
		layout,
		releaseSettling,
		scrollToSection,
		status,
		tab.id,
		tab.reveal,
		workspaceId,
	]);

	useEffect(() => {
		if (!status || tab.reveal) return;
		if (tab.activePath !== null && files.some((change) => change.path === tab.activePath)) return;
		setActivePath(workspaceId, tab.id, current?.path ?? null);
	}, [current, files, setActivePath, status, tab.activePath, tab.id, tab.reveal, workspaceId]);

	const pendingReveal = tab.reveal !== null;
	useEffect(() => {
		if (layout !== "stacked") {
			restoredStacked.current = false;
			settling.current = null;
			return;
		}
		if (pendingReveal || !status || restoredStacked.current) return;
		restoredStacked.current = true;
		const index = files.findIndex((change) => change.path === activePathRef.current);
		const change = files[index];
		if (!change) return;
		const frame = requestAnimationFrame(() => scrollToSection(index, { path: change.path }));
		return () => cancelAnimationFrame(frame);
	}, [files, layout, pendingReveal, scrollToSection, status]);

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
			} else if (plain && event.key === "v") {
				event.preventDefault();
				markViewedAndAdvance();
			} else if (plain && event.key === "j") {
				event.preventDefault();
				nextUnreviewed();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	const targetLabel =
		scope.kind === "branch"
			? `vs ${baseRef}`
			: scope.kind === "uncommitted"
				? "worktree"
				: scope.kind === "turn"
					? "agent snapshot"
					: null;
	const showLargeNotice =
		layout === "stacked" && files.length > LARGE_SCOPE_FILES && !largeNoticeDismissed;

	return (
		<div data-testid="changes-review" className="flex h-full min-h-0 flex-col">
			<div
				data-testid="changes-review-toolbar"
				role="toolbar"
				aria-label="Changes review"
				className="flex h-32 shrink-0 items-center gap-4 border-border-default border-b bg-container-header-bg px-12"
			>
				<span
					data-testid="changes-review-scope"
					className="flex min-w-0 shrink items-baseline gap-4 truncate tr-text-metadata"
				>
					<span className="text-text-default">{scopeLabel(scope, [], turns)}</span>
					{targetLabel ? <span className="truncate text-text-muted">{targetLabel}</span> : null}
				</span>
				{status ? (
					<span
						data-testid="changes-review-summary"
						className="flex min-w-0 shrink items-center gap-4 truncate tr-text-metadata text-text-muted"
					>
						<span>
							{files.length} {files.length === 1 ? "file" : "files"}
						</span>
						<DiffStatBadge added={totals.added} removed={totals.removed} />
						<span data-testid="changes-review-viewed-count">
							{viewedCount}/{files.length} viewed
						</span>
					</span>
				) : null}
				<span className="ml-auto flex shrink-0 items-center gap-4">
					<SendAllReviewsButton
						workspaceId={workspaceId}
						testid="changes-review-send"
						verb="Send review"
					/>
					{layout === "stacked" && files.length > 0 ? (
						<>
							<HeaderIconButton
								testid="changes-review-collapse-all"
								label="Collapse all files"
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
								label="Expand all files"
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
							label={guideOpen ? "Hide the review guide" : "Show the review guide"}
							active={guideOpen}
							onClick={() => setGuideHidden((hidden) => !hidden)}
						>
							<Guide className="size-14" />
						</HeaderIconButton>
					) : null}
					<HeaderIconButton
						testid="changes-review-toggle-whitespace"
						label="Hide whitespace changes"
						active={ignoreWhitespace}
						onClick={() => setIgnoreWhitespace(workspaceId, tab.id, !ignoreWhitespace)}
					>
						<Pilcrow className="size-14" />
					</HeaderIconButton>
					{!mobile ? (
						<>
							<ToggleSegment
								testid="changes-review-toggle-split"
								label="Split"
								active={view === "split"}
								onClick={() => setView(workspaceId, tab.id, "split")}
							/>
							<ToggleSegment
								testid="changes-review-toggle-inline"
								label="Inline"
								active={view === "inline"}
								onClick={() => setView(workspaceId, tab.id, "inline")}
							/>
							<span className="mx-4 h-16 w-px bg-border-default" />
						</>
					) : null}
					<ToggleSegment
						testid="changes-review-layout-stacked"
						label="Stacked"
						active={layout === "stacked"}
						onClick={() => setLayout("stacked")}
					/>
					<ToggleSegment
						testid="changes-review-layout-single"
						label="One file"
						active={layout === "single"}
						onClick={() => setLayout("single")}
					/>
				</span>
			</div>
			{status === null && error !== null ? (
				<div data-testid="changes-review-error" className="flex flex-col items-start gap-4 p-12">
					<p className="tr-text-metadata text-feedback-error">
						Could not read the changes: {error}
					</p>
					<button
						type="button"
						data-testid="changes-review-retry"
						onClick={reload}
						className="rounded-[var(--radius-sm)] px-4 py-2 tr-text-metadata text-text-muted transition-colors hover:bg-control-bg-hovered hover:text-text-default"
					>
						Retry
					</button>
				</div>
			) : status === null ? (
				<LoadingRegion rows={8} className="p-12" />
			) : files.length === 0 ? (
				<p data-testid="changes-review-empty" className="p-12 tr-text-metadata text-text-muted">
					No changes in this scope.
				</p>
			) : layout === "single" && current ? (
				<>
					<div
						data-testid="changes-review-walk"
						className="flex h-32 shrink-0 items-center gap-4 border-border-default border-b bg-container-header-bg px-12"
					>
						<HeaderIconButton
							testid="changes-review-prev"
							label="Previous file (Alt+↑)"
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
							label="Next file (Alt+↓)"
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
							className={`ml-auto flex h-24 items-center gap-4 rounded-[var(--radius-sm)] border px-8 tr-text-metadata outline-none focus-visible:ring-2 focus-visible:ring-primary ${
								viewedSet.has(current.path)
									? "border-primary text-primary"
									: "border-control-border-default text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
							}`}
						>
							<Check className="size-14" />
							{viewedSet.has(current.path) ? "Viewed" : "Mark viewed"}
							<kbd className="rounded-[var(--radius-xs)] border border-control-border-default px-4 tr-code-text text-text-subtle">
								V
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
			) : (
				<div className="flex min-h-0 flex-1">
					{guideOpen ? (
						<ChangesReviewGuide
							tab={tab}
							files={files}
							guide={reviewGuide}
							comments={reviewComments}
							onReveal={(path, commentId) => requestReveal(workspaceId, tab.id, path, commentId)}
						/>
					) : null}
					<div className="relative min-h-0 flex-1 bg-container-content-bg">
						{showLargeNotice ? (
							<div
								data-testid="changes-review-large-notice"
								className="flex items-center gap-8 border-border-default border-b bg-feedback-info-subtle px-12 py-4 tr-text-metadata text-text-muted"
							>
								<span>
									{files.length} files in this scope — reviewing one file at a time may be easier.
								</span>
								<button
									type="button"
									onClick={() => setLayout("single")}
									className="text-text-default underline-offset-2 hover:underline"
								>
									Switch to One file
								</button>
								<button
									type="button"
									onClick={() => setLargeNoticeDismissed(true)}
									className="ml-auto text-text-subtle hover:text-text-default"
								>
									Dismiss
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
							totalListHeightChanged={() => {
								if (revealComment()) return;
								const index = files.findIndex((change) => change.path === settling.current?.path);
								if (index >= 0) {
									virtuoso.current?.scrollToIndex({ index, align: "start" });
									return;
								}
								releaseSettling();
								spyActiveSection();
							}}
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
								{viewedCount} of {files.length} reviewed
							</span>
							<progress
								data-testid="changes-review-progress"
								aria-label="Files reviewed"
								max={Math.max(files.length, 1)}
								value={viewedCount}
								className="h-4 w-120 min-w-0 shrink appearance-none overflow-hidden rounded-[var(--radius-xs)] bg-control-bg-hovered accent-primary [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-control-bg-hovered [&::-webkit-progress-value]:bg-primary"
							/>
							<span className="ml-auto flex shrink-0 items-center gap-4">
								<button
									type="button"
									data-testid="changes-review-next-unreviewed"
									disabled={viewedCount >= files.length}
									onClick={nextUnreviewed}
									className="flex h-24 items-center gap-4 rounded-[var(--radius-sm)] border border-control-border-default px-8 tr-text-metadata text-text-muted outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary disabled:text-control-disabled-text disabled:hover:bg-transparent"
								>
									Next unreviewed
									<kbd className="rounded-[var(--radius-xs)] border border-control-border-default px-4 tr-code-text text-text-subtle">
										J
									</kbd>
								</button>
								<button
									type="button"
									data-testid="changes-review-mark-all"
									disabled={viewedCount >= files.length}
									onClick={markAllViewed}
									className="flex h-24 items-center gap-4 rounded-[var(--radius-sm)] border border-control-border-default px-8 tr-text-metadata text-text-muted outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary disabled:text-control-disabled-text disabled:hover:bg-transparent"
								>
									<Check className="size-14" />
									Mark all viewed
								</button>
							</span>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
