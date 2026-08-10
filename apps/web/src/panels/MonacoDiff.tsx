import {
	type BeforeMount,
	DiffEditor,
	type DiffOnMount,
	type MonacoDiffEditor,
} from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useCallback, useEffect, useRef } from "react";
import { decorateEditorContextMenus } from "./monacoMenuIcons";
import {
	defineThinkrailTheme,
	languageForPath,
	sharedEditorOptions,
	THEME,
	watchThemeSwap,
} from "./monacoSetup";
import { applyReviewDecorations } from "./reviewGutter";
import { attachReviewCommenting, attachReviewThreads } from "./reviewWidgets";
import type { EditorReview, SideReview } from "./useReviewCommenting";

const beforeMount: BeforeMount = (m) => defineThinkrailTheme(m);

/** One wired diff editor: its thread zones + decoration ids, and how to read its slice of the review. */
interface SideWiring {
	codeEditor: editor.ICodeEditor;
	threads: ReturnType<typeof attachReviewThreads>;
	read: (review: EditorReview) => SideReview;
	decorations: string[];
	detach: () => void;
}

/**
 * Read-only Monaco diff of one file: the diff scope's original side vs its modified side. `view` picks split
 * (side-by-side) or inline rendering; `ignoreWhitespace` drops whitespace-only changes. Language is inferred
 * from the model paths (both derive from the file's own path, so both sides highlight alike).
 *
 * The optional `review` hook rides **both** editors, each against its own anchor side: the modified
 * editor renders `review` (worktree anchors), the original editor `review.base` (base anchors, captured
 * against the very blob it displays). They are deliberately NOT one space — translating an original-side
 * selection into modified line numbers pins a remark about a deleted or rewritten line to whatever
 * happens to occupy that spot in the worktree, which is what the agent would then be shown. Each side
 * carries the same three pieces: decorations, in-flow thread cards, and the selection→icon→composer
 * flow. See panels/SPEC.md + `useFileReview`.
 */
export default function MonacoDiff({
	path,
	original,
	modified,
	view,
	ignoreWhitespace,
	review,
}: {
	path: string;
	original: string;
	modified: string;
	view: "split" | "inline";
	ignoreWhitespace: boolean;
	review?: EditorReview;
}) {
	const stopThemeWatchRef = useRef<(() => void) | null>(null);
	const menuIconsRef = useRef<{ dispose(): void }[]>([]);
	// The diff widget + its two TextModels, captured at mount so our unmount cleanup can dispose them in the
	// right order — see below.
	const editorRef = useRef<MonacoDiffEditor | null>(null);
	const modelsRef = useRef<{ dispose(): void }[]>([]);
	const sidesRef = useRef<SideWiring[]>([]);
	// Attach once; the widgets read the LATEST review object through this ref (see MonacoEditor).
	const reviewRef = useRef(review);
	reviewRef.current = review;

	// Stable (reads only refs), so the effects below can list them honestly.
	const syncThreads = useCallback((target: EditorReview) => {
		for (const side of sidesRef.current) {
			const slice = side.read(target);
			side.threads.setThreads(slice.threads);
			side.decorations = applyReviewDecorations(side.codeEditor, side.decorations, slice.threads);
		}
	}, []);

	// The Review panel's "focus this comment" deep link: reveal the anchor line on whichever side owns
	// the comment (the in-flow card sits right below it), then consume the request so it fires once.
	const consumeFocus = useCallback((target: EditorReview) => {
		let handled = false;
		for (const side of sidesRef.current) {
			const focus = side.read(target).focus;
			if (!focus) continue;
			side.codeEditor.revealLineInCenter(focus.line);
			handled = true;
		}
		if (handled) target.onFocusHandled();
	}, []);

	/** Wire one editor for review: composer + thread cards, both reading through `reviewRef`. */
	const wireSide = useCallback(
		(codeEditor: editor.IStandaloneCodeEditor, read: SideWiring["read"]): SideWiring => {
			const slice = () => (reviewRef.current ? read(reviewRef.current) : undefined);
			const detach = attachReviewCommenting(codeEditor, {
				onSave: (s, t) => slice()?.commenting.onSave(s, t) ?? Promise.resolve(),
				onSend: (s, t) => slice()?.commenting.onSend(s, t) ?? Promise.resolve(),
			});
			const threads = attachReviewThreads(codeEditor, {
				onSendComment: (id) => reviewRef.current?.actions.onSendComment(id) ?? Promise.resolve(),
				onDeleteComment: (id) =>
					reviewRef.current?.actions.onDeleteComment(id) ?? Promise.resolve(),
				onUpdateComment: (id, body) =>
					reviewRef.current?.actions.onUpdateComment(id, body) ?? Promise.resolve(),
			});
			return { codeEditor, threads, read, decorations: [], detach };
		},
		[],
	);

	// Mirrors MonacoEditor's observer: follow atomic `[data-theme]` swaps while mounted — and capture
	// the widget + its models for the ORDERED unmount disposal below.
	const onMount: DiffOnMount = (diffEditor, m) => {
		stopThemeWatchRef.current = watchThemeSwap(m, THEME);
		editorRef.current = diffEditor;
		// Review or not, both inner editors have context menus (Copy, Command Palette…) — icon them always.
		menuIconsRef.current = [
			decorateEditorContextMenus(diffEditor.getModifiedEditor()),
			decorateEditorContextMenus(diffEditor.getOriginalEditor()),
		];
		const model = diffEditor.getModel();
		modelsRef.current = model ? [model.original, model.modified] : [];
		if (!review) return;
		sidesRef.current = [
			wireSide(diffEditor.getModifiedEditor(), (r) => r),
			wireSide(diffEditor.getOriginalEditor(), (r) => r.base),
		];
		syncThreads(review);
		// A focus deep link that arrived BEFORE the editor mounted (row click opens the tab, Monaco
		// loads lazily) is consumed here — the effect below only re-runs on `review` changes.
		if (reviewRef.current) consumeFocus(reviewRef.current);
	};

	useEffect(() => {
		if (review) syncThreads(review);
	}, [review, syncThreads]);

	useEffect(() => {
		if (review) consumeFocus(review);
	}, [review, consumeFocus]);

	useEffect(
		() => () => {
			stopThemeWatchRef.current?.();
			for (const d of menuIconsRef.current) d.dispose();
			menuIconsRef.current = [];
			for (const side of sidesRef.current) {
				side.detach();
				side.threads.dispose();
			}
			sidesRef.current = [];
			// Dispose the diff *widget* before its TextModels. Disposing a model while a live widget still
			// references it trips Monaco 0.52+'s "TextModel got disposed before DiffEditorWidget model got
			// reset" assertion (@monaco-editor/react#647 / monaco-editor#4779, unfixed in 4.7.0), and
			// `@monaco-editor/react`'s own cleanup disposes them in the wrong order. The `keepCurrent*` flags
			// below stop it from disposing the models early, so we own their lifecycle here and free them only
			// after the widget is gone (widget dispose is idempotent, so it's fine if the library already ran).
			// Not keeping them would also leak a model pair per closed diff tab.
			editorRef.current?.dispose();
			editorRef.current = null;
			for (const model of modelsRef.current) model.dispose();
			modelsRef.current = [];
		},
		[],
	);

	return (
		<DiffEditor
			height="100%"
			original={original}
			modified={modified}
			language={languageForPath(path)}
			originalModelPath={`diff-original://${path}`}
			modifiedModelPath={`diff-modified://${path}`}
			theme={THEME}
			// Keep the models on unmount so `DiffEditor` disposes the widget *before* its models (it otherwise
			// disposes models first — the assertion trip above); we free them ourselves once the widget is gone.
			keepCurrentOriginalModel
			keepCurrentModifiedModel
			beforeMount={beforeMount}
			onMount={onMount}
			loading={
				<div className="flex h-full items-center justify-center text-text-muted">Loading diff…</div>
			}
			// `useInlineViewWhenSpaceIsLimited: false`: the pane-header toggle must do what it says — without
			// it Monaco silently renders Split as inline on a narrow pane, which reads as a broken toggle.
			options={{
				...sharedEditorOptions(),
				renderSideBySide: view === "split",
				useInlineViewWhenSpaceIsLimited: false,
				// Collapsed unchanged context ("N unmodified lines", with an expand control) is Monaco's own
				// feature in both split and inline — nothing hand-rolled to keep in sync with its folding.
				hideUnchangedRegions: { enabled: true },
				ignoreTrimWhitespace: ignoreWhitespace,
			}}
		/>
	);
}
