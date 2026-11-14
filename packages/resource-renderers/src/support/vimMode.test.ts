import { describe, expect, test } from "bun:test";
import type {
	editor,
	IKeyboardEvent,
	IPosition,
	IRange,
	ISelection,
} from "monaco-editor/editor/editor.api.js";
import {
	createVimController,
	initialVimState,
	registerActiveVimToggle,
	toggleActiveVimMode,
	type VimState,
} from "./vimMode";

type KeyListener = (event: IKeyboardEvent) => void;

function position(lineNumber: number, column: number): IPosition {
	return { lineNumber, column };
}

function makeEditor(lines: readonly string[]) {
	let current = position(1, 1);
	let selection: IRange | null = null;
	let listener: KeyListener | null = null;
	const text = lines.join("\n");
	const offsets: number[] = [];
	for (const index of lines.keys()) {
		const previous = offsets[index - 1] ?? 0;
		const previousLine = lines[index - 1] ?? "";
		offsets.push(index === 0 ? 0 : previous + previousLine.length + 1);
	}
	const model = {
		getValue: () => text,
		getOffsetAt: (value: IPosition) => (offsets[value.lineNumber - 1] ?? 0) + value.column - 1,
		getPositionAt: (offset: number) => {
			const lineNumber = offsets.findLastIndex((start) => start <= offset) + 1;
			return position(lineNumber, offset - (offsets[lineNumber - 1] ?? 0) + 1);
		},
		getLineCount: () => lines.length,
		getLineMaxColumn: (lineNumber: number) => (lines[lineNumber - 1] ?? "").length + 1,
		findMatches: (query: string) => {
			const matches: Array<{ range: IRange }> = [];
			for (const [lineIndex, line] of lines.entries()) {
				let from = 0;
				while (from <= line.length) {
					const found = line.indexOf(query, from);
					if (found < 0) break;
					matches.push({
						range: {
							startLineNumber: lineIndex + 1,
							startColumn: found + 1,
							endLineNumber: lineIndex + 1,
							endColumn: found + query.length + 1,
							getStartPosition: () => position(lineIndex + 1, found + 1),
							getEndPosition: () => position(lineIndex + 1, found + query.length + 1),
						} as IRange,
					});
					from = found + Math.max(query.length, 1);
				}
			}
			return matches;
		},
	};
	const editor = {
		onKeyDown: (next: KeyListener) => {
			listener = next;
			return { dispose: () => (listener = null) };
		},
		getModel: () => model,
		getPosition: () => current,
		getSelection: () => {
			const currentSelection = selection;
			if (!currentSelection) return null;
			return {
				...currentSelection,
				getStartPosition: () =>
					position(currentSelection.startLineNumber, currentSelection.startColumn),
				getEndPosition: () => position(currentSelection.endLineNumber, currentSelection.endColumn),
			} as unknown as ISelection;
		},
		setPosition: (next: IPosition) => {
			current = next;
			selection = null;
		},
		setSelection: (next: IRange) => {
			selection = next;
			current = position(next.endLineNumber, next.endColumn);
		},
		revealPositionInCenter: () => {},
		revealRangeInCenter: () => {},
		focus: () => {},
	};
	return {
		editor: editor as unknown as editor.IStandaloneCodeEditor,
		get position() {
			return current;
		},
		get selection() {
			return selection;
		},
		emit(key: string, shiftKey = false) {
			const browserEvent = {
				key,
				shiftKey,
				ctrlKey: false,
				metaKey: false,
				altKey: false,
				isComposing: false,
				preventDefault: () => {},
				stopPropagation: () => {},
			} as unknown as KeyboardEvent;
			listener?.({ browserEvent } as unknown as IKeyboardEvent);
		},
	};
}

describe("Vim mode", () => {
	test("starts disabled and cycles normal, insert and visual modes", () => {
		const fake = makeEditor(["one", "two"]);
		let state: VimState = initialVimState();
		const controller = createVimController(fake.editor, (next) => (state = next));

		expect(state).toEqual(initialVimState());
		controller.toggle();
		expect(state).toMatchObject({ enabled: true, mode: "normal" });
		fake.emit("i");
		expect(state.mode).toBe("insert");
		fake.emit("Escape");
		fake.emit("v");
		expect(state.mode).toBe("visual");
		fake.emit("Escape");
		expect(state.mode).toBe("normal");
		controller.dispose();
	});

	test("repeats line movement with a count", () => {
		const fake = makeEditor(Array.from({ length: 20 }, (_, index) => `line ${index}`));
		const controller = createVimController(fake.editor, () => {});
		controller.toggle();

		for (const key of ["1", "0", "j"]) fake.emit(key);
		expect(fake.position).toEqual(position(11, 1));
		controller.dispose();
	});

	test("searches forward and backward with n and Shift+N", () => {
		const fake = makeEditor(["alpha", "beta", "beta"]);
		let state: VimState = initialVimState();
		const controller = createVimController(fake.editor, (next) => (state = next));
		controller.toggle();
		fake.emit("/");
		expect(state.searchOpen).toBe(true);
		controller.submitSearch("beta");
		expect(fake.position).toEqual(position(2, 5));
		fake.emit("n");
		expect(fake.position).toEqual(position(3, 5));
		fake.emit("N", true);
		expect(fake.position).toEqual(position(2, 5));
		controller.dispose();
	});

	test("palette toggle reaches active editor", () => {
		const fake = makeEditor(["one"]);
		let state: VimState = initialVimState();
		const controller = createVimController(fake.editor, (next) => (state = next));
		const registration = registerActiveVimToggle(controller.toggle);
		registration.activate();
		toggleActiveVimMode();
		expect(state.enabled).toBe(true);
		registration.dispose();
		controller.dispose();
	});
});
