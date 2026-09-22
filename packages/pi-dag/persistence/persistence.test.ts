import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import {
	chmod,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rename,
	rm,
	stat,
	symlink,
	utimes,
	writeFile,
} from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { canonicalJson, DagError, type DagFailureCode, LIMITS } from "../domain/index.ts";
import { snapshot } from "./fixtures.ts";
import { createDagStore } from "./index.ts";

const roots: string[] = [];
const processes: Array<{ child: ChildProcessWithoutNullStreams; done: Promise<void> }> = [];
const scope = "user/../scope/cwd";
const scopeHash = createHash("sha256").update(scope).digest("hex");

async function fixture() {
	const root = await realpath(await mkdtemp(join(tmpdir(), "pi-dag-persistence-")));
	roots.push(root);
	const storageRoot = join(root, "storage");
	const store = createDagStore({ storageRoot, scope });
	return {
		root,
		storageRoot,
		store,
		dir: join(storageRoot, scopeHash, "dag"),
	};
}

async function failure(operation: Promise<unknown>, code: DagFailureCode) {
	try {
		await operation;
		throw new Error(`Expected ${code}`);
	} catch (error) {
		expect(error).toBeInstanceOf(DagError);
		if (!(error instanceof DagError)) throw error;
		expect(error.failure.code).toBe(code);
	}
}

function childStore(storageRoot: string, mode: string) {
	const child = spawn(
		process.execPath,
		[fileURLToPath(new URL("./process.fixture.ts", import.meta.url)), storageRoot, scope, mode],
		{ stdio: "pipe" },
	);
	const lines = createInterface({ input: child.stdout });
	let stderr = "";
	child.stderr.setEncoding("utf8").on("data", (data: string) => {
		stderr += data;
	});
	const message = new Promise<Record<string, unknown>>((resolve, reject) => {
		lines.once("line", (line) => resolve(JSON.parse(line)));
		child.once("error", reject);
		child.once("close", () => reject(new Error(`Child exited before reporting: ${stderr}`)));
	});
	const done = new Promise<void>((resolve) => child.once("close", () => resolve()));
	processes.push({ child, done });
	return { child, message, done };
}

afterEach(async () => {
	for (const { child, done } of processes.splice(0)) {
		if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
		await done;
	}
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("DAG snapshots", () => {
	test("creation and update CAS, detached snapshots and summaries", async () => {
		const { store, storageRoot } = await fixture();
		expect(await store.read("dag")).toBeUndefined();
		expect(await store.list()).toEqual([]);
		const lease = await store.claim("dag");
		const abandoned = await store.claim("empty");
		const state = await snapshot(store, scope);
		await failure(lease.save({ ...state, version: 2 }, undefined), "stale-version");
		await failure(lease.save(state, 1), "stale-version");
		const saving = lease.save(state, undefined);
		state.title = "not committed";
		const worker = state.nodes.worker;
		if (!worker) throw new Error("Missing fixture worker");
		worker.id = "other";
		await saving;
		const first = await store.read("dag");
		expect(first?.title).toBe("Stored DAG");
		expect(first?.nodes.worker?.id).toBe("worker");
		if (!first) throw new Error("Missing snapshot");
		await failure(lease.save(first, undefined), "stale-version");
		await failure(lease.save(first, 1), "stale-version");
		await failure(lease.save({ ...first, version: 3 }, 1), "stale-version");
		await lease.save({ ...first, version: 2, title: "Second" }, 1);
		first.title = "mutated read";
		expect((await store.read("dag"))?.title).toBe("Second");
		const other = createDagStore({ storageRoot, scope });
		expect((await other.read("dag"))?.version).toBe(2);
		expect(await store.list()).toEqual([
			{
				dagId: "dag",
				title: "Second",
				version: 2,
				graphRevision: 1,
				mode: "paused",
				lifecycle: "active",
				createdAt: "2026-01-01",
				updatedAt: "2026-01-01",
			},
		]);
		await lease.release();
		await abandoned.release();
	});

	test("revocation at publication leaves the predecessor intact and removes the temporary snapshot", async () => {
		const { store, dir } = await fixture();
		const lease = await store.claim("dag");
		const state = await snapshot(store, scope);
		await lease.save(state, undefined);
		let checks = 0;
		await failure(
			lease.save({ ...state, version: 2, title: "Revoked" }, 1, () => {
				checks++;
				throw new DagError({ code: "revoked", message: "Caller revoked before publication" });
			}),
			"revoked",
		);
		expect(checks).toBe(1);
		expect((await store.read("dag"))?.version).toBe(1);
		expect((await readdir(dir)).some((name) => name.startsWith(".tmp-"))).toBe(false);
		await lease.release();
	});

	test("reads stay internally version consistent during atomic replacements", async () => {
		const { store, storageRoot } = await fixture();
		const lease = await store.claim("dag");
		const state = await snapshot(store, scope);
		state.title = "version-1";
		await lease.save(state, undefined);
		const reader = createDagStore({ storageRoot, scope });
		await Promise.all([
			(async () => {
				for (let version = 2; version <= 15; version++) {
					await lease.save(
						{ ...state, version, title: `version-${version}`, graphRevision: version },
						version - 1,
					);
				}
			})(),
			(async () => {
				for (let i = 0; i < 80; i++) {
					const current = await reader.read("dag");
					expect(current?.title).toBe(`version-${current?.version}`);
					expect(current?.graphRevision).toBe(current?.version);
				}
			})(),
		]);
		expect((await reader.read("dag"))?.version).toBe(15);
		await lease.release();
	});

	test("validates identity and unknown/corrupt state on every read and write", async () => {
		const { store, dir } = await fixture();
		const lease = await store.claim("dag");
		const state = await snapshot(store, scope);
		await failure(lease.save({ ...state, scope: "elsewhere" }, undefined), "corrupt-state");
		await failure(lease.save({ ...state, dagId: "elsewhere" }, undefined), "corrupt-state");
		await failure(lease.save({ ...state, nodes: {} }, undefined), "corrupt-state");
		await lease.save(state, undefined);
		for (const bytes of [
			"{",
			canonicalJson({ ...state, schemaVersion: 2 }),
			canonicalJson({ ...state, scope: "elsewhere" }),
			canonicalJson({ ...state, dagId: "elsewhere" }),
			canonicalJson({ ...state, unexpected: true }),
		]) {
			await writeFile(join(dir, "state.json"), bytes);
			await failure(store.read("dag"), "corrupt-state");
			await failure(store.list(), "corrupt-state");
			await failure(lease.save({ ...state, version: 2 }, 1), "corrupt-state");
			expect(await readFile(join(dir, "state.json"), "utf8")).toBe(bytes);
		}
		await lease.release();
	});

	test("scope namespaces are hashed and unsafe ids cannot traverse", async () => {
		const { store, storageRoot } = await fixture();
		const lease = await store.claim("dag");
		await lease.save(await snapshot(store, scope), undefined);
		expect(await readdir(storageRoot)).toEqual([scopeHash]);
		const other = createDagStore({ storageRoot, scope: "different scope" });
		expect(await other.read("dag")).toBeUndefined();
		expect(await other.list()).toEqual([]);
		for (const dagId of ["../dag", "/absolute", "..", "a/b", "a\\b", "dag\n", "x".repeat(129)]) {
			await failure(store.claim(dagId), "invalid-command");
			await failure(store.read(dagId), "invalid-command");
		}
		await lease.release();
	});
});

describe("captured payloads", () => {
	test("detaches caller buffers, deduplicates concurrent content, verifies loads", async () => {
		const { store, dir } = await fixture();
		const lease = await store.claim("dag");
		const bytes = new Uint8Array([1, 2, 3]);
		const pending = store.put("dag", bytes);
		bytes.fill(9);
		const file = await pending;
		const copies = await Promise.all(
			Array.from({ length: 8 }, () => store.put("dag", new Uint8Array([1, 2, 3]))),
		);
		expect(copies.every((copy) => canonicalJson(copy) === canonicalJson(file))).toBe(true);
		expect(() => store.reference("dag", { ...file, artifactId: "../../state.json" })).toThrow(
			DagError,
		);
		expect(file.artifactId).toBe(file.sha256);
		expect(file.sizeBytes).toBe(3);
		expect(await readdir(join(dir, "payloads"))).toEqual([file.artifactId]);
		const input = { ...file };
		const loading = store.load("dag", input);
		input.sha256 = "0".repeat(64);
		expect(Array.from(await loading)).toEqual([1, 2, 3]);
		const read = await store.load("dag", file);
		read.fill(0);
		expect(Array.from(await store.load("dag", file))).toEqual([1, 2, 3]);
		await failure(store.load("dag", { ...file, artifactId: "0".repeat(64) }), "corrupt-state");
		await failure(store.load("dag", { ...file, sizeBytes: 2 }), "corrupt-state");
		await failure(store.load("dag", { ...file, sizeBytes: 4 }), "corrupt-state");
		await writeFile(store.reference("dag", file).localPath, new Uint8Array([3, 2, 1]));
		await failure(store.load("dag", file), "corrupt-state");
		await failure(store.put("dag", new Uint8Array([1, 2, 3])), "corrupt-state");
		expect(Array.from(await readFile(join(dir, "payloads", file.artifactId)))).toEqual([3, 2, 1]);
		await lease.release();
	});

	test("enforces byte quotas including UTF-8, defaults and the history ceiling", async () => {
		const { store } = await fixture();
		const lease = await store.claim("dag");
		expect((await store.put("dag", "", 0)).sizeBytes).toBe(0);
		await failure(store.put("dag", "é", 1), "limit-exceeded");
		expect((await store.put("dag", "é", 2)).sizeBytes).toBe(2);
		await failure(store.put("dag", new Uint8Array(LIMITS.valueBytes + 1)), "limit-exceeded");
		expect(
			(await store.put("dag", new Uint8Array(LIMITS.valueBytes + 1), LIMITS.historyBytes))
				.sizeBytes,
		).toBe(LIMITS.valueBytes + 1);
		await failure(
			store.put("dag", new Uint8Array(LIMITS.historyBytes + 1), LIMITS.historyBytes),
			"limit-exceeded",
		);
		for (const max of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, LIMITS.historyBytes + 1]) {
			await failure(store.put("dag", "small", max), "limit-exceeded");
		}
		await lease.release();
	});
});

describe("ownership", () => {
	test("same-process stores and root aliases cannot steal; unrelated DAGs remain writable", async () => {
		const { store, storageRoot, root } = await fixture();
		const other = createDagStore({ storageRoot, scope });
		expect(await other.ownerStatus("dag")).toBe("inactive");
		const lease = await store.claim("dag");
		expect(await other.ownerStatus("dag")).toBe("held");
		await failure(other.claim("dag"), "resource-in-use");
		await failure(store.claim("dag"), "resource-in-use");
		await failure(other.put("dag", "no lease"), "resource-in-use");
		const alias = join(root, "alias");
		await symlink(storageRoot, alias);
		await failure(createDagStore({ storageRoot: alias, scope }).claim("dag"), "resource-in-use");
		const second = await other.claim("second");
		await second.save(await snapshot(other, scope, "second"), undefined);
		await second.release();
		await lease.release();
		expect(await other.ownerStatus("dag")).toBe("inactive");
		const replacement = await other.claim("dag");
		await lease.release();
		await failure(store.claim("dag"), "resource-in-use");
		await failure(lease.save(await snapshot(other, scope), undefined), "resource-in-use");
		await replacement.release();
	});

	test("proven process death allows recovery, with one winner among competing processes", async () => {
		const { store, storageRoot } = await fixture();
		const original = childStore(storageRoot, "create");
		expect((await original.message).claimed).toBe(true);
		await failure(store.claim("dag"), "resource-in-use");
		expect((await store.read("dag"))?.version).toBe(1);
		const reader = childStore(storageRoot, "reader");
		expect(await reader.message).toEqual({
			version: 1,
			claim: "resource-in-use",
			put: "resource-in-use",
		});
		await reader.done;
		original.child.kill("SIGKILL");
		await original.done;
		const competitors = Array.from({ length: 4 }, () => childStore(storageRoot, "hold"));
		const results = await Promise.all(competitors.map((child) => child.message));
		expect(results.filter((result) => result.claimed === true)).toHaveLength(1);
		expect(results.filter((result) => result.code === "resource-in-use")).toHaveLength(3);
		await failure(store.claim("dag"), "resource-in-use");
		for (const competitor of competitors) competitor.child.stdin.end();
		await Promise.all(competitors.map((child) => child.done));
		const recovered = await store.claim("dag");
		const state = await store.read("dag");
		if (!state) throw new Error("Lost committed snapshot");
		await recovered.save({ ...state, version: 2 }, 1);
		await recovered.release();
	});

	test("malformed and ambiguous ownership blocks, and old live PIDs never expire", async () => {
		const { store, dir } = await fixture();
		const owners = join(dir, "owners");
		await mkdir(owners, { recursive: true });
		const path = join(owners, "1.json");
		const owner = { schemaVersion: 1, host: hostname(), pid: process.pid, token: "a".repeat(64) };
		for (const value of [
			"",
			"{}",
			...[
				{ schemaVersion: 2 },
				{ host: "another-host", pid: 2147483647 },
				{ pid: -1 },
				{ pid: 1 },
				{},
			].map((patch) => canonicalJson({ ...owner, ...patch })),
			`{"host":${JSON.stringify(hostname())},"pid":${process.pid},"pid":2147483647,"schemaVersion":1,"token":"${"a".repeat(64)}"}`,
		]) {
			await writeFile(path, value);
			await utimes(path, new Date(0), new Date(0));
			await failure(store.claim("dag"), "resource-in-use");
			expect(await readFile(path, "utf8")).toBe(value);
		}
		await writeFile(path, canonicalJson(owner));
		await writeFile(
			join(owners, "1.released"),
			JSON.stringify({ schemaVersion: 1, token: "b".repeat(64) }),
		);
		await failure(store.claim("dag"), "resource-in-use");
		await rm(join(owners, "1.released"));
		await writeFile(join(owners, "unexpected"), "unknown");
		await failure(store.claim("dag"), "resource-in-use");
	});

	test("save and release validate the exact owner token", async () => {
		const { store, dir } = await fixture();
		const lease = await store.claim("dag");
		const state = await snapshot(store, scope);
		await lease.save(state, undefined);
		const path = join(dir, "owners", "1.json");
		const owner = JSON.parse(await readFile(path, "utf8"));
		const replacement = { ...owner, token: "b".repeat(64) };
		await writeFile(path, JSON.stringify(replacement));
		await failure(lease.save({ ...state, version: 2 }, 1), "resource-in-use");
		await failure(store.put("dag", "lost ownership"), "resource-in-use");
		await failure(lease.release(), "resource-in-use");
		expect(JSON.parse(await readFile(path, "utf8"))).toEqual(replacement);
		expect((await store.read("dag"))?.version).toBe(1);
		expect(await readdir(join(dir, "owners"))).toEqual(["1.json"]);
	});

	test("release closes admission, awaits in-flight save and payloads, and is idempotent", async () => {
		const { store, storageRoot } = await fixture();
		const lease = await store.claim("dag");
		const state = await snapshot(store, scope);
		const saving = lease.save(state, undefined);
		await failure(lease.save(state, undefined), "resource-in-use");
		const payload = store.put("dag", new Uint8Array(1024 * 1024));
		const release = lease.release();
		expect(lease.release()).toBe(release);
		await failure(store.put("dag", "late"), "resource-in-use");
		await failure(lease.save({ ...state, version: 2 }, 1), "resource-in-use");
		await release;
		await saving;
		const file = await payload;
		expect((await store.load("dag", file)).byteLength).toBe(file.sizeBytes);
		expect((await store.read("dag"))?.version).toBe(1);
		const other = createDagStore({ storageRoot, scope });
		const next = await other.claim("dag");
		await next.save({ ...state, version: 2 }, 1);
		await next.release();
	});
});

describe("containment and failure handling", () => {
	test("rejects symlink directories, snapshot links and nonregular snapshot files", async () => {
		const { store, dir, root } = await fixture();
		const lease = await store.claim("dag");
		const state = await snapshot(store, scope);
		const outside = join(root, "outside.json");
		await writeFile(outside, canonicalJson(state));
		await symlink(outside, join(dir, "state.json"));
		await failure(store.read("dag"), "corrupt-state");
		await failure(store.list(), "corrupt-state");
		await failure(lease.save(state, undefined), "corrupt-state");
		await rm(join(dir, "state.json"));
		await mkdir(join(dir, "state.json"));
		await failure(store.read("dag"), "corrupt-state");
		await rm(join(dir, "state.json"), { recursive: true });
		await lease.release();
		const displaced = join(root, "displaced");
		await rename(dir, displaced);
		await symlink(displaced, dir);
		await failure(store.read("dag"), "corrupt-state");
		await failure(store.claim("dag"), "corrupt-state");
	});

	test("payload links and directories cannot escape or impersonate regular content", async () => {
		const { store, dir, root } = await fixture();
		const lease = await store.claim("dag");
		const file = await store.put("dag", "safe");
		const path = store.reference("dag", file).localPath;
		const external = join(root, "external");
		await rename(path, external);
		await failure(store.load("dag", file), "corrupt-state");
		expect(() => store.reference("dag", file)).toThrow(DagError);
		await symlink(external, path);
		await failure(store.load("dag", file), "corrupt-state");
		await failure(store.put("dag", "safe"), "corrupt-state");
		expect(() => store.reference("dag", file)).toThrow(DagError);
		await rm(path);
		await mkdir(path);
		await failure(store.load("dag", file), "corrupt-state");
		await failure(store.put("dag", "safe"), "corrupt-state");
		await rm(path, { recursive: true });
		await rename(external, path);
		const displaced = join(root, "payloads");
		await rename(join(dir, "payloads"), displaced);
		await symlink(displaced, join(dir, "payloads"));
		await failure(store.load("dag", file), "corrupt-state");
		await failure(store.put("dag", "safe"), "corrupt-state");
		expect(() => store.reference("dag", file)).toThrow(DagError);
		await lease.release();
	});

	test("a failed pending save settles before release and does not publish speculative state", async () => {
		const { store, dir, storageRoot } = await fixture();
		const lease = await store.claim("dag");
		const state = await snapshot(store, scope);
		await lease.save(state, undefined);
		const rejected = failure(lease.save({ ...state, version: 3 }, 1), "stale-version");
		await lease.release();
		await rejected;
		expect((await store.read("dag"))?.version).toBe(1);
		expect((await readdir(dir)).filter((name) => name.startsWith(".tmp-"))).toEqual([]);
		const next = await createDagStore({ storageRoot, scope }).claim("dag");
		await next.release();
	});

	for (const fault of ["rename confirmation", "directory sync"]) {
		test.skipIf(fault === "directory sync" && process.getuid?.() === 0)(
			`${fault} failure after replacement is commit-unknown`,
			async () => {
				const { store, dir } = await fixture();
				const lease = await store.claim("dag");
				const state = await snapshot(store, scope);
				await lease.save(state, undefined);
				const originalRename = fs.rename;
				const blocked = spyOn(fs, "rename").mockImplementation(async (from, to) => {
					await originalRename(from, to);
					if (to !== join(dir, "state.json")) return;
					if (fault === "rename confirmation")
						throw Object.assign(new Error("Lost rename completion"), { code: "EIO" });
					await chmod(dir, 0o000);
				});
				try {
					await failure(lease.save({ ...state, version: 2 }, 1), "commit-unknown");
				} finally {
					blocked.mockRestore();
					await chmod(dir, 0o700);
				}
				expect((await store.read("dag"))?.version).toBe(2);
				expect((await readdir(dir)).filter((name) => name.startsWith(".tmp-"))).toEqual([]);
				await failure(lease.save({ ...state, version: 2 }, 1), "stale-version");
				await lease.save({ ...state, version: 3 }, 2);
				await lease.release();
			},
		);
	}

	test.skipIf(process.getuid?.() === 0)(
		"filesystem write failure preserves committed bytes and permits retry",
		async () => {
			const { store, dir } = await fixture();
			const lease = await store.claim("dag");
			const state = await snapshot(store, scope);
			await lease.save(state, undefined);
			const before = await readFile(join(dir, "state.json"));
			await chmod(dir, 0o500);
			try {
				await failure(lease.save({ ...state, version: 2 }, 1), "storage-error");
				expect(await readFile(join(dir, "state.json"))).toEqual(before);
				expect((await readdir(dir)).filter((name) => name.startsWith(".tmp-"))).toEqual([]);
			} finally {
				await chmod(dir, 0o700);
			}
			const originalRename = fs.rename;
			const blocked = spyOn(fs, "rename").mockImplementation(async (from, to) => {
				if (to !== join(dir, "state.json")) return originalRename(from, to);
				await chmod(dir, 0o500);
				try {
					await originalRename(from, to);
				} finally {
					await chmod(dir, 0o700);
				}
			});
			try {
				await failure(lease.save({ ...state, version: 2 }, 1), "storage-error");
			} finally {
				blocked.mockRestore();
			}
			expect(await readFile(join(dir, "state.json"))).toEqual(before);
			expect((await readdir(dir)).filter((name) => name.startsWith(".tmp-"))).toEqual([]);
			await lease.save({ ...state, version: 2 }, 1);
			expect((await store.read("dag"))?.version).toBe(2);
			expect((await stat(join(dir, "state.json"))).mode & 0o777).toBe(0o600);
			await lease.release();
		},
	);
});
