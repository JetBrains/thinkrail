import { focusFirstControl } from "@thinkrail/ui/focus";

const REVEAL_FRAMES = 60;

export function focusWhenRevealed(find: () => Element | null | undefined): void {
	let frames = REVEAL_FRAMES;
	const attempt = () => {
		const container = find();
		if (container && focusFirstControl(container)) return;
		if (frames-- > 0) requestAnimationFrame(attempt);
	};
	requestAnimationFrame(attempt);
}
