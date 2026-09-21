export interface NativeUpdateState {
	revision: number;
	status: "disabled" | "idle" | "checking" | "downloading" | "ready" | "installing" | "error";
	version: string;
	channel: string;
	availableVersion: string | null;
	progress: number | null;
	error: string | null;
}

export interface NativeUpdateBridge {
	getState(): Promise<NativeUpdateState>;
	checkForUpdates(): Promise<void>;
	restartToUpdate(): Promise<void>;
	subscribe(listener: (state: NativeUpdateState) => void): () => void;
}

export interface NativeWindowState {
	maximized: boolean;
	fullScreen: boolean;
}

export interface NativeWindowControlsBridge {
	getState(): Promise<NativeWindowState>;
	minimize(): Promise<void>;
	toggleMaximize(): Promise<void>;
	close(): Promise<void>;
	subscribe(listener: (state: NativeWindowState) => void): () => void;
}
