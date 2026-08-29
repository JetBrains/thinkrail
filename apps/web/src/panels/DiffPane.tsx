import {
	RiCheckLine as Check,
	RiFileCopyLine as Copy,
	RiParagraph as Pilcrow,
} from "@remixicon/react";
import { lazy, Suspense, useState } from "react";
import { IconTooltip } from "@/components/ui/tooltip";
import { copyText, isMarkdownPath } from "@/lib/utils";
import { SkeletonRows } from "../components/Skeleton";
import type { DiffTab } from "../store";
import { selectDiffTabTargetRef, useAppStore } from "../store";
import { getTransport } from "../transport";
import { splitPath } from "./changesModel";
import { SendReviewButton } from "./SendReviewButton";
import { ToggleSegment } from "./ToggleSegment";
import { useLiveTabContent } from "./useLiveTabContent";
import { useFileReview } from "./useReviewCommenting";

const MonacoDiff = lazy(() => import("./MonacoDiff"));
const RenderedDiff = lazy(() => import("./RenderedDiff"));

const loading = (
	<div className="h-full p-12">
		<SkeletonRows rows={12} />
	</div>
);

export function DiffPane({ tab }: { tab: DiffTab }) {
	const setDiffTabView = useAppStore((s) => s.setDiffTabView);
	const setDiffTabRendered = useAppStore((s) => s.setDiffTabRendered);
	const setDiffTabIgnoreWhitespace = useAppStore((s) => s.setDiffTabIgnoreWhitespace);
	const [copied, setCopied] = useState(false);
	const reviewable = tab.scope.kind !== "commit";
	const review = useFileReview(tab.workspaceId, tab.path, "diff", tab.scope);

	const targetRef = useAppStore((s) => selectDiffTabTargetRef(s, tab));
	useLiveTabContent(
		tab,
		{
			read: () =>
				getTransport().request("git.diffFile", {
					workspaceId: tab.workspaceId,
					path: tab.path,
					scope: tab.scope,
				}),
			applyFresh: ({ original, modified }, tick) =>
				useAppStore
					.getState()
					.updateDiffTabContent(tab.workspaceId, tab.id, original, modified, tick, targetRef),
			keepCurrent: (tick) =>
				useAppStore
					.getState()
					.updateDiffTabContent(
						tab.workspaceId,
						tab.id,
						tab.original,
						tab.modified,
						tick,
						tab.loadedTarget,
					),
		},
		targetRef,
		tab.loadedTarget,
	);

	const markdown = isMarkdownPath(tab.path);
	const view = tab.view ?? "split";
	const rendered = markdown && (tab.rendered ?? false);
	const ignoreWhitespace = tab.ignoreWhitespace ?? false;
	const { dir, base } = splitPath(tab.path);
	const copy = async () => {
		if (!(await copyText(tab.modified))) return;
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};
	const toggles = markdown ? (
		<>
			<ToggleSegment
				testid="diff-toggle-source"
				label="Source"
				active={!rendered}
				onClick={() => setDiffTabRendered(tab.id, false)}
			/>
			<ToggleSegment
				testid="diff-toggle-rendered"
				label="Rendered"
				active={rendered}
				onClick={() => setDiffTabRendered(tab.id, true)}
			/>
		</>
	) : (
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
	);
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
				{rendered ? null : (
					<HeaderIconButton
						testid="diff-toggle-whitespace"
						label="Hide whitespace changes"
						active={ignoreWhitespace}
						onClick={() => setDiffTabIgnoreWhitespace(tab.id, !ignoreWhitespace)}
					>
						<Pilcrow className="size-14" />
					</HeaderIconButton>
				)}
				<HeaderIconButton testid="diff-copy" label="Copy file contents" onClick={() => void copy()}>
					{copied ? (
						<Check className="size-14 text-feedback-success" />
					) : (
						<Copy className="size-14" />
					)}
				</HeaderIconButton>
				{toggles}
			</div>
			<div className="min-h-0 flex-1">
				<Suspense fallback={loading}>
					{rendered ? (
						<div className="h-full motion-safe:animate-reveal">
							<RenderedDiff tab={tab} />
						</div>
					) : (
						<MonacoDiff
							path={tab.path}
							original={tab.original}
							modified={tab.modified}
							view={markdown ? "split" : view}
							ignoreWhitespace={ignoreWhitespace}
							{...(reviewable ? { review } : {})}
						/>
					)}
				</Suspense>
			</div>
		</div>
	);
}

function HeaderIconButton({
	testid,
	label,
	active,
	onClick,
	children,
}: {
	testid: string;
	label: string;
	active?: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<IconTooltip label={label}>
			<button
				type="button"
				data-testid={testid}
				data-active={active}
				aria-pressed={active}
				aria-label={label}
				onClick={onClick}
				className={`flex size-24 items-center justify-center rounded-[var(--radius-sm)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary ${
					active
						? "bg-container-elevated-bg text-text-default"
						: "text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
				}`}
			>
				{children}
			</button>
		</IconTooltip>
	);
}
