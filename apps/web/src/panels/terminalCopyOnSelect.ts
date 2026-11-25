import { TERMINAL_COPY_ON_SELECT_PROTOCOL_VERSION } from "@thinkrail/contracts";

const SELECTION_SETTLE_MS = 150;

export function createTerminalCopyOnSelect({
	getSelection,
	getConfig,
	copy,
}: {
	getSelection: () => string;
	getConfig: () => { terminalCopyOnSelect: boolean; protocolVersion: number | null };
	copy: (text: string) => Promise<unknown>;
}) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let selecting = false;
	let pending = false;
	let disposed = false;
	const enabled = () => {
		const config = getConfig();
		return (
			config.terminalCopyOnSelect &&
			(config.protocolVersion ?? 0) >= TERMINAL_COPY_ON_SELECT_PROTOCOL_VERSION
		);
	};
	const clearTimer = () => {
		clearTimeout(timer);
		timer = undefined;
	};
	const cancelPending = () => {
		clearTimer();
		pending = false;
	};
	const schedule = () => {
		clearTimer();
		if (disposed || selecting || !pending) return;
		timer = setTimeout(() => {
			timer = undefined;
			pending = false;
			if (!enabled()) return;
			const selection = getSelection();
			if (selection) void copy(selection);
		}, SELECTION_SETTLE_MS);
	};

	return {
		selectionChanged() {
			pending = enabled() && getSelection().length > 0;
			schedule();
		},
		startSelection() {
			selecting = true;
			clearTimer();
		},
		endSelection() {
			selecting = false;
			schedule();
		},
		settingsChanged() {
			if (!enabled()) cancelPending();
		},
		cancel() {
			selecting = false;
			cancelPending();
		},
		dispose() {
			disposed = true;
			cancelPending();
		},
	};
}
