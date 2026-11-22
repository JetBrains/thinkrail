import { focusAndReveal } from "@thinkrail/ui/focus";
import { isImeComposing } from "@thinkrail/ui/keyboard";
import { READ_ONLY_TEXT_SELECTOR } from "../lib";
import { showFiles } from "./chordActions";
import { keyboardClaimed } from "./extensionCommands";
import { FOCUS_CLAIM_SELECTOR, fieldExitTarget, mainAreaTarget, REGION_SELECTOR } from "./regions";
import { isInLayer } from "./shortcutLayers";

const TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
	"text",
	"search",
	"url",
	"email",
	"number",
	"password",
	"tel",
]);
const KEEPS_ESCAPE_SELECTOR = ".monaco-editor, .xterm";
const CENTER_SELECTOR = '[data-region-kind="center"]';
const LADDER_ORIGIN_SELECTOR = "[data-esc-ladder]";
const CENTER_CONTENT_SELECTOR = '[data-region-kind="center"] > [role="tabpanel"]';
const FILE_PANE_SELECTOR = "[data-file-pane]";

export interface FieldTarget {
	readonly tagName: string;
	readonly isContentEditable: boolean;
	readonly type?: string;
	closest(selector: string): unknown;
}

export interface EscapeTarget extends FieldTarget {
	matches(selector: string): boolean;
}

export type EscapePress = Pick<
	KeyboardEvent,
	| "key"
	| "altKey"
	| "ctrlKey"
	| "metaKey"
	| "shiftKey"
	| "isComposing"
	| "keyCode"
	| "defaultPrevented"
>;

function isTextField(target: FieldTarget): boolean {
	if (target.isContentEditable || target.tagName === "TEXTAREA") return true;
	return target.tagName === "INPUT" && TEXT_INPUT_TYPES.has(target.type ?? "");
}

function isBareEscape(press: EscapePress, claimed: boolean): boolean {
	return (
		press.key === "Escape" &&
		!press.altKey &&
		!press.ctrlKey &&
		!press.metaKey &&
		!press.shiftKey &&
		!isImeComposing(press) &&
		!press.defaultPrevented &&
		!claimed
	);
}

function keepsEscape(target: FieldTarget): boolean {
	return target.closest(KEEPS_ESCAPE_SELECTOR) !== null || isInLayer(target);
}

export function leavesField(press: EscapePress, target: FieldTarget, claimed: boolean): boolean {
	return isBareEscape(press, claimed) && isTextField(target) && !keepsEscape(target);
}

export function climbsToMain(press: EscapePress, target: EscapeTarget, claimed: boolean): boolean {
	return (
		isBareEscape(press, claimed) &&
		!isTextField(target) &&
		target.tagName !== "SELECT" &&
		!keepsEscape(target) &&
		(target.closest(REGION_SELECTOR) !== null || target.closest(LADDER_ORIGIN_SELECTOR) !== null) &&
		!target.matches(CENTER_SELECTOR) &&
		target.closest(CENTER_CONTENT_SELECTOR) === null
	);
}

export function leavesFile(press: EscapePress, target: EscapeTarget, claimed: boolean): boolean {
	if (!isBareEscape(press, claimed) || isInLayer(target)) return false;
	if (target.closest(FILE_PANE_SELECTOR) === null) return false;
	if (target.closest(READ_ONLY_TEXT_SELECTOR) !== null) return true;
	return !isTextField(target) && target.tagName !== "SELECT" && !keepsEscape(target);
}

function escapeLanding(event: KeyboardEvent, target: HTMLElement): HTMLElement | null {
	const claimed = keyboardClaimed();
	if (leavesField(event, target, claimed)) {
		const region = target.closest<HTMLElement>(REGION_SELECTOR);
		return region && fieldExitTarget(region);
	}
	return climbsToMain(event, target, claimed) ? mainAreaTarget() : null;
}

export function installEscapeLeavesField(): () => void {
	const onKeyDown = (event: KeyboardEvent) => {
		const target = event.key === "Escape" ? event.composedPath()[0] : null;
		if (!(target instanceof HTMLElement)) return;
		const landing = escapeLanding(event, target);
		if (!landing) {
			if (!leavesFile(event, target, keyboardClaimed())) return;
			event.preventDefault();
			showFiles("all", { activeRow: true });
			return;
		}
		event.preventDefault();
		if (landing.matches(FOCUS_CLAIM_SELECTOR)) focusAndReveal(landing);
		else landing.focus({ preventScroll: true });
	};
	window.addEventListener("keydown", onKeyDown);
	return () => window.removeEventListener("keydown", onKeyDown);
}
