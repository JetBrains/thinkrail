import {
	RiCheckLine as Check,
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
	RiFileCopyLine as Copy,
	RiMoreLine as More,
	RiExternalLinkLine as OpenAsTab,
	RiArrowGoBackLine as Revert,
} from "@remixicon/react";
import type { GitFileChange, ResourceMeta } from "@thinkrail/contracts";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@thinkrail/ui/dropdown-menu";
import { useCallback, useEffect, useMemo, useState } from "react";
import { copyText, isPhoneViewport } from "@/lib";
import { statusLetter } from "../chat/planView";
import { LoadingRegion } from "../components/Skeleton";
import {
	type ChangesTab,
	selectDiffTabTargetRef,
	selectWorkspaceTick,
	useAppStore,
} from "../store";
import { errorText, getTransport } from "../transport";
import { splitPath, statusNameClass } from "./changesModel";
import { DiffStatBadge } from "./DiffStatBadge";
import { DiffSurfaceBody, useDiffSurface } from "./DiffSurface";
import { HeaderIconButton } from "./HeaderIconButton";
import { openDiffInTab } from "./openTabs";
import { rendererImplementationKey, rendererTestId } from "./resourcePane";
import { ToggleSegment } from "./ToggleSegment";
import { useLiveTabContent } from "./useLiveTabContent";

export interface SectionContent {
	original: string;
	modified: string;
	meta: { original: ResourceMeta; modified: ResourceMeta } | undefined;
	originalOid: string | null | undefined;
	loadedTick: number;
	loadedTarget: string;
}

export type SectionContentCache = Map<string, SectionContent>;

const PENDING_CONTENT = {
	original: "",
	modified: "",
	meta: undefined,
	originalOid: undefined,
} as const;

export function ChangesFileSection({
	tab,
	change,
	mode,
	collapsed,
	collapsedByDefault,
	viewed,
	cache,
	onToggleCollapsed,
	onToggleViewed,
}: {
	tab: ChangesTab;
	change: GitFileChange;
	mode: "stacked" | "single";
	collapsed: boolean;
	collapsedByDefault: boolean;
	viewed: boolean;
	cache: SectionContentCache;
	onToggleCollapsed: () => void;
	onToggleViewed: () => void;
}) {
	const { workspaceId, scope } = tab;
	const path = change.path;
	const [content, setContent] = useState<SectionContent | null>(() => cache.get(path) ?? null);
	const [error, setError] = useState<string | null>(null);
	const liveTick = useAppStore((state) => selectWorkspaceTick(state, workspaceId));
	const targetRef = useAppStore((state) => selectDiffTabTargetRef(state, { workspaceId, scope }));
	const setSectionRenderer = useAppStore((state) => state.setChangesTabSectionRenderer);
	const setSectionViewState = useAppStore((state) => state.setChangesTabSectionViewState);
	const section = tab.sections[path];

	const read = useCallback(
		() => getTransport().request("git.diffFile", { workspaceId, path, scope }),
		[workspaceId, path, scope],
	);
	const install = useCallback(
		(next: SectionContent) => {
			cache.set(path, next);
			setContent(next);
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
		if (content || !bodyVisible) return;
		let cancelled = false;
		const tick = selectWorkspaceTick(useAppStore.getState(), workspaceId);
		setError(null);
		read().then(
			(fresh) => {
				if (!cancelled) install({ ...fresh, loadedTick: tick, loadedTarget: targetRef });
			},
			(failure: unknown) => {
				if (!cancelled) setError(errorText(failure));
			},
		);
		return () => {
			cancelled = true;
		};
	}, [bodyVisible, content, install, read, targetRef, workspaceId]);

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
	});
	const { renderer, candidates, implementationKey, mobile, hunkActions } = surface;
	const view = mobile ? "inline" : (tab.view ?? "split");
	const ignoreWhitespace = tab.ignoreWhitespace ?? false;
	const { dir, base } = splitPath(path);
	const openAsTab = () => void openDiffInTab(workspaceId, scope, path, "keep");
	const selectRenderer = (rendererId: string) =>
		setSectionRenderer(workspaceId, tab.id, path, rendererId);
	const saveViewState = (state: unknown) => {
		const current = useAppStore
			.getState()
			.tabsByWorkspace[workspaceId]?.find((candidate) => candidate.id === tab.id);
		if (current?.kind !== "changes") return;
		const stored = current.sections[path];
		if (
			(stored?.rendererId === undefined || stored.rendererId === renderer.id) &&
			rendererImplementationKey(renderer.id, isPhoneViewport()) === implementationKey
		) {
			setSectionViewState(workspaceId, tab.id, path, state);
		}
	};
	const changedLines = (change.added ?? 0) + (change.removed ?? 0);

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
						aria-label={collapsed ? `Expand ${base}` : `Collapse ${base}`}
						aria-expanded={!collapsed}
						onClick={onToggleCollapsed}
						className="flex size-20 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-muted outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
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
				<span className="ml-auto flex shrink-0 items-center gap-4">
					{content && candidates.length >= 2
						? candidates.map((candidate) => (
								<ToggleSegment
									key={candidate.id}
									testid={rendererTestId(candidate.id)}
									label={candidate.label}
									active={candidate.id === renderer.id}
									onClick={() => selectRenderer(candidate.id)}
								/>
							))
						: null}
					{hunkActions ? (
						<HeaderIconButton
							testid="changes-section-revert"
							label="Revert file"
							onClick={() => void hunkActions.revertFile()}
						>
							<Revert className="size-14" />
						</HeaderIconButton>
					) : null}
					<HeaderIconButton
						testid="changes-section-open-tab"
						label="Open as its own tab"
						onClick={openAsTab}
					>
						<OpenAsTab className="size-14" />
					</HeaderIconButton>
					<DropdownMenu>
						<DropdownMenuTrigger
							data-testid="changes-section-menu"
							aria-label={`Actions for ${path}`}
							className="flex size-24 items-center justify-center rounded-[var(--radius-sm)] text-text-muted outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary data-[state=open]:bg-control-bg-selected"
						>
							<More className="size-14" />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onSelect={openAsTab}>
								<OpenAsTab />
								Open as tab
							</DropdownMenuItem>
							<DropdownMenuItem
								onSelect={() => {
									void copyText(path);
								}}
							>
								<Copy />
								Copy path
							</DropdownMenuItem>
							{hunkActions ? (
								<DropdownMenuItem onSelect={() => void hunkActions.revertFile()}>
									<Revert />
									Revert file
								</DropdownMenuItem>
							) : null}
							<DropdownMenuItem onSelect={onToggleViewed}>
								<Check />
								{viewed ? "Mark as not viewed" : "Mark as viewed"}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
					<button
						type="button"
						data-testid="changes-section-viewed"
						aria-pressed={viewed}
						onClick={onToggleViewed}
						className="flex h-24 items-center gap-4 rounded-[var(--radius-sm)] px-8 tr-text-metadata text-text-muted outline-none hover:bg-control-bg-hovered hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary"
					>
						<span
							className={`flex size-14 items-center justify-center rounded-[var(--radius-xs)] border ${
								viewed
									? "border-primary bg-primary text-text-on-primary"
									: "border-control-border-active"
							}`}
						>
							{viewed ? <Check className="size-10" /> : null}
						</span>
						Viewed
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
								? `Large change — ${changedLines} lines, collapsed by default.`
								: "Collapsed by default."}
						</span>
						<button
							type="button"
							data-testid="changes-section-expand"
							onClick={onToggleCollapsed}
							className="text-text-muted underline-offset-2 hover:text-text-default hover:underline"
						>
							Expand
						</button>
						<button
							type="button"
							onClick={openAsTab}
							className="text-text-muted underline-offset-2 hover:text-text-default hover:underline"
						>
							Open as tab
						</button>
					</div>
				) : null
			) : error ? (
				<div
					data-testid="changes-section-error"
					className="flex items-center gap-8 px-12 py-8 tr-text-metadata text-feedback-error"
				>
					<span>Could not read this diff: {error}</span>
					<button
						type="button"
						onClick={() => setContent(null)}
						className="text-text-muted underline-offset-2 hover:text-text-default hover:underline"
					>
						Retry
					</button>
				</div>
			) : !content ? (
				<LoadingRegion rows={4} className="p-12" />
			) : (
				<DiffSurfaceBody
					surface={surface}
					view={view}
					ignoreWhitespace={ignoreWhitespace}
					viewState={section?.viewState}
					onViewState={saveViewState}
					onSelectRenderer={selectRenderer}
					bodyClassName={
						mode === "single"
							? "min-h-0 flex-1"
							: renderer.capabilities.boundedDiff
								? "h-[60vh]"
								: ""
					}
				/>
			)}
		</section>
	);
}
