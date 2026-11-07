import { dlopen, FFIType, ptr } from "bun:ffi";
import type { SystemProxyInfo } from "@thinkrail/contracts";

const HKEY_CURRENT_USER = 0x80000001n;
const INTERNET_SETTINGS_SUBKEY = "Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
const RRF_RT_REG_SZ = 0x00000002;
const RRF_RT_REG_DWORD = 0x00000010;
const ERROR_SUCCESS = 0;

/** Windows excludes the loopback interface from the proxy by default. */
const DEFAULT_LOOPBACK = ["localhost", "127.0.0.1"];

export interface WindowsInternetSettings {
	proxyEnable: number;
	proxyServer: string;
	proxyOverride: string;
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

function regGetValue(valueName: string, flags: number): Buffer | null {
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
	if (result !== ERROR_SUCCESS || size[0] === 0) return null;
	const data = Buffer.alloc(size[0]);
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

function readRegistryDword(valueName: string): number | null {
	const data = regGetValue(valueName, RRF_RT_REG_DWORD);
	return data ? data.readUInt32LE(0) : null;
}

function readRegistryString(valueName: string): string | null {
	const data = regGetValue(valueName, RRF_RT_REG_SZ);
	return data ? data.toString("utf16le").replace(/\0+$/, "") : null;
}

function readInternetSettings(): WindowsInternetSettings | null {
	try {
		const proxyEnable = readRegistryDword("ProxyEnable");
		if (proxyEnable === null) return null;
		return {
			proxyEnable,
			proxyServer: readRegistryString("ProxyServer") ?? "",
			proxyOverride: readRegistryString("ProxyOverride") ?? "",
		};
	} catch {
		return null;
	}
}

function normalizeProxyTarget(raw: string): string | null {
	const candidate = raw.trim();
	if (!candidate || candidate.toLowerCase().startsWith("socks")) return null;
	const hostPort = candidate.replace(/^https?:\/\//i, "").replace(/^https?=/i, "");
	const match = /^([^:/\s]+):(\d{1,5})$/.exec(hostPort);
	if (!match) return null;
	const port = Number(match[2]);
	if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
	return `http://${match[1]}:${port}`;
}

function parseBypass(proxyOverride: string): string[] {
	const result: string[] = [];
	for (const entry of proxyOverride.split(";")) {
		const cleaned = entry.trim().replace(/^https?:\/\//i, "");
		if (!cleaned || cleaned === "<local>") continue;
		result.push(cleaned);
	}
	return result;
}

/**
 * Resolve raw `ProxyEnable`/`ProxyServer`/`ProxyOverride` registry values into separate HTTP
 * and HTTPS targets plus the bypass list. A bare `host:port` serves both protocols.
 */
export function proxyInfoFromSettings(settings: WindowsInternetSettings): SystemProxyInfo {
	if (settings.proxyEnable === 0) {
		return { httpProxy: null, httpsProxy: null, noProxy: [] };
	}
	let httpProxy: string | null = null;
	let httpsProxy: string | null = null;
	for (const segment of settings.proxyServer.split(";")) {
		const selector = /^(https?)=(.+)$/i.exec(segment.trim());
		if (selector) {
			const target = normalizeProxyTarget(selector[2]);
			if (!target) continue;
			if (selector[1].toLowerCase() === "https") httpsProxy = target;
			else httpProxy = target;
		} else {
			httpProxy ??= normalizeProxyTarget(segment);
		}
	}
	httpsProxy ??= httpProxy;
	return {
		httpProxy,
		httpsProxy,
		noProxy: [...DEFAULT_LOOPBACK, ...parseBypass(settings.proxyOverride)],
	};
}

/** Read the operating system proxy. Windows-only in this change; other platforms report none. */
export function readSystemProxy(platform: string = process.platform): SystemProxyInfo | null {
	if (platform !== "win32") return null;
	const settings = readInternetSettings();
	return settings ? proxyInfoFromSettings(settings) : null;
}
