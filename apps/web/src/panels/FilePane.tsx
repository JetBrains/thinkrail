import { useT } from "@thinkrail/locales/react";
import {
	describeResource,
	PENDING_TEXT_META,
	RendererToggles,
	RendererView,
	rendererImplementationKey,
	resourceContent,
	UnplacedReviewStrip,
	useRendererSelection,
} from "@thinkrail/resource-renderers";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { Suspense, useMemo } from "react";
import { isPhoneViewport } from "../lib";
import type { FileTab } from "../store";
import { selectWorkspaceById, useAppStore } from "../store";
import { getTransport } from "../transport";
import { resourceBytesUrl, useResetViewStateOnImplementationChange } from "./resourcePane";
import { reviewFlagFor } from "./reviewModel";
import { SendReviewButton } from "./SendReviewButton";
import { useLiveTabContent } from "./useLiveTabContent";
import { useFileReview } from "./useReviewCommenting";

const loading = <LoadingRegion rows={12} className="h-full p-12" testId="file-pane-loading" />;

export function FilePane({ tab }: { tab: FileTab }) {
	const t = useT();
	const setTabRenderer = useAppStore((state) => state.setTabRenderer);
	const review = useFileReview(tab.workspaceId, tab.path, "inline");
	const reviewable = useAppStore(
		(state) => selectWorkspaceById(state, tab.workspaceId)?.kind !== "chat",
	);
	const reviewComments = useAppStore(
		(state) => state.reviewsByWorkspace[tab.workspaceId]?.comments,
	);
	const fileHasDraft = useMemo(
		() => reviewFlagFor(reviewComments, tab.path) === "draft",
		[reviewComments, tab.path],
	);

	useLiveTabContent(tab, {
		read: () =>
			getTransport().request("fs.readFile", { workspaceId: tab.workspaceId, path: tab.path }),
		applyFresh: ({ content, meta }, tick) =>
			useAppStore.getState().updateFileTabContent(tab.workspaceId, tab.id, content, meta, tick),
		keepCurrent: (tick) =>
			useAppStore
				.getState()
				.updateFileTabContent(tab.workspaceId, tab.id, tab.content, tab.meta, tick),
	});

	const resource = useMemo(
		() => describeResource(tab.workspaceId, tab.path, tab.meta ?? PENDING_TEXT_META),
		[tab.workspaceId, tab.path, tab.meta],
	);
	const { mobile, candidates, renderer, implementationKey, placedThreadIds, onPlacedThreadIds } =
		useRendererSelection(resource, "view", tab.rendererId);
	useResetViewStateOnImplementationChange(tab.workspaceId, tab.id, implementationKey);
	const content = resourceContent(tab.content, tab.meta, () =>
		resourceBytesUrl(tab.workspaceId, tab.path),
	);
	const reviews = reviewable ? [review.worktree] : [];
	const showToolbar = candidates.length >= 2 || fileHasDraft;
	const saveViewState = (state: unknown) => {
		const current = useAppStore
			.getState()
			.tabsByWorkspace[tab.workspaceId]?.find((candidate) => candidate.id === tab.id);
		if (
			current?.kind === "file" &&
			(current.rendererId === undefined || current.rendererId === renderer.id) &&
			rendererImplementationKey(renderer.id, isPhoneViewport()) === implementationKey
		) {
			useAppStore.getState().setTabViewState(tab.workspaceId, tab.id, state);
		}
	};

	return (
		<div className="flex h-full min-h-0 flex-col">
			{showToolbar ? (
				<div
					data-testid="resource-view-toggle"
					role="toolbar"
					aria-label={t("panels.filePane.resourceView")}
					className="flex h-32 shrink-0 items-center justify-end gap-4 border-border-default border-b bg-container-header-bg px-12"
				>
					<SendReviewButton workspaceId={tab.workspaceId} path={tab.path} />
					<RendererToggles
						candidates={candidates}
						renderer={renderer}
						onRendererId={(rendererId) => setTabRenderer(tab.workspaceId, tab.id, rendererId)}
					/>
				</div>
			) : null}
			<UnplacedReviewStrip
				reviews={reviews}
				renderer={renderer}
				intent="view"
				candidates={candidates}
				{...(placedThreadIds ? { placedThreadIds } : {})}
				onSelectRenderer={(rendererId) => setTabRenderer(tab.workspaceId, tab.id, rendererId)}
			/>
			<div className="min-h-0 flex-1">
				<Suspense fallback={loading}>
					<RendererView
						key={implementationKey}
						renderer={renderer}
						mobile={mobile}
						resource={resource}
						content={content}
						{...(reviewable ? { review: review.worktree } : {})}
						onPlacedThreadIds={onPlacedThreadIds}
						viewState={tab.viewState}
						onViewState={saveViewState}
						{...(tab.reveal ? { reveal: tab.reveal } : {})}
					/>
				</Suspense>
			</div>
		</div>
	);
}
