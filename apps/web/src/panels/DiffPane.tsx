import {
	RiCheckLine as Check,
	RiFileCopyLine as Copy,
	RiParagraph as Pilcrow,
	RiArrowGoBackLine as Revert,
} from "@remixicon/react";
import { useMemo, useState } from "react";
import { copyText, isPhoneViewport } from "@/lib";
import type { DiffTab } from "../store";
import { selectDiffTabTargetRef, useAppStore } from "../store";
import { getTransport } from "../transport";
import { splitPath } from "./changesModel";
import { DiffSurfaceBody, useDiffSurface } from "./DiffSurface";
import { HeaderIconButton } from "./HeaderIconButton";
import {
	rendererImplementationKey,
	rendererTestId,
	useResetViewStateOnImplementationChange,
} from "./resourcePane";
import { SendReviewButton } from "./SendReviewButton";
import { ToggleSegment } from "./ToggleSegment";
import { useLiveTabContent } from "./useLiveTabContent";

export function DiffPane({ tab }: { tab: DiffTab }) {
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
				{candidates.length >= 2
					? candidates.map((candidate) => (
							<ToggleSegment
								key={candidate.id}
								testid={rendererTestId(candidate.id)}
								label={candidate.label}
								active={candidate.id === renderer.id}
								onClick={() => setTabRenderer(tab.workspaceId, tab.id, candidate.id)}
							/>
						))
					: null}
				{renderer.capabilities.layout && !mobile ? (
					<>
						<ToggleSegment
							testid="diff-toggle-split"
							label="Split"
							active={view === "split"}
							onClick={() => setDiffTabView(tab.id, "split")}
						/>
						<ToggleSegment
							testid="diff-toggle-inline"
							label="Inline"
							active={view === "inline"}
							onClick={() => setDiffTabView(tab.id, "inline")}
						/>
					</>
				) : null}
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
