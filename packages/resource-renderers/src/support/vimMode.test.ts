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
	let scrollTop = 0;
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
		getLineContent: (lineNumber: number) => lines[lineNumber - 1] ?? "",
		getLineMaxColumn: (lineNumber: number) => (lines[lineNumber - 1] ?? "").length + 1,
		getWordAtPosition: (value: IPosition) => {
			const line = lines[value.lineNumber - 1] ?? "";
			const index = value.column - 1;
			const match = /[A-Za-z0-9_]+/gu;
			for (const item of line.matchAll(match)) {
				const start = item.index ?? 0;
				if (index >= start && index <= start + item[0].length) {
					return { word: item[0], startColumn: start + 1, endColumn: start + item[0].length + 1 };
				}
			}
			return null;
		},
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
		setSelections: (next: readonly ISelection[]) => {
			const last = next[next.length - 1];
			if (!last) return;
			selection = last as unknown as IRange;
			current = position(last.positionLineNumber, last.positionColumn);
		},
		getVisibleRanges: () => [
			{
				startLineNumber: 1,
				startColumn: 1,
				endLineNumber: Math.min(lines.length, 5),
				endColumn: 1,
			} as IRange,
		],
		getTopForLineNumber: (lineNumber: number) => (lineNumber - 1) * 20,
		getLayoutInfo: () => ({ height: 100 }),
		setScrollTop: (next: number) => {
			scrollTop = next;
		},
		revealPositionInCenter: () => {},
		revealRangeInCenter: () => {},
		revealLineNearTop: () => {},
		revealLineInCenter: () => {},
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
		get scrollTop() {
			return scrollTop;
		},
		emit(key: string, shiftKey = false, ctrlKey = false) {
			const browserEvent = {
				key,
				shiftKey,
				ctrlKey,
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

	test("supports Vim tiny navigation, Visual variants, marks and viewport jumps", () => {
		const fake = makeEditor(["  alpha beta", "(gamma)", "delta"]);
		let state: VimState = initialVimState();
		const controller = createVimController(fake.editor, (next) => (state = next));
		controller.toggle();

		fake.emit("^");
		expect(fake.position).toEqual(position(1, 3));
		fake.emit("e");
		expect(fake.position).toEqual(position(1, 7));
		fake.emit("f");
		fake.emit("b");
		expect(fake.position).toEqual(position(1, 9));
		const counted = makeEditor(["a b c d"]);
		const countedController = createVimController(counted.editor, () => {});
		countedController.toggle();
		counted.emit("2");
		counted.emit("t");
		counted.emit(" ");
		expect(counted.position).toEqual(position(1, 3));
		countedController.dispose();
		fake.emit("G");
		expect(fake.position.lineNumber).toBe(3);
		const viewport = makeEditor(Array.from({ length: 20 }, (_, index) => `line ${index}`));
		const viewportController = createVimController(viewport.editor, () => {});
		viewportController.toggle();
		viewport.emit("G");
		viewport.emit("z");
		viewport.emit("b");
		expect(viewport.scrollTop).toBeGreaterThan(0);
		viewportController.dispose();
		fake.emit("g");
		fake.emit("g");
		expect(fake.position.lineNumber).toBe(1);

		fake.emit("m");
		fake.emit("a");
		fake.emit("G");
		fake.emit("`");
		fake.emit("a");
		expect(fake.position.lineNumber).toBe(1);

		fake.emit("V");
		expect(state.visualMode).toBe("line");
		fake.emit("a", false, true);
		expect(state.mode).toBe("visual");
		fake.emit("Escape");
		fake.emit("v");
		expect(state.visualMode).toBe("character");
		fake.emit("Escape");
		fake.emit("v");
		fake.emit("V", true);
		expect(state.visualMode).toBe("line");
		fake.emit("Escape");
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
