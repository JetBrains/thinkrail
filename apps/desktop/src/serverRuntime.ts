export interface DesktopHostOptions {
	runtimeDir: string;
	staticDir: string;
	appVersion: string;
	channel: string;
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
}

export interface DesktopServerRuntime {
	startDesktopHost(options: DesktopHostOptions): Promise<DesktopHost>;
}
