export type NativeUpdateFailedPhase = "check" | "download" | "install" | null;

export interface NativeUpdateState {
	revision: number;
	status:
		| "disabled"
		| "idle"
		| "checking"
		| "available"
		| "downloading"
		| "preparing"
		| "ready"
		| "installing"
		| "error";
	version: string;
	channel: string;
	availableVersion: string | null;
	progress: number | null;
	error: string | null;
	failedPhase: NativeUpdateFailedPhase;
}

export interface NativeUpdateBridge {
	getState(): Promise<NativeUpdateState>;
	checkForUpdates(): Promise<void>;
	downloadUpdate(): Promise<void>;
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

export type NativeQuitHint = "hidden" | "armed" | "release" | "quitting";

export type NativeCommand = "close-item";

export interface NativeShortcutsBridge {
	subscribeQuitHint(listener: (hint: NativeQuitHint) => void): () => void;
	subscribeCommand(listener: (command: NativeCommand) => void): () => void;
	quit(): Promise<void>;
}
