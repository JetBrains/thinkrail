import MonacoReact, { type BeforeMount, type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useCallback, useEffect, useRef } from "react";
import type { ResourceViewProps, SurfaceReview } from "@/resources";
import { LoadingRegion } from "../components/Skeleton";
import { useAppStore } from "../store";
import { decorateEditorContextMenus } from "./monacoMenuIcons";
import {
	defineThinkrailTheme,
	EDITOR_THEME,
	sharedEditorOptions,
	watchThemeSwap,
} from "./monacoSetup";
import {
	applyReviewDecorations,
	attachReviewCommenting,
	attachReviewThreads,
} from "./reviewWidgets";

const beforeMount: BeforeMount = (monaco) => defineThinkrailTheme(monaco);

function focusLine(review: SurfaceReview): number | null {
	const range = review.focus?.anchor.selectors.find((selector) => selector.kind === "lineRange");
	return range?.kind === "lineRange" ? range.startLine : null;
}

function isEditorViewState(value: unknown): value is editor.ICodeEditorViewState {
	if (typeof value !== "object" || value === null) return false;
	return Array.isArray(Reflect.get(value, "cursorState")) && Reflect.has(value, "viewState");
}

export default function MonacoEditor({
	resource,
	content,
	review,
	viewState,
	onViewState,
}: ResourceViewProps) {
	const fileLineWidth = useAppStore((state) => state.fileLineWidth);
	const fileLineWidthBounded = useAppStore((state) => state.fileLineWidthBounded);
	const stopThemeWatchRef = useRef<(() => void) | null>(null);
	const menuIconsRef = useRef<{ dispose(): void } | null>(null);
	const detachRef = useRef<(() => void) | null>(null);
	const threadsRef = useRef<ReturnType<typeof attachReviewThreads> | null>(null);
	const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
	const decorationsRef = useRef<string[]>([]);
	const reviewRef = useRef(review);
	const onViewStateRef = useRef(onViewState);
	reviewRef.current = review;
	onViewStateRef.current = onViewState;

	const syncThreads = useCallback((target: SurfaceReview) => {
		if (!editorRef.current) return;
		threadsRef.current?.setThreads(target.threads);
		const applied = applyReviewDecorations(
			editorRef.current,
			decorationsRef.current,
			target.threads,
		);
		decorationsRef.current = applied.decorations;
	}, []);

	const onMount: OnMount = (codeEditor, monaco) => {
		stopThemeWatchRef.current = watchThemeSwap(monaco, EDITOR_THEME);
		editorRef.current = codeEditor;
		menuIconsRef.current = decorateEditorContextMenus(codeEditor);
		if (isEditorViewState(viewState)) codeEditor.restoreViewState(viewState);
		if (review) {
			detachRef.current = attachReviewCommenting(codeEditor, {
				onSave: (draft, text) =>
					reviewRef.current?.commenting.onSave(draft, text) ?? Promise.resolve(),
				onSend: (draft, text) =>
					reviewRef.current?.commenting.onSend(draft, text) ?? Promise.resolve(),
			});
			threadsRef.current = attachReviewThreads(codeEditor, {
				onSendComment: (id) => reviewRef.current?.actions.onSendComment(id) ?? Promise.resolve(),
				onDeleteComment: (id) =>
					reviewRef.current?.actions.onDeleteComment(id) ?? Promise.resolve(),
				onUpdateComment: (id, body) =>
					reviewRef.current?.actions.onUpdateComment(id, body) ?? Promise.resolve(),
			});
			syncThreads(review);
			const line = focusLine(review);
			if (line !== null) {
				codeEditor.revealLineInCenter(line);
				review.onFocusHandled();
			}
		}
	};

	useEffect(() => {
		if (review) syncThreads(review);
	}, [review, syncThreads]);

	useEffect(() => {
		if (!review || !editorRef.current) return;
		const line = focusLine(review);
		if (line === null) return;
		editorRef.current.revealLineInCenter(line);
		review.onFocusHandled();
	}, [review]);

	useEffect(
		() => () => {
			const saved = editorRef.current?.saveViewState();
			if (saved) onViewStateRef.current?.(saved);
			stopThemeWatchRef.current?.();
			menuIconsRef.current?.dispose();
			detachRef.current?.();
			threadsRef.current?.dispose();
		},
		[],
	);

	const text = content.kind === "text" ? content.text : "";
	return (
		<MonacoReact
			height="100%"
			path={resource.path}
			value={text}
			theme={EDITOR_THEME}
			beforeMount={beforeMount}
			onMount={onMount}
			loading={<LoadingRegion rows={12} className="h-full w-full p-12" />}
			options={sharedEditorOptions(fileLineWidth, fileLineWidthBounded)}
		/>
	);
}
