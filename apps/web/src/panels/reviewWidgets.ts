// Selection-triggered review commenting (see panels/SPEC.md): selecting text in a Monaco surface shows
// a floating comment icon right of the selection (a content widget); clicking it opens an inline
// composer under the selection (a view zone with a textarea + Save draft / Send now). No mode toggle —
// this attaches whenever the pane's content can carry a worktree-anchored comment. Plain-DOM widgets
// (Monaco owns their layers, React can't reach in); styling comes from `index.css` token classes.

import { MessageSquarePlus, Send, Trash2 } from "lucide-react";
import * as monaco from "monaco-editor";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { LineSelection } from "./reviewGutter";

export interface ReviewCommentingCallbacks {
	/** Persist a draft (`null` selection = whole file — the preview's unmapped degrade). Reject to keep
	 * the composer open (the caller surfaces the error). */
	onSave: (selection: LineSelection | null, text: string) => Promise<void>;
	/** Save + send into the file's review chat. Reject to keep the composer open. */
	onSend: (selection: LineSelection | null, text: string) => Promise<void>;
}

const ICON_WIDGET_ID = "thinkrail.review.addIcon";

/** What an inline thread card renders — the pane derives these from the store (`reviewModel`). */
export interface ReviewThreadData {
	id: string;
	startLine: number;
	endLine: number;
	body: string;
	status: string;
	anchorState: string;
}

/** The card actions the pane wires to the transport (drafts only — sent/resolved cards are passive;
 * delete exists for DRAFTS alone: once sent, a comment is a record). */
export interface ReviewThreadActions {
	onSendComment: (id: string) => Promise<void>;
	onDeleteComment: (id: string) => Promise<void>;
	/** Persist an in-card body edit (drafts only — the server rejects edits on sent comments). */
	onUpdateComment: (id: string, body: string) => Promise<void>;
}

// The widgets are plain DOM (Monaco owns their layers, React can't reach in), so the lucide glyphs
// are rendered to static markup once — the same icons every React surface uses, never hand-inlined.
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

/**
 * Attach the selection→icon→composer flow to one editor. Returns a dispose function (the caller runs it
 * on unmount). One icon and one composer at a time; opening the composer hides the icon and freezes the
 * captured selection, so churn while typing can't retarget the comment.
 */
export function attachReviewCommenting(
	// Standalone (not the base ICodeEditor): `addAction` — the context-menu entry — lives only there,
	// and every caller holds one (a diff's inner editors are IStandaloneCodeEditor too).
	codeEditor: monaco.editor.IStandaloneCodeEditor,
	callbacks: ReviewCommentingCallbacks,
): () => void {
	let iconPosition: monaco.IPosition | null = null;
	let composerZoneId: string | null = null;

	const iconNode = document.createElement("div");
	iconNode.className = "review-add-icon-holder";
	iconNode.style.display = "none"; // Monaco keeps the widget node in the DOM even without a position
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
				// Above the cursor point, nudged right by the holder's padding — the standard floating
				// "comment here" affordance (falls below only when the cursor is on the top line).
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

		// The zone node spans Monaco's full CONTENT width (the horizontal scroll width, not the viewport),
		// so it stays a transparent holder; the visible composer is a bounded card inside it.
		const domNode = document.createElement("div");
		domNode.className = "review-composer-zone";
		const card = document.createElement("div");
		card.className = "review-composer";
		card.dataset.testid = "review-composer";
		// Bound the card to the editor's visible width (minus the gutter + a margin), never the scroll width.
		const layout = codeEditor.getLayoutInfo();
		card.style.maxWidth = `${Math.max(280, Math.min(560, layout.contentWidth - 24))}px`;
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
		textarea.wrap = "soft"; // wrap within the card — never scroll text horizontally

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
			if (e.key === "Escape") closeComposer();
			if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(callbacks.onSave);
			e.stopPropagation(); // Monaco must not treat composer typing as editor keys
		});

		const row = document.createElement("div");
		row.className = "review-composer-row";
		row.append(save, send, cancel);
		card.append(label, textarea, row);

		// The zone grows WITH the comment: the textarea auto-sizes to its wrapped content (bounded — past
		// the cap it scrolls vertically with everything visible-height intact), and the zone re-layouts to
		// the card's real height, so typing never ends up in a fixed two-line slit with scrollbars.
		const zone: monaco.editor.IViewZone = {
			afterLineNumber: selection.endLine,
			heightInPx: 120,
			domNode,
		};
		const relayout = () => {
			textarea.style.height = "auto";
			// +2: border-box height must include the 1px borders scrollHeight doesn't count, or a sliver
			// of vertical scrollbar appears at exactly-fitting content.
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
		// Focus + first layout once the zone is attached (Monaco renders the node on the next frame).
		requestAnimationFrame(() => {
			textarea.focus();
			relayout();
		});
	};

	const commentOnSelection = () => {
		const s = codeEditor.getSelection();
		if (!s || s.isEmpty()) return;
		// A selection ending at column 1 of the next line visually covers only the previous one.
		const endLine =
			s.positionColumn === 1 && s.endLineNumber > s.startLineNumber
				? s.endLineNumber - 1
				: s.endLineNumber;
		openComposer({ startLine: s.startLineNumber, endLine });
	};
	iconButton.addEventListener("click", commentOnSelection);

	// The same action in the editor's right-click CONTEXT MENU (right after Copy) + a chord — the «+»
	// stays the discoverable floating affordance, the menu unifies it with where users also look. One
	// entry point pair, one composer. (The rendered preview's menu is the browser's own — not extendable.)
	const menuAction = codeEditor.addAction({
		// Suffixed with the editor's own id: `addAction` registers a GLOBAL command under this id, and a
		// diff attaches this flow to BOTH inner editors — one shared id would route the second editor's
		// menu click to the first editor's (empty) selection.
		id: `thinkrail.review.commentSelection.${codeEditor.getId()}`,
		label: "Comment on selection",
		precondition: "editorHasSelection",
		contextMenuGroupId: "9_cutcopypaste",
		contextMenuOrder: 2,
		keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyM],
		run: commentOnSelection,
	});

	const selectionListener = codeEditor.onDidChangeCursorSelection((e) => {
		if (composerZoneId !== null) return; // frozen while composing
		const s = e.selection;
		if (s.isEmpty()) {
			hideIcon();
			return;
		}
		// Anchored to the CURSOR — the selection's active end, where the drag stopped — and offset
		// right-above it (the widget's ABOVE preference + the holder's right nudge): the standard
		// floating affordance. Elevation (shadow) keeps it reading as a button OVER the text, never as
		// a hole in the selection.
		showIcon({ lineNumber: s.positionLineNumber, column: s.positionColumn });
	});

	return () => {
		selectionListener.dispose();
		menuAction.dispose();
		closeComposer();
		codeEditor.removeContentWidget(iconWidget);
	};
}

/**
 * In-flow thread cards (the inline-edit presentation, adopted for comments): every unresolved comment
 * of the file renders as a card in a VIEW ZONE directly below its anchor lines — Monaco pushes the
 * following lines apart, the comment sits in the document flow (the DOM twin of `ReviewThreadCard`,
 * same `.review-thread*` skin). Zone heights are measured from the rendered card (next frame), so a
 * long comment never overflows its slot. Draft cards carry Send (the file's chat) + Delete; sent/outdated
 * ones are passive markers. The sidebar remains the full-detail surface.
 */
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
		label.className = "review-thread-label tr-text-eyebrow";
		label.textContent =
			thread.anchorState === "outdated" ? `${thread.status} · outdated` : thread.status;
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
			// A DRAFT's body is editable in place until it's sent: click in, type, blur (or Cmd/Ctrl+Enter)
			// saves; Esc reverts. The textarea auto-grows and the zone re-measures (`relayoutCards`).
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
				e.stopPropagation(); // Monaco must not treat card typing as editor keys
				if (e.key === "Escape") {
					edit.value = thread.body;
					edit.blur();
				}
				if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) edit.blur();
			});
			edit.addEventListener("blur", () => {
				const next = edit.value.trim();
				if (!next || next === thread.body) {
					edit.value = thread.body; // empty/unchanged — revert, never delete from here
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

	/** Re-measure every zone against its card's current height (in-card editing grows the card). A
	 * card that measures 0 — Monaco keeps an OFF-VIEWPORT zone's node at `display:none` — is skipped
	 * (the `height > 12` guard), so a zone never collapses; the observer below re-runs this the moment
	 * such a card scrolls in and gets real geometry. */
	const relayoutCards = () => {
		requestAnimationFrame(() => {
			codeEditor.changeViewZones((accessor) => {
				for (const entry of zones) {
					// The in-card editor sizes itself to its wrapped content first (it renders 0-high until
					// the node is attached, so this must happen HERE, after Monaco mounted the zone).
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

	// The one-shot measure after `setThreads` is not enough: on a fresh mount (e.g. the markdown tab's
	// rendered→source switch) every card below the fold sits in a `display:none` zone and measures 0,
	// so its zone would stay at the placeholder height forever — and the card would paint OVER the
	// following lines once scrolled in. The observer fires whenever a card gains real geometry (zone
	// scrolled into the viewport, node attached late) or grows (in-card editing, font swap), keeping
	// the zone's reserved height true to the card at all times.
	const cardSizeObserver = new ResizeObserver(() => relayoutCards());

	// A card's identity for RECONCILIATION: everything it paints. `setThreads` rebuilds a zone only when
	// this changes, so an unrelated push (another client adding a comment, a re-anchor/resolve elsewhere)
	// leaves an unchanged card — and its DOM — untouched. That is what preserves a draft edit in flight:
	// the textarea, its value, focus and selection all survive, because that card is never torn down.
	const signature = (t: ReviewThreadData): string =>
		[t.status, t.anchorState, t.startLine, t.endLine, t.body].join("\u0000");

	const buildZone = (accessor: monaco.editor.IViewZoneChangeAccessor, thread: ReviewThreadData) => {
		const domNode = document.createElement("div");
		domNode.className = "review-composer-zone";
		const card = cardFor(thread);
		const layout = codeEditor.getLayoutInfo();
		card.style.maxWidth = `${Math.max(280, Math.min(560, layout.contentWidth - 24))}px`;
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
			// Reconcile by comment id: keep every zone whose card renders the same content (signature match),
			// rebuild the ones that changed, drop the ones now gone, add the new — instead of tearing every
			// zone down and back up on each snapshot. A draft the user is mid-edit is a signature match under
			// a sibling push (its persisted body is unchanged), so its live textarea is left in place.
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
		// Size each zone to its rendered card (Monaco attaches new nodes on the next frame; kept ones
		// re-measure too, in case a font/layout change moved them while their content stayed put).
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
