import type { BashOperations } from "@earendil-works/pi-coding-agent";

export async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("Condition timed out");
		await Bun.sleep(5);
	}
}

export function controlledOperations() {
	type Call = {
		command: string;
		cwd: string;
		options: Parameters<BashOperations["exec"]>[2];
		resolve(value: { exitCode: number | null }): void;
		reject(error: Error): void;
	};
	const calls: Call[] = [];
	return {
		calls,
		call(index = 0): Call {
			const call = calls[index];
			if (!call) throw new Error(`Missing executor call ${index}`);
			return call;
		},
		createOperations(): BashOperations {
			return {
				exec: (command, cwd, options) =>
					new Promise((resolve, reject) => {
						calls.push({ command, cwd, options, resolve, reject });
					}),
			};
		},
	};
}
