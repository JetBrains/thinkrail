/**
 * Chat-history messages longer than this (characters) collapse behind an "Expand" control — except the
 * thread's last message, which always renders in full. Pure + framework-free so it's unit-testable.
 */
export const MESSAGE_COLLAPSE_LIMIT = 300;

/** Whether a message should render collapsed by default: only earlier (non-last) messages, and only
 * when their text exceeds the limit. ≤ limit, or the last message, always renders in full. */
export function shouldCollapseMessage(text: string, isLast: boolean): boolean {
	return !isLast && text.length > MESSAGE_COLLAPSE_LIMIT;
}
