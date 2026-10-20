import { gitAsync } from "./gitExec";

const MAX_ARGS_CHARS = 24_000;
const TIMEOUT_MS = 10_000;

function argChunks(paths: readonly string[]): string[][] {
	const chunks: string[][] = [];
	let current: string[] = [];
	let length = 0;
	for (const path of paths) {
		if (current.length > 0 && length + path.length + 1 > MAX_ARGS_CHARS) {
			chunks.push(current);
			current = [];
			length = 0;
		}
		current.push(path);
		length += path.length + 1;
	}
	if (current.length > 0) chunks.push(current);
	return chunks;
}

export async function ignoredPaths(
	worktreePath: string,
	paths: readonly string[],
): Promise<Set<string>> {
	const runs = await Promise.all(
		argChunks(paths).map((chunk) =>
			gitAsync(worktreePath, ["-c", "core.quotePath=false", "check-ignore", "--", ...chunk], {
				timeoutMs: TIMEOUT_MS,
				raw: true,
			}),
		),
	);
	const ignored = new Set<string>();
	for (const run of runs) {
		if (!run.ok) continue;
		for (const raw of run.out.split("\n")) {
			const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
			if (line && !line.startsWith('"')) ignored.add(line);
		}
	}
	return ignored;
}
