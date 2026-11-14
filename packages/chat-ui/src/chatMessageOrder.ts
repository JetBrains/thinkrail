export const CHAT_MESSAGE_ORDERS = ["oldest-first", "newest-first"] as const;
export type ChatMessageOrder = (typeof CHAT_MESSAGE_ORDERS)[number];
export const DEFAULT_CHAT_MESSAGE_ORDER: ChatMessageOrder = "oldest-first";

export function isChatMessageOrder(value: unknown): value is ChatMessageOrder {
	return CHAT_MESSAGE_ORDERS.some((order) => order === value);
}
