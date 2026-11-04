import { isImeComposing } from "@thinkrail/ui/keyboard";
import { type DictationAnchor, dictationText, separators } from "./text";

const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "email", "tel", ""]);
const EXCLUDED_ROOTS = ".monaco-editor, .xterm";

/** The slice of an element eligibility reads, so the rule is testable without a DOM. */
export interface FieldCandidate {
	tagName: string;
	type?: string;
	readOnly?: boolean;
	disabled?: boolean;
	isContentEditable?: boolean;
	closest(selector: string): unknown;
}

/** Text inputs, textareas and contenteditable regions, outside the code editor and the terminal. */
export function isDictationField(candidate: FieldCandidate): boolean {
	if (candidate.closest(EXCLUDED_ROOTS)) return false;
	if (candidate.readOnly || candidate.disabled) return false;
	if (candidate.tagName === "TEXTAREA") return true;
	if (candidate.tagName === "INPUT")
		return TEXT_INPUT_TYPES.has((candidate.type ?? "").toLowerCase());
	return candidate.isContentEditable === true;
}

/** The eligible field a focus target belongs to: the element itself, or its contenteditable host. */
export function dictationFieldOf(target: EventTarget | null): HTMLElement | null {
	if (!(target instanceof HTMLElement)) return null;
	if (target.isContentEditable) {
		const host = target.closest<HTMLElement>('[contenteditable]:not([contenteditable="false"])');
		return host && isDictationField(host) ? host : null;
	}
	return isDictationField(target) ? target : null;
}

/** Writes recognized text into one field and keeps it read-only while listening. */
export interface FieldWriter {
	replace(spoken: string): void;
	lock(): () => void;
}

function isTextControl(element: HTMLElement): element is HTMLInputElement | HTMLTextAreaElement {
	return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement;
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
	const prototype =
		element instanceof HTMLTextAreaElement
			? HTMLTextAreaElement.prototype
			: HTMLInputElement.prototype;
	Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
	element.dispatchEvent(new Event("input", { bubbles: true }));
}

function selectionOf(element: HTMLInputElement | HTMLTextAreaElement): DictationAnchor {
	const end = element.value.length;
	return {
		base: element.value,
		start: element.selectionStart ?? end,
		end: element.selectionEnd ?? end,
	};
}

function swallowEnter(element: HTMLElement): () => void {
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key !== "Enter" || isImeComposing(event)) return;
		event.preventDefault();
		event.stopImmediatePropagation();
	};
	element.addEventListener("keydown", onKeyDown, true);
	return () => element.removeEventListener("keydown", onKeyDown, true);
}

/**
 * Inputs and textareas are rewritten through the native value setter plus an `input` event, so a
 * React-controlled field sees an ordinary `onChange`. The caret moves only while the field has focus.
 */
function textControlWriter(element: HTMLInputElement | HTMLTextAreaElement): FieldWriter {
	const anchor = selectionOf(element);
	return {
		replace(spoken) {
			const { text, caret } = dictationText(anchor, spoken);
			setNativeValue(element, text);
			if (element === document.activeElement) {
				try {
					element.setSelectionRange(caret, caret);
				} catch {}
			}
		},
		lock() {
			const wasReadOnly = element.readOnly;
			element.readOnly = true;
			const releaseEnter = swallowEnter(element);
			return () => {
				element.readOnly = wasReadOnly;
				releaseEnter();
			};
		},
	};
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** `Selection.modify` steps whole characters (grapheme clusters), never UTF-16 units. */
function graphemeCount(text: string): number {
	let count = 0;
	for (const _ of graphemes.segment(text)) count += 1;
	return count;
}

/** One character beside the selection, as the browser reads it (a line or block break reads as "\n"). */
function neighbour(selection: Selection, direction: "backward" | "forward"): string {
	const saved = selection.getRangeAt(0).cloneRange();
	if (direction === "backward") selection.collapseToStart();
	else selection.collapseToEnd();
	selection.modify("extend", direction, "character");
	const text = selection.toString();
	selection.removeAllRanges();
	selection.addRange(saved);
	return text;
}

/** Contenteditable regions take each update as one `insertText` over the previous one's span. */
function editableWriter(host: HTMLElement): FieldWriter {
	const selection = window.getSelection();
	let span: Range | null = null;
	if (
		selection &&
		selection.rangeCount > 0 &&
		host.contains(selection.getRangeAt(0).startContainer)
	) {
		span = selection.getRangeAt(0).cloneRange();
	}
	const { lead, trail } =
		selection && span
			? separators(neighbour(selection, "backward"), neighbour(selection, "forward"))
			: { lead: "", trail: "" };
	let writing = false;
	return {
		replace(spoken) {
			if (!selection || !span || !host.contains(document.activeElement)) return;
			const next = spoken ? `${lead}${spoken}${trail}` : "";
			selection.removeAllRanges();
			selection.addRange(span);
			writing = true;
			if (next) document.execCommand("insertText", false, next);
			else if (!selection.isCollapsed) document.execCommand("delete");
			writing = false;
			const characters = graphemeCount(next);
			for (let i = 0; i < characters; i += 1) selection.modify("extend", "backward", "character");
			span = selection.getRangeAt(0).cloneRange();
			selection.collapseToEnd();
		},
		lock() {
			const onBeforeInput = (event: Event) => {
				if (!writing) event.preventDefault();
			};
			host.addEventListener("beforeinput", onBeforeInput, true);
			const releaseEnter = swallowEnter(host);
			return () => {
				host.removeEventListener("beforeinput", onBeforeInput, true);
				releaseEnter();
			};
		},
	};
}

export function fieldWriter(element: HTMLElement): FieldWriter {
	return isTextControl(element) ? textControlWriter(element) : editableWriter(element);
}

/** Fired on the field when its dictation starts and ends, so an owner can hold its own submit button. */
export const DICTATION_EVENT = "thinkrail:dictation";

export function announceDictation(element: HTMLElement, listening: boolean): void {
	element.dispatchEvent(new CustomEvent(DICTATION_EVENT, { bubbles: true, detail: { listening } }));
}
