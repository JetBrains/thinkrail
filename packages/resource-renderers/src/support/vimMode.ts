import type {
	editor,
	IKeyboardEvent,
	IPosition,
	ISelection,
} from "monaco-editor/editor/editor.api.js";

export type VimMode = "normal" | "insert" | "visual";
export type VimVisualMode = "character" | "line" | "block";
export type VimSearchDirection = "forward" | "backward";

export interface VimState {
	enabled: boolean;
	mode: VimMode;
	visualMode: VimVisualMode | null;
	searchOpen: boolean;
	searchDirection: VimSearchDirection;
}

const INITIAL_STATE: VimState = {
	enabled: false,
	mode: "normal",
	visualMode: null,
	searchOpen: false,
	searchDirection: "forward",
};

const BRACKET_PAIRS: Readonly<Record<string, string>> = {
	"(": ")",
	")": "(",
	"[": "]",
	"]": "[",
	"{": "}",
	"}": "{",
};

let activeOwner: symbol | null = null;
let activeToggle: (() => void) | null = null;

export function registerActiveVimToggle(toggle: () => void): {
	activate: () => void;
	dispose: () => void;
} {
	const owner = Symbol("vim-editor");
	return {
		activate: () => {
			activeOwner = owner;
			activeToggle = toggle;
		},
		dispose: () => {
			if (activeOwner !== owner) return;
			activeOwner = null;
			activeToggle = null;
		},
	};
}

export function toggleActiveVimMode(): void {
	activeToggle?.();
}

function positionKey(position: IPosition): number {
	return position.lineNumber * 1_000_000 + position.column;
}

function isWordCharacter(value: string | undefined): boolean {
	return value !== undefined && /[A-Za-z0-9_]/u.test(value);
}

function moveWordForward(model: editor.ITextModel, position: IPosition): IPosition {
	const text = model.getValue();
	let offset = model.getOffsetAt(position);
	while (offset < text.length && isWordCharacter(text[offset])) offset += 1;
	while (offset < text.length && !isWordCharacter(text[offset])) offset += 1;
	return model.getPositionAt(offset);
}

function moveWordBackward(model: editor.ITextModel, position: IPosition): IPosition {
	const text = model.getValue();
	let offset = Math.max(0, model.getOffsetAt(position) - 1);
	while (offset > 0 && !isWordCharacter(text[offset])) offset -= 1;
	while (offset > 0 && isWordCharacter(text[offset - 1])) offset -= 1;
	return model.getPositionAt(offset);
}

function moveWordEnd(model: editor.ITextModel, position: IPosition): IPosition {
	const text = model.getValue();
	let offset = model.getOffsetAt(position);
	if (isWordCharacter(text[offset]) && isWordCharacter(text[offset + 1])) {
		while (offset < text.length && isWordCharacter(text[offset + 1])) offset += 1;
		return model.getPositionAt(offset);
	}
	offset += 1;
	while (offset < text.length && !isWordCharacter(text[offset])) offset += 1;
	while (offset < text.length && isWordCharacter(text[offset + 1])) offset += 1;
	return model.getPositionAt(Math.min(offset, text.length));
}

function movePosition(
	model: editor.ITextModel,
	position: IPosition,
	key: string,
	count: number,
): IPosition | null {
	let next = position;
	for (let index = 0; index < count; index += 1) {
		if (key === "h") {
			next = { lineNumber: next.lineNumber, column: Math.max(1, next.column - 1) };
		} else if (key === "l") {
			next = {
				lineNumber: next.lineNumber,
				column: Math.min(model.getLineMaxColumn(next.lineNumber), next.column + 1),
			};
		} else if (key === "j") {
			const lineNumber = Math.min(model.getLineCount(), next.lineNumber + 1);
			next = {
				lineNumber,
				column: Math.min(model.getLineMaxColumn(lineNumber), next.column),
			};
		} else if (key === "k") {
			const lineNumber = Math.max(1, next.lineNumber - 1);
			next = {
				lineNumber,
				column: Math.min(model.getLineMaxColumn(lineNumber), next.column),
			};
		} else if (key === "w") {
			next = moveWordForward(model, next);
		} else if (key === "b") {
			next = moveWordBackward(model, next);
		} else if (key === "e") {
			next = moveWordEnd(model, next);
		} else {
			return null;
		}
	}
	return next;
}

function clampCount(value: string): number {
	const count = Number.parseInt(value, 10);
	return Number.isSafeInteger(count) && count > 0 ? Math.min(count, 9999) : 1;
}

function consume(event: IKeyboardEvent): void {
	event.browserEvent.preventDefault();
	event.browserEvent.stopPropagation();
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function lineStart(
	model: editor.ITextModel,
	lineNumber: number,
	firstNonBlank: boolean,
): IPosition {
	if (!firstNonBlank) return { lineNumber, column: 1 };
	const match = model.getLineContent(lineNumber).search(/\S/u);
	return { lineNumber, column: match < 0 ? 1 : match + 1 };
}

function findCharacter(
	model: editor.ITextModel,
	position: IPosition,
	character: string,
	direction: "forward" | "backward",
	before: boolean,
	count: number,
): IPosition {
	const line = model.getLineContent(position.lineNumber);
	let cursor = direction === "forward" ? position.column : position.column - 2;
	let found = -1;
	for (let repetition = 0; repetition < count; repetition += 1) {
		found =
			direction === "forward"
				? line.indexOf(character, Math.max(0, cursor))
				: line.lastIndexOf(character, Math.max(0, cursor));
		if (found < 0) return position;
		cursor = direction === "forward" ? found + 1 : found - 1;
	}
	const column = found + 1 + (before ? (direction === "forward" ? -1 : 1) : 0);
	return { lineNumber: position.lineNumber, column: Math.max(1, column) };
}

function matchingBracket(model: editor.ITextModel, position: IPosition): IPosition | null {
	const text = model.getValue();
	const offset = model.getOffsetAt(position);
	let index = offset;
	let character = text[index];
	if (!BRACKET_PAIRS[character ?? ""]) {
		index = offset + 1;
		while (index < text.length && !BRACKET_PAIRS[text[index] ?? ""]) index += 1;
		character = text[index];
	}
	const pair = BRACKET_PAIRS[character ?? ""];
	if (!pair) return null;
	const forward = character === "(" || character === "[" || character === "{";
	let depth = 0;
	for (
		let cursor = index;
		forward ? cursor < text.length : cursor >= 0;
		cursor += forward ? 1 : -1
	) {
		const current = text[cursor];
		if (current === character) depth += 1;
		if (current === pair) {
			depth -= 1;
			if (depth === 0) return model.getPositionAt(cursor);
		}
	}
	return null;
}

function revealLineNearBottom(codeEditor: editor.IStandaloneCodeEditor, lineNumber: number): void {
	const lineTop = codeEditor.getTopForLineNumber(lineNumber);
	const nextLineTop = codeEditor.getTopForLineNumber(lineNumber + 1);
	const lineHeight = Math.max(1, nextLineTop - lineTop);
	const viewportHeight = codeEditor.getLayoutInfo().height;
	codeEditor.setScrollTop(Math.max(0, lineTop - viewportHeight + lineHeight));
}

function visibleLine(
	codeEditor: editor.IStandaloneCodeEditor,
	kind: "top" | "middle" | "bottom",
	count: number,
): number | null {
	const range = codeEditor.getVisibleRanges()[0];
	if (!range) return null;
	if (kind === "top") return Math.min(range.startLineNumber + count - 1, range.endLineNumber);
	if (kind === "bottom") return Math.max(range.endLineNumber - count + 1, range.startLineNumber);
	return Math.floor((range.startLineNumber + range.endLineNumber) / 2);
}

type PendingCommand =
	| { kind: "character"; direction: "forward" | "backward"; before: boolean; count: number }
	| { kind: "g"; count: number }
	| { kind: "z"; count: number }
	| { kind: "mark-set" }
	| { kind: "mark-jump"; exact: boolean };

export function createVimController(
	codeEditor: editor.IStandaloneCodeEditor,
	onStateChange: (state: VimState) => void,
): {
	toggle: () => void;
	submitSearch: (query: string) => void;
	cancelSearch: () => void;
	dispose: () => void;
} {
	let state = INITIAL_STATE;
	let count = "";
	let anchor: IPosition | null = null;
	let visualPosition: IPosition | null = null;
	let pending: PendingCommand | null = null;
	let lastSearch: { query: string; direction: VimSearchDirection; wholeWord: boolean } | null =
		null;
	const marks = new Map<string, IPosition>();
	let jumpHistory: IPosition[] = [];
	let jumpIndex = -1;

	const update = (patch: Partial<VimState>) => {
		state = { ...state, ...patch };
		onStateChange(state);
	};

	const currentPosition = () => codeEditor.getPosition();
	const motionPosition = () =>
		state.mode === "visual" ? (visualPosition ?? currentPosition()) : currentPosition();

	const recordJump = (target: IPosition) => {
		const current = currentPosition();
		if (!current) return;
		if (
			jumpIndex >= 0 &&
			jumpHistory[jumpIndex]?.lineNumber === current.lineNumber &&
			jumpHistory[jumpIndex]?.column === current.column
		) {
			jumpHistory = jumpHistory.slice(0, jumpIndex + 1);
		} else {
			jumpHistory = jumpHistory.slice(0, jumpIndex + 1);
			jumpHistory.push(current);
		}
		jumpHistory.push(target);
		jumpIndex = jumpHistory.length - 1;
	};

	const setPosition = (position: IPosition, jump = false) => {
		if (jump) recordJump(position);
		codeEditor.setPosition(position);
		codeEditor.revealPositionInCenter(position);
	};

	const setVisualPosition = (position: IPosition) => {
		if (!anchor) anchor = currentPosition() ?? position;
		visualPosition = position;
		if (state.visualMode === "line") {
			const model = codeEditor.getModel();
			const end = Math.max(anchor.lineNumber, position.lineNumber);
			const anchorEnd = model?.getLineMaxColumn(anchor.lineNumber) ?? anchor.column;
			const positionEnd = model?.getLineMaxColumn(position.lineNumber) ?? position.column;
			codeEditor.setSelection({
				selectionStartLineNumber: anchor.lineNumber,
				selectionStartColumn: anchor.lineNumber <= position.lineNumber ? 1 : anchorEnd,
				positionLineNumber: position.lineNumber,
				positionColumn: position.lineNumber >= anchor.lineNumber ? positionEnd : 1,
			});
			codeEditor.revealLineInCenter(end);
			return;
		}
		if (state.visualMode === "block") {
			const model = codeEditor.getModel();
			const startLine = Math.min(anchor.lineNumber, position.lineNumber);
			const endLine = Math.max(anchor.lineNumber, position.lineNumber);
			const startColumn = Math.min(anchor.column, position.column);
			const endColumn = Math.max(anchor.column, position.column);
			const endColumnExclusive = model
				? Math.min(model.getLineMaxColumn(endLine), endColumn + 1)
				: endColumn + 1;
			const selections: ISelection[] = [];
			for (let line = startLine; line <= endLine; line += 1) {
				selections.push({
					selectionStartLineNumber: line,
					selectionStartColumn: startColumn,
					positionLineNumber: line,
					positionColumn: endColumnExclusive,
				});
			}
			codeEditor.setSelections(selections);
			codeEditor.revealPositionInCenter(position);
			return;
		}
		const model = codeEditor.getModel();
		const anchorIsBefore = positionKey(anchor) <= positionKey(position);
		const start = anchorIsBefore ? anchor : position;
		const end = anchorIsBefore ? position : anchor;
		const endColumnExclusive = model
			? Math.min(model.getLineMaxColumn(end.lineNumber), end.column + 1)
			: end.column + 1;
		codeEditor.setSelection({
			selectionStartLineNumber: start.lineNumber,
			selectionStartColumn: start.column,
			positionLineNumber: end.lineNumber,
			positionColumn: endColumnExclusive,
		});
		codeEditor.revealPositionInCenter(position);
	};

	const applyPosition = (position: IPosition, jump = false) => {
		if (state.mode === "visual") setVisualPosition(position);
		else setPosition(position, jump);
	};

	const performSearch = (
		query: string,
		direction: VimSearchDirection,
		repetitions = 1,
		wholeWord = false,
		saveSearch = true,
	) => {
		const model = codeEditor.getModel();
		const current = currentPosition();
		if (!model || !current || query.length === 0) return;
		const selection = codeEditor.getSelection();
		let searchPosition: IPosition =
			direction === "forward"
				? (selection?.getEndPosition() ?? current)
				: (selection?.getStartPosition() ?? current);
		const searchQuery = wholeWord ? `\\b${escapeRegex(query)}\\b` : query;
		let match: ReturnType<editor.ITextModel["findNextMatch"]> | null = null;
		for (let index = 0; index < repetitions; index += 1) {
			match =
				direction === "forward"
					? model.findNextMatch(searchQuery, searchPosition, wholeWord, false, null, false)
					: model.findPreviousMatch(searchQuery, searchPosition, wholeWord, false, null, false);
			if (!match) {
				searchPosition =
					direction === "forward"
						? { lineNumber: 1, column: 1 }
						: model.getPositionAt(model.getValueLength());
				match =
					direction === "forward"
						? model.findNextMatch(searchQuery, searchPosition, wholeWord, false, null, false)
						: model.findPreviousMatch(searchQuery, searchPosition, wholeWord, false, null, false);
			}
			if (!match) return;
			searchPosition =
				direction === "forward" ? match.range.getEndPosition() : match.range.getStartPosition();
		}
		if (!match) return;
		recordJump(match.range.getStartPosition());
		codeEditor.setSelection(match.range);
		codeEditor.revealRangeInCenter(match.range);
		if (saveSearch) lastSearch = { query, direction, wholeWord };
	};

	const jumpHistoryBy = (delta: -1 | 1) => {
		if (jumpHistory.length === 0) return;
		const nextIndex = Math.max(0, Math.min(jumpHistory.length - 1, jumpIndex + delta));
		if (nextIndex === jumpIndex) return;
		jumpIndex = nextIndex;
		const position = jumpHistory[jumpIndex];
		if (position) setPosition(position);
	};

	const submitSearch = (query: string) => {
		update({ searchOpen: false });
		performSearch(query, state.searchDirection);
		codeEditor.focus();
	};

	const cancelSearch = () => {
		update({ searchOpen: false });
		codeEditor.focus();
	};

	const toggle = () => {
		const enabled = !state.enabled;
		count = "";
		anchor = null;
		visualPosition = null;
		pending = null;
		update({ enabled, mode: "normal", visualMode: null, searchOpen: false });
		codeEditor.focus();
	};

	const onKeyDown = (event: IKeyboardEvent) => {
		if (!state.enabled || event.browserEvent.isComposing) return;
		const key = event.browserEvent.key;
		const lowerKey = key.toLowerCase();
		const hasModifier =
			event.browserEvent.ctrlKey || event.browserEvent.metaKey || event.browserEvent.altKey;

		if (state.mode === "insert") {
			if (key !== "Escape") return;
			consume(event);
			visualPosition = null;
			update({ mode: "normal", visualMode: null });
			return;
		}

		if (key === "Escape") {
			consume(event);
			count = "";
			anchor = null;
			visualPosition = null;
			pending = null;
			update({ mode: "normal", visualMode: null });
			return;
		}

		if (
			hasModifier &&
			event.browserEvent.ctrlKey &&
			(lowerKey === "v" ||
				lowerKey === "o" ||
				lowerKey === "i" ||
				lowerKey === "d" ||
				lowerKey === "u" ||
				lowerKey === "f" ||
				lowerKey === "b")
		) {
			if (lowerKey === "v") {
				consume(event);
				anchor = currentPosition();
				visualPosition = anchor;
				update({ mode: "visual", visualMode: "block" });
				if (visualPosition) setVisualPosition(visualPosition);
				return;
			}
			if (lowerKey === "o" || lowerKey === "i") {
				consume(event);
				jumpHistoryBy(lowerKey === "o" ? -1 : 1);
				return;
			}
			const visible = codeEditor.getVisibleRanges()[0];
			const current = motionPosition();
			if (visible && current) {
				const page = Math.max(1, visible.endLineNumber - visible.startLineNumber);
				const delta =
					lowerKey === "f"
						? page
						: lowerKey === "b"
							? -page
							: lowerKey === "d"
								? Math.floor(page / 2)
								: lowerKey === "u"
									? -Math.floor(page / 2)
									: 0;
				if (delta !== 0) {
					consume(event);
					const model = codeEditor.getModel();
					if (model) {
						const lineNumber = Math.max(
							1,
							Math.min(model.getLineCount(), current.lineNumber + delta),
						);
						setPosition({
							lineNumber,
							column: Math.min(model.getLineMaxColumn(lineNumber), current.column),
						});
					}
					return;
				}
			}
		}

		if (hasModifier) return;

		if (pending) {
			const command = pending;
			pending = null;
			if (command.kind === "character" && key.length === 1) {
				const model = codeEditor.getModel();
				const position = motionPosition();
				if (model && position)
					applyPosition(
						findCharacter(model, position, key, command.direction, command.before, command.count),
					);
				consume(event);
				return;
			}
			if (command.kind === "g" && lowerKey === "g") {
				const model = codeEditor.getModel();
				if (model) applyPosition(lineStart(model, command.count, false), true);
				consume(event);
				return;
			}
			if (command.kind === "z" && (lowerKey === "t" || lowerKey === "z" || lowerKey === "b")) {
				const line = currentPosition()?.lineNumber ?? null;
				if (line !== null) {
					if (lowerKey === "t") codeEditor.revealLineNearTop(line);
					else if (lowerKey === "b") revealLineNearBottom(codeEditor, line);
					else codeEditor.revealLineInCenter(line);
				}
				consume(event);
				return;
			}
			if (command.kind === "mark-set" && /^[a-z]$/u.test(key)) {
				const position = currentPosition();
				if (position) marks.set(key, position);
				consume(event);
				return;
			}
			if (command.kind === "mark-jump" && /^[a-z]$/u.test(key)) {
				const mark = marks.get(key);
				if (mark) {
					const model = codeEditor.getModel();
					setPosition(
						command.exact ? mark : model ? lineStart(model, mark.lineNumber, false) : mark,
						true,
					);
				}
				consume(event);
				return;
			}
			return;
		}

		if (key >= "1" && key <= "9") {
			consume(event);
			count += key;
			return;
		}
		if (key === "0" && count.length > 0) {
			consume(event);
			count += key;
			return;
		}

		if (key === "/" || key === "?") {
			consume(event);
			count = "";
			update({ searchOpen: true, searchDirection: key === "/" ? "forward" : "backward" });
			return;
		}

		if (key === "i" || key === "a" || key === "A") {
			consume(event);
			count = "";
			update({ mode: "insert", visualMode: null });
			return;
		}

		if (key === "v" || key === "V") {
			consume(event);
			count = "";
			anchor = currentPosition();
			visualPosition = anchor;
			update({ mode: "visual", visualMode: key === "V" ? "line" : "character" });
			if (visualPosition) setVisualPosition(visualPosition);
			return;
		}

		if (state.mode === "visual" && (key === "o" || key === "O")) {
			const position = motionPosition();
			if (position && anchor) {
				const previousAnchor = anchor;
				anchor = position;
				visualPosition = previousAnchor;
				setVisualPosition(previousAnchor);
			}
			consume(event);
			return;
		}

		if (lowerKey === "n" && lastSearch) {
			consume(event);
			const repetitions = clampCount(count);
			count = "";
			performSearch(
				lastSearch.query,
				event.browserEvent.shiftKey
					? lastSearch.direction === "forward"
						? "backward"
						: "forward"
					: lastSearch.direction,
				repetitions,
				lastSearch.wholeWord,
				false,
			);
			return;
		}

		if (key === "*" || key === "#") {
			const model = codeEditor.getModel();
			const position = currentPosition();
			const word = model && position ? model.getWordAtPosition(position)?.word : null;
			if (word) {
				consume(event);
				performSearch(word, key === "*" ? "forward" : "backward", clampCount(count), true);
			}
			count = "";
			return;
		}

		if (key === "f" || key === "F" || key === "t" || key === "T") {
			consume(event);
			pending = {
				kind: "character",
				direction: key === "f" || key === "t" ? "forward" : "backward",
				before: key === "t" || key === "T",
				count: clampCount(count),
			};
			count = "";
			return;
		}

		if (key === "g") {
			consume(event);
			pending = { kind: "g", count: clampCount(count) };
			count = "";
			return;
		}

		if (key === "z") {
			consume(event);
			pending = { kind: "z", count: clampCount(count) };
			count = "";
			return;
		}

		if (key === "m") {
			consume(event);
			pending = { kind: "mark-set" };
			count = "";
			return;
		}
		if (key === "'" || key === "`") {
			consume(event);
			pending = { kind: "mark-jump", exact: key === "`" };
			count = "";
			return;
		}

		if (key === "G") {
			consume(event);
			const model = codeEditor.getModel();
			if (model) {
				const lineNumber =
					count.length > 0
						? Math.min(model.getLineCount(), clampCount(count))
						: model.getLineCount();
				applyPosition(lineStart(model, lineNumber, false), true);
			}
			count = "";
			return;
		}

		if (key === "^" || key === "0" || key === "$") {
			consume(event);
			const position = motionPosition();
			const model = codeEditor.getModel();
			if (position && model) {
				const next =
					key === "$"
						? {
								lineNumber: position.lineNumber,
								column: model.getLineMaxColumn(position.lineNumber),
							}
						: lineStart(model, position.lineNumber, key === "^");
				applyPosition(next);
			}
			count = "";
			return;
		}

		if (key === "%") {
			const model = codeEditor.getModel();
			const position = currentPosition();
			const match = model && position ? matchingBracket(model, position) : null;
			if (match) {
				consume(event);
				applyPosition(match, true);
			}
			count = "";
			return;
		}

		if (key === "H" || key === "M" || key === "L") {
			const line = visibleLine(
				codeEditor,
				key === "H" ? "top" : key === "L" ? "bottom" : "middle",
				clampCount(count),
			);
			const model = codeEditor.getModel();
			if (line !== null && model) {
				consume(event);
				applyPosition(lineStart(model, line, false));
			}
			count = "";
			return;
		}

		const model = codeEditor.getModel();
		const position = motionPosition();
		if (!model || !position) return;
		const next = movePosition(model, position, lowerKey, clampCount(count));
		if (!next) return;
		consume(event);
		count = "";
		applyPosition(next);
	};

	const listener = codeEditor.onKeyDown(onKeyDown);
	const modelContentListener = codeEditor.onDidChangeModelContent(() => {
		count = "";
		anchor = null;
		visualPosition = null;
		pending = null;
		lastSearch = null;
		marks.clear();
		jumpHistory = [];
		jumpIndex = -1;
		update({ mode: "normal", visualMode: null, searchOpen: false });
	});
	return {
		toggle,
		submitSearch,
		cancelSearch,
		dispose: () => {
			listener.dispose();
			modelContentListener.dispose();
		},
	};
}

export function initialVimState(): VimState {
	return { ...INITIAL_STATE };
}
