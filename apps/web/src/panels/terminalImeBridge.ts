export interface ImeInputEventLike {
	readonly inputType: string;
	readonly data: string | null;
	stopPropagation(): void;
}

export interface ImeKeyEventLike {
	readonly key: string;
	readonly keyCode: number;
	readonly ctrlKey: boolean;
	readonly altKey: boolean;
	readonly metaKey: boolean;
	stopPropagation(): void;
}

export interface TerminalImeBridge {
	readonly pending: string;
	input(event: ImeInputEventLike): void;
	keydown(event: ImeKeyEventLike): void;
	compositionstart(): void;
	flush(): void;
}

const IME_SENTINEL_KEYCODE = 229;
const BACKSPACE_KEYCODE = 8;
const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock"]);

const isHangulCodePoint = (text: string): boolean => {
	const codePoints = [...text];
	if (codePoints.length !== 1) return false;
	const cp = codePoints[0]?.codePointAt(0) ?? 0;
	return (
		(cp >= 0x1100 && cp <= 0x11ff) ||
		(cp >= 0x3130 && cp <= 0x318f) ||
		(cp >= 0xa960 && cp <= 0xa97f) ||
		(cp >= 0xac00 && cp <= 0xd7ff)
	);
};

export function createTerminalImeBridge(send: (data: string) => void): TerminalImeBridge {
	let pending = "";
	let replacementModelSeen = false;

	const flush = (): void => {
		if (pending === "") return;
		const text = pending;
		pending = "";
		send(text);
	};

	return {
		get pending() {
			return pending;
		},
		flush,
		compositionstart: flush,
		input(event) {
			const data = event.data;
			if (!data) return;
			if (event.inputType === "insertReplacementText") {
				if (pending === "") return;
				replacementModelSeen = true;
				pending = data;
				event.stopPropagation();
				return;
			}
			if (event.inputType !== "insertText") return;
			flush();
			if (!isHangulCodePoint(data)) return;
			replacementModelSeen = true;
			pending = data;
			event.stopPropagation();
		},
		keydown(event) {
			if (event.keyCode === IME_SENTINEL_KEYCODE) {
				const chord = event.ctrlKey || event.altKey || event.metaKey || event.key === "Escape";
				if (replacementModelSeen && !chord) event.stopPropagation();
				return;
			}
			if (MODIFIER_KEYS.has(event.key)) return;
			if (event.keyCode === BACKSPACE_KEYCODE && pending !== "") {
				pending = "";
				event.stopPropagation();
				return;
			}
			flush();
		},
	};
}
