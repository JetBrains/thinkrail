export const SEND_ACK_MS = 10_000;

export async function ackSend(
	run: Promise<void>,
	windowMs: number = SEND_ACK_MS,
	signal?: AbortSignal,
): Promise<void> {
	let acked = false;
	const guarded = run.catch((err) => {
		if (!acked) throw err;
	});
	await Promise.race([
		guarded,
		new Promise<void>((resolve) => {
			setTimeout(resolve, windowMs);
			if (signal?.aborted) resolve();
			signal?.addEventListener("abort", () => resolve(), { once: true });
		}),
	]);
	acked = true;
}
