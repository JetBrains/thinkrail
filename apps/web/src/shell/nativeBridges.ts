export function hasNativeMessageBridge(global: object): boolean {
	const webkit = Reflect.get(global, "webkit");
	const chrome = Reflect.get(global, "chrome");
	return (
		Reflect.has(global, "__electrobunWebviewId") ||
		(typeof webkit === "object" && webkit !== null && Reflect.has(webkit, "messageHandlers")) ||
		(typeof chrome === "object" && chrome !== null && Reflect.has(chrome, "webview"))
	);
}
