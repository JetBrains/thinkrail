import type { PiEvent } from "@thinkrail/contracts";
import type { ActionHandler, Disposer, Off, PiExtensionFactory, SessionRef } from "@thinkrail/ext";

export type Observer = (event: PiEvent, session: SessionRef) => void;
type Phase = "loading" | "active" | "disposed";

export interface Generation {
	readonly id: number;
	readonly phase: Phase;
	readonly observers: ReadonlyMap<string, ReadonlySet<Observer>>;
	readonly piFactories: ReadonlySet<PiExtensionFactory>;
	readonly actions: ReadonlyMap<string, ActionHandler>;
	addObserver(type: string, fn: Observer): Off;
	addPiFactory(factory: PiExtensionFactory): Off;
	addAction(id: string, fn: ActionHandler): Off;
	addTimer(start: () => Off): Off;
	addDisposer(fn: Disposer): void;
	publish(key: string, value: unknown): void;
	unpublish(key: string): void;
	activate(): void;
	dispose(): Promise<unknown[]>;
}

export const createGeneration = ({
	id,
	emit,
	drop,
}: {
	id: number;
	emit: (key: string, value: unknown) => void;
	drop: (key: string) => void;
}): Generation => {
	let phase: Phase = "loading";
	const observers = new Map<string, Set<Observer>>();
	const piFactories = new Set<PiExtensionFactory>();
	const actions = new Map<string, ActionHandler>();
	const timers = new Map<() => Off, Off | undefined>();
	const disposers: Disposer[] = [];
	const pendingPublishes = new Map<string, unknown>();

	const startTimer = (start: () => Off) => {
		timers.set(start, start());
	};

	return {
		id,
		get phase() {
			return phase;
		},
		observers,
		piFactories,
		actions,
		addObserver(type, fn) {
			const set = observers.get(type) ?? new Set();
			set.add(fn);
			observers.set(type, set);
			return () => {
				set.delete(fn);
			};
		},
		addPiFactory(factory) {
			piFactories.add(factory);
			return () => {
				piFactories.delete(factory);
			};
		},
		addAction(actionId, fn) {
			if (actions.has(actionId)) throw new Error(`action "${actionId}" is already registered`);
			actions.set(actionId, fn);
			return () => {
				if (actions.get(actionId) === fn) actions.delete(actionId);
			};
		},
		addTimer(start) {
			if (phase === "active") startTimer(start);
			else if (phase === "loading") timers.set(start, undefined);
			return () => {
				timers.get(start)?.();
				timers.delete(start);
			};
		},
		addDisposer(fn) {
			disposers.push(fn);
		},
		publish(key, value) {
			if (phase === "active") emit(key, value);
			else if (phase === "loading") pendingPublishes.set(key, value);
		},
		unpublish(key) {
			if (phase === "active") drop(key);
			else if (phase === "loading") pendingPublishes.delete(key);
		},
		activate() {
			if (phase !== "loading") return;
			phase = "active";
			for (const start of timers.keys()) startTimer(start);
			for (const [key, value] of pendingPublishes) emit(key, value);
			pendingPublishes.clear();
		},
		async dispose() {
			if (phase === "disposed") return [];
			phase = "disposed";
			for (const stop of timers.values()) stop?.();
			timers.clear();
			observers.clear();
			piFactories.clear();
			actions.clear();
			pendingPublishes.clear();
			const failures: unknown[] = [];
			for (const fn of disposers.splice(0).reverse()) {
				try {
					await fn();
				} catch (error) {
					failures.push(error);
				}
			}
			return failures;
		},
	};
};
