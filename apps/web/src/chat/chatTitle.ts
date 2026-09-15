import { normalizeSessionTitle, SESSION_TITLE_MAX_LENGTH } from "@thinkrail/contracts";

export type PreparedChatTitle = { title: string } | { reason: string };

export function prepareChatTitle(titleInput: string): PreparedChatTitle {
	const title = normalizeSessionTitle(titleInput);
	if (title) return { title };
	return titleInput.trim()
		? { reason: `Keep chat names to ${SESSION_TITLE_MAX_LENGTH} characters or fewer.` }
		: { reason: "Enter a chat name." };
}
