import type { NativeUpdateState, NativeWindowAppearance } from "@thinkrail/contracts";
import type { WindowChromeGeometry } from "./windowChrome";

export type DesktopRpc = {
	bun: {
		requests: {
			getUpdateState: { params: undefined; response: NativeUpdateState };
			checkForUpdates: { params: undefined; response: undefined };
			restartToUpdate: { params: undefined; response: undefined };
		};
		messages: {
			windowAppearanceChanged: NativeWindowAppearance;
			routeChanged: { hash: string };
			preferenceWrite: { key: string; value: string };
			preferenceRemove: { key: string };
		};
	};
	webview: {
		requests: Record<string, never>;
		messages: {
			updateStateChanged: NativeUpdateState;
			windowChromeChanged: WindowChromeGeometry;
		};
	};
};
