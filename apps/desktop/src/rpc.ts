export type DesktopRpc = {
	bun: {
		requests: Record<string, never>;
		messages: {
			routeChanged: { hash: string };
		};
	};
	webview: {
		requests: Record<string, never>;
		messages: Record<string, never>;
	};
};
