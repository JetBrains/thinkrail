import { STORAGE_PREFIX } from "../constants/branding";
import { useAppStore } from "../store";
import { getTransport } from "../transport";

export const CHAT_MESSAGE_ORDERS = ["oldest-first", "newest-first"] as const;
export type ChatMessageOrder = (typeof CHAT_MESSAGE_ORDERS)[number];
export const DEFAULT_CHAT_MESSAGE_ORDER: ChatMessageOrder = "oldest-first";
export const CHAT_MESSAGE_ORDER_PREFERENCE_KEY = "chat-message-order";
const STABLE_PREFERENCES_GLOBAL = "__THINKRAIL_STABLE_PREFERENCES__";

export interface StablePreferenceAdapter {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

export function isChatMessageOrder(value: unknown): value is ChatMessageOrder {
	return CHAT_MESSAGE_ORDERS.some((order) => order === value);
}

export function chatMessageOrderStorageKey(httpBase: string): string {
	return `${STORAGE_PREFIX}chat-message-order:${httpBase}`;
}

export function parseChatMessageOrder(value: unknown): ChatMessageOrder {
	return isChatMessageOrder(value) ? value : DEFAULT_CHAT_MESSAGE_ORDER;
}

function isStablePreferenceAdapter(value: unknown): value is StablePreferenceAdapter {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof Reflect.get(value, "getItem") === "function" &&
		typeof Reflect.get(value, "setItem") === "function" &&
		typeof Reflect.get(value, "removeItem") === "function"
	);
}

function injectedStablePreferenceAdapter(): StablePreferenceAdapter | null {
	const value = Reflect.get(globalThis, STABLE_PREFERENCES_GLOBAL);
	return isStablePreferenceAdapter(value) ? value : null;
}

function readBrowserMessageOrder(storage: Storage | null, key: string): ChatMessageOrder {
	if (!storage) return DEFAULT_CHAT_MESSAGE_ORDER;
	try {
		return parseChatMessageOrder(storage.getItem(key));
	} catch {
		return DEFAULT_CHAT_MESSAGE_ORDER;
	}
}

function readStableMessageOrder(adapter: StablePreferenceAdapter): ChatMessageOrder {
	try {
		return parseChatMessageOrder(adapter.getItem(CHAT_MESSAGE_ORDER_PREFERENCE_KEY));
	} catch {
		return DEFAULT_CHAT_MESSAGE_ORDER;
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

function writeStableMessageOrder(adapter: StablePreferenceAdapter, order: ChatMessageOrder): void {
	try {
		if (order === DEFAULT_CHAT_MESSAGE_ORDER) {
			adapter.removeItem(CHAT_MESSAGE_ORDER_PREFERENCE_KEY);
		} else {
			adapter.setItem(CHAT_MESSAGE_ORDER_PREFERENCE_KEY, order);
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

export function initChatMessageOrderPersistence(
	stablePreferences: StablePreferenceAdapter | null = injectedStablePreferenceAdapter(),
): () => void {
	const key = stablePreferences ? "" : chatMessageOrderStorageKey(getTransport().httpBase());
	let storage: Storage | null = null;
	if (!stablePreferences) {
		try {
			storage = window.localStorage;
		} catch {}
	}

	const initial = stablePreferences
		? readStableMessageOrder(stablePreferences)
		: readBrowserMessageOrder(storage, key);
	useAppStore.getState().setChatMessageOrder(initial);
	let previous = initial;
	const unsubscribe = useAppStore.subscribe((state) => {
		if (state.chatMessageOrder === previous) return;
		previous = state.chatMessageOrder;
		if (stablePreferences) writeStableMessageOrder(stablePreferences, previous);
		else writeBrowserMessageOrder(storage, key, previous);
	});
	const onStorage = (event: StorageEvent) => {
		const order = chatMessageOrderFromStorageEvent(event, storage, key);
		if (order === undefined) return;
		previous = order;
		useAppStore.getState().setChatMessageOrder(order);
	};
	if (!stablePreferences) window.addEventListener("storage", onStorage);
	return () => {
		unsubscribe();
		if (!stablePreferences) window.removeEventListener("storage", onStorage);
	};
}
