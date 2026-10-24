import { normalizeSessionTitle, SESSION_TITLE_MAX_LENGTH } from "@thinkrail/contracts";
import { t } from "@thinkrail/locales/react";

export type PreparedChatTitle = { title: string } | { reason: string };

export function prepareChatTitle(titleInput: string): PreparedChatTitle {
	const title = normalizeSessionTitle(titleInput);
	if (title) return { title };
	return titleInput.trim()
		? { reason: t("chat.title.tooLong", { max: SESSION_TITLE_MAX_LENGTH }) }
		: { reason: t("chat.title.empty") };
}
