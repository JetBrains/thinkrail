import {
	type BeforeMount,
	DiffEditor,
	type DiffOnMount,
	type MonacoDiffEditor,
} from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useCallback, useEffect, useRef } from "react";
import { SkeletonRows } from "../components/Skeleton";
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

interface SideWiring {
	codeEditor: editor.ICodeEditor;
	threads: ReturnType<typeof attachReviewThreads>;
	read: (review: EditorReview) => SideReview;
	decorations: string[];
	detach: () => void;
}

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
	const editorRef = useRef<MonacoDiffEditor | null>(null);
	const modelsRef = useRef<{ dispose(): void }[]>([]);
	const sidesRef = useRef<SideWiring[]>([]);
	const reviewRef = useRef(review);
	reviewRef.current = review;

	const syncThreads = useCallback((target: EditorReview) => {
		for (const side of sidesRef.current) {
			const slice = side.read(target);
			side.threads.setThreads(slice.threads);
			side.decorations = applyReviewDecorations(side.codeEditor, side.decorations, slice.threads);
		}
	}, []);

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

	const onMount: DiffOnMount = (diffEditor, m) => {
		stopThemeWatchRef.current = watchThemeSwap(m, THEME);
		editorRef.current = diffEditor;
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
			// Widget before models — the only order that dodges Monaco 0.52+'s dispose assertion (monaco-editor#4779, see panels/SPEC.md).
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
			keepCurrentOriginalModel
			keepCurrentModifiedModel
			beforeMount={beforeMount}
			onMount={onMount}
			loading={
				<div className="h-full w-full p-md">
					<SkeletonRows rows={12} />
				</div>
			}
			options={{
				...sharedEditorOptions(),
				renderSideBySide: view === "split",
				useInlineViewWhenSpaceIsLimited: false,
				hideUnchangedRegions: { enabled: true },
				ignoreTrimWhitespace: ignoreWhitespace,
			}}
		/>
	);
}
