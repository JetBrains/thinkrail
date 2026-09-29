export function attributionClaimOnFirstReadiness(start: () => void): () => void {
	let started = false;
	return () => {
		if (started) return;
		started = true;
		start();
	};
}
