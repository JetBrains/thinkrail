import { dlopen, FFIType, ptr } from "bun:ffi";

const HKEY_CURRENT_USER = 0x80000001n;
const INTERNET_SETTINGS_SUBKEY = "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
const RRF_RT_REG_SZ = 0x00000002;
const RRF_RT_REG_DWORD = 0x00000010;
const ERROR_SUCCESS = 0;

export interface WindowsInternetSettings {
	proxyEnable: number;
	proxyServer: string;
}

function wide(text: string): Buffer {
	return Buffer.from(`${text}\0`, "utf16le");
}

let cachedAdvapi32: ReturnType<typeof dlopen> | undefined;

function advapi32() {
	if (!cachedAdvapi32) {
		cachedAdvapi32 = dlopen("advapi32.dll", {
			RegGetValueW: {
				args: [
					FFIType.u64,
					FFIType.ptr,
					FFIType.ptr,
					FFIType.u32,
					FFIType.ptr,
					FFIType.ptr,
					FFIType.ptr,
				],
				returns: FFIType.i32,
			},
		});
	}
	return cachedAdvapi32;
}

function regGetValue(valueName: string, flags: number, byteSize: number): Buffer | null {
	const size = new Uint32Array(1);
	const result = advapi32().symbols.RegGetValueW(
		HKEY_CURRENT_USER,
		ptr(wide(INTERNET_SETTINGS_SUBKEY)),
		ptr(wide(valueName)),
		flags,
		null,
		null,
		ptr(size),
	);
	if (result !== ERROR_SUCCESS) return null;
	size[0] = byteSize;
	const data = Buffer.alloc(byteSize);
	const readResult = advapi32().symbols.RegGetValueW(
		HKEY_CURRENT_USER,
		ptr(wide(INTERNET_SETTINGS_SUBKEY)),
		ptr(wide(valueName)),
		flags,
		null,
		ptr(data),
		ptr(size),
	);
	if (readResult !== ERROR_SUCCESS) return null;
	return data;
}

function readInternetSettings(): WindowsInternetSettings | null {
	try {
		const proxyEnable = regGetValue("ProxyEnable", RRF_RT_REG_DWORD, 4);
		if (!proxyEnable) return null;
		const proxyServer = regGetValue("ProxyServer", RRF_RT_REG_SZ, 4096);
		if (!proxyServer) return null;
		return {
			proxyEnable: proxyEnable.readUInt32LE(0),
			proxyServer: proxyServer.toString("utf16le").replace(/\0+$/, ""),
		};
	} catch {
		return null;
	}
}

/** Turn raw `ProxyEnable`/`ProxyServer` registry values into a single `http://` proxy URL. */
export function proxyUrlFromSettings(settings: WindowsInternetSettings): string | null {
	if (settings.proxyEnable === 0) return null;
	const server = settings.proxyServer.trim();
	if (!server) return null;
	const segments = server.split(";");
	const httpSegment = segments.find((segment) => /^http=/i.test(segment.trim()));
	const candidate = (httpSegment ?? segments[0]).replace(/^http=/i, "").trim();
	if (!candidate || candidate.startsWith("socks=")) return null;
	const hostPort = candidate.replace(/^https?:\/\//i, "");
	if (!/^[^\s:]+:\d+$/.test(hostPort)) return null;
	return `http://${hostPort}`;
}

/** Read the operating system proxy. Windows-only in this change; other platforms report none. */
export function readSystemProxy(platform: string = process.platform): string | null {
	if (platform !== "win32") return null;
	const settings = readInternetSettings();
	return settings ? proxyUrlFromSettings(settings) : null;
}
