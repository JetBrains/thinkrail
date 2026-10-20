import {
	RiCheckLine as Check,
	RiFileCopyLine as Copy,
	RiParagraph as Pilcrow,
	RiArrowGoBackLine as Revert,
} from "@remixicon/react";
import {
	RendererToggles,
	ResourcePreview,
	rendererImplementationKey,
} from "@thinkrail/resource-renderers";
import { useMemo, useState } from "react";
import { copyText, isPhoneViewport } from "@/lib";
import type { DiffTab } from "../store";
import { selectDiffTabTargetRef, useAppStore } from "../store";
import { getTransport } from "../transport";
import { splitPath } from "./changesModel";
import { DiffSurfaceBody, useDiffSurface } from "./DiffSurface";
import { HeaderIconButton } from "./HeaderIconButton";
import { useResetViewStateOnImplementationChange } from "./resourcePane";
import { SendReviewButton } from "./SendReviewButton";
import { useLiveTabContent } from "./useLiveTabContent";

export function DiffPane({ tab }: { tab: DiffTab }) {
	return tab.before === undefined ? (
		<GitDiffPane tab={tab} />
	) : (
		<FileComparisonPane tab={tab} before={tab.before} />
	);
}

function FileComparisonPane({ tab, before }: { tab: DiffTab; before: string }) {
	const setTabRenderer = useAppStore((state) => state.setTabRenderer);
	const setDiffTabView = useAppStore((state) => state.setDiffTabView);
	const setTabViewState = useAppStore((state) => state.setTabViewState);
	return (
		<div data-testid="diff-pane" data-compare className="flex h-full min-h-0 flex-col">
			<ResourcePreview
				workspaceId={tab.workspaceId}
				path={tab.path}
				before={before}
				rendererId={tab.rendererId}
				onRendererId={(rendererId) => setTabRenderer(tab.workspaceId, tab.id, rendererId)}
				layout={tab.view === "inline" ? "unified" : "split"}
				onLayout={(layout) => setDiffTabView(tab.id, layout === "unified" ? "inline" : "split")}
				viewState={tab.viewState}
				onViewState={(viewState) => setTabViewState(tab.workspaceId, tab.id, viewState)}
				leading={
					<span
						data-testid="diff-path"
						title={`${before} → ${tab.path}`}
						className="truncate tr-code-text text-text-muted"
					>
						{before} → {tab.path}
					</span>
				}
				className="h-full"
			/>
		</div>
	);
}

function GitDiffPane({ tab }: { tab: DiffTab }) {
	const setTabRenderer = useAppStore((state) => state.setTabRenderer);
	const setDiffTabView = useAppStore((state) => state.setDiffTabView);
	const setDiffTabIgnoreWhitespace = useAppStore((state) => state.setDiffTabIgnoreWhitespace);
	const [copied, setCopied] = useState(false);
	const targetRef = useAppStore((state) => selectDiffTabTargetRef(state, tab));

	const { reload } = useLiveTabContent(
		tab,
		{
			read: () =>
				getTransport().request("git.diffFile", {
					workspaceId: tab.workspaceId,
					path: tab.path,
					scope: tab.scope,
				}),
			applyFresh: ({ original, modified, meta, originalOid }, tick) =>
				useAppStore
					.getState()
					.updateDiffTabContent(
						tab.workspaceId,
						tab.id,
						original,
						modified,
						meta,
						originalOid,
						tick,
						targetRef,
					),
			keepCurrent: (tick) =>
				useAppStore
					.getState()
					.updateDiffTabContent(
						tab.workspaceId,
						tab.id,
						tab.original,
						tab.modified,
						tab.meta,
						tab.originalOid,
						tick,
						tab.loadedTarget,
					),
		},
		targetRef,
		tab.loadedTarget,
	);

	const content = useMemo(
		() => ({
			original: tab.original,
			modified: tab.modified,
			meta: tab.meta,
			originalOid: tab.originalOid,
		}),
		[tab.meta, tab.modified, tab.original, tab.originalOid],
	);
	const surface = useDiffSurface({
		workspaceId: tab.workspaceId,
		path: tab.path,
		scope: tab.scope,
		content,
		rendererId: tab.rendererId,
		reload,
	});
	const { renderer, candidates, implementationKey, mobile, hunkActions } = surface;
	useResetViewStateOnImplementationChange(tab.workspaceId, tab.id, implementationKey);

	const view = mobile ? "inline" : (tab.view ?? "split");
	const ignoreWhitespace = tab.ignoreWhitespace ?? false;
	const { dir, base } = splitPath(tab.path);
	const copy = async () => {
		if (!(await copyText(tab.modified))) return;
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};
	const saveViewState = (state: unknown) => {
		const current = useAppStore
			.getState()
			.tabsByWorkspace[tab.workspaceId]?.find((candidate) => candidate.id === tab.id);
		if (
			current?.kind === "diff" &&
			(current.rendererId === undefined || current.rendererId === renderer.id) &&
			rendererImplementationKey(renderer.id, isPhoneViewport()) === implementationKey
		) {
			useAppStore.getState().setTabViewState(tab.workspaceId, tab.id, state);
		}
	};

	return (
		<div data-testid="diff-pane" className="flex h-full min-h-0 flex-col">
			<div
				data-testid="diff-view-toggle"
				role="toolbar"
				aria-label="Diff view mode"
				className="flex h-32 shrink-0 items-center gap-4 border-border-default border-b bg-container-header-bg px-12"
			>
				<span
					data-testid="diff-path"
					title={tab.path}
					className="mr-auto flex min-w-0 items-baseline tr-code-text"
				>
					{dir ? (
						<span data-testid="diff-path-dir" className="min-w-0 shrink truncate text-text-muted">
							{dir}
						</span>
					) : null}
					<span
						data-testid="diff-path-base"
						className="max-w-full shrink-0 truncate text-text-muted"
					>
						{base}
					</span>
				</span>
				<SendReviewButton workspaceId={tab.workspaceId} path={tab.path} />
				{hunkActions ? (
					<HeaderIconButton
						testid="diff-revert-file"
						label="Revert file"
						onClick={() => void hunkActions.revertFile()}
					>
						<Revert className="size-14" />
					</HeaderIconButton>
				) : null}
				{renderer.capabilities.whitespace ? (
					<HeaderIconButton
						testid="diff-toggle-whitespace"
						label="Hide whitespace changes"
						active={ignoreWhitespace}
						onClick={() => setDiffTabIgnoreWhitespace(tab.id, !ignoreWhitespace)}
					>
						<Pilcrow className="size-14" />
					</HeaderIconButton>
				) : null}
				{renderer.capabilities.copy ? (
					<HeaderIconButton
						testid="diff-copy"
						label="Copy file contents"
						onClick={() => void copy()}
					>
						{copied ? (
							<Check className="size-14 text-feedback-success" />
						) : (
							<Copy className="size-14" />
						)}
					</HeaderIconButton>
				) : null}
				<RendererToggles
					candidates={candidates}
					renderer={renderer}
					onRendererId={(rendererId) => setTabRenderer(tab.workspaceId, tab.id, rendererId)}
					layout={{
						value: view === "inline" ? "unified" : "split",
						onChange: (layout) => setDiffTabView(tab.id, layout === "unified" ? "inline" : "split"),
					}}
				/>
			</div>
			<DiffSurfaceBody
				surface={surface}
				view={view}
				ignoreWhitespace={ignoreWhitespace}
				viewState={tab.viewState}
				onViewState={saveViewState}
				onSelectRenderer={(rendererId) => setTabRenderer(tab.workspaceId, tab.id, rendererId)}
			/>
		</div>
	);
}
