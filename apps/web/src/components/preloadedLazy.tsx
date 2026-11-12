import { type ComponentType, lazy, useState } from "react";

export function preloadedLazy<P extends object>(
	load: () => Promise<{ default: ComponentType<P> }>,
) {
	let pending: Promise<{ default: ComponentType<P> }> | undefined;
	let loaded: ComponentType<P> | undefined;
	let failed = false;
	const start = () => {
		if (!pending) {
			pending = load();
			pending.then(
				(module) => {
					loaded = module.default;
				},
				() => {
					failed = true;
				},
			);
		}
		return pending;
	};
	let Lazy = lazy(start);
	const preload = () => {
		if (failed) {
			failed = false;
			pending = undefined;
			Lazy = lazy(start);
		}
		return start();
	};
	function Preloaded(props: P) {
		const [Component] = useState(() => loaded ?? Lazy);
		return <Component {...props} />;
	}
	return Object.assign(Preloaded, { preload });
}
