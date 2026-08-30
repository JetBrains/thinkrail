import { STORAGE_PREFIX } from "../constants/branding";
import { useAppStore } from "../store";
import { getTransport } from "../transport";

export const CHAT_MESSAGE_ORDERS = ["oldest-first", "newest-first"] as const;
export type ChatMessageOrder = (typeof CHAT_MESSAGE_ORDERS)[number];
export const DEFAULT_CHAT_MESSAGE_ORDER: ChatMessageOrder = "oldest-first";

export function isChatMessageOrder(value: unknown): value is ChatMessageOrder {
	return CHAT_MESSAGE_ORDERS.some((order) => order === value);
}

export function chatMessageOrderStorageKey(httpBase: string): string {
	return `${STORAGE_PREFIX}chat-message-order:${httpBase}`;
}

export function parseChatMessageOrder(value: unknown): ChatMessageOrder {
	return isChatMessageOrder(value) ? value : DEFAULT_CHAT_MESSAGE_ORDER;
}

function readMessageOrder(storage: Storage | null, key: string): ChatMessageOrder {
	if (!storage) return DEFAULT_CHAT_MESSAGE_ORDER;
	try {
		return parseChatMessageOrder(storage.getItem(key));
	} catch {
		return DEFAULT_CHAT_MESSAGE_ORDER;
	}
}

function writeMessageOrder(storage: Storage | null, key: string, order: ChatMessageOrder): void {
	if (!storage) return;
	try {
		storage.setItem(key, order);
	} catch {}
}

export function initChatMessageOrderPersistence(): () => void {
	const key = chatMessageOrderStorageKey(getTransport().httpBase());
	let storage: Storage | null = null;
	try {
		storage = window.localStorage;
	} catch {}

	const initial = readMessageOrder(storage, key);
	useAppStore.getState().setChatMessageOrder(initial);
	let previous = initial;
	const unsubscribe = useAppStore.subscribe((state) => {
		if (state.chatMessageOrder === previous) return;
		previous = state.chatMessageOrder;
		writeMessageOrder(storage, key, previous);
	});
	const onStorage = (event: StorageEvent) => {
		if (event.key !== key || (event.storageArea && event.storageArea !== storage)) return;
		const order = parseChatMessageOrder(event.newValue);
		previous = order;
		useAppStore.getState().setChatMessageOrder(order);
	};
	window.addEventListener("storage", onStorage);
	return () => {
		unsubscribe();
		window.removeEventListener("storage", onStorage);
	};
}
