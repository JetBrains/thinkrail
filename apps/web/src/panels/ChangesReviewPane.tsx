import {
	RiCheckLine as Check,
	RiArrowDownSLine as ChevronDown,
	RiArrowLeftSLine as ChevronLeft,
	RiArrowRightSLine as ChevronRight,
	RiArrowUpSLine as ChevronUp,
	RiParagraph as Pilcrow,
} from "@remixicon/react";
import type { GitFileChange, GitStatus } from "@thinkrail/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { usePhoneViewport } from "@/lib";
import { LoadingRegion } from "../components/Skeleton";
import {
	type ChangesLayout,
	type ChangesTab,
	selectDiffBaseRef,
	toast,
	useAppStore,
} from "../store";
import { errorText, getTransport, wsErrorCode } from "../transport";
import { ChangesFileSection, type SectionContentCache } from "./ChangesFileSection";
import { LARGE_SCOPE_FILES, scopeKey, scopeLabel, sectionCollapsedByDefault } from "./changesModel";
import { DiffStatBadge } from "./DiffStatBadge";
import { HeaderIconButton } from "./HeaderIconButton";
import { SendReviewButton } from "./SendReviewButton";
import { ToggleSegment } from "./ToggleSegment";
import { useWorkspaceRead } from "./useWorkspaceRead";

export function ChangesReviewPane({ tab }: { tab: ChangesTab }) {
	const { workspaceId, scope } = tab;
	const mobile = usePhoneViewport();
	const [status, setStatus] = useState<GitStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const warnedRef = useRef(false);
	const baseRef = useAppStore((state) => selectDiffBaseRef(state, workspaceId));
	const layout = useAppStore((state) => state.changesLayout);
	const setLayout = useAppStore((state) => state.setChangesLayout);
	const setView = useAppStore((state) => state.setChangesTabView);
	const setIgnoreWhitespace = useAppStore((state) => state.setChangesTabIgnoreWhitespace);
	const setViewed = useAppStore((state) => state.setChangesTabViewed);
	const setActivePath = useAppStore((state) => state.setChangesTabActivePath);
	const setCollapsed = useAppStore((state) => state.setChangesTabCollapsed);
	const clearReveal = useAppStore((state) => state.clearChangesTabReveal);
	const cache = useRef<SectionContentCache>(new Map()).current;
	const [largeNoticeDismissed, setLargeNoticeDismissed] = useState(false);

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
					setError("That commit is no longer in this branch.");
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
			},
		},
		`${scopeKey(scope)}:${baseRef}`,
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
	const effectiveLayout: ChangesLayout = layout;

	const currentIndex = Math.max(
		0,
		files.findIndex((change) => change.path === tab.activePath),
	);
	const current = files[currentIndex];

	const virtuoso = useRef<VirtuosoHandle>(null);
	const revealTick = tab.reveal?.tick;
	const revealPath = tab.reveal?.path;
	useEffect(() => {
		if (revealTick === undefined || revealPath === undefined || !status) return;
		const index = files.findIndex((change) => change.path === revealPath);
		if (index >= 0) {
			setActivePath(workspaceId, tab.id, revealPath);
			if (tab.collapsed[revealPath] !== false) {
				setCollapsed(workspaceId, tab.id, { [revealPath]: false });
			}
			if (layout === "stacked") {
				virtuoso.current?.scrollToIndex({ index, align: "start" });
			}
		}
		clearReveal(workspaceId, tab.id);
	}, [
		clearReveal,
		files,
		layout,
		revealPath,
		revealTick,
		setActivePath,
		setCollapsed,
		status,
		tab.collapsed,
		tab.id,
		workspaceId,
	]);

	useEffect(() => {
		if (!status) return;
		if (tab.activePath !== null && files.some((change) => change.path === tab.activePath)) return;
		setActivePath(workspaceId, tab.id, files[0]?.path ?? null);
	}, [files, setActivePath, status, tab.activePath, tab.id, workspaceId]);

	const toggleViewed = useCallback(
		(path: string) => setViewed(workspaceId, tab.id, path, !viewedSet.has(path)),
		[setViewed, tab.id, viewedSet, workspaceId],
	);
	const toggleCollapsed = useCallback(
		(change: GitFileChange) =>
			setCollapsed(workspaceId, tab.id, { [change.path]: !isCollapsed(change) }),
		[isCollapsed, setCollapsed, tab.id, workspaceId],
	);
	const step = (delta: number) => {
		const next = files[currentIndex + delta];
		if (next) setActivePath(workspaceId, tab.id, next.path);
	};
	const markViewedAndAdvance = () => {
		if (!current) return;
		const wasViewed = viewedSet.has(current.path);
		setViewed(workspaceId, tab.id, current.path, !wasViewed);
		if (!wasViewed) step(1);
	};

	useEffect(() => {
		if (effectiveLayout !== "single") return;
		const onKey = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (
				target &&
				(target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
			) {
				return;
			}
			if (event.altKey && event.key === "ArrowDown") {
				event.preventDefault();
				step(1);
			} else if (event.altKey && event.key === "ArrowUp") {
				event.preventDefault();
				step(-1);
			} else if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key === "v") {
				event.preventDefault();
				markViewedAndAdvance();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	const targetLabel =
		scope.kind === "branch" ? `vs ${baseRef}` : scope.kind === "uncommitted" ? "worktree" : null;
	const showLargeNotice =
		effectiveLayout === "stacked" && files.length > LARGE_SCOPE_FILES && !largeNoticeDismissed;

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
					<span className="text-text-default">{scopeLabel(scope)}</span>
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
					<SendReviewButton workspaceId={workspaceId} path={null} testid="changes-review-send" />
					{effectiveLayout === "stacked" && files.length > 0 ? (
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
						active={effectiveLayout === "stacked"}
						onClick={() => setLayout("stacked")}
					/>
					<ToggleSegment
						testid="changes-review-layout-single"
						label="One file"
						active={effectiveLayout === "single"}
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
			) : effectiveLayout === "single" && current ? (
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
							tab={tab}
							change={current}
							mode="single"
							collapsed={false}
							collapsedByDefault={false}
							viewed={viewedSet.has(current.path)}
							cache={cache}
							onToggleCollapsed={() => {}}
							onToggleViewed={() => toggleViewed(current.path)}
						/>
					</div>
				</>
			) : (
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
					<Virtuoso<GitFileChange>
						ref={virtuoso}
						data={files}
						computeItemKey={(_index, change) => change.path}
						className="h-full min-h-0 [overflow-anchor:none]"
						increaseViewportBy={{ top: 200, bottom: 600 }}
						rangeChanged={(range) => {
							const first = files[range.startIndex];
							if (first && first.path !== tab.activePath) {
								setActivePath(workspaceId, tab.id, first.path);
							}
						}}
						itemContent={(_index, change) => (
							<ChangesFileSection
								tab={tab}
								change={change}
								mode="stacked"
								collapsed={isCollapsed(change)}
								collapsedByDefault={sectionCollapsedByDefault(change)}
								viewed={viewedSet.has(change.path)}
								cache={cache}
								onToggleCollapsed={() => toggleCollapsed(change)}
								onToggleViewed={() => toggleViewed(change.path)}
							/>
						)}
						components={{
							Footer: () => (
								<div className="px-12 py-24 text-center tr-text-metadata text-text-subtle">
									End of changes · {files.length} {files.length === 1 ? "file" : "files"}
								</div>
							),
						}}
					/>
				</div>
			)}
		</div>
	);
}
