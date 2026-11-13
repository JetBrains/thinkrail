import { focusFirstControl } from "@thinkrail/ui/focus";

const CARD_FRAMES = 30;

export function commentCard(root: ParentNode, commentId: string): HTMLElement | undefined {
	return Array.from(root.querySelectorAll<HTMLElement>("[data-comment-id]")).find(
		(element) => element.dataset.commentId === commentId,
	);
}

export function focusCommentCardWhenRendered(
	root: () => ParentNode | null,
	commentId: string,
): void {
	let frames = CARD_FRAMES;
	const attempt = () => {
		const scope = root();
		const card = scope ? commentCard(scope, commentId) : undefined;
		if (card && focusFirstControl(card)) return;
		if (frames-- > 0) requestAnimationFrame(attempt);
	};
	attempt();
}
