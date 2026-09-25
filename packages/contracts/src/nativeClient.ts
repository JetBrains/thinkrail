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
