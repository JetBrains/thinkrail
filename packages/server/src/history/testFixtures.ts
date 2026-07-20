import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

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
		// `UserMessage.content` is typed as `string | (TextContent | ImageContent)[]` (a bare string is
		// valid), but `AssistantMessage.content` is array-only — pi never emits a bare string there, since
		// an assistant turn can interleave text with thinking/tool-call blocks. Web-client code (e.g.
		// `chat/rows.ts`'s `deriveRows`, `chat/ChatView.tsx`'s jump-anchor matching) relies on that
		// distinction, so a fixture with a bare-string assistant `content` silently renders as an empty
		// turn instead of tripping a loud parse error — match each role's real shape.
		const content = m.role === "assistant" ? [{ type: "text", text: m.text }] : m.text;
		lines.push(
			JSON.stringify({
				type: "message",
				id,
				parentId,
				timestamp: new Date(m.timestamp).toISOString(),
				message: { role: m.role, content, timestamp: m.timestamp },
			}),
		);
		parentId = id;
	});

	const path = join(dir, `${opts.messages[0]?.timestamp ?? Date.now()}_${opts.id}.jsonl`);
	writeFileSync(path, `${lines.join("\n")}\n`);
	return path;
}

/**
 * Replica of pi's `getDefaultSessionDirPath` (`core/session-manager.js`) — the encoding
 * `SessionManager.list(cwd)` / no-arg `listAll()` use to compute where a cwd's sessions live when no
 * explicit `sessionDir` is passed: `${agentDir}/sessions/--<cwd, / and \ and : → '-'>--`. Not importable:
 * that helper isn't exported from `session-manager.js`, and even the mkdir-ing wrapper that IS exported
 * from it (`getDefaultSessionDir`) isn't re-exported from the package root `@earendil-works/pi-coding-agent`
 * index (checked `dist/index.js`) — so this is a from-scratch replica, not a thin wrapper.
 *
 * Pinned by testFixtures.test.ts's "default layout" case against a real `SessionManager.list(cwd)` call;
 * re-verify against `dist/core/session-manager.js` on a pi version bump.
 *
 * Exported (not test-only in the barrel sense) so A5's e2e fixture seeder can compute the same directory
 * for an arbitrary cwd (`seedWorkspaceSession`) without duplicating the regex.
 */
export function defaultSessionDirFor(agentDir: string, cwd: string): string {
	const resolvedCwd = resolve(cwd);
	const resolvedAgentDir = resolve(agentDir);
	const safePath = `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	return join(resolvedAgentDir, "sessions", safePath);
}
