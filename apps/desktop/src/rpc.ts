import type { NativeUpdateState, NativeWindowState } from "@thinkrail/contracts";
import type { PageZoomAction } from "./pageZoom";
import type { WindowChromeGeometry } from "./windowChrome";

export type DesktopRpc = {
	bun: {
		requests: {
			getUpdateState: { params: undefined; response: NativeUpdateState };
			getWindowState: { params: undefined; response: NativeWindowState };
			minimizeWindow: { params: undefined; response: undefined };
			toggleMaximizeWindow: { params: undefined; response: undefined };
			closeWindow: { params: undefined; response: undefined };
			checkForUpdates: { params: undefined; response: undefined };
			downloadUpdate: { params: undefined; response: undefined };
			restartToUpdate: { params: undefined; response: undefined };
		};
		messages: {
			routeChanged: { hash: string };
			preferenceWrite: { key: string; value: string };
			preferenceRemove: { key: string };
			titleBarDoubleClick: undefined;
			pageZoomRequested: { action: PageZoomAction };
		};
	};
	webview: {
		requests: Record<string, never>;
		messages: {
			updateStateChanged: NativeUpdateState;
			windowChromeChanged: WindowChromeGeometry;
			windowStateChanged: NativeWindowState;
		};
	};
};
