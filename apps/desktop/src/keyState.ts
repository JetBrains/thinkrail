import { dlopen, FFIType } from "bun:ffi";

export interface KeyState {
	keyDown: boolean;
	downKeys: number[];
	cmdDown: boolean;
	mouseAfterKey: boolean;
	keyAfterModifiers: boolean;
}

const HID_SYSTEM_STATE = 1;
const LAST_KEYCODE = 127;
const FIRST_MODIFIER_KEYCODE = 54;
const LAST_MODIFIER_KEYCODE = 63;
const KEY_DOWN_EVENT = 10;
const LEFT_MOUSE_UP_EVENT = 2;
const FLAGS_CHANGED_EVENT = 12;
const COMMAND_FLAG = 0x100000n;
const CORE_GRAPHICS = "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics";

function openCoreGraphics() {
	return dlopen(CORE_GRAPHICS, {
		CGEventSourceKeyState: { args: [FFIType.i32, FFIType.u16], returns: FFIType.bool },
		CGEventSourceFlagsState: { args: [FFIType.i32], returns: FFIType.u64 },
		CGEventSourceSecondsSinceLastEventType: {
			args: [FFIType.i32, FFIType.u32],
			returns: FFIType.f64,
		},
	});
}

export interface KeySample {
	isKeyDown(keycode: number): boolean;
	flags: bigint;
	sinceMouseUp: number;
	sinceKeyDown: number;
	sinceFlagsChanged: number;
}

export function decodeKeyState(sample: KeySample): KeyState {
	const downKeys: number[] = [];
	for (let keycode = 0; keycode <= LAST_KEYCODE; keycode += 1) {
		if (keycode >= FIRST_MODIFIER_KEYCODE && keycode <= LAST_MODIFIER_KEYCODE) continue;
		if (sample.isKeyDown(keycode)) downKeys.push(keycode);
	}
	return {
		keyDown: downKeys.length > 0,
		downKeys,
		cmdDown: (sample.flags & COMMAND_FLAG) !== 0n,
		mouseAfterKey: sample.sinceMouseUp < sample.sinceKeyDown,
		keyAfterModifiers: sample.sinceKeyDown < sample.sinceFlagsChanged,
	};
}

export function createKeyStateReader(platform: NodeJS.Platform) {
	let library: ReturnType<typeof openCoreGraphics> | null = null;
	let unavailable = platform !== "darwin";
	return (): KeyState | null => {
		if (unavailable) return null;
		try {
			library ??= openCoreGraphics();
			const cg = library.symbols;
			return decodeKeyState({
				isKeyDown: (keycode) => cg.CGEventSourceKeyState(HID_SYSTEM_STATE, keycode),
				flags: BigInt(cg.CGEventSourceFlagsState(HID_SYSTEM_STATE)),
				sinceMouseUp: cg.CGEventSourceSecondsSinceLastEventType(
					HID_SYSTEM_STATE,
					LEFT_MOUSE_UP_EVENT,
				),
				sinceKeyDown: cg.CGEventSourceSecondsSinceLastEventType(HID_SYSTEM_STATE, KEY_DOWN_EVENT),
				sinceFlagsChanged: cg.CGEventSourceSecondsSinceLastEventType(
					HID_SYSTEM_STATE,
					FLAGS_CHANGED_EVENT,
				),
			});
		} catch (error) {
			unavailable = true;
			console.error("[desktop] could not read keyboard state", error);
			return null;
		}
	};
}
