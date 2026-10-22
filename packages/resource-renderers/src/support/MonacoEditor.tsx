import MonacoReact, { type OnMount } from "@monaco-editor/react";
import { useT } from "@thinkrail/locales/react";
import { LoadingRegion } from "@thinkrail/ui/skeleton";
import type { editor } from "monaco-editor/esm/vs/editor/editor.api.js";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { type ResourceHost, useResourceHost, useResourcePreferences } from "../host";
import type { ResourceDescriptor, ResourceViewProps, SurfaceReview } from "../registry";
import { MonacoReviewZones } from "./MonacoReviewZones";
import { decorateEditorContextMenus } from "./monacoMenuIcons";
import {
	EDITOR_THEME,
	ensureMonaco,
	fileEditorOptions,
	languageForPath,
	revealLineNow,
	warmLanguage,
} from "./monacoSetup";
import {
	applyReviewDecorations,
	attachReviewCommenting,
	attachReviewThreads,
	type MonacoReviewZoneState,
	type ReviewCommenting,
} from "./reviewWidgets";

function focusLine(review: SurfaceReview): number | null {
	const range = review.focus?.anchor.selectors.find((selector) => selector.kind === "lineRange");
	return range?.kind === "lineRange" ? range.startLine : null;
}

function isEditorViewState(value: unknown): value is editor.ICodeEditorViewState {
	if (typeof value !== "object" || value === null) return false;
	return Array.isArray(Reflect.get(value, "cursorState")) && Reflect.has(value, "viewState");
}

export function warm(host: ResourceHost, resource: ResourceDescriptor): void {
	ensureMonaco(host.code);
	setTimeout(() => warmLanguage(languageForPath(resource.path)), 0);
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
	ensureMonaco(useResourceHost().code);
	const modelScope = useId().replace(/[^\w-]/g, "");
	const options = useMemo(
		() => fileEditorOptions(t, fileLineWidth, fileLineWidthBounded, resource.path),
		[t, fileLineWidth, fileLineWidthBounded, resource.path],
	);
	const menuIconsRef = useRef<{ dispose(): void } | null>(null);
	const commentingRef = useRef<ReviewCommenting | null>(null);
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

	const commentLabel = t("review.widget.commentOnSelection");
	const commentLabelRef = useRef(commentLabel);
	commentLabelRef.current = commentLabel;
	useEffect(() => {
		commentingRef.current?.setLabel(commentLabel);
	}, [commentLabel]);

	const onMount: OnMount = (codeEditor) => {
		editorRef.current = codeEditor;
		menuIconsRef.current = decorateEditorContextMenus(codeEditor);
		if (isEditorViewState(viewState)) codeEditor.restoreViewState(viewState);
		if (review) {
			threadsRef.current = attachReviewThreads(codeEditor, setReviewZones);
			commentingRef.current = attachReviewCommenting(
				codeEditor,
				threadsRef.current,
				commentLabelRef.current,
			);
			syncThreads(review);
			const line = focusLine(review);
			if (line !== null) {
				revealLineNow(codeEditor, line);
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
			menuIconsRef.current?.dispose();
			commentingRef.current?.dispose();
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
