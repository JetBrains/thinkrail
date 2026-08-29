import {
	RiChatNewLine as MessageSquarePlus,
	RiSendPlaneLine as Send,
	RiDeleteBin6Line as Trash2,
} from "@remixicon/react";
import * as monaco from "monaco-editor";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LineSelection } from "./reviewGutter";
import { threadLabel } from "./reviewModel";

export interface ReviewCommentingCallbacks {
	onSave: (selection: LineSelection | null, text: string) => Promise<void>;
	onSend: (selection: LineSelection | null, text: string) => Promise<void>;
}

const ICON_WIDGET_ID = "thinkrail.review.addIcon";

// Keep in sync with the CSS caps in index.css (.review-thread / .review-composer-flow).
const CARD_MAX_WIDTH = 832;

function cardMaxWidth(codeEditor: monaco.editor.ICodeEditor): number {
	return Math.max(280, Math.min(CARD_MAX_WIDTH, codeEditor.getLayoutInfo().contentWidth - 24));
}

export interface ReviewThreadData {
	id: string;
	startLine: number;
	endLine: number;
	body: string;
	status: string;
	anchorState: string;
	stale?: boolean;
	refuted?: boolean;
}

export interface ReviewThreadActions {
	onSendComment: (id: string) => Promise<void>;
	onDeleteComment: (id: string) => Promise<void>;
	onUpdateComment: (id: string, body: string) => Promise<void>;
}

const ICON_SVG = renderToStaticMarkup(createElement(MessageSquarePlus, { size: 14 }));
const SEND_SVG = renderToStaticMarkup(createElement(Send, { size: 12 }));
const TRASH_SVG = renderToStaticMarkup(createElement(Trash2, { size: 12 }));

function button(testid: string, className: string, label: string): HTMLButtonElement {
	const el = document.createElement("button");
	el.type = "button";
	el.dataset.testid = testid;
	el.className = className;
	el.textContent = label;
	return el;
}

export function attachReviewCommenting(
	codeEditor: monaco.editor.IStandaloneCodeEditor,
	callbacks: ReviewCommentingCallbacks,
): () => void {
	let iconPosition: monaco.IPosition | null = null;
	let composerZoneId: string | null = null;

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

	const closeComposer = () => {
		if (composerZoneId === null) return;
		const id = composerZoneId;
		composerZoneId = null;
		codeEditor.changeViewZones((accessor) => accessor.removeZone(id));
	};

	const openComposer = (selection: LineSelection) => {
		closeComposer();
		hideIcon();

		const domNode = document.createElement("div");
		domNode.className = "review-composer-zone";
		const card = document.createElement("div");
		card.className = "review-composer";
		card.dataset.testid = "review-composer";
		card.style.maxWidth = `${cardMaxWidth(codeEditor)}px`;
		domNode.appendChild(card);

		const label = document.createElement("span");
		label.className = "review-composer-label tr-code-text";
		label.textContent =
			selection.startLine === selection.endLine
				? `Line ${selection.startLine}`
				: `Lines ${selection.startLine}–${selection.endLine}`;

		const textarea = document.createElement("textarea");
		textarea.dataset.testid = "review-composer-input";
		textarea.placeholder = "Leave a review comment…";
		textarea.className = "review-composer-input tr-text-ui";
		textarea.wrap = "soft";

		const save = button("review-composer-save", "review-composer-btn tr-text-action", "Save draft");
		const send = button(
			"review-composer-send",
			"review-composer-btn review-composer-btn-primary tr-text-action",
			"Send now",
		);
		const cancel = button(
			"review-composer-cancel",
			"review-composer-btn review-composer-btn-quiet tr-text-action",
			"Cancel",
		);

		const setBusy = (busy: boolean) => {
			textarea.disabled = busy;
			save.disabled = busy || !textarea.value.trim();
			send.disabled = busy || !textarea.value.trim();
		};
		setBusy(false);

		const submit = (action: ReviewCommentingCallbacks["onSave"]) => {
			const text = textarea.value.trim();
			if (!text) return;
			setBusy(true);
			action(selection, text).then(closeComposer, () => setBusy(false));
		};
		save.addEventListener("click", () => submit(callbacks.onSave));
		send.addEventListener("click", () => submit(callbacks.onSend));
		cancel.addEventListener("click", closeComposer);
		textarea.addEventListener("keydown", (e) => {
			if (e.isComposing) return;
			if (e.key === "Escape") closeComposer();
			if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(callbacks.onSave);
			e.stopPropagation();
		});

		const row = document.createElement("div");
		row.className = "review-composer-row";
		row.append(save, send, cancel);
		card.append(label, textarea, row);

		const zone: monaco.editor.IViewZone = {
			afterLineNumber: selection.endLine,
			heightInPx: 120,
			domNode,
		};
		const relayout = () => {
			textarea.style.height = "auto";
			textarea.style.height = `${Math.min(160, Math.max(56, textarea.scrollHeight + 2))}px`;
			const height = card.offsetHeight + 12;
			if (zone.heightInPx !== height && composerZoneId !== null) {
				zone.heightInPx = height;
				const id = composerZoneId;
				codeEditor.changeViewZones((accessor) => accessor.layoutZone(id));
			}
		};
		textarea.addEventListener("input", () => {
			setBusy(false);
			relayout();
		});

		codeEditor.changeViewZones((accessor) => {
			composerZoneId = accessor.addZone(zone);
		});
		requestAnimationFrame(() => {
			textarea.focus();
			relayout();
		});
	};

	const commentOnSelection = () => {
		const s = codeEditor.getSelection();
		if (!s || s.isEmpty()) return;
		const endLine =
			s.positionColumn === 1 && s.endLineNumber > s.startLineNumber
				? s.endLineNumber - 1
				: s.endLineNumber;
		openComposer({ startLine: s.startLineNumber, endLine });
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

	const selectionListener = codeEditor.onDidChangeCursorSelection((e) => {
		if (composerZoneId !== null) return;
		const s = e.selection;
		if (s.isEmpty()) {
			hideIcon();
			return;
		}
		showIcon({ lineNumber: s.positionLineNumber, column: s.positionColumn });
	});

	return () => {
		selectionListener.dispose();
		menuAction.dispose();
		closeComposer();
		codeEditor.removeContentWidget(iconWidget);
	};
}

export function attachReviewThreads(
	codeEditor: monaco.editor.ICodeEditor,
	actions: ReviewThreadActions,
): { setThreads: (threads: ReviewThreadData[]) => void; dispose: () => void } {
	let zones: {
		id: string;
		zone: monaco.editor.IViewZone;
		card: HTMLElement;
		commentId: string;
		signature: string;
	}[] = [];

	const iconButton = (testid: string, title: string, svg: string): HTMLButtonElement => {
		const el = document.createElement("button");
		el.type = "button";
		el.dataset.testid = testid;
		el.title = title;
		el.ariaLabel = title;
		el.className = "review-thread-action";
		el.innerHTML = svg;
		return el;
	};

	const cardFor = (thread: ReviewThreadData): HTMLElement => {
		const card = document.createElement("div");
		card.className = "review-thread";
		card.dataset.testid = "review-thread";
		card.dataset.commentId = thread.id;
		card.dataset.status = thread.status;

		const head = document.createElement("div");
		head.className = "review-thread-head";
		const dot = document.createElement("span");
		dot.className = `review-thread-dot rounded-full review-thread-dot-${thread.status === "sent" ? "sent" : "draft"}`;
		const label = document.createElement("span");
		let labelTone = "";
		if (thread.refuted) labelTone = " text-text-subtle";
		else if (thread.stale) labelTone = " text-feedback-warning";
		label.className = `review-thread-label tr-text-eyebrow${labelTone}`;
		label.textContent = threadLabel(thread);
		head.append(dot, label);

		if (thread.status === "draft") {
			const actionsWrap = document.createElement("span");
			actionsWrap.className = "review-thread-actions";
			const send = iconButton(
				"review-thread-send",
				"Send this comment to the file's review chat",
				SEND_SVG,
			);
			const del = iconButton("review-thread-delete", "Delete draft", TRASH_SVG);
			const busy = (b: boolean) => {
				send.disabled = b;
				del.disabled = b;
			};
			send.addEventListener("click", () => {
				busy(true);
				actions.onSendComment(thread.id).catch(() => busy(false));
			});
			del.addEventListener("click", () => {
				busy(true);
				actions.onDeleteComment(thread.id).catch(() => busy(false));
			});
			actionsWrap.append(send, del);
			head.append(actionsWrap);
		}

		if (thread.status === "draft") {
			const edit = document.createElement("textarea");
			edit.className = "review-thread-edit review-thread-body tr-text-ui";
			edit.dataset.testid = "review-thread-edit";
			edit.value = thread.body;
			edit.rows = 1;
			edit.wrap = "soft";
			const grow = () => {
				edit.style.height = "auto";
				edit.style.height = `${edit.scrollHeight}px`;
				relayoutCards();
			};
			edit.addEventListener("input", grow);
			edit.addEventListener("keydown", (e) => {
				e.stopPropagation();
				if (e.isComposing) return;
				if (e.key === "Escape") {
					edit.value = thread.body;
					edit.blur();
				}
				if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) edit.blur();
			});
			edit.addEventListener("blur", () => {
				const next = edit.value.trim();
				if (!next || next === thread.body) {
					edit.value = thread.body;
					grow();
					return;
				}
				actions.onUpdateComment(thread.id, next).catch(() => {
					edit.value = thread.body;
					grow();
				});
			});
			card.append(head, edit);
			requestAnimationFrame(grow);
			return card;
		}

		const body = document.createElement("p");
		body.className = "review-thread-body tr-text-ui";
		body.textContent = thread.body;
		card.append(head, body);
		return card;
	};

	const relayoutCards = () => {
		requestAnimationFrame(() => {
			codeEditor.changeViewZones((accessor) => {
				for (const entry of zones) {
					const edit = entry.card.querySelector<HTMLTextAreaElement>(".review-thread-edit");
					if (edit) {
						edit.style.height = "auto";
						edit.style.height = `${edit.scrollHeight}px`;
					}
					const height = entry.card.offsetHeight + 12;
					if (height > 12 && entry.zone.heightInPx !== height) {
						entry.zone.heightInPx = height;
						accessor.layoutZone(entry.id);
					}
				}
			});
		});
	};

	const cardSizeObserver = new ResizeObserver(() => relayoutCards());

	const signature = (t: ReviewThreadData): string =>
		[
			t.status,
			t.anchorState,
			t.stale ?? false,
			t.refuted ?? false,
			t.startLine,
			t.endLine,
			t.body,
		].join("\u0000");

	const buildZone = (accessor: monaco.editor.IViewZoneChangeAccessor, thread: ReviewThreadData) => {
		const domNode = document.createElement("div");
		domNode.className = "review-composer-zone";
		const card = cardFor(thread);
		card.style.maxWidth = `${cardMaxWidth(codeEditor)}px`;
		domNode.appendChild(card);
		const zone: monaco.editor.IViewZone = {
			afterLineNumber: thread.endLine,
			heightInPx: 48,
			domNode,
		};
		return {
			id: accessor.addZone(zone),
			zone,
			card,
			commentId: thread.id,
			signature: signature(thread),
		};
	};

	const setThreads = (threads: ReviewThreadData[]) => {
		codeEditor.changeViewZones((accessor) => {
			const kept = new Map<string, (typeof zones)[number]>();
			for (const entry of zones) {
				const next = threads.find((t) => t.id === entry.commentId);
				if (next && signature(next) === entry.signature) kept.set(entry.commentId, entry);
				else accessor.removeZone(entry.id);
			}
			zones = threads.map((thread) => kept.get(thread.id) ?? buildZone(accessor, thread));
		});
		cardSizeObserver.disconnect();
		for (const { card } of zones) cardSizeObserver.observe(card);
		relayoutCards();
	};

	return {
		setThreads,
		dispose: () => {
			cardSizeObserver.disconnect();
			codeEditor.changeViewZones((accessor) => {
				for (const { id } of zones) accessor.removeZone(id);
			});
			zones = [];
		},
	};
}
