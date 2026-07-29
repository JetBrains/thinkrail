import { afterEach, beforeEach, expect, jest, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelsRefreshOptions, ModelsRefreshResult } from "@earendil-works/pi-ai";
import {
	type CatalogRefreshRuntime,
	configurePiRuntime,
	getPiRuntime,
	refreshCatalogs,
	refreshCatalogsDetached,
} from "./piRuntime";

let priorOffline: string | undefined;
beforeEach(() => {
	priorOffline = process.env.PI_OFFLINE;
	delete process.env.PI_OFFLINE; // production shape — nothing external forces offline
});
afterEach(() => {
	if (priorOffline === undefined) delete process.env.PI_OFFLINE;
	else process.env.PI_OFFLINE = priorOffline;
});

// ---- getPiRuntime: ambient network stays OFF (pi 0.81 ties `modelNetworkEnabled` to PI_OFFLINE at
// construction — the scoped-env creation in `createRuntimeOfflineByDefault` restores 0.80.x semantics) ----

/** A real runtime created from an isolated, empty agent dir (no auth, no models.json, no network). */
async function isolatedRuntime() {
	const agentDir = mkdtempSync(join(tmpdir(), "trpi-runtime-"));
	const priorAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agentDir;
	configurePiRuntime(null); // drop any memo a sibling test file left behind
	try {
		return { runtime: await getPiRuntime(), agentDir };
	} finally {
		if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
	}
}

function cleanup(agentDir: string): void {
	configurePiRuntime(null);
	rmSync(agentDir, { recursive: true, force: true });
}

test("refresh() on the shared runtime never opts into the network (provider.status must not stall on pi.dev)", async () => {
	const { runtime, agentDir } = await isolatedRuntime();
	try {
		// The scoped PI_OFFLINE used during construction must not leak into the process env…
		expect(process.env.PI_OFFLINE).toBeUndefined();

		// …and a no-options refresh() (what provider.status / jbcentral call — pi 0.82 folded the old
		// reloadConfig() into it) resolves allowNetwork to the runtime's ambient default: OFF. That
		// default is internal, so pin it at the boundary it protects — the network: pi's remote-catalog
		// and availability paths ride global fetch, so a blocking spy proves no egress is attempted.
		// Refresh only touches providers holding a credential, so seed one — that's also the production
		// shape (a signed-in user whose provider.status reads must not stall on pi.dev).
		await runtime.setRuntimeApiKey("anthropic", "sk-test-never-used", { allowNetwork: false });
		const originalFetch = globalThis.fetch;
		const fetched: string[] = [];
		globalThis.fetch = ((input: string | URL | Request) => {
			fetched.push(String(input instanceof Request ? input.url : input));
			return Promise.reject(new Error("unit tests never touch the network"));
		}) as typeof fetch;
		try {
			await runtime.refresh();
			expect(fetched).toEqual([]);

			// Positive control so the spy can't rot vacuous: an explicit network opt-in (force bypasses
			// the freshness throttle) must attempt egress — the spy blocks it, and refresh() swallows
			// the per-provider failures into its result.
			await runtime.refresh({ allowNetwork: true, force: true });
			expect(fetched.length).toBeGreaterThan(0);
		} finally {
			globalThis.fetch = originalFetch;
		}
	} finally {
		cleanup(agentDir);
	}
});

test("a user-set PI_OFFLINE survives runtime creation untouched", async () => {
	process.env.PI_OFFLINE = "yes";
	const { agentDir } = await isolatedRuntime();
	try {
		expect(process.env.PI_OFFLINE).toBe("yes");
	} finally {
		cleanup(agentDir);
	}
});

// ---- refreshCatalogsDetached (issue #98): detached, single-flight, throttle-respecting, offline-aware ----

const OK: ModelsRefreshResult = { aborted: false, errors: new Map() };

/** A fake runtime whose `refresh` is fully controlled by the test — settles only when told to. */
function fakeRuntime() {
	const calls: ModelsRefreshOptions[] = [];
	let settle = { resolve: (_: ModelsRefreshResult) => {}, reject: (_: unknown) => {} };
	const runtime: CatalogRefreshRuntime = {
		refresh: (options?: ModelsRefreshOptions) => {
			calls.push(options ?? {});
			return new Promise<ModelsRefreshResult>((resolve, reject) => {
				settle = { resolve, reject };
			});
		},
	};
	return {
		runtime,
		calls,
		resolve: (result: ModelsRefreshResult = OK) => settle.resolve(result),
		reject: (err: unknown) => settle.reject(err),
	};
}

/** Let the refresh task's `.then/.catch/.finally` chain run (microtasks only — nothing sleeps). */
const settled = () => new Promise<void>((r) => setTimeout(r, 0));

test("an implicit trigger opts into the network per-call but stays behind pi's freshness throttle", () => {
	const { runtime, calls } = fakeRuntime();
	refreshCatalogsDetached(runtime);
	expect(calls.length).toBe(1);
	const options = calls[0];
	expect(options?.allowNetwork).toBe(true);
	expect(options?.force).toBe(false);
	expect(options?.signal).toBeInstanceOf(AbortSignal);
});

// Inside its 4h freshness window pi returns early before issuing any request at all (its If-None-Match
// revalidation included), so without `force` a user-initiated "Refresh catalog" fetches nothing at all.
// These pin the bypass reaching pi.
test("an explicit refresh forces past the freshness throttle", () => {
	const { runtime, calls } = fakeRuntime();
	void refreshCatalogs(runtime, { force: true });
	expect(calls[0]?.force).toBe(true);
});

test("a forced refresh does not settle for an in-flight throttled pass — it queues behind it", async () => {
	const { runtime, calls, resolve } = fakeRuntime();
	refreshCatalogsDetached(runtime); // throttled pass in flight
	const forced = refreshCatalogs(runtime, { force: true });
	expect(calls.length).toBe(1); // not started yet — one refresh at a time

	resolve(); // the throttled pass lands; the forced one now runs for real
	await settled();
	expect(calls.length).toBe(2);
	expect(calls[1]?.force).toBe(true);
	resolve();
	await forced;
});

test("an implicit trigger joins an in-flight forced pass (a forced result satisfies it)", () => {
	const { runtime, calls } = fakeRuntime();
	void refreshCatalogs(runtime, { force: true });
	refreshCatalogsDetached(runtime);
	expect(calls.length).toBe(1);
});

test("single-flight: repeated triggers while one refresh is pending don't stack network tasks", async () => {
	const { runtime, calls, resolve } = fakeRuntime();
	refreshCatalogsDetached(runtime);
	refreshCatalogsDetached(runtime);
	refreshCatalogsDetached(runtime);
	expect(calls.length).toBe(1);

	resolve();
	await settled();
	refreshCatalogsDetached(runtime); // the slot is free again once the previous refresh settled
	expect(calls.length).toBe(2);
});

test("a rejected refresh is swallowed and does not wedge future refreshes", async () => {
	const { runtime, calls, reject } = fakeRuntime();
	refreshCatalogsDetached(runtime);
	reject(new Error("pi.dev unreachable"));
	await settled();

	refreshCatalogsDetached(runtime);
	expect(calls.length).toBe(2);
});

test("an aborted (timed-out) refresh is tolerated and frees the single-flight slot", async () => {
	const { runtime, calls, resolve } = fakeRuntime();
	refreshCatalogsDetached(runtime);
	resolve({ aborted: true, errors: new Map() }); // what pi returns when our 15s signal fires
	await settled();

	refreshCatalogsDetached(runtime);
	expect(calls.length).toBe(2);
});

// The finding this pins: pi's abort signal bounds `models.refresh` only — it awaits an unsignalled
// `forceRefreshAvailability()` after it — and a forced caller can additionally be queued behind a
// throttled pass, so what a caller awaits needs its own ceiling or the picker's refresh row spins with no
// cap (and `modelsRefreshing` is app-wide).
test("a caller's await is bounded even when pi's pass never settles", async () => {
	jest.useFakeTimers();
	try {
		const { runtime, calls } = fakeRuntime();
		const awaited = refreshCatalogs(runtime, { force: true });
		jest.advanceTimersByTime(15_000);
		await awaited; // resolves at the ceiling, though the pass it started is still pending

		// ...and single-flight keeps tracking that unbounded pass, so a timed-out caller cannot start a
		// second concurrent refresh — it just serves the registry as it stands.
		void refreshCatalogs(runtime, { force: true });
		expect(calls.length).toBe(1);
	} finally {
		jest.useRealTimers();
	}
});

test("per-provider failures in a completed refresh are tolerated (result is only logged)", async () => {
	const { runtime, calls, resolve } = fakeRuntime();
	refreshCatalogsDetached(runtime);
	resolve({ aborted: false, errors: new Map([["someprovider", new Error("boom")]]) });
	await settled();

	refreshCatalogsDetached(runtime);
	expect(calls.length).toBe(2);
});

// ---- refreshCatalogs (the awaited variant behind `model.refresh`) ----

test("awaited refresh shares the single-flight slot with a detached trigger", async () => {
	const { runtime, calls, resolve } = fakeRuntime();
	refreshCatalogsDetached(runtime); // e.g. a concurrent model.list
	const awaited = refreshCatalogs(runtime); // model.refresh joins the SAME task
	expect(calls.length).toBe(1);

	let done = false;
	void awaited.then(() => {
		done = true;
	});
	await settled();
	expect(done).toBe(false); // resolves with the refresh, not before
	resolve();
	await awaited;
	expect(calls.length).toBe(1);
});

test("awaited refresh RESOLVES on a failed refresh (caller then serves the current snapshot)", async () => {
	const { runtime, reject } = fakeRuntime();
	const awaited = refreshCatalogs(runtime);
	reject(new Error("pi.dev unreachable"));
	await awaited; // must not throw — failures are logged host-side, the wire still answers
});

test("awaited refresh under PI_OFFLINE resolves immediately without a network task", async () => {
	process.env.PI_OFFLINE = "1";
	const { runtime, calls } = fakeRuntime();
	await refreshCatalogs(runtime);
	expect(calls.length).toBe(0);
});

test("PI_OFFLINE disables the refresh entirely", () => {
	process.env.PI_OFFLINE = "1";
	const { runtime, calls } = fakeRuntime();
	refreshCatalogsDetached(runtime);
	expect(calls.length).toBe(0);
});
