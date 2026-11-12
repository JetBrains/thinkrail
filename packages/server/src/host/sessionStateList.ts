export function trailingSingleFlight<T>(run: () => Promise<T>): () => Promise<T> {
	let current: Promise<T> | null = null;
	let next: Promise<T> | null = null;
	const launch = (): Promise<T> => {
		const scan = Promise.resolve().then(run);
		current = scan;
		const clear = () => {
			if (current === scan) current = null;
		};
		scan.then(clear, clear);
		return scan;
	};
	return () => {
		if (current === null) return launch();
		next ??= current
			.then(
				() => undefined,
				() => undefined,
			)
			.then(() => {
				next = null;
				return launch();
			});
		return next;
	};
}
