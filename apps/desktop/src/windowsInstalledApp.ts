import { dlopen, FFIType } from "bun:ffi";
import type { ElectrobunInstall } from "./electrobunInstall";

const UNINSTALL_ROOT = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall";

export function installedAppKey(install: ElectrobunInstall): string {
	return `${UNINSTALL_ROOT}\\${install.identifier}.${install.channel}`;
}

export interface WindowsRegistryApi {
	readString(subKey: string, name: string): string | null;
	writeString(subKey: string, name: string, value: string): void;
}

export function stampInstalledAppPublisher(
	subKey: string,
	publisher: string,
	registry: WindowsRegistryApi,
): boolean {
	if (registry.readString(subKey, "DisplayName") === null) return false;
	if (registry.readString(subKey, "Publisher") === publisher) return false;
	registry.writeString(subKey, "Publisher", publisher);
	return true;
}

const HKEY_CURRENT_USER = 0xffffffff80000001n;
const REG_SZ = 1;
const RRF_RT_REG_SZ = 0x2;
const ERROR_SUCCESS = 0;
const ERROR_FILE_NOT_FOUND = 2;
const VALUE_BYTES = 2048;

function wide(text: string): Buffer {
	return Buffer.from(`${text}\0`, "utf16le");
}

function win32Error(call: string, status: number): Error {
	return Object.assign(new Error(`${call} failed with Win32 error ${status}`), {
		code: `WIN32_${status}`,
	});
}

let cachedWindowsRegistryApi: WindowsRegistryApi | undefined;

export function loadWindowsRegistryApi(): WindowsRegistryApi {
	if (cachedWindowsRegistryApi) return cachedWindowsRegistryApi;
	const advapi32 = dlopen("advapi32.dll", {
		RegGetValueW: {
			args: [
				FFIType.ptr,
				FFIType.ptr,
				FFIType.ptr,
				FFIType.u32,
				FFIType.ptr,
				FFIType.ptr,
				FFIType.ptr,
			],
			returns: FFIType.i32,
		},
		RegSetKeyValueW: {
			args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32],
			returns: FFIType.i32,
		},
	});
	cachedWindowsRegistryApi = {
		readString: (subKey, name) => {
			const data = Buffer.alloc(VALUE_BYTES);
			const size = new Uint32Array([VALUE_BYTES]);
			const status = advapi32.symbols.RegGetValueW(
				HKEY_CURRENT_USER,
				wide(subKey),
				wide(name),
				RRF_RT_REG_SZ,
				null,
				data,
				size,
			);
			if (status === ERROR_FILE_NOT_FOUND) return null;
			if (status !== ERROR_SUCCESS) throw win32Error("RegGetValueW", status);
			const text = data.toString("utf16le", 0, size[0] ?? 0);
			const end = text.indexOf("\0");
			return end === -1 ? text : text.slice(0, end);
		},
		writeString: (subKey, name, value) => {
			const data = wide(value);
			const status = advapi32.symbols.RegSetKeyValueW(
				HKEY_CURRENT_USER,
				wide(subKey),
				wide(name),
				REG_SZ,
				data,
				data.length,
			);
			if (status !== ERROR_SUCCESS) throw win32Error("RegSetKeyValueW", status);
		},
	};
	return cachedWindowsRegistryApi;
}
