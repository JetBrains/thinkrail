import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import { type FSWatcher, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceFsChangedPayload } from "@thinkrail/contracts";
import { ensureWatch, setWatchPublisher, stopAllWatches, stopWatch } from "./watch";

let dataDir: string;
let root: string;
let now: number;
let priorDataDir: string | undefined;
let payloads: WorkspaceFsChangedPayload[];
const restores: (() => void)[] = [];

function saveWorkspaces(roots: Record<string, string>): void {
	writeFileSync(
		join(dataDir, "workspaces.json"),
		JSON.stringify(
			Object.entries(roots).map(([id, worktreePath]) => ({
				id,
				projectId: "p1",
				name: id,
				branch: id,
				worktreePath,
				baseBranch: "main",
			})),
		),
	);
}

function watchError(code = "ENOSPC"): Error {
	return Object.assign(new Error(`fixture watch failure: ${code}`), { code });
}

function interceptWatch(before: (path: string) => void): { path: string; watcher: FSWatcher }[] {
	const opened: { path: string; watcher: FSWatcher }[] = [];
	const watch = fs.watch;
	const spy = spyOn(fs, "watch").mockImplementation(((...args: Parameters<typeof fs.watch>) => {
		const path = String(args[0]);
		before(path);
		const watcher = watch(...args);
		opened.push({ path, watcher });
		return watcher;
	}) as typeof fs.watch);
	restores.push(() => spy.mockRestore());
	return opened;
}

async function waitFor(check: () => boolean): Promise<void> {
	const deadline = performance.now() + 3_000;
	while (!check()) {
		if (performance.now() > deadline) throw new Error("watch event did not arrive");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

beforeEach(() => {
	priorDataDir = process.env.THINKRAIL_DATA_DIR;
	dataDir = mkdtempSync(join(tmpdir(), "thinkrail-watch-backoff-"));
	root = join(dataDir, "worktree");
	mkdirSync(root);
	root = fs.realpathSync(root);
	process.env.THINKRAIL_DATA_DIR = dataDir;
	saveWorkspaces({ ws1: root });
	payloads = [];
	setWatchPublisher((payload) => payloads.push(payload));
	now = 1_000_000;
	const clock = spyOn(Date, "now").mockImplementation(() => now);
	restores.push(() => clock.mockRestore());
});

afterEach(async () => {
	stopAllWatches();
	setWatchPublisher(null);
	for (const restore of restores.splice(0).reverse()) restore();
	await new Promise((resolve) => setImmediate(resolve));
	rmSync(dataDir, { recursive: true, force: true });
	if (priorDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = priorDataDir;
});

test("ENOSPC root failures back off across reads, double the delay and cap it at five minutes", async () => {
	let attempts = 0;
	interceptWatch((path) => {
		if (path !== root) return;
		attempts += 1;
		throw watchError();
	});
	expect(await ensureWatch("ws1")).toEqual({ startupNudge: true });
	for (let read = 0; read < 20; read++) {
		expect(await ensureWatch("ws1", { prewarm: read % 2 === 0 })).toEqual({ startupNudge: true });
	}
	expect(attempts).toBe(1);

	for (const delay of [30_000, 60_000, 120_000, 240_000, 300_000, 300_000]) {
		const before = attempts;
		now += delay - 1;
		expect(await ensureWatch("ws1")).toEqual({ startupNudge: true });
		expect(attempts).toBe(before);
		now += 1;
		expect(await ensureWatch("ws1")).toEqual({ startupNudge: true });
		expect(attempts).toBe(before + 1);
	}
	expect(payloads).toEqual([]);
});

test.skipIf(process.platform !== "linux")(
	"an ENOSPC directory walk preserves its cooldown, then recovery restores events and resets the streak",
	async () => {
		const child = join(root, "src");
		mkdirSync(child);
		let refuse = true;
		let starts = 0;
		const opened = interceptWatch((path) => {
			if (path === root) starts += 1;
			if (path === child && refuse) throw watchError();
		});
		expect(await ensureWatch("ws1")).toEqual({ startupNudge: true });
		expect(await ensureWatch("ws1")).toEqual({ startupNudge: true });
		expect(starts).toBe(1);
		now += 30_000;
		expect(await ensureWatch("ws1")).toEqual({ startupNudge: true });
		expect(starts).toBe(2);
		now += 30_000;
		expect(await ensureWatch("ws1")).toEqual({ startupNudge: true });
		expect(starts).toBe(2);
		now += 30_000;
		refuse = false;
		expect(await ensureWatch("ws1")).toEqual({ startupNudge: true });
		expect(starts).toBe(3);
		expect(await ensureWatch("ws1")).toEqual({ startupNudge: false });
		payloads.length = 0;
		writeFileSync(join(child, "recovered.ts"), "export {};\n");
		await waitFor(() => payloads.some((payload) => payload.paths.includes("src/recovered.ts")));

		const current = opened.findLast(({ path }) => path === root)?.watcher;
		if (!current) throw new Error("missing recovered root watcher");
		current.emit("error", watchError());
		now += 29_999;
		expect(await ensureWatch("ws1")).toEqual({ startupNudge: true });
		expect(starts).toBe(3);
		now += 1;
		expect(await ensureWatch("ws1")).toEqual({ startupNudge: true });
		expect(starts).toBe(4);
	},
);

test.each(["EACCES", "EMFILE"])("%s failures still retry on the next read", async (code) => {
	let attempts = 0;
	interceptWatch((path) => {
		if (path !== root) return;
		attempts += 1;
		if (attempts === 1) throw watchError(code);
	});
	expect(await ensureWatch("ws1")).toEqual({ startupNudge: true });
	expect(await ensureWatch("ws1")).toEqual({ startupNudge: true });
	expect(attempts).toBe(2);
	expect(await ensureWatch("ws1")).toEqual({ startupNudge: false });
});

test.each([
	"stopWatch",
	"stopAllWatches",
	"workspace removal",
	"missing root",
	"changed path",
	"changed inode",
] as const)("%s clears an ENOSPC cooldown", async (change) => {
	let refuse = true;
	let attempts = 0;
	interceptWatch((path) => {
		if (path !== root) return;
		attempts += 1;
		if (refuse) throw watchError();
	});
	expect(await ensureWatch("ws1")).toEqual({ startupNudge: true });
	if (change === "stopWatch") stopWatch("ws1");
	else if (change === "stopAllWatches") stopAllWatches();
	else if (change === "workspace removal") {
		saveWorkspaces({});
		expect(await ensureWatch("unknown")).toEqual({ startupNudge: false });
		saveWorkspaces({ ws1: root });
	} else if (change === "missing root") {
		renameSync(root, `${root}-away`);
		expect(await ensureWatch("ws1")).toEqual({ startupNudge: true });
		renameSync(`${root}-away`, root);
	} else if (change === "changed path") {
		root = join(dataDir, "replacement");
		mkdirSync(root);
		root = fs.realpathSync(root);
		saveWorkspaces({ ws1: root });
	} else {
		mkdirSync(`${root}-next`);
		renameSync(root, `${root}-away`);
		renameSync(`${root}-next`, root);
	}
	refuse = false;
	expect(await ensureWatch("ws1")).toEqual({ startupNudge: true });
	expect(attempts).toBe(2);
	expect(await ensureWatch("ws1")).toEqual({ startupNudge: false });
});

test("one workspace's cooldown does not delay another worktree", async () => {
	const other = join(dataDir, "other");
	mkdirSync(other);
	saveWorkspaces({ ws1: root, ws2: other });
	interceptWatch((path) => {
		if (path === root) throw watchError();
	});
	expect(await ensureWatch("ws1")).toEqual({ startupNudge: true });
	expect(await ensureWatch("ws2")).toEqual({ startupNudge: true });
	expect(await ensureWatch("ws2")).toEqual({ startupNudge: false });
	expect(await ensureWatch("ws1")).toEqual({ startupNudge: true });
});

test("a queued error from a retired watcher cannot stop or cool down its replacement", async () => {
	const opened = interceptWatch(() => {});
	await ensureWatch("ws1");
	const first = opened.find(({ path }) => path === root)?.watcher;
	if (!first) throw new Error("missing initial root watcher");
	const callbacks = first.listeners("error");
	expect(callbacks.length).toBeGreaterThan(0);
	stopWatch("ws1");
	await ensureWatch("ws1");
	for (const callback of callbacks) callback(watchError());
	expect(await ensureWatch("ws1")).toEqual({ startupNudge: false });
	writeFileSync(join(root, "current.ts"), "export {};\n");
	await waitFor(() => payloads.some((payload) => payload.paths.includes("current.ts")));
});
