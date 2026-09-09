import type { WindowChromeGeometry } from "./windowChrome";

export type DesktopRpc = {
	bun: {
		requests: Record<string, never>;
		messages: {
			routeChanged: { hash: string };
			preferenceWrite: { key: string; value: string };
			preferenceRemove: { key: string };
		};
	};
	webview: {
		requests: Record<string, never>;
		messages: {
			windowChromeChanged: WindowChromeGeometry;
		};
	};
};
