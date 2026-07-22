import { lazy, Suspense, useEffect } from "react";
import { isMarkdownPath } from "@/lib/utils";
import type { DiffTab } from "../store";
import { useAppStore } from "../store";
import { getTransport } from "../transport";
import { ToggleSegment } from "./ToggleSegment";

// Heavy views load only when shown — same lazy stance as FilePane: Monaco for the diff, markdown+shiki
// (+ htmldiff) for the rendered rich-diff view of a markdown file's diff.
const MonacoDiff = lazy(() => import("./MonacoDiff"));
const RenderedDiff = lazy(() => import("./RenderedDiff"));

const loading = <div className="flex h-full items-center justify-center text-hint">Loading…</div>;

/**
 * The center pane for a diff tab: a slim header over the diff. A non-markdown file gets the read-only
 * Monaco diff (base branch vs worktree) with a **Split | Inline** toggle (per-tab via
 * `store.setDiffTabView`). A markdown file gets exactly two views via a **Source | Rendered** toggle
 * (per-tab `store.setDiffTabRendered`): **Source** = the basic Monaco split diff; **Rendered** = the
 * lazy `RenderedDiff` — one htmldiff-merged rendered document with ins/del markers. See `RenderedDiff`
 * for the contract.
 *
 * Live: same contract as `FilePane` — when the workspace's fs tick moves past the tick this tab's
 * contents were loaded at, both sides are re-read (`git.diffFile`) and replaced. Only the active tab
 * mounts, so background tabs catch up on activation. A file that left the change set keeps its last
 * contents (the Changes list is where the disappearance shows); a failed re-read just advances the tick.
 */

export function DiffPane({ tab }: { tab: DiffTab }) {
	const setDiffTabView = useAppStore((s) => s.setDiffTabView);
	const setDiffTabRendered = useAppStore((s) => s.setDiffTabRendered);
	const change = useAppStore((s) => s.fsChangesByWorkspace[tab.workspaceId]);

	useEffect(() => {
		if (!change) return;
		const loaded = tab.loadedTick ?? 0;
		if (change.tick <= loaded) return;
		const updateContent = useAppStore.getState().updateDiffTabContent;
		// Exactly one batch behind and this file isn't in it → nothing to re-read, just advance the tick.
		const skippable =
			change.tick === loaded + 1 && !change.truncated && !change.paths.includes(tab.path);
		if (skippable) {
			updateContent(tab.id, tab.original, tab.modified, change.tick);
			return;
		}
		let cancelled = false;
		getTransport()
			.request("git.diffFile", { workspaceId: tab.workspaceId, path: tab.path })
			.then(({ original, modified }) => {
				if (!cancelled) updateContent(tab.id, original, modified, change.tick);
			})
			.catch(() => {
				if (!cancelled) updateContent(tab.id, tab.original, tab.modified, change.tick);
			});
		return () => {
			cancelled = true;
		};
	}, [change, tab.id, tab.path, tab.workspaceId, tab.loadedTick, tab.original, tab.modified]);

	const markdown = isMarkdownPath(tab.path);
	const view = tab.view ?? "split";
	// `rendered` is only ever set through the toggle, which non-markdown tabs never offer.
	const rendered = markdown && (tab.rendered ?? false);
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
				className="flex h-8 shrink-0 items-center gap-xs border-border2 border-b bg-bg-dark px-sm"
			>
				<span className="mr-auto truncate font-[var(--font-mono)] text-hint text-xs">
					{tab.path}
				</span>
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
						/>
					)}
				</Suspense>
			</div>
		</div>
	);
}
