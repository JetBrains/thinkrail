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

// Heavy views load only when shown: Monaco for source, markdown+shiki for the rendered preview.
const MonacoEditor = lazy(() => import("./MonacoEditor"));
const MarkdownPreview = lazy(() => import("./MarkdownPreview"));

const loading = (
	<div className="flex h-full items-center justify-center text-text-muted">Loading…</div>
);

/**
 * The center pane for a file tab. Non-markdown files render Monaco directly; markdown files open
 * **rendered by default** with a `Preview | Source` toggle in a slim header (the choice lives on the
 * tab, `store.setFileTabView`, so it survives tab switches).
 *
 * Review commenting is selection-triggered, no mode toggle (see panels/SPEC.md): selecting text in the
 * Monaco surface shows the floating comment icon → inline composer (`reviewWidgets`, wired through
 * `useReviewCommenting`); commented lines render as decorations. The rendered markdown view carries it
 * too (`PreviewCommenting` — the rendered selection maps back to source lines via `previewAnchor`).
 *
 * Live: when the workspace's fs tick moves past the tick this tab's content was loaded at, the file is
 * re-read and the tab content replaced (Monaco + preview are `content`-controlled, so they follow).
 * Visible tabs update live; a background tab catches up here on activation (only the active tab mounts).
 * A single unrelated batch is skipped by path; a failed re-read (file deleted) keeps the last content —
 * the tree/changes panels are where the deletion shows — and just advances the tab's tick.
 */
export function FilePane({ tab }: { tab: FileTab }) {
	const setFileTabView = useAppStore((s) => s.setFileTabView);
	const review = useFileReview(tab.workspaceId, tab.path, "inline");
	const reviewComments = useAppStore((s) => s.reviewsByWorkspace[tab.workspaceId]?.comments);
	// The same gate `SendReviewButton` applies — this header exists only to host it, so a file whose
	// review is merely in progress grows no toolbar.
	const fileHasDraft = useMemo(
		() => reviewFlagFor(reviewComments, tab.path) === "draft",
		[reviewComments, tab.path],
	);

	useLiveTabContent(tab, {
		read: () =>
			getTransport().request("fs.readFile", { workspaceId: tab.workspaceId, path: tab.path }),
		applyFresh: ({ content }, tick) =>
			useAppStore.getState().updateFileTabContent(tab.id, content, tick),
		keepCurrent: (tick) => useAppStore.getState().updateFileTabContent(tab.id, tab.content, tick),
	});

	const editor = (
		<Suspense fallback={loading}>
			<MonacoEditor path={tab.path} content={tab.content} review={review} />
		</Suspense>
	);

	// Non-markdown files have no view toggles — a slim header appears only while THIS file has a
	// pending draft, purely to host the Send-review action (same right-aligned toolbar as elsewhere).
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
				// `justify-end`: header actions are right-aligned, matching the DiffPane / Changes toolbars.
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
