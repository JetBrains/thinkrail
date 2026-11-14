import type { editor, IKeyboardEvent, IPosition } from "monaco-editor/editor/editor.api.js";

export type VimMode = "normal" | "insert" | "visual";
export type VimSearchDirection = "forward" | "backward";

export interface VimState {
	enabled: boolean;
	mode: VimMode;
	searchOpen: boolean;
	searchDirection: VimSearchDirection;
}

const INITIAL_STATE: VimState = {
	enabled: false,
	mode: "normal",
	searchOpen: false,
	searchDirection: "forward",
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
	let lastSearch: { query: string; direction: VimSearchDirection } | null = null;

	const update = (patch: Partial<VimState>) => {
		state = { ...state, ...patch };
		onStateChange(state);
	};

	const setPosition = (position: IPosition) => {
		codeEditor.setPosition(position);
		codeEditor.revealPositionInCenter(position);
	};

	const setVisualPosition = (position: IPosition) => {
		if (!anchor) anchor = codeEditor.getPosition() ?? position;
		codeEditor.setSelection({
			selectionStartLineNumber: anchor.lineNumber,
			selectionStartColumn: anchor.column,
			positionLineNumber: position.lineNumber,
			positionColumn: position.column,
		});
		codeEditor.revealPositionInCenter(position);
	};

	const performSearch = (query: string, direction: VimSearchDirection, repetitions = 1) => {
		const model = codeEditor.getModel();
		const current = codeEditor.getPosition();
		if (!model || !current || query.length === 0) return;
		const selection = codeEditor.getSelection();
		let searchPosition =
			direction === "forward"
				? (selection?.getEndPosition() ?? current)
				: (selection?.getStartPosition() ?? current);
		const matches = model.findMatches(query, false, false, false, null, false);
		if (matches.length === 0) return;
		for (let index = 0; index < repetitions; index += 1) {
			const currentOffset = positionKey(searchPosition);
			const match =
				direction === "forward"
					? (matches.find(
							(candidate) => positionKey(candidate.range.getStartPosition()) > currentOffset,
						) ?? matches[0])
					: (matches.findLast(
							(candidate) => positionKey(candidate.range.getStartPosition()) < currentOffset,
						) ?? matches[matches.length - 1]);
			if (!match) return;
			searchPosition =
				direction === "forward" ? match.range.getEndPosition() : match.range.getStartPosition();
			codeEditor.setSelection(match.range);
			codeEditor.revealRangeInCenter(match.range);
		}
		lastSearch = { query, direction };
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
		update({ enabled, mode: "normal", searchOpen: false });
		codeEditor.focus();
	};

	const onKeyDown = (event: IKeyboardEvent) => {
		if (!state.enabled || event.browserEvent.isComposing) return;
		const key = event.browserEvent.key;
		const lowerKey = key.toLowerCase();
		if (event.browserEvent.ctrlKey || event.browserEvent.metaKey || event.browserEvent.altKey) {
			if (key !== "Escape") return;
		}

		if (state.mode === "insert") {
			if (key !== "Escape") return;
			consume(event);
			update({ mode: "normal" });
			return;
		}

		if (key === "Escape") {
			consume(event);
			count = "";
			anchor = null;
			update({ mode: "normal" });
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

		if (key === "i" || key === "a") {
			consume(event);
			count = "";
			update({ mode: "insert" });
			return;
		}

		if (key === "v") {
			consume(event);
			count = "";
			anchor = codeEditor.getPosition();
			update({ mode: "visual" });
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
			);
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
				const position = { lineNumber, column: 1 };
				if (state.mode === "visual") setVisualPosition(position);
				else setPosition(position);
			}
			count = "";
			return;
		}

		if (key === "0" || key === "$") {
			consume(event);
			const position = codeEditor.getPosition();
			const model = codeEditor.getModel();
			if (position && model) {
				const next = {
					lineNumber: position.lineNumber,
					column: key === "0" ? 1 : model.getLineMaxColumn(position.lineNumber),
				};
				if (state.mode === "visual") setVisualPosition(next);
				else setPosition(next);
			}
			count = "";
			return;
		}

		const model = codeEditor.getModel();
		const position = codeEditor.getPosition();
		if (!model || !position) return;
		const next = movePosition(model, position, key, clampCount(count));
		if (!next) return;
		consume(event);
		count = "";
		if (state.mode === "visual") setVisualPosition(next);
		else setPosition(next);
	};

	const listener = codeEditor.onKeyDown(onKeyDown);
	return {
		toggle,
		submitSearch,
		cancelSearch,
		dispose: () => listener.dispose(),
	};
}

export function initialVimState(): VimState {
	return { ...INITIAL_STATE };
}
