import { lazy, Suspense, useMemo } from "react";
import { isMarkdownPath } from "@/lib/utils";
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
	<div className="flex h-full items-center justify-center text-text-muted">Loading…</div>
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
					className="flex h-8 shrink-0 items-center justify-end gap-xs border-border-default border-b bg-container-header-bg px-sm"
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
				className="flex h-8 shrink-0 items-center justify-end gap-xs border-border-default border-b bg-container-header-bg px-sm"
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
						<MarkdownPreview
							content={tab.content}
							workspaceId={tab.workspaceId}
							path={tab.path}
							review={review}
						/>
					</Suspense>
				) : (
					editor
				)}
			</div>
		</div>
	);
}
