import {
	describeResource,
	RendererToggles,
	RendererView,
	type ResourceContent,
	rendererImplementationKey,
	resolveRenderers,
	selectResourceRenderer,
	UnplacedReviewStrip,
	usePlacedThreadIds,
} from "@thinkrail/resource-renderers";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import { Suspense, useMemo } from "react";
import { isPhoneViewport, usePhoneViewport } from "../lib";
import type { FileTab } from "../store";
import { useAppStore } from "../store";
import { getTransport } from "../transport";
import {
	PENDING_TEXT_META,
	resourceBytesUrl,
	useResetViewStateOnImplementationChange,
} from "./resourcePane";
import { reviewFlagFor } from "./reviewModel";
import { SendReviewButton } from "./SendReviewButton";
import { useLiveTabContent } from "./useLiveTabContent";
import { useFileReview } from "./useReviewCommenting";

const loading = <LoadingRegion rows={12} className="h-full p-12" />;

function contentFor(tab: FileTab): ResourceContent {
	const meta = tab.meta;
	if (!meta) return { kind: "text", text: tab.content, hash: "" };
	if (meta.hash === null || meta.byteLength === null) return { kind: "absent" };
	if (meta.text) return { kind: "text", text: tab.content, hash: meta.hash };
	return {
		kind: "bytes",
		url: resourceBytesUrl(tab.workspaceId, tab.path),
		hash: meta.hash,
		byteLength: meta.byteLength,
	};
}

export function FilePane({ tab }: { tab: FileTab }) {
	const mobile = usePhoneViewport();
	const setTabRenderer = useAppStore((state) => state.setTabRenderer);
	const review = useFileReview(tab.workspaceId, tab.path, "inline");
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
	const candidates = useMemo(
		() => resolveRenderers(resource, "view", { mobile }),
		[resource, mobile],
	);
	const renderer = selectResourceRenderer(candidates, tab.rendererId, tab.path);
	const implementationKey = rendererImplementationKey(renderer.id, mobile);
	const { placedThreadIds, onPlacedThreadIds } = usePlacedThreadIds(implementationKey);
	useResetViewStateOnImplementationChange(tab.workspaceId, tab.id, implementationKey);
	const content = contentFor(tab);
	const reviews = [review.worktree];
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
					aria-label="Resource view"
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
						implementationKey={implementationKey}
						mobile={mobile}
						resource={resource}
						content={content}
						review={review.worktree}
						onPlacedThreadIds={onPlacedThreadIds}
						viewState={tab.viewState}
						onViewState={saveViewState}
					/>
				</Suspense>
			</div>
		</div>
	);
}
