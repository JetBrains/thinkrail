#!/usr/bin/env bun

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { locateDesktopLauncher, waitForDocument } from "@thinkrail/artifact-tests";
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

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const desktopDir = fileURLToPath(new URL("../apps/desktop", import.meta.url));
const launcher = locateDesktopLauncher(desktopDir, process.env.THINKRAIL_E2E_DESKTOP);

function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${what}`)), ms),
		),
	]);
}

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
globalSetup();
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
	const playwright = Bun.spawn(
		[
			process.execPath,
			"x",
			"playwright",
			"test",
			"-c",
			"playwright.desktop.config.ts",
			...process.argv.slice(2),
		],
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
}
