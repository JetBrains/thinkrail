import { type BeforeMount, DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import { useEffect, useRef } from "react";
import {
	defineThinkrailTheme,
	languageForPath,
	sharedEditorOptions,
	THEME,
	watchThemeSwap,
} from "./monacoSetup";

const beforeMount: BeforeMount = (m) => defineThinkrailTheme(m);

/**
 * Read-only Monaco diff of one file: base-branch content vs worktree content. `view` picks split
 * (side-by-side) or inline rendering. Language is inferred from the model paths (both derive from the
 * file's own path, so both sides highlight alike).
 */
export default function MonacoDiff({
	path,
	original,
	modified,
	view,
}: {
	path: string;
	original: string;
	modified: string;
	view: "split" | "inline";
}) {
	const observerRef = useRef<MutationObserver | null>(null);

	// Mirrors MonacoEditor's observer: follow atomic `[data-theme]` swaps while mounted.
	const onMount: DiffOnMount = (_editor, m) => {
		observerRef.current = watchThemeSwap(m);
	};

	useEffect(() => () => observerRef.current?.disconnect(), []);

	return (
		<DiffEditor
			height="100%"
			original={original}
			modified={modified}
			language={languageForPath(path)}
			originalModelPath={`diff-original://${path}`}
			modifiedModelPath={`diff-modified://${path}`}
			theme={THEME}
			beforeMount={beforeMount}
			onMount={onMount}
			loading={
				<div className="flex h-full items-center justify-center text-hint">Loading diff…</div>
			}
			// `useInlineViewWhenSpaceIsLimited: false`: the pane-header toggle must do what it says — without
			// it Monaco silently renders Split as inline on a narrow pane, which reads as a broken toggle.
			options={{
				...sharedEditorOptions(),
				renderSideBySide: view === "split",
				useInlineViewWhenSpaceIsLimited: false,
			}}
		/>
	);
}
