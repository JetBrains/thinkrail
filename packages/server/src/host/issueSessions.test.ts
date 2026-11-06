import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIssueSessionStore, type IssueSessionAssociation } from "./issueSessions";

const roots: string[] = [];
const ref = {
	provider: "gitlab" as const,
	instanceUrl: "https://gitlab.example/base",
	projectId: "12",
	number: 3,
};
function setup() {
	const root = mkdtempSync(join(tmpdir(), "issue-sessions-"));
	roots.push(root);
	return { root, store: createIssueSessionStore(root) };
}
function association(overrides: Partial<IssueSessionAssociation> = {}): IssueSessionAssociation {
	return {
		sessionId: "session",
		workspaceId: "workspace",
		projectId: "local",
		reference: ref,
		stage: "design",
		locale: "zh-CN",
		...overrides,
	};
}
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("immutable session binding persists across instances and rejects another identity", async () => {
	const { root, store } = setup();
	expect(await store.bind(association())).toEqual(association());
	expect(await createIssueSessionStore(root).get("session")).toEqual(association());
	await expect(store.bind(association({ workspaceId: "other" }))).rejects.toThrow(
		"requires reconciliation",
	);
});

test("multiple trailing slashes stay canonical across repeated binds and reads", async () => {
	const { root, store } = setup();
	const input = association({
		reference: { ...ref, instanceUrl: "https://gitlab.example/base//" },
	});
	expect(await store.bind(input)).toEqual(association());
	expect(await store.bind(input)).toEqual(association());
	expect(await store.get("session")).toEqual(association());
	expect(await createIssueSessionStore(root).get("session")).toEqual(association());
});

for (const locale of ["en-US-u-hc-h23", "de-DE-u-co-phonebk", "en-US-x-work"]) {
	test(`canonical extension locale ${locale} persists across binds and store recreation`, async () => {
		const { root, store } = setup();
		const input = association({ locale });
		expect(await store.bind(input)).toEqual(input);
		expect(await store.bind(input)).toEqual(input);
		expect(await store.get("session")).toEqual(input);
		expect(await createIssueSessionStore(root).get("session")).toEqual(input);
	});
}

test("startup reservation only completes after acceptance and refuses repeats", async () => {
	const { root, store } = setup();
	await store.bind(association());
	expect(await store.reserveStartup("session")).toBe(true);
	await expect(createIssueSessionStore(root).reserveStartup("session")).rejects.toThrow();
	await store.completeStartup("session");
	expect(await store.reserveStartup("session")).toBe(false);
});

test("summary intent persists before one send; confirmed operation dedupes by digest", async () => {
	const { store } = setup();
	await store.bind(association());
	let calls = 0;
	const send = async () => {
		calls++;
		return 7;
	};
	expect(await store.recordSummary("session", "op-1", "summary", send)).toBe(7);
	expect(await store.recordSummary("session", "op-1", "summary", send)).toBe(7);
	expect(calls).toBe(1);
	await expect(store.recordSummary("session", "op-1", "different", send)).rejects.toThrow();
});

test("pending summary is never replayed after a send failure", async () => {
	const { root, store } = setup();
	await store.bind(association());
	let calls = 0;
	await expect(
		store.recordSummary("session", "op", "body", async () => {
			calls++;
			throw Error("offline");
		}),
	).rejects.toThrow("offline");
	await expect(
		createIssueSessionStore(root).recordSummary("session", "op", "body", async () => {
			calls++;
			return 8;
		}),
	).rejects.toThrow("requires reconciliation");
	expect(calls).toBe(1);
});

test("invalid identity and malformed records fail closed", async () => {
	const { store } = setup();
	for (const bad of [
		association({ sessionId: "../x" }),
		association({ locale: "system" }),
		association({ stage: "unknown" as "design" }),
		association({ reference: { ...ref, instanceUrl: "javascript:alert(1)" } }),
	])
		await expect(store.bind(bad)).rejects.toThrow();
	expect(await store.get("session")).toBeNull();
});

test("concurrent independent stores admit one summary send", async () => {
	const { root, store } = setup();
	await store.bind(association());
	const other = createIssueSessionStore(root);
	let sends = 0;
	const send = async () => {
		sends++;
		await new Promise((resolve) => setTimeout(resolve, 10));
		return 9;
	};
	const outcomes = await Promise.allSettled([
		store.recordSummary("session", "race", "body", send),
		other.recordSummary("session", "race", "body", send),
	]);
	expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
	expect(sends).toBe(1);
});

const folder = (root: string) => join(root, createHash("sha256").update("session").digest("hex"));
for (const body of [
	"",
	"{",
	"x".repeat(17000),
	JSON.stringify({ ...association(), locale: "system" }),
	JSON.stringify({ ...association(), token: "DO_NOT_STORE" }),
	JSON.stringify({ ...association(), reference: { ...ref, projectId: "013" } }),
	JSON.stringify({ ...association(), sessionId: "other" }),
]) {
	test("untrusted binding fails closed without overwriting", async () => {
		const { root, store } = setup();
		mkdirSync(folder(root));
		const path = join(folder(root), "bind.json");
		writeFileSync(path, body);
		await expect(store.get("session")).rejects.toThrow();
		await expect(store.bind(association())).rejects.toThrow();
		expect(readFileSync(path, "utf8")).toBe(body);
	});
}
test("failed receipt write preserves uncertainty and forbids another attempt", async () => {
	const { root, store } = setup();
	await store.bind(association());
	let calls = 0;
	await expect(
		store.recordSummary("session", "op", "PRIVATE BODY", async () => {
			calls++;
			mkdirSync(join(folder(root), "1.completed"));
			return 7;
		}),
	).rejects.toThrow();
	await expect(
		createIssueSessionStore(root).recordSummary("session", "other", "body", async () => {
			calls++;
			return 8;
		}),
	).rejects.toThrow();
	expect(calls).toBe(1);
	expect(readFileSync(join(folder(root), "1.intent"), "utf8")).not.toContain("PRIVATE BODY");
});
test("canonical references are idempotent but ownership, stage and effective locale are immutable", async () => {
	const { store } = setup();
	await store.bind(association());
	expect(
		await store.bind(
			association({ reference: { ...ref, instanceUrl: "https://GITLAB.example:443/base/" } }),
		),
	).toEqual(association());
	for (const change of [
		{ projectId: "other" },
		{ locale: "en" },
		{ stage: "implementation" as const },
		{ reference: { ...ref, number: 4 } },
	])
		await expect(store.bind(association(change))).rejects.toThrow();
	for (const locale of ["en-us", "en_US", "", "system", " en", "x".repeat(40)])
		await expect(store.bind(association({ sessionId: "fresh", locale }))).rejects.toThrow();
});
test("symlink metadata is rejected", async () => {
	const { root, store } = setup();
	await store.bind(association());
	const target = join(root, "target");
	mkdirSync(target);
	symlinkSync(target, join(folder(root), "startup.pending"), "junction");
	await expect(store.reserveStartup("session")).rejects.toThrow();
});
test("torn intent stops even an unrelated operation without sending", async () => {
	const { root, store } = setup();
	await store.bind(association());
	writeFileSync(join(folder(root), "1.intent"), "");
	let calls = 0;
	await expect(
		store.recordSummary("session", "op", "body", async () => {
			calls++;
			return 1;
		}),
	).rejects.toThrow();
	expect(calls).toBe(0);
});

test("independent processes exclusively claim startup", async () => {
	const { root, store } = setup();
	await store.bind(association());
	const modulePath = new URL("./issueSessions.ts", import.meta.url).href;
	const code = `import { createIssueSessionStore } from ${JSON.stringify(modulePath)}; try { console.log(await createIssueSessionStore(${JSON.stringify(root)}).reserveStartup('session')); } catch { console.log('closed'); }`;
	const workers = Array.from({ length: 4 }, () =>
		Bun.spawn([process.execPath, "--eval", code], { stdout: "pipe", stderr: "pipe" }),
	);
	const results = await Promise.all(
		workers.map(async (worker) => {
			const text = await new Response(worker.stdout).text();
			expect(await worker.exited).toBe(0);
			return text.trim();
		}),
	);
	expect(results.filter((value) => value === "true")).toHaveLength(1);
	expect(results.filter((value) => value === "closed")).toHaveLength(3);
});

test("startup completion requires an intent and survives restart", async () => {
	const { root, store } = setup();
	await store.bind(association());
	await expect(store.completeStartup("session")).rejects.toThrow();
	await store.reserveStartup("session");
	await store.completeStartup("session");
	expect(await createIssueSessionStore(root).reserveStartup("session")).toBe(false);
});
