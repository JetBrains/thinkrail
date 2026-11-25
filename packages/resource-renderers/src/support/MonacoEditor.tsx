import { useT } from "@thinkrail/locales/react";
import { onFontsChange } from "@thinkrail/ui/fonts";
import { readingCommand } from "@thinkrail/ui/reading";
import type { editor } from "monaco-editor/editor/editor.api.js";
import {
	useEffect,
	useEffectEvent,
	useId,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { type ResourceHost, useResourceHost, useResourcePreferences } from "../host";
import type { ResourceViewProps, SurfaceReview } from "../registry";
import { MonacoReviewZones } from "./MonacoReviewZones";
import { decorateEditorContextMenus } from "./monacoMenuIcons";
import {
	createFileEditor,
	disposeFileEditor,
	editorFont,
	ensureMonaco,
	fileEditorOptions,
	readCode,
	remeasureEditorFonts,
	revealLineNow,
	syncFileModel,
} from "./monacoSetup";
import { READER_SCOPE, useReaderKeys } from "./readingSurface";
import { focusCommentCardWhenRendered } from "./revealFocus";
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

const NATIVE_READING_KEYS = new Set(["PageUp", "PageDown", "ArrowLeft", "ArrowRight"]);

function isEditorViewState(value: unknown): value is editor.ICodeEditorViewState {
	if (typeof value !== "object" || value === null) return false;
	return Array.isArray(Reflect.get(value, "cursorState")) && Reflect.has(value, "viewState");
}

export function warm(host: ResourceHost): void {
	ensureMonaco(host.code);
}

export default function MonacoEditor({
	resource,
	content,
	review,
	viewState,
	onViewState,
	reveal,
	onRevealHandled,
}: ResourceViewProps) {
	const t = useT();
	const readerKeys = useReaderKeys();
	const { fileLineWidth, fileLineWidthBounded } = useResourcePreferences();
	ensureMonaco(useResourceHost().code);
	const scope = useId().replace(/[^\w-]/g, "");
	const path = resource.path;
	const text = content.kind === "text" ? content.text : "";
	const commentLabels = {
		selection: t("review.widget.commentOnSelection"),
		line: t("viewer.code.commentOnLine"),
	};
	const font = useSyncExternalStore(onFontsChange, editorFont);
	const options = fileEditorOptions(t, fileLineWidth, fileLineWidthBounded, resource.path, font);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const commentingRef = useRef<ReviewCommenting | null>(null);
	const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
	const threadsRef = useRef<ReturnType<typeof attachReviewThreads> | null>(null);
	const decorationsRef = useRef<string[]>([]);
	const freshMountRef = useRef(false);
	const appliedRef = useRef({ scope, path, text, options });
	const latestRef = useRef({
		scope,
		path,
		text,
		options,
		commentLabels,
		viewState,
		review,
		onViewState,
		readerKeys,
	});
	const [reviewZones, setReviewZones] = useState<MonacoReviewZoneState>({
		threads: [],
		composer: null,
	});

	useLayoutEffect(() => {
		latestRef.current = {
			scope,
			path,
			text,
			options,
			commentLabels,
			viewState,
			review,
			onViewState,
			readerKeys,
		};
	});

	useLayoutEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const mount = latestRef.current;
		const codeEditor = createFileEditor(container, mount);
		editorRef.current = codeEditor;
		freshMountRef.current = true;
		appliedRef.current = {
			scope: mount.scope,
			path: mount.path,
			text: mount.text,
			options: mount.options,
		};
		const menuIcons = decorateEditorContextMenus(codeEditor);
		if (isEditorViewState(mount.viewState)) codeEditor.restoreViewState(mount.viewState);
		const threads = mount.review ? attachReviewThreads(codeEditor, setReviewZones) : null;
		const commenting = threads
			? attachReviewCommenting(codeEditor, threads, mount.commentLabels)
			: null;
		threadsRef.current = threads;
		commentingRef.current = commenting;
		const reading = () => codeEditor.getRawOptions().readOnly === true;
		const textFocus = codeEditor.onDidFocusEditorText(() => {
			if (reading()) container.setAttribute("data-text-entry", "false");
		});
		const textBlur = codeEditor.onDidBlurEditorText(() => {
			container.removeAttribute("data-text-entry");
		});
		const readingKeys = codeEditor.onKeyDown((event) => {
			const press = event.browserEvent;
			if (!reading() || !codeEditor.hasTextFocus() || NATIVE_READING_KEYS.has(press.key)) return;
			const keys = latestRef.current.readerKeys;
			const command = readingCommand(press, keys, keys.match(press, { textEntry: false }));
			if (!command) return;
			event.preventDefault();
			event.stopPropagation();
			readCode(codeEditor, command);
		});
		return () => {
			readingKeys.dispose();
			textFocus.dispose();
			textBlur.dispose();
			const saved = codeEditor.saveViewState();
			if (saved) latestRef.current.onViewState?.(saved);
			menuIcons.dispose();
			commenting?.dispose();
			threads?.dispose();
			threadsRef.current = null;
			commentingRef.current = null;
			editorRef.current = null;
			decorationsRef.current = [];
			disposeFileEditor(codeEditor);
		};
	}, []);

	useLayoutEffect(() => {
		const codeEditor = editorRef.current;
		const applied = appliedRef.current;
		if (
			!codeEditor ||
			(applied.scope === scope && applied.path === path && applied.text === text)
		) {
			return;
		}
		syncFileModel(codeEditor, { scope, path, text }, applied.text);
		appliedRef.current = { ...applied, scope, path, text };
	}, [scope, path, text]);

	useLayoutEffect(() => {
		commentingRef.current?.setLabels(commentLabels);
	}, [commentLabels]);

	useLayoutEffect(() => {
		const codeEditor = editorRef.current;
		if (!codeEditor || appliedRef.current.options === options) return;
		appliedRef.current = { ...appliedRef.current, options };
		codeEditor.updateOptions(options);
	}, [options]);

	useEffect(() => remeasureEditorFonts(font), [font]);

	const closeComposer = () => threadsRef.current?.closeComposer();
	const returnFocus = (line?: number) => {
		const codeEditor = editorRef.current;
		if (!codeEditor) return;
		if (line !== undefined) codeEditor.setPosition({ lineNumber: line, column: 1 });
		codeEditor.focus();
	};
	const layoutReviewZones = () => threadsRef.current?.layout();

	useLayoutEffect(() => {
		const codeEditor = editorRef.current;
		const freshMount = freshMountRef.current;
		freshMountRef.current = false;
		if (!review || !codeEditor) return;
		threadsRef.current?.setThreads(review.threads);
		decorationsRef.current = applyReviewDecorations(
			codeEditor,
			decorationsRef.current,
			review.threads,
		);
		const line = focusLine(review);
		if (line === null) return;
		if (freshMount) revealLineNow(codeEditor, line);
		else codeEditor.revealLineInCenter(line);
		const focus = review.focus;
		if (focus?.moveFocus) focusCommentCardWhenRendered(() => containerRef.current, focus.id);
		review.onFocusHandled();
	}, [review]);

	const revealLine = reveal?.line;
	const revealColumn = reveal?.column;
	const revealLength = reveal?.length;
	const revealTick = reveal?.tick;
	const revealHandled = useEffectEvent((tick: number) => onRevealHandled?.(tick));
	useLayoutEffect(() => {
		const codeEditor = editorRef.current;
		if (!codeEditor || revealLine === undefined || revealTick === undefined) return;
		revealLineNow(codeEditor, revealLine);
		const column = revealColumn ?? 1;
		codeEditor.setSelection({
			startLineNumber: revealLine,
			startColumn: column,
			endLineNumber: revealLine,
			endColumn: column + (revealLength ?? 0),
		});
		revealHandled(revealTick);
	}, [revealLine, revealColumn, revealLength, revealTick]);

	return (
		<>
			<div
				ref={containerRef}
				data-focus-default
				data-key-scope={READER_SCOPE}
				className="h-full w-full text-left"
			/>
			<MonacoReviewZones
				zones={reviewZones}
				review={review}
				onCloseComposer={closeComposer}
				onReturnFocus={returnFocus}
				onRendered={layoutReviewZones}
			/>
		</>
	);
}
