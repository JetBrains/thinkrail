import { CFunction, dlopen, FFIType, type Pointer, ptr, read } from "bun:ffi";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, win32 } from "node:path";
import { windowsFileIdentity } from "@thinkrail/shared/windowsIdentity";

export function desktopAppUserModelId(channel: string): string {
	const { productName } = windowsFileIdentity({ version: "0.0.0", channel });
	return `JetBrains.${productName.replaceAll(" ", ".")}`;
}

export interface WindowsShortcut {
	target(): string | null;
	appUserModelId(): string | null;
	setAppUserModelId(id: string): void;
	close(): void;
}

export interface WindowsShellApi {
	setProcessAppUserModelId(id: string): void;
	processAppUserModelId(): string | null;
	openShortcut(path: string): WindowsShortcut;
}

const ELECTROBUN_UNINSTALL_MANIFEST = ".electrobun-uninstall.json";

function hasCode(error: unknown, code: string): boolean {
	return error instanceof Error && "code" in error && error.code === code;
}

export function taskbarShortcutCandidates(appDir: string, appData: string | undefined): string[] {
	const candidates: string[] = [];
	try {
		const manifest: unknown = JSON.parse(
			readFileSync(join(dirname(appDir), ELECTROBUN_UNINSTALL_MANIFEST), "utf8"),
		);
		if (
			manifest &&
			typeof manifest === "object" &&
			"schema_version" in manifest &&
			manifest.schema_version === 1
		) {
			const startMenu = "start_menu_shortcut" in manifest ? manifest.start_menu_shortcut : null;
			const desktop = "desktop_shortcut" in manifest ? manifest.desktop_shortcut : null;
			for (const path of [startMenu, desktop]) {
				if (typeof path === "string" && path) candidates.push(path);
			}
		}
	} catch (error) {
		if (!hasCode(error, "ENOENT")) throw error;
	}
	if (appData) {
		const pinned = join(
			appData,
			"Microsoft",
			"Internet Explorer",
			"Quick Launch",
			"User Pinned",
			"TaskBar",
		);
		try {
			for (const name of readdirSync(pinned)) {
				if (name.toLowerCase().endsWith(".lnk")) candidates.push(join(pinned, name));
			}
		} catch (error) {
			if (!hasCode(error, "ENOENT")) throw error;
		}
	}
	return candidates;
}

function sameWindowsPath(left: string, right: string): boolean {
	return win32.normalize(left).toLowerCase() === win32.normalize(right).toLowerCase();
}

export function stampTaskbarShortcuts(
	candidates: readonly string[],
	launcher: string,
	id: string,
	openShortcut: (path: string) => WindowsShortcut,
): { stamped: string[]; failures: unknown[] } {
	const stamped: string[] = [];
	const failures: unknown[] = [];
	for (const path of candidates) {
		if (!existsSync(path)) continue;
		try {
			const shortcut = openShortcut(path);
			try {
				const target = shortcut.target();
				if (!target || !sameWindowsPath(target, launcher)) continue;
				if (shortcut.appUserModelId() === id) continue;
				shortcut.setAppUserModelId(id);
				stamped.push(path);
			} finally {
				shortcut.close();
			}
		} catch (error) {
			failures.push(error);
		}
	}
	return { stamped, failures };
}

type ComPointer = Pointer | bigint;

const CLSCTX_INPROC_SERVER = 0x1;
const COINIT_APARTMENTTHREADED = 0x2;
const STGM_READWRITE = 0x2;
const VT_LPWSTR = 31;
const PATH_CHARACTERS = 1024;
const SHCNE_UPDATEITEM = 0x2000;
const SHCNF_PATHW = 0x5;

const QUERY_INTERFACE = 0;
const RELEASE = 2;
const SHELL_LINK_GET_PATH = 3;
const PERSIST_FILE_LOAD = 5;
const PERSIST_FILE_SAVE = 6;
const PROPERTY_STORE_GET_VALUE = 5;
const PROPERTY_STORE_SET_VALUE = 6;
const PROPERTY_STORE_COMMIT = 7;

function guid(text: string): Buffer {
	const hex = text.replaceAll("-", "");
	const bytes = Buffer.alloc(16);
	bytes.writeUInt32LE(Number.parseInt(hex.slice(0, 8), 16), 0);
	bytes.writeUInt16LE(Number.parseInt(hex.slice(8, 12), 16), 4);
	bytes.writeUInt16LE(Number.parseInt(hex.slice(12, 16), 16), 6);
	Buffer.from(hex.slice(16), "hex").copy(bytes, 8);
	return bytes;
}

const CLSID_SHELL_LINK = guid("00021401-0000-0000-C000-000000000046");
const IID_SHELL_LINK_W = guid("000214F9-0000-0000-C000-000000000046");
const IID_PERSIST_FILE = guid("0000010B-0000-0000-C000-000000000046");
const IID_PROPERTY_STORE = guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
const PKEY_APP_USER_MODEL_ID = Buffer.concat([
	guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),
	Buffer.from([5, 0, 0, 0]),
]);

function wide(text: string): Buffer {
	return Buffer.from(`${text}\0`, "utf16le");
}

function readWide(pointer: ComPointer): string {
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

function comMethod(object: ComPointer, index: number, args: FFIType[]) {
	const method = BigInt(read.ptr(read.ptr(object, 0), index * 8));
	return CFunction({ ptr: method, args: [FFIType.ptr, ...args], returns: FFIType.i32 });
}

function release(object: ComPointer): void {
	comMethod(object, RELEASE, [])(object);
}

function queryInterface(object: ComPointer, iid: Buffer, call: string): bigint {
	const out = new BigUint64Array(1);
	check(comMethod(object, QUERY_INTERFACE, [FFIType.ptr, FFIType.ptr])(object, iid, out), call);
	return out[0] ?? 0n;
}

let cachedWindowsShellApi: WindowsShellApi | undefined;

export function loadWindowsShellApi(): WindowsShellApi {
	if (cachedWindowsShellApi) return cachedWindowsShellApi;
	const shell32 = dlopen("shell32.dll", {
		SetCurrentProcessExplicitAppUserModelID: { args: [FFIType.ptr], returns: FFIType.i32 },
		GetCurrentProcessExplicitAppUserModelID: { args: [FFIType.ptr], returns: FFIType.i32 },
		SHChangeNotify: {
			args: [FFIType.i32, FFIType.u32, FFIType.ptr, FFIType.ptr],
			returns: FFIType.void,
		},
	});
	const ole32 = dlopen("ole32.dll", {
		CoInitializeEx: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
		CoCreateInstance: {
			args: [FFIType.ptr, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr],
			returns: FFIType.i32,
		},
		CoTaskMemFree: { args: [FFIType.ptr], returns: FFIType.void },
		PropVariantClear: { args: [FFIType.ptr], returns: FFIType.i32 },
	});
	ole32.symbols.CoInitializeEx(null, COINIT_APARTMENTTHREADED);

	function openShortcut(path: string): WindowsShortcut {
		const out = new BigUint64Array(1);
		check(
			ole32.symbols.CoCreateInstance(
				CLSID_SHELL_LINK,
				null,
				CLSCTX_INPROC_SERVER,
				IID_SHELL_LINK_W,
				out,
			),
			"CoCreateInstance(ShellLink)",
		);
		const link = out[0] ?? 0n;
		const opened: bigint[] = [link];
		try {
			const file = queryInterface(link, IID_PERSIST_FILE, "QueryInterface(IPersistFile)");
			opened.push(file);
			check(
				comMethod(file, PERSIST_FILE_LOAD, [FFIType.ptr, FFIType.u32])(
					file,
					wide(path),
					STGM_READWRITE,
				),
				"IPersistFile::Load",
			);
			const store = queryInterface(link, IID_PROPERTY_STORE, "QueryInterface(IPropertyStore)");
			opened.push(store);
			return {
				target: () => {
					const buffer = Buffer.alloc(PATH_CHARACTERS * 2);
					const result = comMethod(link, SHELL_LINK_GET_PATH, [
						FFIType.ptr,
						FFIType.i32,
						FFIType.ptr,
						FFIType.u32,
					])(link, buffer, PATH_CHARACTERS, null, 0);
					check(result, "IShellLinkW::GetPath");
					const text = buffer.toString("utf16le");
					const end = text.indexOf("\0");
					return result === 0 ? text.slice(0, end === -1 ? text.length : end) : null;
				},
				appUserModelId: () => {
					const variant = new BigUint64Array(3);
					check(
						comMethod(store, PROPERTY_STORE_GET_VALUE, [FFIType.ptr, FFIType.ptr])(
							store,
							PKEY_APP_USER_MODEL_ID,
							variant,
						),
						"IPropertyStore::GetValue",
					);
					try {
						const type = new DataView(variant.buffer).getUint16(0, true);
						return type === VT_LPWSTR && variant[1] ? readWide(variant[1]) : null;
					} finally {
						ole32.symbols.PropVariantClear(variant);
					}
				},
				setAppUserModelId: (id) => {
					const value = wide(id);
					const variant = new BigUint64Array(3);
					new DataView(variant.buffer).setUint16(0, VT_LPWSTR, true);
					variant[1] = BigInt(ptr(value));
					check(
						comMethod(store, PROPERTY_STORE_SET_VALUE, [FFIType.ptr, FFIType.ptr])(
							store,
							PKEY_APP_USER_MODEL_ID,
							variant,
						),
						"IPropertyStore::SetValue",
					);
					check(comMethod(store, PROPERTY_STORE_COMMIT, [])(store), "IPropertyStore::Commit");
					check(
						comMethod(file, PERSIST_FILE_SAVE, [FFIType.ptr, FFIType.i32])(file, null, 1),
						"IPersistFile::Save",
					);
					shell32.symbols.SHChangeNotify(SHCNE_UPDATEITEM, SHCNF_PATHW, wide(path), null);
				},
				close: () => {
					for (const object of opened.reverse()) release(object);
				},
			};
		} catch (error) {
			for (const object of opened.reverse()) release(object);
			throw error;
		}
	}

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
		openShortcut,
	};
	return cachedWindowsShellApi;
}
