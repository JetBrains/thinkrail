import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { HostUpdateNotice, ServerWelcome } from "@thinkrail/contracts";
import { PROTOCOL_VERSION, WS_CHANNELS } from "@thinkrail/contracts";
import { isPortFree } from "@thinkrail/shared/freePort";
import { configurePiRuntime, configurePiRuntimeFactory } from "../agent";
import { resetJbcentralStateForTests } from "../auth";
import { type BootedHost, bootHost } from "./boot";

process.setMaxListeners(50);

const booted: BootedHost[] = [];
const tmpDirs: string[] = [];
const originalDataDir = process.env.THINKRAIL_DATA_DIR;
let testRuntime: ModelRuntime;

interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(error: unknown): void;
}

interface SocketFrame {
	channel?: string;
	data?: unknown;
	id?: string;
	ok?: boolean;
}

interface SocketCollector {
	socket: WebSocket;
	frames: SocketFrame[];
	waitForFrame(matches: (frame: SocketFrame) => boolean): Promise<SocketFrame>;
}

interface CheckHarness<T> {
	checks: Deferred<T>[];
	check(): Promise<T>;
	waitForCheck(index: number): Promise<Deferred<T>>;
}

function deferred<T>(): Deferred<T> {
	let resolve = (_value: T): void => {};
	let reject = (_error: unknown): void => {};
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

function createCheckHarness<T>(): CheckHarness<T> {
	const checks: Deferred<T>[] = [];
	const waiters = new Map<number, (check: Deferred<T>) => void>();
	return {
		checks,
		check: () => {
			const pending = deferred<T>();
			const index = checks.push(pending) - 1;
			waiters.get(index)?.(pending);
			waiters.delete(index);
			return pending.promise;
		},
		waitForCheck: (index) => {
			const pending = checks[index];
			if (pending) return Promise.resolve(pending);
			return new Promise<Deferred<T>>((resolve) => waiters.set(index, resolve));
		},
	};
}

async function collectSocket(port: number, client: string): Promise<SocketCollector> {
	const socket = new WebSocket(
		`ws://localhost:${port}/ws?client=${client}&protocol=${PROTOCOL_VERSION}`,
	);
	const frames: SocketFrame[] = [];
	const waiters = new Set<{
		matches: (frame: SocketFrame) => boolean;
		resolve(frame: SocketFrame): void;
	}>();
	socket.addEventListener("message", (event) => {
		const frame = JSON.parse(String(event.data)) as SocketFrame;
		frames.push(frame);
		for (const waiter of waiters) {
			if (!waiter.matches(frame)) continue;
			waiters.delete(waiter);
			waiter.resolve(frame);
		}
	});
	await new Promise<void>((resolve, reject) => {
		socket.addEventListener("open", () => resolve(), { once: true });
		socket.addEventListener("error", () => reject(new Error("websocket failed to open")), {
			once: true,
		});
	});
	return {
		socket,
		frames,
		waitForFrame: (matches) => {
			const frame = frames.find(matches);
			if (frame) return Promise.resolve(frame);
			return new Promise<SocketFrame>((resolve) => waiters.add({ matches, resolve }));
		},
	};
}

async function socketBarrier(collector: SocketCollector, id: string): Promise<void> {
	collector.socket.send(JSON.stringify({ id, method: "project.list", params: {} }));
	const frame = await collector.waitForFrame((candidate) => candidate.id === id);
	expect(frame.ok).toBe(true);
}

beforeAll(async () => {
	testRuntime = await ModelRuntime.create({
		credentials: new InMemoryCredentialStore(),
		modelsPath: null,
		allowModelNetwork: false,
	});
});

beforeEach(async () => {
	await resetJbcentralStateForTests();
	configurePiRuntime(null);
	configurePiRuntimeFactory(async () => testRuntime);
	const dir = mkdtempSync(join(tmpdir(), "thinkrail-boot-data-"));
	tmpDirs.push(dir);
	process.env.THINKRAIL_DATA_DIR = dir;
});

afterEach(async () => {
	while (booted.length) await booted.pop()?.server.shutdown();
	while (tmpDirs.length) rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
	if (originalDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = originalDataDir;
	await resetJbcentralStateForTests();
	configurePiRuntimeFactory();
	configurePiRuntime(null);
});

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

test("boot permits two hosts for the same data directory", async () => {
	const first = await boot({ port: grabFreePort(), host: "localhost", portMode: "exact" });
	const second = await boot({ port: grabFreePort(), host: "localhost", portMode: "exact" });

	expect(second.port).not.toBe(first.port);
	const responses = await Promise.all([
		fetch(`http://localhost:${first.port}/health`),
		fetch(`http://localhost:${second.port}/health`),
	]);
	expect(await Promise.all(responses.map((response) => response.text()))).toEqual(["ok", "ok"]);
});

test("shutdown is idempotent and releases the port", async () => {
	const options = { port: grabFreePort(), host: "localhost", portMode: "exact" as const };
	const first = await boot(options);
	await Promise.all([first.server.shutdown(), first.server.shutdown()]);
	booted.splice(booted.indexOf(first), 1);
	const second = await boot(options);
	expect(second.port).toBe(options.port);
});

test("publishes only changed host update notices after welcome and on fixed repeats", async () => {
	const checks = createCheckHarness<HostUpdateNotice | null>();
	const b = await boot({
		port: grabFreePort(),
		host: "localhost",
		portMode: "exact",
		hostUpdate: { intervalMs: 5, check: checks.check },
	});
	const firstCheck = await checks.waitForCheck(0);
	const collector = await collectSocket(b.port, "updates-first");
	const welcomeFrame = await collector.waitForFrame(
		(frame) => frame.channel === WS_CHANNELS.serverWelcome,
	);
	expect((welcomeFrame.data as ServerWelcome).hostUpdate).toBeUndefined();
	expect(checks.checks).toHaveLength(1);

	const firstNotice: HostUpdateNotice = {
		currentVersion: "1.0.0",
		availableVersion: "1.1.0",
		channel: "stable",
	};
	firstCheck.resolve(firstNotice);
	const firstPush = await collector.waitForFrame(
		(frame) =>
			frame.channel === WS_CHANNELS.hostUpdateAvailable &&
			(frame.data as HostUpdateNotice).availableVersion === "1.1.0",
	);
	expect(firstPush.data).toEqual(firstNotice);

	const retained = await collectSocket(b.port, "updates-retained");
	const retainedWelcome = await retained.waitForFrame(
		(frame) => frame.channel === WS_CHANNELS.serverWelcome,
	);
	expect((retainedWelcome.data as ServerWelcome).hostUpdate).toEqual(firstNotice);
	retained.socket.close();

	const secondCheck = await checks.waitForCheck(1);
	const newerNotice: HostUpdateNotice = {
		currentVersion: "1.0.0",
		availableVersion: "1.2.0",
		channel: "stable",
	};
	secondCheck.resolve(newerNotice);
	await collector.waitForFrame(
		(frame) =>
			frame.channel === WS_CHANNELS.hostUpdateAvailable &&
			(frame.data as HostUpdateNotice).availableVersion === "1.2.0",
	);

	const duplicateCheck = await checks.waitForCheck(2);
	duplicateCheck.resolve({ ...newerNotice });
	const noUpdateCheck = await checks.waitForCheck(3);
	await socketBarrier(collector, "duplicate-barrier");
	expect(
		collector.frames.filter((frame) => frame.channel === WS_CHANNELS.hostUpdateAvailable),
	).toHaveLength(2);

	noUpdateCheck.resolve(null);
	const failedCheck = await checks.waitForCheck(4);
	await socketBarrier(collector, "no-update-barrier");
	expect(
		collector.frames.filter((frame) => frame.channel === WS_CHANNELS.hostUpdateAvailable),
	).toHaveLength(2);

	failedCheck.reject(new Error("offline"));
	await checks.waitForCheck(5);
	await socketBarrier(collector, "failure-barrier");
	expect(
		collector.frames.filter((frame) => frame.channel === WS_CHANNELS.hostUpdateAvailable),
	).toHaveLength(2);
	const afterSilentChecks = await collectSocket(b.port, "updates-after-silent-checks");
	const latestWelcome = await afterSilentChecks.waitForFrame(
		(frame) => frame.channel === WS_CHANNELS.serverWelcome,
	);
	expect((latestWelcome.data as ServerWelcome).hostUpdate).toEqual(newerNotice);
	afterSilentChecks.socket.close();
	collector.socket.close();
});

test("shutdown clears periodic checks and makes a late result inert", async () => {
	const checks = createCheckHarness<HostUpdateNotice | null>();
	const b = await boot({
		port: grabFreePort(),
		host: "localhost",
		portMode: "exact",
		hostUpdate: { intervalMs: 5, check: checks.check },
	});
	const collector = await collectSocket(b.port, "updates-shutdown");
	await collector.waitForFrame((frame) => frame.channel === WS_CHANNELS.serverWelcome);
	const firstCheck = await checks.waitForCheck(0);

	await b.server.shutdown();
	firstCheck.resolve({
		currentVersion: "1.0.0",
		availableVersion: "1.1.0",
		channel: "stable",
	});
	await firstCheck.promise;
	await Bun.sleep(10);

	expect(checks.checks).toHaveLength(1);
	expect(
		collector.frames.filter((frame) => frame.channel === WS_CHANNELS.hostUpdateAvailable),
	).toHaveLength(0);
});
