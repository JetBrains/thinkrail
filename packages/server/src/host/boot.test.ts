import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isPortFree } from "@thinkrail/shared/freePort";
import { resetConfigCache } from "../settings";
import { type BootedHost, bootHost } from "./boot";
import { handleRequest } from "./handlers";

// bootHost registers a SIGINT/SIGTERM handler per call; a handful of boots stays well under the warn
// threshold, but lift the cap so a noisy run never trips MaxListenersExceededWarning.
process.setMaxListeners(50);

const booted: BootedHost[] = [];
const tmpDirs: string[] = [];

afterEach(() => {
	while (booted.length) booted.pop()?.server.stop();
	while (tmpDirs.length) rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
});

/** Bind an OS-assigned port, then release it — a port known to be free for the next bind. */
function grabFreePort(): number {
	const probe = Bun.serve({ port: 0, hostname: "localhost", fetch: () => new Response("x") });
	const port = probe.port;
	if (port == null) throw new Error("probe failed to bind");
	probe.stop(true);
	return port;
}

async function boot(options: Parameters<typeof bootHost>[0]): Promise<BootedHost> {
	const b = await bootHost(options);
	booted.push(b);
	return b;
}

test('portMode "exact" binds the requested port', async () => {
	const requested = grabFreePort();
	const b = await boot({ port: requested, host: "localhost", portMode: "exact" });

	expect(b.requested).toBe(requested);
	expect(b.port).toBe(requested);
	expect(b.server.port).toBe(requested);
	const res = await fetch(`http://localhost:${b.port}/health`);
	expect(res.status).toBe(200);
	expect(await res.text()).toBe("ok");
});

test('portMode "free" scans upward past a taken port', async () => {
	// Hold a port open so the requested one is occupied at boot.
	const holder = Bun.serve({ port: 0, hostname: "localhost", fetch: () => new Response("x") });
	const taken = holder.port as number;
	try {
		const b = await boot({ port: taken, host: "localhost", portMode: "free" });
		expect(b.requested).toBe(taken);
		expect(b.port).toBeGreaterThan(taken);
		const res = await fetch(`http://localhost:${b.port}/health`);
		expect(await res.text()).toBe("ok");
	} finally {
		holder.stop(true);
	}
});

test("serves the SPA from staticDir with index.html fallback", async () => {
	const dir = mkdtempSync(join(tmpdir(), "thinkrail-boot-"));
	tmpDirs.push(dir);
	writeFileSync(join(dir, "index.html"), "<!doctype html><title>spa</title>");

	const b = await boot({
		port: grabFreePort(),
		host: "localhost",
		portMode: "exact",
		staticDir: dir,
	});

	const root = await fetch(`http://localhost:${b.port}/`);
	expect(root.status).toBe(200);
	expect(root.headers.get("content-type") ?? "").toContain("text/html");
	expect(await root.text()).toContain("<title>spa</title>");

	// Unknown client-side route falls back to index.html (SPA), not 404.
	const deep = await fetch(`http://localhost:${b.port}/some/client/route`);
	expect(deep.status).toBe(200);
	expect(await deep.text()).toContain("<title>spa</title>");
});

test("stop() releases the port", async () => {
	const b = await boot({ port: grabFreePort(), host: "localhost", portMode: "exact" });
	expect(await isPortFree(b.port)).toBe(false);
	b.server.stop();
	expect(await isPortFree(b.port)).toBe(true);
});

// ── the remote-check scheduler's lifecycle, proven against the REAL global timer ──────────────────────
//
// `remotes.test.ts` already proves the scheduler is internally consistent against its OWN injected
// `setTimer`/`clearTimer` seam — that's the mechanics half's unit test, exercising the module in
// isolation. It does NOT prove `createServer` calls `startRemoteChecks`/`stopRemoteChecks` at all: in
// production, `server.ts` installs no `setTimer`/`clearTimer` override, so the scheduler's defaults
// (`defaultSetTimer`/`defaultClearTimer`) call the true global `setTimeout`/`clearTimeout` — deleting
// `stopRemoteChecks();` from `server.ts`'s `stop()` would fail none of `remotes.test.ts`, `policy.test.ts`,
// or the e2e suite (whose own teardown goes through `boot.ts`'s SIGINT handler, which calls
// `process.exit(0)` in a `finally` — that kills every pending timer regardless of whether
// `stopRemoteChecks()` ran, so e2e is structurally incapable of catching this class of regression). These
// two tests spy on the true globals instead, so a boot that never disarms its own timer is caught here.

test("stop() clears the remote-check scheduler's real backstop timer — no live timer survives it", async () => {
	const dataDir = mkdtempSync(join(tmpdir(), "thinkrail-boot-remotes-"));
	const savedDataDir = process.env.THINKRAIL_DATA_DIR;
	process.env.THINKRAIL_DATA_DIR = dataDir;
	resetConfigCache(); // a previous test/file may have cached a different data dir's config
	const setTimeoutSpy = spyOn(globalThis, "setTimeout");
	const clearTimeoutSpy = spyOn(globalThis, "clearTimeout");
	try {
		const b = await boot({ port: grabFreePort(), host: "localhost", portMode: "exact" });

		// startRemoteChecks armed the backstop during boot, through the real global setTimeout.
		expect(setTimeoutSpy.mock.calls.length).toBeGreaterThan(0);
		const armedHandles = setTimeoutSpy.mock.results.map(
			(r) => r.value as ReturnType<typeof setTimeout>,
		);

		b.server.stop();

		// Every handle armed up to this point was cleared by stop() — none is still live afterward.
		const clearedHandles = clearTimeoutSpy.mock.calls.map((call) => call[0]);
		for (const handle of armedHandles) {
			expect(clearedHandles).toContain(handle);
		}
	} finally {
		setTimeoutSpy.mockRestore();
		clearTimeoutSpy.mockRestore();
		resetConfigCache();
		rmSync(dataDir, { recursive: true, force: true });
		if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
		else process.env.THINKRAIL_DATA_DIR = savedDataDir;
	}
});

test("a settings.update reaches the remote-check scheduler through the host-mediated tee — the seam that exists because remotes may not import settings", async () => {
	const dataDir = mkdtempSync(join(tmpdir(), "thinkrail-boot-settingstee-"));
	const savedDataDir = process.env.THINKRAIL_DATA_DIR;
	process.env.THINKRAIL_DATA_DIR = dataDir;
	resetConfigCache();
	const setTimeoutSpy = spyOn(globalThis, "setTimeout");
	const clearTimeoutSpy = spyOn(globalThis, "clearTimeout");
	try {
		await boot({ port: grabFreePort(), host: "localhost", portMode: "exact" });
		const armedAtBoot = setTimeoutSpy.mock.results.at(-1)?.value as
			| ReturnType<typeof setTimeout>
			| undefined;
		expect(armedAtBoot).toBeDefined();

		await handleRequest(
			"settings.update",
			{ config: { gitRemoteCheckIntervalMinutes: 5 } },
			{ clientKey: "test-client" },
		);

		// `configureRemoteChecks`'s own doc: "Rearms the backstop immediately when already running" — a
		// changed interval clears the boot-time timer and arms a fresh one. This is only observable if the
		// settings tee actually calls `configureRemoteChecks` (not just broadcasts `settingsChanged`) — a
		// tee that dropped that call would leave the boot-time handle live and never clear it here.
		const clearedHandles = clearTimeoutSpy.mock.calls.map((call) => call[0]);
		expect(clearedHandles).toContain(armedAtBoot);
		expect(setTimeoutSpy.mock.calls.length).toBeGreaterThan(1);
	} finally {
		setTimeoutSpy.mockRestore();
		clearTimeoutSpy.mockRestore();
		resetConfigCache();
		rmSync(dataDir, { recursive: true, force: true });
		if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
		else process.env.THINKRAIL_DATA_DIR = savedDataDir;
	}
});
