#!/usr/bin/env bun

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { locateDesktopLauncher } from "@thinkrail/desktop/artifact";
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
import { type E2eRunTiming, startE2eRunTiming } from "./runTiming";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const desktopDir = fileURLToPath(new URL("../apps/desktop", import.meta.url));

function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timeout = setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${what}`)), ms);
		promise.then(
			(value) => {
				clearTimeout(timeout);
				resolve(value);
			},
			(error) => {
				clearTimeout(timeout);
				reject(error);
			},
		);
	});
}

async function waitForReady(exited: Promise<number>): Promise<string> {
	let desktopExit: number | undefined;
	void exited.then((code) => {
		desktopExit = code;
	});
	const startedAt = performance.now();
	while (!existsSync(E2E_DESKTOP_READY_FILE)) {
		if (desktopExit !== undefined)
			throw new Error(`desktop host exited before ready with ${desktopExit}`);
		if (performance.now() - startedAt >= 30_000) {
			throw new Error("timed out after 30000ms: desktop host ready");
		}
		await Bun.sleep(50);
	}
	if (desktopExit !== undefined)
		throw new Error(`desktop host exited before ready with ${desktopExit}`);
	const ready = JSON.parse(readFileSync(E2E_DESKTOP_READY_FILE, "utf8")) as {
		origin?: unknown;
		mode?: unknown;
	};
	if (typeof ready.origin !== "string" || ready.mode !== "host") {
		throw new Error("desktop host wrote an invalid ready document");
	}
	return ready.origin;
}

async function main(args: string[], timing: E2eRunTiming): Promise<number> {
	await holdE2eIdleSleep();
	timing.setSelection({ playwrightArgs: args });
	const launcher = locateDesktopLauncher(desktopDir, process.env.THINKRAIL_E2E_DESKTOP);
	await timing.timePhase("fixture-setup", () => globalSetup());
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
		const origin = await timing.timePhase("host-ready", () => waitForReady(desktop.exited));
		const playwright = Bun.spawn(
			[process.execPath, "x", "playwright", "test", "-c", "playwright.desktop.config.ts", ...args],
			{
				cwd: repoRoot,
				env: { ...process.env, THINKRAIL_E2E_DESKTOP_ORIGIN: origin },
				stdout: "inherit",
				stderr: "inherit",
			},
		);
		const testExit = await timing.timePhase("playwright", () => playwright.exited);
		await timing.timePhase("host-shutdown", async () => {
			writeFileSync(E2E_DESKTOP_CONTROL_FILE, "stop");
			const desktopExit = await within(desktop.exited, 20_000, "desktop graceful shutdown");
			if (desktopExit !== 0) throw new Error(`desktop shutdown exited ${desktopExit}`);
		});
		return testExit;
	} catch (error) {
		desktop.kill("SIGKILL");
		await desktop.exited;
		throw error;
	} finally {
		await timing.timePhase("fixture-teardown", () => globalTeardown());
	}
}

const args = process.argv.slice(2);
const timing = startE2eRunTiming("desktop", args);
try {
	const exitCode = await main(args, timing);
	timing.finish(exitCode);
	process.exitCode = exitCode;
} catch (error) {
	timing.finish(1);
	throw error;
}
