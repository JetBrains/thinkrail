import { Check, Copy, Pilcrow } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { copyText, isMarkdownPath } from "@/lib/utils";
import type { DiffTab } from "../store";
import { selectDiffTabTargetRef, useAppStore } from "../store";
import { getTransport } from "../transport";
import { splitPath } from "./changesModel";
import { SendReviewButton } from "./SendReviewButton";
import { ToggleSegment } from "./ToggleSegment";
import { useLiveTabContent } from "./useLiveTabContent";
import { useFileReview } from "./useReviewCommenting";

// Heavy views load only when shown — same lazy stance as FilePane: Monaco for the diff, markdown+shiki
// (+ htmldiff) for the rendered rich-diff view of a markdown file's diff.
const MonacoDiff = lazy(() => import("./MonacoDiff"));
const RenderedDiff = lazy(() => import("./RenderedDiff"));

const loading = (
	<div className="flex h-full items-center justify-center text-text-muted">Loading…</div>
);

/**
 * The center pane for a diff tab: a slim header over the diff. A non-markdown file gets the read-only
 * Monaco diff (the tab's own scope: base branch / HEAD / one commit) with a **Split | Inline** toggle
 * (per-tab via `store.setDiffTabView`). A markdown file gets exactly two views via a **Source | Rendered**
 * toggle (per-tab `store.setDiffTabRendered`): **Source** = the basic Monaco split diff; **Rendered** = the
 * lazy `RenderedDiff` — one htmldiff-merged rendered document with ins/del markers. See `RenderedDiff`
 * for the contract.
 *
 * Two more header affordances, both per-tab and both read-only (editing in the diff is a separate task —
 * it needs `fs.writeFile` plus a conflict story against agent/terminal writes): **¶** toggles hiding
 * whitespace-only changes (Monaco's `ignoreTrimWhitespace`) and **copy** puts the modified side's contents
 * on the clipboard. The path is a **chip**: muted directory prefix + bright basename, matching the Changes
 * list's rows.
 *
 * Live in two dimensions: same contract as `FilePane` — when the workspace's fs tick moves past the tick
 * this tab's contents were loaded at, both sides are re-read (`git.diffFile`, **with this tab's scope** —
 * never the panel's current one) and replaced — **plus** the review target for a branch-scope tab: such a
 * tab means "this file vs the workspace's *current* target", so re-pointing it re-reads immediately instead
 * of lagging until the next fs tick (`selectDiffTabTargetRef`; a commit scope has no such dimension). Only the active tab mounts, so background tabs catch up on
 * activation. A file that left the change set keeps its last contents (the Changes list is where the
 * disappearance shows); a failed re-read just advances the tick.
 */

export function DiffPane({ tab }: { tab: DiffTab }) {
	const setDiffTabView = useAppStore((s) => s.setDiffTabView);
	const setDiffTabRendered = useAppStore((s) => s.setDiffTabRendered);
	const setDiffTabIgnoreWhitespace = useAppStore((s) => s.setDiffTabIgnoreWhitespace);
	const [copied, setCopied] = useState(false);
	// Review commenting attaches only for scopes whose modified side is the worktree (branch /
	// uncommitted) — a commit-scope tab shows historical content on both sides, and a comment anchored
	// there would pin lines the worktree may not have. The tab's scope also travels with a base-side
	// comment: it is what lets the host resolve the very blob the original editor is showing.
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
			// Fresh content records the target it was read against; a tick-only advance keeps the tab's existing
			// one (nothing was re-read, so nothing new is being claimed).
			applyFresh: ({ original, modified }, tick) =>
				useAppStore.getState().updateDiffTabContent(tab.id, original, modified, tick, targetRef),
			keepCurrent: (tick) =>
				useAppStore
					.getState()
					.updateDiffTabContent(tab.id, tab.original, tab.modified, tick, tab.loadedTarget),
		},
		targetRef,
		tab.loadedTarget,
	);

	const markdown = isMarkdownPath(tab.path);
	const view = tab.view ?? "split";
	// `rendered` is only ever set through the toggle, which non-markdown tabs never offer.
	const rendered = markdown && (tab.rendered ?? false);
	const ignoreWhitespace = tab.ignoreWhitespace ?? false;
	const { dir, base } = splitPath(tab.path);
	const copy = async () => {
		// No clipboard (insecure context / denied) — no flash; the diff text stays selectable.
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
				className="flex h-8 shrink-0 items-center gap-xs border-border-default border-b bg-container-header-bg px-sm"
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
					{/* `shrink-0` **plus** `max-w-full` (the same rule as the Changes list's path rows): the dir is
					    the only shrinkable half, so it yields completely before the name loses a pixel, while
					    max-width still clamps a long basename so it can never push the ¶/copy/layout controls out
					    of the header on a narrow pane. */}
					<span
						data-testid="diff-path-base"
						className="max-w-full shrink-0 truncate text-text-muted"
					>
						{base}
					</span>
				</span>
				<SendReviewButton workspaceId={tab.workspaceId} path={tab.path} />
				{/* Hide whitespace-only changes — Monaco's own `ignoreTrimWhitespace`, per tab. Not offered in
				    the rendered markdown view, which has no lines to compare. */}
				{rendered ? null : (
					<HeaderIconButton
						testid="diff-toggle-whitespace"
						label="Hide whitespace changes"
						active={ignoreWhitespace}
						onClick={() => setDiffTabIgnoreWhitespace(tab.id, !ignoreWhitespace)}
					>
						<Pilcrow className="size-3.5" />
					</HeaderIconButton>
				)}
				<HeaderIconButton testid="diff-copy" label="Copy file contents" onClick={() => void copy()}>
					{copied ? (
						<Check className="size-3.5 text-feedback-success" />
					) : (
						<Copy className="size-3.5" />
					)}
				</HeaderIconButton>
				{toggles}
			</div>
			<div className="min-h-0 flex-1">
				<Suspense fallback={loading}>
					{rendered ? (
						<RenderedDiff tab={tab} />
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

/**
 * A header icon button, styled like `ToggleSegment` — for affordances a word would crowd out (¶, copy).
 * `active` is **optional on purpose**: given, the button is a toggle (pressed styling + `aria-pressed`);
 * omitted, it is a plain action (copy), which must not claim a pressed state it doesn't have.
 */
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
		<button
			type="button"
			data-testid={testid}
			data-active={active}
			aria-pressed={active}
			aria-label={label}
			title={label}
			onClick={onClick}
			className={`flex size-6 items-center justify-center rounded-[var(--radius-sm)] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary ${
				active
					? "bg-container-elevated-bg text-text-default"
					: "text-text-muted hover:bg-control-bg-hovered hover:text-text-default"
			}`}
		>
			{children}
		</button>
	);
}
