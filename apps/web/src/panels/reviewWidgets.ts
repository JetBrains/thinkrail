import { RiChatNewLine as MessageSquarePlus } from "@remixicon/react";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReviewThread } from "@/resources";

const ICON_WIDGET_ID = "thinkrail.review.addIcon";
const CARD_MAX_WIDTH = 832;
const ICON_SVG = renderToStaticMarkup(createElement(MessageSquarePlus, { className: "size-14" }));

export interface MonacoThreadZone {
	commentId: string;
	node: HTMLElement;
}

export interface MonacoComposerZone {
	node: HTMLElement;
	selection: { startLine: number; endLine: number };
}

export interface MonacoReviewZoneState {
	threads: MonacoThreadZone[];
	composer: MonacoComposerZone | null;
}

function cardMaxWidth(codeEditor: monaco.editor.ICodeEditor): number {
	return Math.max(280, Math.min(CARD_MAX_WIDTH, codeEditor.getLayoutInfo().contentWidth - 24));
}

function threadLineRange(thread: ReviewThread): { startLine: number; endLine: number } | null {
	const range = thread.anchor.selectors.find((selector) => selector.kind === "lineRange");
	return range?.kind === "lineRange"
		? { startLine: range.startLine, endLine: range.endLine }
		: null;
}

export function applyReviewDecorations(
	codeEditor: monaco.editor.ICodeEditor,
	previous: string[],
	threads: ReviewThread[],
): string[] {
	const ranges = threads.flatMap((thread) => {
		const range = threadLineRange(thread);
		return range ? [range] : [];
	});
	return codeEditor.deltaDecorations(
		previous,
		ranges.map((range) => ({
			range: {
				startLineNumber: range.startLine,
				startColumn: 1,
				endLineNumber: range.endLine,
				endColumn: 1,
			},
			options: {
				isWholeLine: true,
				className: "review-comment-line",
				linesDecorationsClassName: "review-comment-rail",
			},
		})),
	);
}

interface ReviewZoneController {
	openComposer(selection: { startLine: number; endLine: number }): void;
	isComposerOpen(): boolean;
}

export function attachReviewCommenting(
	codeEditor: monaco.editor.IStandaloneCodeEditor,
	zones: ReviewZoneController,
): () => void {
	let iconPosition: monaco.IPosition | null = null;
	const iconNode = document.createElement("div");
	iconNode.className = "review-add-icon-holder";
	iconNode.style.display = "none";
	const iconButton = document.createElement("button");
	iconButton.type = "button";
	iconButton.dataset.testid = "review-add-icon";
	iconButton.title = "Comment on selection";
	iconButton.ariaLabel = "Comment on selection";
	iconButton.className = "review-add-icon";
	iconButton.innerHTML = ICON_SVG;
	iconNode.appendChild(iconButton);

	const iconWidget: monaco.editor.IContentWidget = {
		getId: () => ICON_WIDGET_ID,
		getDomNode: () => iconNode,
		getPosition: () =>
			iconPosition && {
				position: iconPosition,
				preference: [
					monaco.editor.ContentWidgetPositionPreference.ABOVE,
					monaco.editor.ContentWidgetPositionPreference.BELOW,
				],
			},
	};
	codeEditor.addContentWidget(iconWidget);

	const showIcon = (position: monaco.IPosition) => {
		iconPosition = position;
		iconNode.style.display = "";
		codeEditor.layoutContentWidget(iconWidget);
	};
	const hideIcon = () => {
		if (!iconPosition) return;
		iconPosition = null;
		iconNode.style.display = "none";
		codeEditor.layoutContentWidget(iconWidget);
	};
	const commentOnSelection = () => {
		const selection = codeEditor.getSelection();
		if (!selection || selection.isEmpty()) return;
		const endLine =
			selection.positionColumn === 1 && selection.endLineNumber > selection.startLineNumber
				? selection.endLineNumber - 1
				: selection.endLineNumber;
		hideIcon();
		zones.openComposer({ startLine: selection.startLineNumber, endLine });
	};
	iconButton.addEventListener("click", commentOnSelection);

	const menuAction = codeEditor.addAction({
		id: `thinkrail.review.commentSelection.${codeEditor.getId()}`,
		label: "Comment on selection",
		precondition: "editorHasSelection",
		contextMenuGroupId: "9_cutcopypaste",
		contextMenuOrder: 2,
		keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyM],
		run: commentOnSelection,
	});
	const selectionListener = codeEditor.onDidChangeCursorSelection((event) => {
		if (zones.isComposerOpen()) return;
		const selection = event.selection;
		if (selection.isEmpty()) {
			hideIcon();
			return;
		}
		showIcon({
			lineNumber: selection.positionLineNumber,
			column: selection.positionColumn,
		});
	});

	return () => {
		selectionListener.dispose();
		menuAction.dispose();
		codeEditor.removeContentWidget(iconWidget);
	};
}

interface InternalThreadZone extends MonacoThreadZone {
	id: string;
	zone: monaco.editor.IViewZone;
	endLine: number;
}

interface InternalComposerZone extends MonacoComposerZone {
	id: string;
	zone: monaco.editor.IViewZone;
}

export function attachReviewThreads(
	codeEditor: monaco.editor.ICodeEditor,
	onZones: (zones: MonacoReviewZoneState) => void,
): {
	setThreads(threads: ReviewThread[]): void;
	openComposer(selection: { startLine: number; endLine: number }): void;
	closeComposer(): void;
	isComposerOpen(): boolean;
	layout(): void;
	dispose(): void;
} {
	let threads: InternalThreadZone[] = [];
	let composer: InternalComposerZone | null = null;
	let layoutFrame: number | null = null;
	let disposed = false;

	const emit = () => {
		onZones({
			threads: threads.map(({ commentId, node }) => ({ commentId, node })),
			composer: composer ? { node: composer.node, selection: composer.selection } : null,
		});
	};
	const allZones = () => (composer ? [...threads, composer] : threads);
	const setWidth = (node: HTMLElement) => {
		node.style.setProperty("--review-card-max-width", `${cardMaxWidth(codeEditor)}px`);
	};
	const relayout = () => {
		if (layoutFrame !== null || disposed) return;
		layoutFrame = requestAnimationFrame(() => {
			layoutFrame = null;
			if (disposed) return;
			observeZones();
			codeEditor.changeViewZones((accessor) => {
				for (const entry of allZones()) {
					setWidth(entry.node);
					const card = entry.node.firstElementChild;
					if (!(card instanceof HTMLElement)) continue;
					const height = card.offsetHeight + 12;
					if (height > 12 && entry.zone.heightInPx !== height) {
						entry.zone.heightInPx = height;
						accessor.layoutZone(entry.id);
					}
				}
			});
		});
	};
	const sizeObserver = new ResizeObserver(relayout);
	let observed = new Set<Element>();
	const observeZones = () => {
		const targets = new Set(
			allZones().map((entry) =>
				entry.node.firstElementChild instanceof HTMLElement
					? entry.node.firstElementChild
					: entry.node,
			),
		);
		if (targets.size === observed.size && [...targets].every((target) => observed.has(target))) {
			return;
		}
		sizeObserver.disconnect();
		observed = targets;
		for (const target of targets) sizeObserver.observe(target);
	};
	const buildThreadZone = (
		accessor: monaco.editor.IViewZoneChangeAccessor,
		thread: ReviewThread,
		endLine: number,
	): InternalThreadZone => {
		const node = document.createElement("div");
		node.className = "review-composer-zone";
		setWidth(node);
		const zone: monaco.editor.IViewZone = {
			afterLineNumber: endLine,
			heightInPx: 48,
			domNode: node,
		};
		return { id: accessor.addZone(zone), zone, node, commentId: thread.id, endLine };
	};
	const closeComposer = () => {
		if (!composer) return;
		const current = composer;
		composer = null;
		codeEditor.changeViewZones((accessor) => accessor.removeZone(current.id));
		observeZones();
		emit();
	};

	return {
		setThreads(nextThreads) {
			const placed = nextThreads.flatMap((thread) => {
				const range = threadLineRange(thread);
				return range ? [{ thread, endLine: range.endLine }] : [];
			});
			codeEditor.changeViewZones((accessor) => {
				const nextById = new Map(placed.map((entry) => [entry.thread.id, entry]));
				const kept = new Map<string, InternalThreadZone>();
				for (const entry of threads) {
					const next = nextById.get(entry.commentId);
					if (next?.endLine === entry.endLine) kept.set(entry.commentId, entry);
					else accessor.removeZone(entry.id);
				}
				threads = placed.map(
					({ thread, endLine }) =>
						kept.get(thread.id) ?? buildThreadZone(accessor, thread, endLine),
				);
			});
			observeZones();
			emit();
			relayout();
		},
		openComposer(selection) {
			closeComposer();
			const node = document.createElement("div");
			node.className = "review-composer-zone";
			setWidth(node);
			const zone: monaco.editor.IViewZone = {
				afterLineNumber: selection.endLine,
				heightInPx: 120,
				domNode: node,
			};
			codeEditor.changeViewZones((accessor) => {
				composer = { id: accessor.addZone(zone), zone, node, selection };
			});
			observeZones();
			emit();
			relayout();
		},
		closeComposer,
		isComposerOpen: () => composer !== null,
		layout() {
			observeZones();
			relayout();
		},
		dispose() {
			disposed = true;
			if (layoutFrame !== null) cancelAnimationFrame(layoutFrame);
			sizeObserver.disconnect();
			codeEditor.changeViewZones((accessor) => {
				for (const entry of allZones()) accessor.removeZone(entry.id);
			});
			threads = [];
			composer = null;
		},
	};
}
