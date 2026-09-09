import type { NativeUpdateBridge, NativeUpdateState } from "@thinkrail/contracts";

const NATIVE_UPDATES_GLOBAL = "__THINKRAIL_NATIVE_UPDATES__";

export type NativeUpdateAction = "check" | "restart";

export interface NativeUpdateControllerSnapshot {
	state: NativeUpdateState | null;
	pendingAction: NativeUpdateAction | null;
	actionError: string | null;
}

const INITIAL_SNAPSHOT: NativeUpdateControllerSnapshot = Object.freeze({
	state: null,
	pendingAction: null,
	actionError: null,
});

function updateErrorText(error: unknown): string {
	if (error instanceof Error && error.message.trim()) return error.message;
	if (typeof error === "string" && error.trim()) return error;
	return "The native update request failed";
}

export function asNativeUpdateBridge(value: unknown): NativeUpdateBridge | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	return typeof Reflect.get(value, "getState") === "function" &&
		typeof Reflect.get(value, "checkForUpdates") === "function" &&
		typeof Reflect.get(value, "restartToUpdate") === "function" &&
		typeof Reflect.get(value, "subscribe") === "function"
		? (value as NativeUpdateBridge)
		: null;
}

export class NativeUpdateController {
	private snapshot: NativeUpdateControllerSnapshot = INITIAL_SNAPSHOT;
	private readonly listeners = new Set<() => void>();
	private started = false;
	private unsubscribeNative: (() => void) | null = null;

	constructor(private readonly bridge: NativeUpdateBridge) {}

	readonly getSnapshot = (): NativeUpdateControllerSnapshot => this.snapshot;

	readonly subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		this.start();
		return () => this.listeners.delete(listener);
	};

	checkForUpdates(): void {
		const { state, pendingAction, actionError } = this.snapshot;
		if (
			pendingAction !== null ||
			(!actionError && state?.status !== "idle" && state?.status !== "error")
		) {
			return;
		}
		this.runAction("check", () => this.bridge.checkForUpdates());
	}

	restartToUpdate(): void {
		if (this.snapshot.pendingAction !== null || this.snapshot.state?.status !== "ready") return;
		this.runAction("restart", () => this.bridge.restartToUpdate());
	}

	dispose(): void {
		this.unsubscribeNative?.();
		this.unsubscribeNative = null;
		this.started = false;
	}

	private start(): void {
		if (this.started) return;
		this.started = true;
		try {
			this.unsubscribeNative = this.bridge.subscribe(this.acceptState);
		} catch (error) {
			this.recordInitialError(error);
		}
		try {
			void this.bridge.getState().then(this.acceptState).catch(this.recordInitialError);
		} catch (error) {
			this.recordInitialError(error);
		}
	}

	private readonly acceptState = (state: NativeUpdateState): void => {
		if (this.snapshot.state && state.revision < this.snapshot.state.revision) return;
		this.publish({ ...this.snapshot, state, actionError: null });
	};

	private readonly recordInitialError = (error: unknown): void => {
		if (this.snapshot.state) return;
		this.publish({ ...this.snapshot, actionError: updateErrorText(error) });
	};

	private runAction(action: NativeUpdateAction, operation: () => Promise<void>): void {
		this.publish({ ...this.snapshot, pendingAction: action, actionError: null });
		let request: Promise<void>;
		try {
			request = operation();
		} catch (error) {
			this.finishAction(action, error);
			return;
		}
		void request.then(
			() => this.finishAction(action),
			(error) => this.finishAction(action, error),
		);
	}

	private finishAction(action: NativeUpdateAction, error?: unknown): void {
		if (this.snapshot.pendingAction !== action) return;
		this.publish({
			...this.snapshot,
			pendingAction: null,
			actionError: error === undefined ? this.snapshot.actionError : updateErrorText(error),
		});
	}

	private publish(snapshot: NativeUpdateControllerSnapshot): void {
		this.snapshot = snapshot;
		for (const listener of this.listeners) listener();
	}
}

let nativeUpdateController: NativeUpdateController | null | undefined;

export function getNativeUpdateController(): NativeUpdateController | null {
	if (nativeUpdateController === undefined) {
		const bridge = asNativeUpdateBridge(Reflect.get(globalThis, NATIVE_UPDATES_GLOBAL));
		nativeUpdateController = bridge ? new NativeUpdateController(bridge) : null;
	}
	return nativeUpdateController;
}

export function hasNativeUpdateCapability(): boolean {
	return getNativeUpdateController() !== null;
}
