import {
	RiCheckLine as Check,
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
	RiFileCopyLine as Copy,
	RiMoreLine as More,
	RiExternalLinkLine as OpenAsTab,
	RiArrowGoBackLine as Revert,
} from "@remixicon/react";
import type { GitDiffScope, GitFileChange } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import type { HunkTriage, ReviewDraftPersistence } from "@thinkrail/resource-renderers";
import {
	RendererToggles,
	ReviewDraftContext,
	rendererImplementationKey,
} from "@thinkrail/resource-renderers";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { copyText, isPhoneViewport } from "@/lib";
import { statusLetter } from "../chat/planView";
import {
	type ChangesTabSection,
	type DiffTabView,
	selectChangesTabSection,
	selectDiffTabTargetRef,
	selectWorkspaceTick,
	useAppStore,
} from "../store";
import { errorText, getTransport } from "../transport";
import {
	estimatedSectionHeight,
	splitPath,
	stackedDiffBounded,
	statusNameClass,
} from "./changesModel";
import { DiffStatBadge } from "./DiffStatBadge";
import { DiffSurfaceBody, useDiffSurface } from "./DiffSurface";
import { HeaderIconButton } from "./HeaderIconButton";
import { openDiffInTab } from "./openTabs";
import type { SectionContent, SectionContentCache } from "./sectionContentCache";
import { useLiveTabContent } from "./useLiveTabContent";

const PENDING_CONTENT = {
	original: "",
	modified: "",
	meta: undefined,
	originalOid: undefined,
} as const;

export const ChangesFileSection = memo(function ChangesFileSection({
	workspaceId,
	tabId,
	scope,
	tabView,
	ignoreWhitespace,
	section,
	keptList,
	change,
	mode,
	collapsed,
	collapsedByDefault,
	viewed,
	cache,
	onToggleCollapsed,
	onSetViewed,
}: {
	workspaceId: string;
	tabId: string;
	scope: GitDiffScope;
	tabView: DiffTabView | undefined;
	ignoreWhitespace: boolean;
	section: ChangesTabSection | undefined;
	keptList: readonly string[] | undefined;
	change: GitFileChange;
	mode: "stacked" | "single";
	collapsed: boolean;
	collapsedByDefault: boolean;
	viewed: boolean;
	cache: SectionContentCache;
	onToggleCollapsed: (change: GitFileChange) => void;
	onSetViewed: (path: string, viewed: boolean) => void;
}) {
	const t = useT();
	const path = change.path;
	const onToggleViewed = () => onSetViewed(path, !viewed);
	const toggleCollapsed = () => onToggleCollapsed(change);
	const [content, setContent] = useState<SectionContent | null>(() => cache.get(path) ?? null);
	const [error, setError] = useState<string | null>(null);
	const liveTick = useAppStore((state) => selectWorkspaceTick(state, workspaceId));
	const targetRef = useAppStore((state) => selectDiffTabTargetRef(state, { workspaceId, scope }));
	const setSectionRenderer = useAppStore((state) => state.setChangesTabSectionRenderer);
	const setSectionViewState = useAppStore((state) => state.setChangesTabSectionViewState);
	const setSectionReviewDraft = useAppStore((state) => state.setChangesTabSectionReviewDraft);
	const updateReviewDraft = useCallback(
		(key: string, update: (current: unknown) => unknown) =>
			setSectionReviewDraft(workspaceId, tabId, path, key, update),
		[path, setSectionReviewDraft, tabId, workspaceId],
	);
	const setHunkKept = useAppStore((state) => state.setChangesTabHunkKept);
	const keptKeys = useMemo(() => new Set(keptList ?? []), [keptList]);
	const [hunkKeys, setHunkKeys] = useState<readonly string[]>([]);
	const triage = useMemo<HunkTriage>(
		() => ({
			keptKeys,
			setKept: (key, kept) => setHunkKept(workspaceId, tabId, path, key, kept, hunkKeys),
			onHunkKeys: setHunkKeys,
		}),
		[hunkKeys, keptKeys, path, setHunkKept, tabId, workspaceId],
	);
	const keptCount = hunkKeys.filter((key) => keptKeys.has(key)).length;
	const allKept = hunkKeys.length > 0 && keptCount === hunkKeys.length;

	const read = useCallback(
		() => getTransport().request("git.diffFile", { workspaceId, path, scope }),
		[workspaceId, path, scope],
	);
	const install = useCallback(
		(next: SectionContent) => {
			cache.set(path, next);
			setContent(next);
			setError(null);
		},
		[cache, path],
	);
	const loadedTick = content?.loadedTick ?? liveTick;
	const { reload } = useLiveTabContent(
		{ workspaceId, path, loadedTick },
		{
			read,
			applyFresh: (fresh, tick) => install({ ...fresh, loadedTick: tick, loadedTarget: targetRef }),
			keepCurrent: (tick) => {
				if (content) install({ ...content, loadedTick: tick });
			},
		},
		targetRef,
		content?.loadedTarget ?? targetRef,
	);
	const bodyVisible = mode === "single" || !collapsed;
	useEffect(() => {
		if (content || error || !bodyVisible) return;
		let cancelled = false;
		const tick = selectWorkspaceTick(useAppStore.getState(), workspaceId);
		cache.load(path, read, tick, targetRef).then(
			(next) => {
				if (!cancelled) setContent(cache.get(path) ?? next);
			},
			(failure: unknown) => {
				if (!cancelled) setError(errorText(failure));
			},
		);
		return () => {
			cancelled = true;
		};
	}, [bodyVisible, cache, content, error, path, read, targetRef, workspaceId]);

	const surfaceContent = useMemo(
		() =>
			content
				? {
						original: content.original,
						modified: content.modified,
						meta: content.meta,
						originalOid: content.originalOid,
					}
				: PENDING_CONTENT,
		[content],
	);
	const surface = useDiffSurface({
		workspaceId,
		path,
		scope,
		content: surfaceContent,
		rendererId: section?.rendererId,
		reload,
		triage,
	});
	const { renderer, candidates, implementationKey, mobile, hunkActions } = surface;
	const reviewDrafts = useMemo<ReviewDraftPersistence>(
		() => ({
			rendererId: renderer.id,
			read: (key) =>
				selectChangesTabSection(useAppStore.getState(), workspaceId, tabId, path)?.reviewDrafts?.[
					key
				],
			subscribe: useAppStore.subscribe,
			update: updateReviewDraft,
		}),
		[path, renderer.id, tabId, updateReviewDraft, workspaceId],
	);
	const view = mobile ? "inline" : (tabView ?? "split");
	const { dir, base } = splitPath(path);
	const openAsTab = () => void openDiffInTab(workspaceId, scope, path, "keep");
	const selectRenderer = (rendererId: string) =>
		setSectionRenderer(workspaceId, tabId, path, rendererId);
	const saveViewState = (state: unknown) => {
		const current = useAppStore
			.getState()
			.tabsByWorkspace[workspaceId]?.find((candidate) => candidate.id === tabId);
		if (current?.kind !== "changes") return;
		const stored = current.sections[path];
		if (
			(stored?.rendererId === undefined || stored.rendererId === renderer.id) &&
			rendererImplementationKey(renderer.id, isPhoneViewport()) === implementationKey
		) {
			setSectionViewState(workspaceId, tabId, path, state);
		}
	};
	const changedLines = (change.added ?? 0) + (change.removed ?? 0);
	const bounded = stackedDiffBounded(renderer.capabilities.boundedDiff, surface.lineCount);
	const ownsScroller = mode === "single" || bounded;

	return (
		<section
			data-testid="changes-section"
			data-path={path}
			data-status={change.status}
			data-collapsed={collapsed && mode === "stacked" ? true : undefined}
			data-viewed={viewed ? true : undefined}
			className={
				mode === "single"
					? "flex h-full min-h-0 flex-col"
					: "border-border-default border-b bg-container-content-bg"
			}
		>
			<div
				data-testid="changes-section-header"
				className={`${mode === "stacked" ? "sticky top-0 z-10" : ""} flex h-32 shrink-0 items-center gap-4 border-border-default border-b bg-container-header-bg px-8`}
			>
				{mode === "stacked" ? (
					<button
						type="button"
						data-testid="changes-section-toggle"
						aria-label={
							collapsed
								? t("changes.section.expandFile", { name: base })
								: t("changes.section.collapseFile", { name: base })
						}
						aria-expanded={!collapsed}
						onClick={toggleCollapsed}
						className="flex size-20 shrink-0 items-center justify-center rounded-sm text-text-muted outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
					>
						{collapsed ? <ChevronRight className="size-16" /> : <ChevronDown className="size-16" />}
					</button>
				) : null}
				<span
					className={`w-16 shrink-0 text-center tr-text-metadata ${statusNameClass(change.status) || "text-text-muted"}`}
				>
					{statusLetter(change.status)}
				</span>
				<span
					data-testid="changes-section-path"
					title={path}
					className={`flex min-w-0 items-baseline tr-code-text ${viewed ? "opacity-60" : ""}`}
				>
					{dir ? <span className="min-w-0 shrink truncate text-text-muted">{dir}</span> : null}
					<span
						className={`max-w-full shrink-0 truncate ${statusNameClass(change.status) || "text-text-default"}`}
					>
						{base}
					</span>
				</span>
				<DiffStatBadge added={change.added ?? 0} removed={change.removed ?? 0} />
				{hunkActions && hunkKeys.length > 0 && bodyVisible ? (
					<span
						data-testid="changes-section-kept"
						className={`shrink-0 tr-text-metadata tabular-nums ${allKept ? "text-feedback-success" : "text-text-subtle"}`}
					>
						{t("changes.section.kept", { kept: keptCount, total: hunkKeys.length })}
					</span>
				) : null}
				<span className="ml-auto flex shrink-0 items-center gap-4">
					{content ? (
						<RendererToggles
							candidates={candidates}
							renderer={renderer}
							onRendererId={selectRenderer}
						/>
					) : null}
					{hunkActions ? (
						<HeaderIconButton
							testid="changes-section-revert"
							label={t("changes.section.revertFile")}
							onClick={() => void hunkActions.revertFile()}
						>
							<Revert className="size-14" />
						</HeaderIconButton>
					) : null}
					<HeaderIconButton
						testid="changes-section-open-tab"
						label={t("changes.section.openOwnTab")}
						onClick={openAsTab}
					>
						<OpenAsTab className="size-14" />
					</HeaderIconButton>
					<DropdownMenu>
						<DropdownMenuTrigger
							data-testid="changes-section-menu"
							aria-label={t("changes.section.actions", { path })}
							className="flex size-24 items-center justify-center rounded-sm text-text-muted outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary data-[state=open]:bg-control-bg-selected"
						>
							<More className="size-14" />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onSelect={openAsTab}>
								<OpenAsTab />
								{t("changes.section.openAsTab")}
							</DropdownMenuItem>
							<DropdownMenuItem
								onSelect={() => {
									void copyText(path);
								}}
							>
								<Copy />
								{t("changes.section.copyPath")}
							</DropdownMenuItem>
							{hunkActions ? (
								<DropdownMenuItem onSelect={() => void hunkActions.revertFile()}>
									<Revert />
									{t("changes.section.revertFile")}
								</DropdownMenuItem>
							) : null}
							<DropdownMenuItem onSelect={onToggleViewed}>
								<Check />
								{viewed ? t("changes.section.markNotViewed") : t("changes.section.markViewed")}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<button
						type="button"
						data-testid="changes-section-viewed"
						aria-pressed={viewed}
						onClick={onToggleViewed}
						className="flex h-24 items-center gap-4 rounded-sm px-8 tr-text-metadata text-text-muted outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
					>
						<span
							className={`flex size-14 items-center justify-center rounded-xs border ${
								viewed
									? "border-primary bg-primary text-text-on-primary"
									: "border-control-border-active"
							}`}
						>
							{viewed ? <Check className="size-10" /> : null}
						</span>
						{t("changes.section.viewed")}
					</button>
				</span>
			</div>
			{!bodyVisible ? (
				collapsedByDefault ? (
					<div
						data-testid="changes-section-collapsed"
						className="flex items-center gap-12 px-24 py-8 tr-text-metadata text-text-subtle"
					>
						<span>
							{changedLines > 0
								? t("changes.section.largeCollapsed", { count: changedLines })
								: t("changes.section.collapsed")}
						</span>
						<button
							type="button"
							data-testid="changes-section-expand"
							onClick={toggleCollapsed}
							className="text-text-muted underline-offset-2 hover:text-text-default hover:underline"
						>
							{t("changes.section.expand")}
						</button>
						<button
							type="button"
							onClick={openAsTab}
							className="text-text-muted underline-offset-2 hover:text-text-default hover:underline"
						>
							{t("changes.section.openAsTab")}
						</button>
					</div>
				) : null
			) : error ? (
				<div
					data-testid="changes-section-error"
					className="flex items-center gap-8 px-12 py-8 tr-text-metadata text-feedback-error"
				>
					<span>{t("changes.section.readFailed", { error })}</span>
					<button
						type="button"
						data-testid="changes-section-retry"
						onClick={() => setError(null)}
						className="text-text-muted underline-offset-2 hover:text-text-default hover:underline"
					>
						{t("common.retry")}
					</button>
				</div>
			) : !content ? (
				<div
					data-testid="changes-section-loading"
					style={mode === "stacked" ? { minHeight: estimatedSectionHeight(change) } : undefined}
				>
					<LoadingRegion rows={4} className="p-12" />
				</div>
			) : (
				<ReviewDraftContext value={reviewDrafts}>
					<DiffSurfaceBody
						surface={surface}
						view={view}
						ignoreWhitespace={ignoreWhitespace}
						viewState={ownsScroller ? section?.viewState : undefined}
						onViewState={ownsScroller ? saveViewState : undefined}
						onSelectRenderer={selectRenderer}
						bodyClassName={mode === "single" ? "min-h-0 flex-1" : bounded ? "h-[60vh]" : ""}
					/>
				</ReviewDraftContext>
			)}
		</section>
	);
});
