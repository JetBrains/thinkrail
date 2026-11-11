#!/usr/bin/env bun

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { locateDesktopLauncher, waitForDocument, within } from "@thinkrail/artifact-tests";
import { artifactHostEnvironment } from "./artifactPlaywright";
import {
	E2E_DESKTOP_CACHE,
	E2E_DESKTOP_CONTROL_FILE,
	E2E_DESKTOP_READY_FILE,
	E2E_DESKTOP_USER_DATA,
} from "./fixtures/paths";
import globalSetup from "./global-setup";
import globalTeardown from "./global-teardown";
import { holdE2eIdleSleep } from "./idleSleep";
import { laneShard, parseJobShard } from "./shardPlan";
import { shardTestListArgs } from "./shardTestLists";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const desktopDir = fileURLToPath(new URL("../apps/desktop", import.meta.url));
const launcher = locateDesktopLauncher(desktopDir, process.env.THINKRAIL_E2E_DESKTOP);

function hostOrigin(document: unknown): string | undefined {
	if (typeof document !== "object" || document === null) return undefined;
	const { origin, mode } = document as { origin?: unknown; mode?: unknown };
	return typeof origin === "string" && mode === "host" ? origin : undefined;
}

function waitForReady(exited: Promise<number>): Promise<string> {
	return waitForDocument(E2E_DESKTOP_READY_FILE, hostOrigin, {
		timeoutMs: 30_000,
		what: "desktop host ready",
		exited,
		exitError: (code) => new Error(`desktop host exited before ready with ${code}`),
	});
}

await holdE2eIdleSleep();
const playwrightArgs = ["-c", "e2e/playwright.desktop.config.ts", ...process.argv.slice(2)];
const listDir = mkdtempSync(join(tmpdir(), "thinkrail-e2e-test-lists-"));
const testListArgs = shardTestListArgs(
	playwrightArgs,
	[laneShard(parseJobShard(process.env.THINKRAIL_E2E_JOB_SHARD), 1, 1)],
	{ ...process.env, THINKRAIL_E2E_DESKTOP_ORIGIN: "http://localhost" },
	listDir,
);
testListArgs.catch(() => {});
await globalSetup();
const desktop = Bun.spawn([launcher], {
	cwd: repoRoot,
	env: {
		...process.env,
		...artifactHostEnvironment(E2E_DESKTOP_CACHE),
		THINKRAIL_DESKTOP_READY_FILE: E2E_DESKTOP_READY_FILE,
		THINKRAIL_DESKTOP_CONTROL_FILE: E2E_DESKTOP_CONTROL_FILE,
		THINKRAIL_DESKTOP_USER_DATA: E2E_DESKTOP_USER_DATA,
		THINKRAIL_DESKTOP_E2E_HOST: "1",
		THINKRAIL_DESKTOP_HIDDEN: "1",
	},
	stdout: "inherit",
	stderr: "inherit",
});

try {
	const origin = await waitForReady(desktop.exited);
	const [laneArgs = []] = await testListArgs;
	const playwright = Bun.spawn(
		[process.execPath, "x", "playwright", "test", ...playwrightArgs, ...laneArgs],
		{
			cwd: repoRoot,
			env: { ...process.env, THINKRAIL_E2E_DESKTOP_ORIGIN: origin },
			stdout: "inherit",
			stderr: "inherit",
		},
	);
	const testExit = await playwright.exited;
	writeFileSync(E2E_DESKTOP_CONTROL_FILE, "stop");
	const desktopExit = await within(desktop.exited, 20_000, "desktop graceful shutdown");
	if (desktopExit !== 0) throw new Error(`desktop shutdown exited ${desktopExit}`);
	if (testExit !== 0) process.exitCode = testExit;
} catch (error) {
	desktop.kill("SIGKILL");
	throw error;
} finally {
	globalTeardown();
	await testListArgs.catch(() => {});
	rmSync(listDir, { recursive: true, force: true });
}
