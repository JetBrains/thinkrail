import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelsRefreshOptions, ModelsRefreshResult } from "@earendil-works/pi-ai";
import {
	type CatalogRefreshRuntime,
	configurePiRuntime,
	getPiRuntime,
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

test("opts into the network per-call but never forces past pi's freshness throttle", () => {
	const { runtime, calls } = fakeRuntime();
	refreshCatalogsDetached(runtime);
	expect(calls.length).toBe(1);
	const options = calls[0];
	expect(options?.allowNetwork).toBe(true);
	expect(options?.force).toBeUndefined();
	expect(options?.signal).toBeInstanceOf(AbortSignal);
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

test("per-provider failures in a completed refresh are tolerated (result is only logged)", async () => {
	const { runtime, calls, resolve } = fakeRuntime();
	refreshCatalogsDetached(runtime);
	resolve({ aborted: false, errors: new Map([["someprovider", new Error("boom")]]) });
	await settled();

	refreshCatalogsDetached(runtime);
	expect(calls.length).toBe(2);
});

test("PI_OFFLINE disables the refresh entirely", () => {
	process.env.PI_OFFLINE = "1";
	const { runtime, calls } = fakeRuntime();
	refreshCatalogsDetached(runtime);
	expect(calls.length).toBe(0);
});
