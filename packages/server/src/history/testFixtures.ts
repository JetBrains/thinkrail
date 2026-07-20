import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Writes a minimal but real pi session JSONL file, parseable by pi's actual
 * `SessionManager.list`/`listAll` (see SPEC.md's "pi file format" note for the pinned facts this
 * relies on: header shape, `.jsonl`-suffix discovery, `cwd` recovery from the header).
 *
 * Writes **flat**, directly under `dir` — a custom `sessionDir` is read non-recursively by pi, so
 * multi-session fixtures must NOT nest files in per-cwd subdirectories the way pi's real default
 * sessions root does; distinct `cwd`s are expressed via each file's own header instead.
 *
 * Exported (not test-only in the barrel sense) so A5's e2e fixture seeder can reuse it against a real
 * on-disk sessions directory.
 *
 * @returns the written file's path — callers can `appendFileSync` more lines onto it directly (e.g. to
 * exercise `HistoryIndex`'s mtime revalidation).
 */
export function writeFixtureSession(
	dir: string,
	opts: {
		id: string;
		cwd: string;
		name?: string;
		messages: Array<{ role: "user" | "assistant"; text: string; timestamp: number }>;
	},
): string {
	mkdirSync(dir, { recursive: true });

	const entryId = (suffix: string) => `${opts.id}-${suffix}`;
	let parentId: string | null = null;
	const lines: string[] = [
		JSON.stringify({
			type: "session",
			version: 3,
			id: opts.id,
			timestamp: new Date(opts.messages[0]?.timestamp ?? Date.now()).toISOString(),
			cwd: opts.cwd,
		}),
	];

	if (opts.name !== undefined) {
		const id = entryId("info");
		lines.push(
			JSON.stringify({
				type: "session_info",
				id,
				parentId,
				timestamp: new Date().toISOString(),
				name: opts.name,
			}),
		);
		parentId = id;
	}

	opts.messages.forEach((m, i) => {
		const id = entryId(`m${i}`);
		lines.push(
			JSON.stringify({
				type: "message",
				id,
				parentId,
				timestamp: new Date(m.timestamp).toISOString(),
				message: { role: m.role, content: m.text, timestamp: m.timestamp },
			}),
		);
		parentId = id;
	});

	const path = join(dir, `${opts.messages[0]?.timestamp ?? Date.now()}_${opts.id}.jsonl`);
	writeFileSync(path, `${lines.join("\n")}\n`);
	return path;
}
