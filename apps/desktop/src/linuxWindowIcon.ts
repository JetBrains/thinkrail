import { dlopen, FFIType, type Pointer } from "bun:ffi";

export interface LinuxWindowIconApi {
	setWindowIcon(window: Pointer | bigint, iconPath: string): void;
}

export function loadLinuxWindowIconApi(nativeWrapperPath: string): LinuxWindowIconApi {
	const library = dlopen(nativeWrapperPath, {
		setWindowIcon: { args: [FFIType.ptr, FFIType.cstring], returns: FFIType.void },
	});
	return {
		setWindowIcon: (window, iconPath) =>
			library.symbols.setWindowIcon(window, Buffer.from(`${iconPath}\0`)),
	};
}
