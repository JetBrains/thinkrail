import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelsRefreshOptions, ModelsRefreshResult } from "@earendil-works/pi-ai";
import { configurePiRuntime, getPiRuntime } from "./piRuntime";

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

test("reloadConfig() on the shared runtime never opts into the network (provider.status must not stall on pi.dev)", async () => {
	const { runtime, agentDir } = await isolatedRuntime();
	try {
		// The scoped PI_OFFLINE used during construction must not leak into the process env…
		expect(process.env.PI_OFFLINE).toBeUndefined();

		// …and the constructed runtime resolves reloadConfig's refresh to allowNetwork:false.
		const seen: (ModelsRefreshOptions | undefined)[] = [];
		const originalRefresh = runtime.refresh.bind(runtime);
		runtime.refresh = (options?: ModelsRefreshOptions): Promise<ModelsRefreshResult> => {
			seen.push(options);
			return Promise.resolve({ aborted: false, errors: new Map() });
		};
		try {
			await runtime.reloadConfig();
			expect(seen.length).toBe(1);
			expect(seen[0]?.allowNetwork).toBe(false);
		} finally {
			runtime.refresh = originalRefresh;
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
