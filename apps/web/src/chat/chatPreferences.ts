import { getStablePreferenceAdapter, type StablePreferenceAdapter } from "../clientPreferences";
import { STORAGE_PREFIX } from "../constants/branding";
import {
	DEFAULT_STREAMING_RESPONSE_MOVEMENT,
	type StreamingResponseMovement,
	useAppStore,
} from "../store";
import { getTransport } from "../transport";

export type { StablePreferenceAdapter } from "../clientPreferences";
export type { StreamingResponseMovement } from "../store";
export { DEFAULT_STREAMING_RESPONSE_MOVEMENT } from "../store";

export const CHAT_MESSAGE_ORDERS = ["oldest-first", "newest-first"] as const;
export type ChatMessageOrder = (typeof CHAT_MESSAGE_ORDERS)[number];
export const DEFAULT_CHAT_MESSAGE_ORDER: ChatMessageOrder = "oldest-first";
export const CHAT_MESSAGE_ORDER_PREFERENCE_KEY = "chat-message-order";
export const STREAMING_RESPONSE_MOVEMENT_PREFERENCE_KEY = "streaming-response-movement";
export const STREAMING_RESPONSE_MOVEMENT_LIMITS = {
	triggerMin: 35,
	triggerMax: 100,
	step: 5,
} as const;
function defaultStreamingResponseMovement(): StreamingResponseMovement {
	return { ...DEFAULT_STREAMING_RESPONSE_MOVEMENT };
}

export function isChatMessageOrder(value: unknown): value is ChatMessageOrder {
	return CHAT_MESSAGE_ORDERS.some((order) => order === value);
}

export function chatMessageOrderStorageKey(httpBase: string): string {
	return `${STORAGE_PREFIX}chat-message-order:${httpBase}`;
}

export function streamingResponseMovementStorageKey(httpBase: string): string {
	return `${STORAGE_PREFIX}streaming-response-movement:${httpBase}`;
}

export function parseChatMessageOrder(value: unknown): ChatMessageOrder {
	return isChatMessageOrder(value) ? value : DEFAULT_CHAT_MESSAGE_ORDER;
}

export function moveStreamingResponseTrigger(
	current: StreamingResponseMovement,
	value: number,
): StreamingResponseMovement {
	if (!Number.isFinite(value)) return current;
	const stepped =
		Math.round(value / STREAMING_RESPONSE_MOVEMENT_LIMITS.step) *
		STREAMING_RESPONSE_MOVEMENT_LIMITS.step;
	return {
		trigger: Math.max(
			STREAMING_RESPONSE_MOVEMENT_LIMITS.triggerMin,
			Math.min(STREAMING_RESPONSE_MOVEMENT_LIMITS.triggerMax, stepped),
		),
	};
}

export function isStreamingResponseMovement(value: unknown): value is StreamingResponseMovement {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const trigger = Reflect.get(value, "trigger");
	return (
		typeof trigger === "number" &&
		Number.isInteger(trigger) &&
		trigger % STREAMING_RESPONSE_MOVEMENT_LIMITS.step === 0 &&
		trigger >= STREAMING_RESPONSE_MOVEMENT_LIMITS.triggerMin &&
		trigger <= STREAMING_RESPONSE_MOVEMENT_LIMITS.triggerMax
	);
}

export function parseStreamingResponseMovement(value: unknown): StreamingResponseMovement {
	return isStreamingResponseMovement(value)
		? { trigger: value.trigger }
		: defaultStreamingResponseMovement();
}

function parseStoredStreamingResponseMovement(value: string | null): StreamingResponseMovement {
	if (value === null) return defaultStreamingResponseMovement();
	try {
		return parseStreamingResponseMovement(JSON.parse(value));
	} catch {
		return defaultStreamingResponseMovement();
	}
}

function isDefaultStreamingResponseMovement(value: StreamingResponseMovement): boolean {
	return value.trigger === DEFAULT_STREAMING_RESPONSE_MOVEMENT.trigger;
}

function sameStreamingResponseMovement(
	left: StreamingResponseMovement,
	right: StreamingResponseMovement,
): boolean {
	return left.trigger === right.trigger;
}

function readBrowserMessageOrder(storage: Storage | null, key: string): ChatMessageOrder {
	if (!storage) return DEFAULT_CHAT_MESSAGE_ORDER;
	try {
		return parseChatMessageOrder(storage.getItem(key));
	} catch {
		return DEFAULT_CHAT_MESSAGE_ORDER;
	}
}

function readBrowserStreamingResponseMovement(
	storage: Storage | null,
	key: string,
): StreamingResponseMovement {
	if (!storage) return defaultStreamingResponseMovement();
	try {
		return parseStoredStreamingResponseMovement(storage.getItem(key));
	} catch {
		return defaultStreamingResponseMovement();
	}
}

function readStableMessageOrder(adapter: StablePreferenceAdapter): ChatMessageOrder {
	try {
		return parseChatMessageOrder(adapter.getItem(CHAT_MESSAGE_ORDER_PREFERENCE_KEY));
	} catch {
		return DEFAULT_CHAT_MESSAGE_ORDER;
	}
}

function readStableStreamingResponseMovement(
	adapter: StablePreferenceAdapter,
): StreamingResponseMovement {
	try {
		return parseStoredStreamingResponseMovement(
			adapter.getItem(STREAMING_RESPONSE_MOVEMENT_PREFERENCE_KEY),
		);
	} catch {
		return defaultStreamingResponseMovement();
	}
}

function writeBrowserMessageOrder(
	storage: Storage | null,
	key: string,
	order: ChatMessageOrder,
): void {
	if (!storage) return;
	try {
		storage.setItem(key, order);
	} catch {}
}

function writeBrowserStreamingResponseMovement(
	storage: Storage | null,
	key: string,
	movement: StreamingResponseMovement,
): void {
	if (!storage) return;
	try {
		if (isDefaultStreamingResponseMovement(movement)) storage.removeItem(key);
		else storage.setItem(key, JSON.stringify(movement));
	} catch {}
}

function writeStableMessageOrder(adapter: StablePreferenceAdapter, order: ChatMessageOrder): void {
	try {
		if (order === DEFAULT_CHAT_MESSAGE_ORDER) {
			adapter.removeItem(CHAT_MESSAGE_ORDER_PREFERENCE_KEY);
		} else {
			adapter.setItem(CHAT_MESSAGE_ORDER_PREFERENCE_KEY, order);
		}
	} catch {}
}

function writeStableStreamingResponseMovement(
	adapter: StablePreferenceAdapter,
	movement: StreamingResponseMovement,
): void {
	try {
		if (isDefaultStreamingResponseMovement(movement)) {
			adapter.removeItem(STREAMING_RESPONSE_MOVEMENT_PREFERENCE_KEY);
		} else {
			adapter.setItem(STREAMING_RESPONSE_MOVEMENT_PREFERENCE_KEY, JSON.stringify(movement));
		}
	} catch {}
}

export function chatMessageOrderFromStorageEvent(
	event: Pick<StorageEvent, "key" | "newValue" | "storageArea">,
	storage: Storage | null,
	key: string,
): ChatMessageOrder | undefined {
	if (
		(event.key !== null && event.key !== key) ||
		(event.storageArea !== null && event.storageArea !== storage)
	) {
		return undefined;
	}
	return event.key === null ? DEFAULT_CHAT_MESSAGE_ORDER : parseChatMessageOrder(event.newValue);
}

export function streamingResponseMovementFromStorageEvent(
	event: Pick<StorageEvent, "key" | "newValue" | "storageArea">,
	storage: Storage | null,
	key: string,
): StreamingResponseMovement | undefined {
	if (
		(event.key !== null && event.key !== key) ||
		(event.storageArea !== null && event.storageArea !== storage)
	) {
		return undefined;
	}
	return event.key === null
		? defaultStreamingResponseMovement()
		: parseStoredStreamingResponseMovement(event.newValue);
}

export function initChatPreferencesPersistence(
	stablePreferences: StablePreferenceAdapter | null = getStablePreferenceAdapter(),
): () => void {
	const httpBase = stablePreferences ? "" : getTransport().httpBase();
	const messageOrderKey = stablePreferences ? "" : chatMessageOrderStorageKey(httpBase);
	const movementKey = stablePreferences ? "" : streamingResponseMovementStorageKey(httpBase);
	let storage: Storage | null = null;
	if (!stablePreferences) {
		try {
			storage = window.localStorage;
		} catch {}
	}

	const initialOrder = stablePreferences
		? readStableMessageOrder(stablePreferences)
		: readBrowserMessageOrder(storage, messageOrderKey);
	const initialMovement = stablePreferences
		? readStableStreamingResponseMovement(stablePreferences)
		: readBrowserStreamingResponseMovement(storage, movementKey);
	useAppStore.getState().setChatPreferences(initialOrder, initialMovement);
	let previousOrder = initialOrder;
	let previousMovement = initialMovement;
	const unsubscribe = useAppStore.subscribe((state) => {
		if (state.chatMessageOrder !== previousOrder) {
			previousOrder = state.chatMessageOrder;
			if (stablePreferences) writeStableMessageOrder(stablePreferences, previousOrder);
			else writeBrowserMessageOrder(storage, messageOrderKey, previousOrder);
		}
		if (!sameStreamingResponseMovement(state.streamingResponseMovement, previousMovement)) {
			previousMovement = state.streamingResponseMovement;
			if (stablePreferences) {
				writeStableStreamingResponseMovement(stablePreferences, previousMovement);
			} else {
				writeBrowserStreamingResponseMovement(storage, movementKey, previousMovement);
			}
		}
	});
	const onStorage = (event: StorageEvent) => {
		const order = chatMessageOrderFromStorageEvent(event, storage, messageOrderKey);
		const movement = streamingResponseMovementFromStorageEvent(event, storage, movementKey);
		if (order === undefined && movement === undefined) return;
		const current = useAppStore.getState();
		const nextOrder = order ?? current.chatMessageOrder;
		const nextMovement = movement ?? current.streamingResponseMovement;
		previousOrder = nextOrder;
		previousMovement = nextMovement;
		current.setChatPreferences(nextOrder, nextMovement);
	};
	if (!stablePreferences) window.addEventListener("storage", onStorage);
	return () => {
		unsubscribe();
		if (!stablePreferences) window.removeEventListener("storage", onStorage);
	};
}
