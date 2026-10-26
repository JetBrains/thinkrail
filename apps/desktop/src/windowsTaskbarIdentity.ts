import { dlopen, FFIType, type Pointer, read } from "bun:ffi";
import { windowsFileIdentity } from "@thinkrail/shared/windowsIdentity";

export function desktopAppUserModelId(channel: string): string {
	const { productName } = windowsFileIdentity({ version: "0.0.0", channel });
	return `JetBrains.${productName.replaceAll(" ", ".")}`;
}

export interface WindowsShellApi {
	setProcessAppUserModelId(id: string): void;
	processAppUserModelId(): string | null;
}

function wide(text: string): Buffer {
	return Buffer.from(`${text}\0`, "utf16le");
}

function readWide(pointer: Pointer | bigint): string {
	let text = "";
	for (let offset = 0; ; offset += 2) {
		const unit = read.u16(pointer, offset);
		if (unit === 0) return text;
		text += String.fromCharCode(unit);
	}
}

function check(hresult: number, call: string): void {
	if (hresult < 0) throw new Error(`${call} failed with HRESULT 0x${(hresult >>> 0).toString(16)}`);
}

let cachedWindowsShellApi: WindowsShellApi | undefined;

export function loadWindowsShellApi(): WindowsShellApi {
	if (cachedWindowsShellApi) return cachedWindowsShellApi;
	const shell32 = dlopen("shell32.dll", {
		SetCurrentProcessExplicitAppUserModelID: { args: [FFIType.ptr], returns: FFIType.i32 },
		GetCurrentProcessExplicitAppUserModelID: { args: [FFIType.ptr], returns: FFIType.i32 },
	});
	const ole32 = dlopen("ole32.dll", {
		CoTaskMemFree: { args: [FFIType.ptr], returns: FFIType.void },
	});
	cachedWindowsShellApi = {
		setProcessAppUserModelId: (id) =>
			check(
				shell32.symbols.SetCurrentProcessExplicitAppUserModelID(wide(id)),
				"SetCurrentProcessExplicitAppUserModelID",
			),
		processAppUserModelId: () => {
			const out = new BigUint64Array(1);
			if (shell32.symbols.GetCurrentProcessExplicitAppUserModelID(out) < 0) return null;
			const [pointer = 0n] = out;
			try {
				return readWide(pointer);
			} finally {
				ole32.symbols.CoTaskMemFree(pointer);
			}
		},
	};
	return cachedWindowsShellApi;
}
