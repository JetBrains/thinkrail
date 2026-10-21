export type NativeUpdateFailedPhase = "check" | "download" | "install" | null;

export type NativeUpdateInstallStep = "stopping" | "handoff" | "restarting";

export type NativeUpdateLogEvent =
	| { kind: "installStarted"; version: string }
	| { kind: "hostStopping" }
	| { kind: "hostStopped"; seconds: number }
	| { kind: "handoffStarted" }
	| { kind: "restarting" }
	| { kind: "installed"; version: string }
	| { kind: "installFailed"; version: string; step: string; detail: string }
	| { kind: "diagnostic"; text: string };

export interface NativeUpdateLogEntry {
	at: number;
	source: "update" | "host" | "installer";
	level: "info" | "error";
	event: NativeUpdateLogEvent;
}

export interface NativeUpdateInstallResult {
	outcome: "installed" | "failed" | "unreported";
	fromVersion: string | null;
	toVersion: string;
	failedStep: string | null;
	detail: string | null;
	log: readonly NativeUpdateLogEntry[];
}

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
	installStep: NativeUpdateInstallStep | null;
	log: readonly NativeUpdateLogEntry[];
	lastInstall: NativeUpdateInstallResult | null;
}

export interface NativeUpdateBridge {
	getState(): Promise<NativeUpdateState>;
	checkForUpdates(): Promise<void>;
	downloadUpdate(): Promise<void>;
	restartToUpdate(): Promise<void>;
	dismissInstallResult(): Promise<void>;
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

export interface NativeNotificationInput {
	title: string;
	subtitle?: string;
	body: string;
	silent?: boolean;
}

export interface NativeNotificationBridge {
	show(input: NativeNotificationInput): void;
	/** Whether the native window holds OS-level focus (true even when DevTools is focused). */
	isWindowFocused?: () => boolean;
}

export type NativeQuitHint = "hidden" | "armed" | "release" | "quitting";

export type NativeCommand = "close-item" | "open-settings";

export interface NativeShortcutsBridge {
	subscribeQuitHint(listener: (hint: NativeQuitHint) => void): () => void;
	subscribeCommand(listener: (command: NativeCommand) => void): () => void;
	quit(): Promise<void>;
}

/** Translated labels for the desktop's custom native menu items, keyed by catalog key. */
export interface NativeMenuBridge {
	setLabels(labels: Readonly<Record<string, string>>): void;
}
