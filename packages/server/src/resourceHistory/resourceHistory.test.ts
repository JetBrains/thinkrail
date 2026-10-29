import { afterEach, beforeEach, expect, test } from "bun:test";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type BackgroundCommandSummary,
	type ResourceRecord,
	resourceRecordId,
	type SubagentResourceSummary,
	tallyResources,
} from "@thinkrail/contracts";
import {
	archivedCommandOutput,
	finishedResources,
	pageResources,
	recordResource,
	removeWorkspaceResourceHistory,
	resourceHistoryRoot,
} from "./resourceHistory";

type Archive = typeof import("./resourceHistory");

let dataDir: string;
let restarts = 0;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;
const scope = { workspaceId: "w1", sessionId: "chat-1" };
const none = new Set<string>();

beforeEach(() => {
	dataDir = mkdtempSync(join(tmpdir(), "trpi-resource-history-"));
	process.env.THINKRAIL_DATA_DIR = dataDir;
});

afterEach(() => {
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
	rmSync(dataDir, { recursive: true, force: true });
});

async function restartedArchive(): Promise<Archive> {
	return (await import(`${"./resourceHistory.ts"}?restart=${++restarts}`)) as Archive;
}

function command(
	id: string,
	patch: Partial<BackgroundCommandSummary> = {},
): Extract<ResourceRecord, { kind: "command" }> {
	return {
		kind: "command",
		summary: {
			id,
			sessionId: scope.sessionId,
			name: id,
			command: `run ${id}`,
			status: "completed",
			startedAt: 1_000,
			finishedAt: 2_000,
			exitCode: 0,
			...patch,
		},
	};
}

function inFlight(id: string, patch: Partial<BackgroundCommandSummary> = {}) {
	const {
		finishedAt: _finishedAt,
		exitCode: _exitCode,
		...summary
	} = command(id, {
		status: "running",
		...patch,
	}).summary;
	return { kind: "command", summary } satisfies ResourceRecord;
}

function subagent(
	childSessionId: string,
	patch: Partial<SubagentResourceSummary> = {},
): Extract<ResourceRecord, { kind: "subagent" }> {
	return {
		kind: "subagent",
		summary: {
			childSessionId,
			parentSessionId: scope.sessionId,
			roleName: "Explore",
			task: `task ${childSessionId}`,
			status: "completed",
			createdAt: new Date(1_000).toISOString(),
			durationMs: 500,
			finishedAt: 1_500,
			...patch,
		},
	};
}

function indexLines(): string[] {
	return readFileSync(join(resourceHistoryRoot(), "w1", "chat-1", "index.jsonl"), "utf8")
		.split("\n")
		.filter(Boolean);
}

test("records upsert by id and survive a host restart", async () => {
	recordResource(scope, inFlight("c1"));
	recordResource(scope, command("c1"));
	recordResource(scope, command("c1"));
	recordResource(scope, subagent("child-1"));
	expect(indexLines()).toHaveLength(3);

	const restarted = await restartedArchive();
	expect(restarted.finishedResources(scope, "command", none)).toEqual([command("c1")]);
	expect(restarted.finishedResources(scope, "subagent", none)).toEqual([subagent("child-1")]);
});

test("a run still in flight that no live owner reports reads as interrupted with a terminal status; a live one is left to its owner", async () => {
	const running = inFlight("dev", { startedAt: 3_000 });
	recordResource(scope, running);
	const {
		finishedAt: _finishedAt,
		durationMs: _durationMs,
		...child
	} = subagent("child-1", {
		status: "running",
	}).summary;
	recordResource(scope, { kind: "subagent", summary: child });
	recordResource(scope, command("tests", { finishedAt: 2_500 }));

	expect(finishedResources(scope, "command", new Set(["dev"])).map(resourceRecordId)).toEqual([
		"tests",
	]);
	const restarted = await restartedArchive();
	expect(restarted.finishedResources(scope, "command", none)).toEqual([
		{ kind: "command", summary: { ...running.summary, status: "stopped", interrupted: true } },
		command("tests", { finishedAt: 2_500 }),
	]);
	expect(restarted.finishedResources(scope, "subagent", none)[0]?.summary).toMatchObject({
		status: "aborted",
		interrupted: true,
	});
});

test("a finished command keeps its log tail across a restart; a crash-interrupted one has none", async () => {
	recordResource(scope, inFlight("dev"), {
		text: "partial",
		truncated: false,
	});
	recordResource(scope, command("tests"), { text: "1 pass\n", truncated: true });

	const restarted = await restartedArchive();
	expect(restarted.archivedCommandOutput(scope, "tests")).toEqual({
		text: "1 pass\n",
		truncated: true,
	});
	expect(restarted.archivedCommandOutput(scope, "dev")).toBeUndefined();
	expect(restarted.archivedCommandOutput(scope, "../w1/chat-1/index")).toBeUndefined();
});

test("a torn or foreign line is skipped and the next record still lands on its own line", async () => {
	const dir = join(resourceHistoryRoot(), "w1", "chat-1");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "index.jsonl"),
		[
			JSON.stringify({ kind: "command", summary: command("old").summary }),
			"not json",
			JSON.stringify({ kind: "terminal", summary: { id: "x" } }),
			JSON.stringify({ kind: "command", summary: { id: "bad", status: "exploded" } }),
			'{"kind":"command","summary":{"id":"torn"',
		].join("\n"),
	);
	recordResource(scope, command("new", { finishedAt: 3_000 }));

	const restarted = await restartedArchive();
	expect(restarted.finishedResources(scope, "command", none).map(resourceRecordId)).toEqual([
		"new",
		"old",
	]);
});

test.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
	"a failed append never glues the next record onto a possibly torn line",
	async () => {
		recordResource(scope, command("before"));
		const index = join(resourceHistoryRoot(), "w1", "chat-1", "index.jsonl");
		chmodSync(index, 0o444);
		try {
			recordResource(scope, command("lost"));
		} finally {
			chmodSync(index, 0o644);
		}
		recordResource(scope, command("after", { finishedAt: 3_000 }));

		expect(readFileSync(index, "utf8")).toContain("\n\n");
		const restarted = await restartedArchive();
		expect(restarted.finishedResources(scope, "command", none).map(resourceRecordId)).toEqual([
			"after",
			"before",
		]);
	},
);

test("pages walk newest first from a cursor and tallies count every outcome", () => {
	for (let index = 0; index < 5; index++)
		recordResource(scope, command(`c${index}`, { finishedAt: 10_000 + index }));
	recordResource(scope, command("failed", { status: "error", exitCode: 1, finishedAt: 1 }));
	recordResource(scope, command("stopped", { status: "stopped", finishedAt: 2 }));
	recordResource(scope, inFlight("cut", { status: "stopping", startedAt: 0 }));
	const finished = finishedResources(scope, "command", none);

	const first = pageResources(finished, undefined, 3);
	expect(first.items.map(resourceRecordId)).toEqual(["c4", "c3", "c2"]);
	expect(first.hasMore).toBe(true);
	const last = pageResources(finished, { at: 10_002, id: "c2" }, 10);
	expect(last.items.map(resourceRecordId)).toEqual(["c1", "c0", "stopped", "failed", "cut"]);
	expect(last.hasMore).toBe(false);
	expect(tallyResources(finished)).toEqual({ done: 5, failed: 1, stopped: 1, interrupted: 1 });
});

test("unsafe ids never touch the filesystem", () => {
	recordResource({ workspaceId: "..", sessionId: "chat-1" }, command("c1"));
	recordResource({ workspaceId: "w1", sessionId: "../escape" }, command("c1"));
	recordResource(scope, command("../../escape"));
	expect(existsSync(resourceHistoryRoot())).toBe(false);
	expect(finishedResources({ workspaceId: "w1", sessionId: "a/b" }, "command", none)).toEqual([]);
});

test("removing a workspace drops its history on disk and in memory", () => {
	recordResource(scope, command("c1"), { text: "log", truncated: false });
	recordResource({ workspaceId: "w2", sessionId: "chat-2" }, command("c2"));
	removeWorkspaceResourceHistory("w1");

	expect(existsSync(join(resourceHistoryRoot(), "w1"))).toBe(false);
	expect(finishedResources(scope, "command", none)).toEqual([]);
	expect(archivedCommandOutput(scope, "c1")).toBeUndefined();
	expect(
		finishedResources({ workspaceId: "w2", sessionId: "chat-2" }, "command", none),
	).toHaveLength(1);
});
