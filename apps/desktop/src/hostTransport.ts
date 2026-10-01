const LOOPBACK_HOST_SOCKET_GLOBALS = [
	"__electrobunHostSocketPort",
	"__electrobunRpcSocketPort",
] as const;

export function usesNativeHostBridge(platform: NodeJS.Platform): boolean {
	return platform === "win32";
}

export function preferNativeHostBridge(preloadSource: string): string {
	const names = JSON.stringify(LOOPBACK_HOST_SOCKET_GLOBALS);
	return `for (const name of ${names}) Reflect.deleteProperty(globalThis, name);\n${preloadSource}`;
}
