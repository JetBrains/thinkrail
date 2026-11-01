import { isImeComposing } from "./ime";

export const DOUBLE_SHIFT = { stepMs: 300, otherKeyGuardMs: 100 } as const;

export type DoubleShiftKeyEvent = Pick<
	KeyboardEvent,
	"key" | "repeat" | "isComposing" | "keyCode" | "ctrlKey" | "metaKey" | "altKey"
>;

export interface DoubleShiftDetector {
	keydown(event: DoubleShiftKeyEvent): void;
	keyup(event: DoubleShiftKeyEvent): boolean;
	reset(): void;
}

export function createDoubleShiftDetector(
	now: () => number = () => performance.now(),
): DoubleShiftDetector {
	let stage: 0 | 1 | 2 | 3 = 0;
	let at = 0;
	let lastOtherKeyAt = Number.NEGATIVE_INFINITY;

	const otherModifier = (event: DoubleShiftKeyEvent) =>
		event.ctrlKey || event.metaKey || event.altKey;

	return {
		keydown(event) {
			const time = now();
			if (event.key !== "Shift" || isImeComposing(event) || otherModifier(event)) {
				lastOtherKeyAt = time;
				stage = 0;
				return;
			}
			if (event.repeat) {
				stage = 0;
				return;
			}
			if (stage === 2 && time - at <= DOUBLE_SHIFT.stepMs) {
				stage = 3;
				at = time;
				return;
			}
			stage = time - lastOtherKeyAt > DOUBLE_SHIFT.otherKeyGuardMs ? 1 : 0;
			at = time;
		},
		keyup(event) {
			if (event.key !== "Shift") return false;
			const time = now();
			const withinStep = time - at <= DOUBLE_SHIFT.stepMs;
			if (stage === 1 && withinStep) {
				stage = 2;
				at = time;
				return false;
			}
			const fired = stage === 3 && withinStep;
			stage = 0;
			return fired;
		},
		reset() {
			stage = 0;
		},
	};
}
