import MonacoReact, { type BeforeMount, type OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useCallback, useEffect, useRef } from "react";
import { SkeletonRows } from "../components/Skeleton";
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
	const reviewRef = useRef(review);
	reviewRef.current = review;

	const syncThreads = useCallback((target: EditorReview) => {
		if (!editorRef.current) return;
		threadsRef.current?.setThreads(target.threads);
		decorationsRef.current = applyReviewDecorations(
			editorRef.current,
			decorationsRef.current,
			target.threads,
		);
	}, []);

	const onMount: OnMount = (codeEditor, m) => {
		stopThemeWatchRef.current = watchThemeSwap(m, EDITOR_THEME);
		editorRef.current = codeEditor;
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
				<div className="h-full w-full p-md">
					<SkeletonRows rows={12} />
				</div>
			}
			options={sharedEditorOptions()}
		/>
	);
}
