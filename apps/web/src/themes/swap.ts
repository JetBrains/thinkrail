export interface ThemeSwapOptions {
	readonly settle?: boolean;
}

const SETTLE_MS = 120;

const listeners = new Set<() => void>();
let applied: string | null = null;
let notified: string | null = null;
let scheduled = false;

const nextFrame = (run: () => void) => {
	if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
	else setTimeout(run, 0);
};

const flush = () => {
	scheduled = false;
	if (applied === notified) return;
	notified = applied;
	for (const listener of [...listeners]) if (listeners.has(listener)) listener();
};

export const recordThemeApplication = (signature: string) => {
	if (signature === applied) return false;
	applied = signature;
	if (!scheduled) {
		scheduled = true;
		nextFrame(flush);
	}
	return true;
};

const settled = (onSwap: () => void) => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let pending = false;
	const expire = () => {
		timer = undefined;
		if (!pending) return;
		pending = false;
		onSwap();
	};
	return {
		notify: () => {
			if (timer === undefined) onSwap();
			else pending = true;
			clearTimeout(timer);
			timer = setTimeout(expire, SETTLE_MS);
		},
		stop: () => clearTimeout(timer),
	};
};

export const onThemeSwap = (onSwap: () => void, { settle = false }: ThemeSwapOptions = {}) => {
	const settler = settle ? settled(onSwap) : null;
	const listener = settler ? settler.notify : () => onSwap();
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
		settler?.stop();
	};
};
