import { RiKeyboardLine } from "@remixicon/react";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { onFontsChange } from "@thinkrail/ui/fonts";
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
	remeasureEditorFonts,
	revealLineNow,
	syncFileModel,
} from "./monacoSetup";
import { focusCommentCardWhenRendered } from "./revealFocus";
import {
	applyReviewDecorations,
	attachReviewCommenting,
	attachReviewThreads,
	type MonacoReviewZoneState,
	type ReviewCommenting,
} from "./reviewWidgets";
import {
	createVimController,
	initialVimState,
	registerActiveVimToggle,
	type VimState,
} from "./vimMode";

function focusLine(review: SurfaceReview): number | null {
	const range = review.focus?.anchor.selectors.find((selector) => selector.kind === "lineRange");
	return range?.kind === "lineRange" ? range.startLine : null;
}

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
	const { fileLineWidth, fileLineWidthBounded } = useResourcePreferences();
	ensureMonaco(useResourceHost().code);
	const scope = useId().replace(/[^\w-]/g, "");
	const path = resource.path;
	const text = content.kind === "text" ? content.text : "";
	const commentLabel = t("review.widget.commentOnSelection");
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
		commentLabel,
		viewState,
		review,
		onViewState,
	});
	const [reviewZones, setReviewZones] = useState<MonacoReviewZoneState>({
		threads: [],
		composer: null,
	});
	const [vimState, setVimState] = useState<VimState>(initialVimState);
	const [searchQuery, setSearchQuery] = useState("");
	const vimControllerRef = useRef<ReturnType<typeof createVimController> | null>(null);
	const activeVimToggleRef = useRef<ReturnType<typeof registerActiveVimToggle> | null>(null);
	const searchInputRef = useRef<HTMLInputElement | null>(null);

	useLayoutEffect(() => {
		latestRef.current = {
			scope,
			path,
			text,
			options,
			commentLabel,
			viewState,
			review,
			onViewState,
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
		const vimController = createVimController(codeEditor, setVimState);
		const activeVimToggle = registerActiveVimToggle(vimController.toggle);
		vimControllerRef.current = vimController;
		activeVimToggleRef.current = activeVimToggle;
		activeVimToggle.activate();
		const focusListener = codeEditor.onDidFocusEditorText(activeVimToggle.activate);
		if (isEditorViewState(mount.viewState)) codeEditor.restoreViewState(mount.viewState);
		const threads = mount.review ? attachReviewThreads(codeEditor, setReviewZones) : null;
		const commenting = threads
			? attachReviewCommenting(codeEditor, threads, mount.commentLabel)
			: null;
		threadsRef.current = threads;
		commentingRef.current = commenting;
		return () => {
			const saved = codeEditor.saveViewState();
			if (saved) latestRef.current.onViewState?.(saved);
			focusListener.dispose();
			activeVimToggle.dispose();
			vimController.dispose();
			vimControllerRef.current = null;
			activeVimToggleRef.current = null;
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
		commentingRef.current?.setLabel(commentLabel);
	}, [commentLabel]);

	useLayoutEffect(() => {
		const codeEditor = editorRef.current;
		if (!codeEditor || appliedRef.current.options === options) return;
		appliedRef.current = { ...appliedRef.current, options };
		codeEditor.updateOptions(options);
	}, [options]);

	useEffect(() => remeasureEditorFonts(font), [font]);
	useEffect(() => {
		if (!vimState.searchOpen) return;
		setSearchQuery("");
		searchInputRef.current?.focus();
	}, [vimState.searchOpen]);

	const closeComposer = () => threadsRef.current?.closeComposer();
	const vimModeLabel =
		vimState.mode === "normal"
			? t("viewer.vim.mode.normal")
			: vimState.mode === "insert"
				? t("viewer.vim.mode.insert")
				: t("viewer.vim.mode.visual");
	const submitSearch = () => vimControllerRef.current?.submitSearch(searchQuery);
	const cancelSearch = () => vimControllerRef.current?.cancelSearch();

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
		<div
			className="relative h-full w-full text-left"
			onFocusCapture={() => activeVimToggleRef.current?.activate()}
		>
			<div ref={containerRef} data-focus-default className="h-full w-full" />
			<Button
				variant="ghost"
				size="s"
				selected={vimState.enabled}
				iconLeft={RiKeyboardLine}
				aria-pressed={vimState.enabled}
				aria-label={t("viewer.vim.toggle")}
				data-testid="vim-mode-toggle"
				onMouseDown={() => activeVimToggleRef.current?.activate()}
				onClick={() => vimControllerRef.current?.toggle()}
				className="absolute top-8 right-8 z-10"
			>
				{vimState.enabled ? vimModeLabel : t("viewer.vim.off")}
			</Button>
			{vimState.searchOpen ? (
				<div className="absolute top-8 right-8 z-20 flex h-24 items-center gap-4 rounded-sm border border-border-default bg-container-elevated-bg px-8 shadow-lg">
					<span className="tr-code-text text-text-muted" aria-hidden="true">
						{vimState.searchDirection === "forward" ? "/" : "?"}
					</span>
					<input
						ref={searchInputRef}
						value={searchQuery}
						onChange={(event) => setSearchQuery(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								submitSearch();
							} else if (event.key === "Escape") {
								event.preventDefault();
								cancelSearch();
							}
						}}
						aria-label={t("viewer.vim.search")}
						data-testid="vim-search-input"
						placeholder={t("viewer.vim.searchPlaceholder")}
						className="h-20 w-[256px] bg-transparent text-text-default outline-none tr-code-text"
					/>
				</div>
			) : null}
			<MonacoReviewZones
				zones={reviewZones}
				review={review}
				onCloseComposer={closeComposer}
				onRendered={layoutReviewZones}
			/>
		</div>
	);
}
