import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { editor } from "monaco-editor";
import { useEffect, useRef, useState } from "react";
import type { DiffTab } from "../store";
import { useAppStore } from "../store";
import { getTransport } from "../transport";
import { defineThinkrailTheme, observeThemeSwap, THEME } from "./MonacoEditor";
import { reverseApplyPatch } from "./unifiedDiff";

/**
 * The center pane for a Changes diff tab: Monaco's built-in diff editor, side-by-side (base left,
 * worktree right), with its standard features — syntax highlighting (language inferred from the model
 * paths' extension), unchanged-region collapsing, line numbers — plus prev/next change buttons
 * (Monaco `goToDiff`) in a slim header.
 *
 * The two sides come from the wire's existing surface, no diff-specific method: the NEW side is
 * `fs.readFile` (a failed read = deleted file = ""), the OLD side is reconstructed by reverse-applying
 * the `git.diff` unified patch to it (`unifiedDiff.ts`). A patch that doesn't apply renders both sides
 * as the current content (an empty diff) rather than a wrong base.
 *
 * Live: refetches when the workspace's fs tick moves (skipping a single unrelated batch by path, like
 * `FilePane`), so an open diff follows further edits to the file.
 */
export default function DiffPane({ tab }: { tab: DiffTab }) {
	const [sides, setSides] = useState<{ original: string; modified: string } | null>(null);
	const fsTick = useAppStore((s) => s.fsChangesByWorkspace[tab.workspaceId]?.tick ?? 0);
	const change = useAppStore((s) => s.fsChangesByWorkspace[tab.workspaceId]);
	const loadedTickRef = useRef(-1);
	const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
	const themeObserverRef = useRef<MutationObserver | null>(null);

	useEffect(() => {
		if (fsTick <= loadedTickRef.current) return;
		// Exactly one batch behind and this file isn't in it → nothing to re-read.
		const skippable =
			sides !== null &&
			change !== undefined &&
			fsTick === loadedTickRef.current + 1 &&
			!change.truncated &&
			!change.paths.includes(tab.path);
		loadedTickRef.current = fsTick;
		if (skippable) return;
		let cancelled = false;
		void (async () => {
			const [diffResult, readResult] = await Promise.all([
				getTransport()
					.request("git.diff", { workspaceId: tab.workspaceId, path: tab.path })
					.catch(() => ({ diff: "" })),
				getTransport()
					.request("fs.readFile", { workspaceId: tab.workspaceId, path: tab.path })
					.catch(() => ({ content: "" })), // deleted (or unreadable) → the new side is empty
			]);
			if (cancelled) return;
			const modified = readResult.content;
			const original = reverseApplyPatch(diffResult.diff, modified) ?? modified;
			setSides({ original, modified });
		})();
		return () => {
			cancelled = true;
		};
	}, [fsTick, change, sides, tab.workspaceId, tab.path]);

	const onMount: DiffOnMount = (diffEditor, m) => {
		editorRef.current = diffEditor;
		themeObserverRef.current = observeThemeSwap(m);
	};
	useEffect(() => () => themeObserverRef.current?.disconnect(), []);

	if (sides === null) {
		return <div className="flex h-full items-center justify-center text-hint">Loading diff…</div>;
	}

	return (
		<div data-testid="diff-pane" className="flex h-full min-h-0 flex-col">
			<div
				role="toolbar"
				aria-label="Diff navigation"
				className="flex h-8 shrink-0 items-center gap-xs border-border2 border-b bg-bg-dark px-sm"
			>
				<span className="min-w-0 flex-1 truncate font-[var(--font-mono)] text-muted text-xs">
					{tab.path}
				</span>
				<button
					type="button"
					data-testid="diff-prev"
					aria-label="Previous change"
					title="Previous change"
					onClick={() => editorRef.current?.goToDiff("previous")}
					className="rounded-[var(--radius-sm)] p-0.5 text-hint hover:bg-hover hover:text-text"
				>
					<ChevronUp className="size-4" />
				</button>
				<button
					type="button"
					data-testid="diff-next"
					aria-label="Next change"
					title="Next change"
					onClick={() => editorRef.current?.goToDiff("next")}
					className="rounded-[var(--radius-sm)] p-0.5 text-hint hover:bg-hover hover:text-text"
				>
					<ChevronDown className="size-4" />
				</button>
			</div>
			<div className="min-h-0 flex-1">
				<DiffEditor
					height="100%"
					original={sides.original}
					modified={sides.modified}
					// Distinct URIs (a) keep these models clear of the same path's file-tab model and
					// (b) end in the real filename, so Monaco infers the language from the extension.
					originalModelPath={`diff-original/${tab.workspaceId}/${tab.path}`}
					modifiedModelPath={`diff-modified/${tab.workspaceId}/${tab.path}`}
					theme={THEME}
					beforeMount={defineThinkrailTheme}
					onMount={onMount}
					loading={
						<div className="flex h-full items-center justify-center text-hint">Loading diff…</div>
					}
					options={{
						readOnly: true,
						renderSideBySide: true,
						hideUnchangedRegions: { enabled: true },
						minimap: { enabled: false },
						fontSize: 13,
						scrollBeyondLastLine: false,
						automaticLayout: true,
					}}
				/>
			</div>
		</div>
	);
}
