import type { DesktopResizeEdge, DesktopWindowChromePlatform } from "./windowChrome";

export type DesktopRpc = {
	bun: {
		requests: Record<string, never>;
		messages: {
			routeChanged: { hash: string };
			preferenceWrite: { key: string; value: string };
			preferenceRemove: { key: string };
			windowChromeMinimize: Record<string, never>;
			windowChromeToggleMaximize: Record<string, never>;
			windowChromeRequestClose: Record<string, never>;
			windowChromeStartResize: { edge: DesktopResizeEdge };
			windowChromeReady: { platform: DesktopWindowChromePlatform };
		};
	};
	webview: {
		requests: Record<string, never>;
		messages: {
			windowChromeState: { maximized: boolean };
		};
	};
};
