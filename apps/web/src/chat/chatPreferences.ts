import { getStablePreferenceAdapter, type StablePreferenceAdapter } from "../clientPreferences";
import { STORAGE_PREFIX } from "../constants/branding";
import { useAppStore } from "../store";
import { getTransport } from "../transport";

export type { StablePreferenceAdapter } from "../clientPreferences";

export const CHAT_MESSAGE_ORDERS = ["oldest-first", "newest-first"] as const;
export type ChatMessageOrder = (typeof CHAT_MESSAGE_ORDERS)[number];
export const DEFAULT_CHAT_MESSAGE_ORDER: ChatMessageOrder = "oldest-first";
export const CHAT_MESSAGE_ORDER_PREFERENCE_KEY = "chat-message-order";

export function isChatMessageOrder(value: unknown): value is ChatMessageOrder {
	return CHAT_MESSAGE_ORDERS.some((order) => order === value);
}

export function chatMessageOrderStorageKey(httpBase: string): string {
	return `${STORAGE_PREFIX}chat-message-order:${httpBase}`;
}

export function parseChatMessageOrder(value: unknown): ChatMessageOrder {
	return isChatMessageOrder(value) ? value : DEFAULT_CHAT_MESSAGE_ORDER;
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

export function initChatPreferencesPersistence(
	stablePreferences: StablePreferenceAdapter | null = getStablePreferenceAdapter(),
): () => void {
	const httpBase = stablePreferences ? "" : getTransport().httpBase();
	const messageOrderKey = stablePreferences ? "" : chatMessageOrderStorageKey(httpBase);
	let storage: Storage | null = null;
	if (!stablePreferences) {
		try {
			storage = window.localStorage;
		} catch {}
	}

	const initialOrder = stablePreferences
		? readStableMessageOrder(stablePreferences)
		: readBrowserMessageOrder(storage, messageOrderKey);
	useAppStore.getState().setChatMessageOrder(initialOrder);
	let previousOrder = initialOrder;
	const unsubscribe = useAppStore.subscribe((state) => {
		if (state.chatMessageOrder !== previousOrder) {
			previousOrder = state.chatMessageOrder;
			if (stablePreferences) writeStableMessageOrder(stablePreferences, previousOrder);
			else writeBrowserMessageOrder(storage, messageOrderKey, previousOrder);
		}
	});
	const onStorage = (event: StorageEvent) => {
		const order = chatMessageOrderFromStorageEvent(event, storage, messageOrderKey);
		if (order === undefined) return;
		previousOrder = order;
		useAppStore.getState().setChatMessageOrder(order);
	};
	if (!stablePreferences) window.addEventListener("storage", onStorage);
	return () => {
		unsubscribe();
		if (!stablePreferences) window.removeEventListener("storage", onStorage);
	};
}
