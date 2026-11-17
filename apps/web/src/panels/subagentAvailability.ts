import { SUBAGENT_CATALOG_PROTOCOL_VERSION } from "@thinkrail/contracts";
import { useAppStore } from "@/store";
import { getTransport } from "@/transport";

interface AvailabilityState {
	pending: boolean;
	failed: { name: string; enabled: boolean } | null;
}
const IDLE: AvailabilityState = { pending: false, failed: null };
const SAVE_TIMEOUT_MS = 15_000;

export function createSubagentAvailabilitySaver(
	request: (intent: { name: string; enabled: boolean }) => Promise<unknown>,
	timeoutMs = SAVE_TIMEOUT_MS,
) {
	let state = IDLE;
	const listeners = new Set<() => void>();
	const publish = (next: AvailabilityState) => {
		state = next;
		for (const listener of listeners) listener();
	};
	return {
		getSnapshot: () => state,
		subscribe: (listener: () => void) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		async save(name: string, enabled: boolean): Promise<boolean | null> {
			const initial = useAppStore.getState();
			if (
				state.pending ||
				initial.status !== "connected" ||
				initial.protocolVersion === null ||
				initial.protocolVersion < SUBAGENT_CATALOG_PROTOCOL_VERSION
			)
				return null;
			if (initial.disabledSubagents.includes(name) === !enabled) {
				publish(IDLE);
				return true;
			}
			publish({ pending: true, failed: null });
			let finishConfirmation = (_confirmed: boolean) => {};
			const confirmation = new Promise<boolean>((resolve) => {
				finishConfirmation = resolve;
			});
			const unsubscribe = useAppStore.subscribe((current) => {
				if (
					current.status !== "connected" ||
					current.connectionGeneration !== initial.connectionGeneration
				) {
					finishConfirmation(false);
				} else if (
					current.disabledSubagents !== initial.disabledSubagents &&
					current.disabledSubagents.includes(name) === !enabled
				) {
					finishConfirmation(true);
				}
			});
			const timer = setTimeout(() => finishConfirmation(false), timeoutMs);
			let ok = false;
			try {
				// Even after disconnect, hold the lock until the replayable RPC has settled.
				await request({ name, enabled });
				ok = await confirmation;
				const current = useAppStore.getState();
				ok =
					ok &&
					current.status === "connected" &&
					current.connectionGeneration === initial.connectionGeneration &&
					current.disabledSubagents.includes(name) === !enabled;
			} catch {
				ok = false;
			}
			clearTimeout(timer);
			unsubscribe();
			publish({ pending: false, failed: ok ? null : { name, enabled } });
			return ok;
		},
	};
}

export const subagentAvailability = createSubagentAvailabilitySaver((intent) =>
	getTransport().request("subagent.setEnabled", intent, { timeoutMs: SAVE_TIMEOUT_MS }),
);
