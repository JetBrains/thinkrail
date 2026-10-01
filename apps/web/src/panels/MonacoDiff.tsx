import {
	type BeforeMount,
	DiffEditor,
	type DiffOnMount,
	type MonacoDiffEditor,
} from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useCallback, useEffect, useRef } from "react";
import type { ResourceDiffProps, SurfaceReview } from "@/resources";
import { LoadingRegion } from "../components/Skeleton";
import { useAppStore } from "../store";
import { decorateEditorContextMenus } from "./monacoMenuIcons";
import {
	defineThinkrailTheme,
	languageForPath,
	sharedEditorOptions,
	THEME,
	watchThemeSwap,
} from "./monacoSetup";
import {
	applyReviewDecorations,
	attachReviewCommenting,
	attachReviewThreads,
} from "./reviewWidgets";

const beforeMount: BeforeMount = (monaco) => defineThinkrailTheme(monaco);

type DiffReview = NonNullable<ResourceDiffProps["review"]>;

interface SideWiring {
	codeEditor: editor.ICodeEditor;
	threads: ReturnType<typeof attachReviewThreads>;
	read: (review: DiffReview) => SurfaceReview;
	decorations: string[];
	detach: () => void;
}

function focusLine(review: SurfaceReview): number | null {
	const range = review.focus?.anchor.selectors.find((selector) => selector.kind === "lineRange");
	return range?.kind === "lineRange" ? range.startLine : null;
}

function isDiffViewState(value: unknown): value is editor.IDiffEditorViewState {
	if (typeof value !== "object" || value === null) return false;
	const original = Reflect.get(value, "original");
	const modified = Reflect.get(value, "modified");
	return (
		(original === null || typeof original === "object") &&
		(modified === null || typeof modified === "object")
	);
}

export default function MonacoDiff({
	resource,
	original,
	modified,
	layout,
	ignoreWhitespace,
	review,
	viewState,
	onViewState,
}: ResourceDiffProps) {
	const fileLineWidth = useAppStore((state) => state.fileLineWidth);
	const fileLineWidthBounded = useAppStore((state) => state.fileLineWidthBounded);
	const stopThemeWatchRef = useRef<(() => void) | null>(null);
	const menuIconsRef = useRef<{ dispose(): void }[]>([]);
	const editorRef = useRef<MonacoDiffEditor | null>(null);
	const modelsRef = useRef<{ dispose(): void }[]>([]);
	const sidesRef = useRef<SideWiring[]>([]);
	const reviewRef = useRef(review);
	const onViewStateRef = useRef(onViewState);
	reviewRef.current = review;
	onViewStateRef.current = onViewState;

	const syncThreads = useCallback((target: DiffReview) => {
		for (const side of sidesRef.current) {
			const surface = side.read(target);
			side.threads.setThreads(surface.threads);
			const applied = applyReviewDecorations(side.codeEditor, side.decorations, surface.threads);
			side.decorations = applied.decorations;
		}
	}, []);

	const consumeFocus = useCallback((target: DiffReview) => {
		for (const side of sidesRef.current) {
			const surface = side.read(target);
			const line = focusLine(surface);
			if (line === null) continue;
			side.codeEditor.revealLineInCenter(line);
			surface.onFocusHandled();
		}
	}, []);

	const wireSide = useCallback(
		(codeEditor: editor.IStandaloneCodeEditor, read: SideWiring["read"]): SideWiring => {
			const surface = () => (reviewRef.current ? read(reviewRef.current) : undefined);
			const detach = attachReviewCommenting(codeEditor, {
				onSave: (draft, text) => surface()?.commenting.onSave(draft, text) ?? Promise.resolve(),
				onSend: (draft, text) => surface()?.commenting.onSend(draft, text) ?? Promise.resolve(),
			});
			const threads = attachReviewThreads(codeEditor, {
				onSendComment: (id) => surface()?.actions.onSendComment(id) ?? Promise.resolve(),
				onDeleteComment: (id) => surface()?.actions.onDeleteComment(id) ?? Promise.resolve(),
				onUpdateComment: (id, body) =>
					surface()?.actions.onUpdateComment(id, body) ?? Promise.resolve(),
			});
			return { codeEditor, threads, read, decorations: [], detach };
		},
		[],
	);

	const onMount: DiffOnMount = (diffEditor, monaco) => {
		stopThemeWatchRef.current = watchThemeSwap(monaco, THEME);
		editorRef.current = diffEditor;
		menuIconsRef.current = [
			decorateEditorContextMenus(diffEditor.getModifiedEditor()),
			decorateEditorContextMenus(diffEditor.getOriginalEditor()),
		];
		const model = diffEditor.getModel();
		modelsRef.current = model ? [model.original, model.modified] : [];
		if (isDiffViewState(viewState)) diffEditor.restoreViewState(viewState);
		if (!review) return;
		sidesRef.current = [
			wireSide(diffEditor.getModifiedEditor(), (target) => target.worktree),
			wireSide(diffEditor.getOriginalEditor(), (target) => target.base),
		];
		syncThreads(review);
		consumeFocus(review);
	};

	useEffect(() => {
		if (review) syncThreads(review);
	}, [review, syncThreads]);

	useEffect(() => {
		if (review) consumeFocus(review);
	}, [review, consumeFocus]);

	useEffect(
		() => () => {
			const saved = editorRef.current?.saveViewState();
			if (saved) onViewStateRef.current?.(saved);
			stopThemeWatchRef.current?.();
			for (const disposable of menuIconsRef.current) disposable.dispose();
			menuIconsRef.current = [];
			for (const side of sidesRef.current) {
				side.detach();
				side.threads.dispose();
			}
			sidesRef.current = [];
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
			original={original.kind === "text" ? original.text : ""}
			modified={modified.kind === "text" ? modified.text : ""}
			language={resource.language ?? languageForPath(resource.path)}
			originalModelPath={`diff-original://${resource.path}`}
			modifiedModelPath={`diff-modified://${resource.path}`}
			theme={THEME}
			keepCurrentOriginalModel
			keepCurrentModifiedModel
			beforeMount={beforeMount}
			onMount={onMount}
			loading={<LoadingRegion rows={12} className="h-full w-full p-12" />}
			options={{
				...sharedEditorOptions(fileLineWidth, fileLineWidthBounded),
				renderSideBySide: layout === "split",
				useInlineViewWhenSpaceIsLimited: false,
				hideUnchangedRegions: { enabled: true },
				ignoreTrimWhitespace: ignoreWhitespace,
				renderOverviewRuler: false,
			}}
		/>
	);
}
