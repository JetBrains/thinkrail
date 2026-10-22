export interface DesktopHostOptions {
	runtimeDir: string;
	staticDir: string;
	appVersion: string;
	channel: string;
	posthogProjectKey: string;
	openExternal?: (url: string) => void;
}

export interface DesktopHost {
	server: {
		readonly port: number;
		startAttributionClaim(): void;
		stop(): void;
		shutdown(): Promise<void>;
	};
	port: number;
	requested: number;
	reportError(error: unknown, scope: string): void;
}

export interface DesktopServerRuntime {
	startDesktopHost(options: DesktopHostOptions): Promise<DesktopHost>;
}
