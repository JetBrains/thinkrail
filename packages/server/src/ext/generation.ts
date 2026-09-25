import type { PiEvent } from "@thinkrail/contracts";
import type { ActionHandler, Disposer, Off, PiExtensionFactory, SessionRef } from "@thinkrail/ext";

type Observer = (event: PiEvent, session: SessionRef) => void;
type WatchObserver = (key: string, watching: boolean) => void;
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
	addWatchObserver(fn: WatchObserver): Off;
	notifyWatch(key: string, watching: boolean): void;
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
	watched,
}: {
	id: number;
	emit: (key: string, value: unknown) => void;
	drop: (key: string) => void;
	watched: () => string[];
}): Generation => {
	let phase: Phase = "loading";
	const observers = new Map<string, Set<Observer>>();
	const piFactories = new Set<PiExtensionFactory>();
	const actions = new Map<string, ActionHandler>();
	const timers = new Map<() => Off, Off | undefined>();
	const disposers: Disposer[] = [];
	const pendingPublishes = new Map<string, unknown>();
	const watchObservers = new Set<WatchObserver>();

	const replayWatched = (fn: WatchObserver) => {
		for (const key of watched()) fn(key, true);
	};

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
		addWatchObserver(fn) {
			watchObservers.add(fn);
			if (phase === "active") replayWatched(fn);
			return () => {
				watchObservers.delete(fn);
			};
		},
		notifyWatch(key, watching) {
			if (phase !== "active") return;
			for (const fn of watchObservers) fn(key, watching);
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
			for (const fn of watchObservers) replayWatched(fn);
		},
		async dispose() {
			if (phase === "disposed") return [];
			phase = "disposed";
			for (const stop of timers.values()) stop?.();
			timers.clear();
			observers.clear();
			watchObservers.clear();
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
