import { expect, test } from "bun:test";
import { installLinuxTitleBarDoubleClick } from "./linuxTitleBar";

test("Linux handles the native second press before Electrobun can begin another move", () => {
	let listener: EventListener | undefined;
	let registration: unknown;
	let sends = 0;
	let region = "drag";
	installLinuxTitleBarDoubleClick(
		{
			addEventListener(type, callback, options) {
				registration = { type, options };
				if (typeof callback === "function") listener = callback;
			},
		},
		() => sends++,
		() => ({ getPropertyValue: () => region }),
	);
	expect(registration).toEqual({ type: "mousedown", options: { capture: true } });
	const press = (detail: number, button = 0, prevented = false) => {
		const event = new Event("mousedown", { cancelable: true });
		Object.defineProperty(event, "target", { value: { nodeType: 1 } });
		Object.assign(event, { detail, button });
		if (prevented) event.preventDefault();
		let stopped = false;
		event.stopImmediatePropagation = () => {
			stopped = true;
		};
		listener?.(event);
		return { prevented: event.defaultPrevented, stopped };
	};
	expect(press(1)).toEqual({ prevented: false, stopped: false });
	expect(press(2)).toEqual({ prevented: true, stopped: true });
	expect(sends).toBe(1);
	expect(press(3)).toEqual({ prevented: false, stopped: false });
	expect(press(2, 2)).toEqual({ prevented: false, stopped: false });
	expect(press(2, 0, true)).toEqual({ prevented: true, stopped: false });
	region = "no-drag";
	expect(press(2)).toEqual({ prevented: false, stopped: false });
	expect(sends).toBe(1);
});
