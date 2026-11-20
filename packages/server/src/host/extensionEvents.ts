import type {
	ExtensionHostEventBus,
	ExtensionHostEvents,
	ExtensionHostEventType,
	ExtensionLog,
} from "../extensions";

type Listener = (payload: unknown) => unknown;

interface Subscription {
	extension: string;
	type: ExtensionHostEventType;
	listener: Listener;
}

export interface ExtensionEventHub {
	emit<T extends ExtensionHostEventType>(type: T, payload: ExtensionHostEvents[T]): void;
	/** One run's bus: what it subscribes ends once `signal` aborts, never another run's subscriptions. */
	bus(extension: string, signal: AbortSignal): ExtensionHostEventBus;
}

/** Host events fanned out to the enabled extensions' listeners, each with its own copy of the payload. */
export function createExtensionEventHub(options: {
	isDisabled: (extension: string) => boolean;
	log: (extension: string) => ExtensionLog;
}): ExtensionEventHub {
	let subscriptions: readonly Subscription[] = [];
	const failed = (subscription: Subscription, error: unknown): void =>
		options.log(subscription.extension).warn(`${subscription.type} listener failed`, error);
	return {
		emit(type, payload) {
			for (const subscription of subscriptions) {
				if (subscription.type !== type || options.isDisabled(subscription.extension)) continue;
				try {
					const result = subscription.listener(structuredClone(payload));
					if (result instanceof Promise) result.catch((error) => failed(subscription, error));
				} catch (error) {
					failed(subscription, error);
				}
			}
		},
		bus: (extension, signal) => ({
			subscribe(type, listener) {
				const subscription: Subscription = { extension, type, listener: listener as Listener };
				const unsubscribe = (): void => {
					signal.removeEventListener("abort", unsubscribe);
					subscriptions = subscriptions.filter((candidate) => candidate !== subscription);
				};
				if (signal.aborted) return unsubscribe;
				subscriptions = [...subscriptions, subscription];
				signal.addEventListener("abort", unsubscribe, { once: true });
				return unsubscribe;
			},
		}),
	};
}
