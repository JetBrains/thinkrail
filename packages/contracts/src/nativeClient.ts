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

/**
 * The interface language, handed to the desktop process.
 *
 * A locale switch is the one preference the native side also acts on: it names every native menu item
 * and the start-up failure dialogs. The call resolves once the value is persisted and the menu has
 * been rebuilt, so the client can reload knowing the preload script will re-seed the new value.
 */
export interface NativeLocaleBridge {
	applyLocale(locale: string): Promise<boolean>;
}

export type NativeCommand = "close-item" | "open-settings";

export interface NativeShortcutsBridge {
	subscribeQuitHint(listener: (hint: NativeQuitHint) => void): () => void;
	subscribeCommand(listener: (command: NativeCommand) => void): () => void;
	quit(): Promise<void>;
}
