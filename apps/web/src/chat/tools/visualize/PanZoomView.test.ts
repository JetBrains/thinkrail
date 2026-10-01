import { expect, test } from "bun:test";
import { installPanZoomGestures } from "./PanZoomView";

function gestureEvent(type: string, scale?: number): Event {
	const event = new Event(type, { cancelable: true });
	if (scale !== undefined) Object.defineProperty(event, "scale", { value: scale });
	return event;
}

test("claims WebKit pinch gestures and scales from the local zoom at gesture start", () => {
	const target = new EventTarget();
	const writes: number[] = [];
	let scale = 2;
	const remove = installPanZoomGestures(target, {
		getScale: () => scale,
		setScale: (next) => {
			scale = next;
			writes.push(next);
		},
	});
	const start = gestureEvent("gesturestart");
	const shrink = gestureEvent("gesturechange", 0.75);
	const growPastLimit = gestureEvent("gesturechange", 3);
	const end = gestureEvent("gestureend");

	target.dispatchEvent(start);
	target.dispatchEvent(shrink);
	target.dispatchEvent(growPastLimit);
	target.dispatchEvent(end);

	expect(writes).toEqual([1.5, 5]);
	expect([
		start.defaultPrevented,
		shrink.defaultPrevented,
		growPastLimit.defaultPrevented,
		end.defaultPrevented,
	]).toEqual([true, true, true, true]);
	remove();
});
