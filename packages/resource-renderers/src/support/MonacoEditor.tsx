import MonacoReact, { type OnMount } from "@monaco-editor/react";
import { useT } from "@thinkrail/locales/react";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import type { editor } from "monaco-editor/esm/vs/editor/editor.api.js";
import { use, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useResourceHost, useResourcePreferences } from "../host";
import type { ResourceViewProps, SurfaceReview } from "../registry";
import { MonacoReviewZones } from "./MonacoReviewZones";
import { decorateEditorContextMenus } from "./monacoMenuIcons";
import {
	EDITOR_THEME,
	ensureMonaco,
	fileEditorOptions,
	languageForPath,
	watchThemeSwap,
} from "./monacoSetup";
import {
	applyReviewDecorations,
	attachReviewCommenting,
	attachReviewThreads,
	type MonacoReviewZoneState,
} from "./reviewWidgets";

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
	const t = useT();
	const { fileLineWidth, fileLineWidthBounded } = useResourcePreferences();
	use(ensureMonaco(useResourceHost().code));
	const modelScope = useId().replace(/[^\w-]/g, "");
	const options = useMemo(
		() => fileEditorOptions(t, fileLineWidth, fileLineWidthBounded, resource.path),
		[t, fileLineWidth, fileLineWidthBounded, resource.path],
	);
	const stopThemeWatchRef = useRef<(() => void) | null>(null);
	const menuIconsRef = useRef<{ dispose(): void } | null>(null);
	const detachRef = useRef<(() => void) | null>(null);
	const threadsRef = useRef<ReturnType<typeof attachReviewThreads> | null>(null);
	const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
	const decorationsRef = useRef<string[]>([]);
	const [reviewZones, setReviewZones] = useState<MonacoReviewZoneState>({
		threads: [],
		composer: null,
	});
	const onViewStateRef = useRef(onViewState);
	onViewStateRef.current = onViewState;

	const closeComposer = useCallback(() => threadsRef.current?.closeComposer(), []);
	const layoutReviewZones = useCallback(() => threadsRef.current?.layout(), []);
	const syncThreads = useCallback((target: SurfaceReview) => {
		if (!editorRef.current) return;
		threadsRef.current?.setThreads(target.threads);
		decorationsRef.current = applyReviewDecorations(
			editorRef.current,
			decorationsRef.current,
			target.threads,
		);
	}, []);

	const onMount: OnMount = (codeEditor) => {
		stopThemeWatchRef.current = watchThemeSwap();
		editorRef.current = codeEditor;
		menuIconsRef.current = decorateEditorContextMenus(codeEditor);
		if (isEditorViewState(viewState)) codeEditor.restoreViewState(viewState);
		if (review) {
			threadsRef.current = attachReviewThreads(codeEditor, setReviewZones);
			detachRef.current = attachReviewCommenting(codeEditor, threadsRef.current);
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
		<>
			<MonacoReact
				height="100%"
				path={`${modelScope}/${resource.path}`}
				value={text}
				language={languageForPath(resource.path)}
				theme={EDITOR_THEME}
				onMount={onMount}
				loading={<LoadingRegion rows={12} className="h-full w-full p-12" />}
				options={options}
			/>
			<MonacoReviewZones
				zones={reviewZones}
				review={review}
				onCloseComposer={closeComposer}
				onRendered={layoutReviewZones}
			/>
		</>
	);
}
