import type { NativeQuitHint } from "./nativeClient";

export const QUIT_CONFIRMATION = { holdMs: 1200, doublePressMs: 500, pollMs: 40 } as const;

export interface QuitConfirmationDependencies {
	readHeld(): boolean | null;
	canShowHint(): boolean;
	quit(): void;
	onHint(hint: NativeQuitHint): void;
	now(): number;
	every(callback: () => void, ms: number): () => void;
}

type Phase = "idle" | "holding" | "release" | "waiting" | "quitting";

export function createQuitConfirmation(dependencies: QuitConfirmationDependencies) {
	let phase: Phase = "idle";
	let firstPressAt = 0;
	let windowStart = 0;
	let stopPolling: (() => void) | null = null;

	function stop() {
		stopPolling?.();
		stopPolling = null;
	}

	function quitNow() {
		if (phase === "quitting") return;
		phase = "quitting";
		stop();
		dependencies.onHint("quitting");
		dependencies.quit();
	}

	function hide() {
		phase = "idle";
		stop();
		dependencies.onHint("hidden");
	}

	function cancel() {
		if (phase === "release") quitNow();
		else if (phase !== "idle" && phase !== "quitting") hide();
	}

	function sync() {
		if (phase === "idle" || phase === "quitting") return;
		const held = dependencies.readHeld();
		if (held === null) {
			cancel();
			return;
		}
		const now = dependencies.now();
		if (phase === "holding") {
			if (held && now - firstPressAt >= QUIT_CONFIRMATION.holdMs) {
				phase = "release";
				dependencies.onHint("release");
				return;
			}
			if (!held) {
				phase = "waiting";
				windowStart = now;
			}
		}
		if (phase === "release" && !held) {
			quitNow();
			return;
		}
		if (phase === "waiting" && now - windowStart > QUIT_CONFIRMATION.doublePressMs) hide();
	}

	function startPolling() {
		stopPolling ??= dependencies.every(sync, QUIT_CONFIRMATION.pollMs);
	}

	function awaitRelease() {
		phase = "release";
		dependencies.onHint("release");
		startPolling();
	}

	function arm(held: boolean) {
		if (!dependencies.canShowHint()) {
			if (held) awaitRelease();
			else quitNow();
			return;
		}
		firstPressAt = dependencies.now();
		windowStart = firstPressAt;
		phase = held ? "holding" : "waiting";
		dependencies.onHint("armed");
		startPolling();
	}

	function press(held: boolean) {
		if (phase === "quitting" || phase === "holding" || phase === "release") return;
		if (phase === "idle") {
			arm(held);
			return;
		}
		if (dependencies.now() - windowStart > QUIT_CONFIRMATION.doublePressMs) arm(held);
		else if (held) awaitRelease();
		else quitNow();
	}

	return { press, sync, cancel, quitNow, reset: hide };
}
