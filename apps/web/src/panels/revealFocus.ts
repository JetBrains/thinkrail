const REVEAL_FRAMES = 60;

export function focusWhenRevealed(find: () => HTMLElement | null | undefined): void {
	let frames = REVEAL_FRAMES;
	const attempt = () => {
		const target = find();
		target?.focus({ preventScroll: true });
		if (target && document.activeElement === target) return;
		if (frames-- > 0) requestAnimationFrame(attempt);
	};
	requestAnimationFrame(attempt);
}
