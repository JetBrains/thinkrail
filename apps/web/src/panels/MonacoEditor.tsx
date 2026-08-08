import MonacoReact, { type BeforeMount, type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useCallback, useEffect, useRef } from "react";
import { decorateEditorContextMenus } from "./monacoMenuIcons";
import {
	defineThinkrailTheme,
	EDITOR_THEME,
	sharedEditorOptions,
	watchThemeSwap,
} from "./monacoSetup";
import { applyReviewDecorations } from "./reviewGutter";
import { attachReviewCommenting, attachReviewThreads } from "./reviewWidgets";
import type { EditorReview } from "./useReviewCommenting";

const beforeMount: BeforeMount = (m) => defineThinkrailTheme(m);

/**
 * Read-only file viewer; language is inferred from `path`. Editing + save land with `fs.writeFile`.
 * The optional `review` hook (see panels/SPEC.md + `useFileReview`) carries the whole review surface:
 * comment-line decorations + inline thread cards (derived from `review.threads`) and the
 * selection→icon→composer flow (`review.commenting`).
 */
export default function MonacoEditor({
	path,
	content,
	review,
}: {
	path: string;
	content: string;
	review?: EditorReview;
}) {
	const stopThemeWatchRef = useRef<(() => void) | null>(null);
	const menuIconsRef = useRef<{ dispose(): void } | null>(null);
	const detachRef = useRef<(() => void) | null>(null);
	const threadsRef = useRef<ReturnType<typeof attachReviewThreads> | null>(null);
	const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
	const decorationsRef = useRef<string[]>([]);
	// Attach once; the widgets read the LATEST review object through this ref (its identity changes per
	// render — re-attaching per render would tear the composer down mid-typing).
	const reviewRef = useRef(review);
	reviewRef.current = review;

	// Stable (reads only refs), so the effect below can list it honestly.
	const syncThreads = useCallback((target: EditorReview) => {
		if (!editorRef.current) return;
		threadsRef.current?.setThreads(target.threads);
		decorationsRef.current = applyReviewDecorations(
			editorRef.current,
			decorationsRef.current,
			target.threads,
		);
	}, []);

	// Mirrors TerminalInstance's observer: follow atomic `[data-theme]` swaps while mounted.
	const onMount: OnMount = (codeEditor, m) => {
		stopThemeWatchRef.current = watchThemeSwap(m, EDITOR_THEME);
		editorRef.current = codeEditor;
		// Review or not, the editor HAS a context menu (Copy, Command Palette…) — icon it always.
		menuIconsRef.current = decorateEditorContextMenus(codeEditor);
		if (review) {
			detachRef.current = attachReviewCommenting(codeEditor, {
				onSave: (s, t) => reviewRef.current?.commenting.onSave(s, t) ?? Promise.resolve(),
				onSend: (s, t) => reviewRef.current?.commenting.onSend(s, t) ?? Promise.resolve(),
			});
			threadsRef.current = attachReviewThreads(codeEditor, {
				onSendComment: (id) => reviewRef.current?.actions.onSendComment(id) ?? Promise.resolve(),
				onDeleteComment: (id) =>
					reviewRef.current?.actions.onDeleteComment(id) ?? Promise.resolve(),
				onUpdateComment: (id, body) =>
					reviewRef.current?.actions.onUpdateComment(id, body) ?? Promise.resolve(),
			});
			syncThreads(review);
			// A focus deep link that arrived BEFORE the editor mounted (row click opens the tab, Monaco
			// loads lazily) is consumed here — the effect below only re-runs on `review` changes.
			const focus = reviewRef.current?.focus;
			if (focus) {
				codeEditor.revealLineInCenter(focus.line);
				reviewRef.current?.onFocusHandled();
			}
		}
	};

	useEffect(() => {
		if (review) syncThreads(review);
	}, [review, syncThreads]);

	// The Review panel's "focus this comment" deep link: reveal the anchor line (the in-flow card sits
	// right below it), then consume the request so it fires exactly once.
	useEffect(() => {
		if (!review?.focus || !editorRef.current) return;
		editorRef.current.revealLineInCenter(review.focus.line);
		review.onFocusHandled();
	}, [review]);

	useEffect(
		() => () => {
			stopThemeWatchRef.current?.();
			menuIconsRef.current?.dispose();
			detachRef.current?.();
			threadsRef.current?.dispose();
		},
		[],
	);

	return (
		<MonacoReact
			height="100%"
			path={path}
			value={content}
			theme={EDITOR_THEME}
			beforeMount={beforeMount}
			onMount={onMount}
			loading={
				<div className="flex h-full items-center justify-center text-text-muted">
					Loading editor…
				</div>
			}
			options={sharedEditorOptions()}
		/>
	);
}
