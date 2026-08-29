import { lazy, Suspense, useMemo } from "react";
import { isMarkdownPath } from "@/lib/utils";
import { SkeletonRows } from "../components/Skeleton";
import type { FileTab } from "../store";
import { useAppStore } from "../store";
import { getTransport } from "../transport";
import { reviewFlagFor } from "./reviewModel";
import { SendReviewButton } from "./SendReviewButton";
import { ToggleSegment } from "./ToggleSegment";
import { useLiveTabContent } from "./useLiveTabContent";
import { useFileReview } from "./useReviewCommenting";

const MonacoEditor = lazy(() => import("./MonacoEditor"));
const MarkdownPreview = lazy(() => import("./MarkdownPreview"));

const loading = (
	<div className="h-full p-12">
		<SkeletonRows rows={12} />
	</div>
);

export function FilePane({ tab }: { tab: FileTab }) {
	const setFileTabView = useAppStore((s) => s.setFileTabView);
	const review = useFileReview(tab.workspaceId, tab.path, "inline");
	const reviewComments = useAppStore((s) => s.reviewsByWorkspace[tab.workspaceId]?.comments);
	const fileHasDraft = useMemo(
		() => reviewFlagFor(reviewComments, tab.path) === "draft",
		[reviewComments, tab.path],
	);

	useLiveTabContent(tab, {
		read: () =>
			getTransport().request("fs.readFile", { workspaceId: tab.workspaceId, path: tab.path }),
		applyFresh: ({ content }, tick) =>
			useAppStore.getState().updateFileTabContent(tab.workspaceId, tab.id, content, tick),
		keepCurrent: (tick) =>
			useAppStore.getState().updateFileTabContent(tab.workspaceId, tab.id, tab.content, tick),
	});

	const editor = (
		<Suspense fallback={loading}>
			<MonacoEditor path={tab.path} content={tab.content} review={review} />
		</Suspense>
	);

	if (!isMarkdownPath(tab.path)) {
		if (!fileHasDraft) return editor;
		return (
			<div className="flex h-full min-h-0 flex-col">
				<div
					data-testid="file-review-toolbar"
					role="toolbar"
					aria-label="Review actions"
					className="flex h-32 shrink-0 items-center justify-end gap-4 border-border-default border-b bg-container-header-bg px-12"
				>
					<SendReviewButton workspaceId={tab.workspaceId} path={tab.path} />
				</div>
				<div className="min-h-0 flex-1">{editor}</div>
			</div>
		);
	}

	const view = tab.view ?? "rendered";
	return (
		<div className="flex h-full min-h-0 flex-col">
			<div
				data-testid="markdown-view-toggle"
				role="toolbar"
				aria-label="Markdown view mode"
				className="flex h-32 shrink-0 items-center justify-end gap-4 border-border-default border-b bg-container-header-bg px-12"
			>
				<SendReviewButton workspaceId={tab.workspaceId} path={tab.path} />
				<ToggleSegment
					testid="md-toggle-preview"
					label="Preview"
					active={view === "rendered"}
					onClick={() => setFileTabView(tab.id, "rendered")}
				/>
				<ToggleSegment
					testid="md-toggle-source"
					label="Source"
					active={view === "source"}
					onClick={() => setFileTabView(tab.id, "source")}
				/>
			</div>
			<div className="min-h-0 flex-1">
				{view === "rendered" ? (
					<Suspense fallback={loading}>
						<div className="h-full motion-safe:animate-reveal">
							<MarkdownPreview
								content={tab.content}
								workspaceId={tab.workspaceId}
								path={tab.path}
								review={review}
							/>
						</div>
					</Suspense>
				) : (
					editor
				)}
			</div>
		</div>
	);
}
