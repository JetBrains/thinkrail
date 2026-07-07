#!/usr/bin/env bun
// Boot-smoke the compiled `thinkrail` binary: start it against throwaway data/agent/cache dirs and
// assert it comes up, serves the staged web UI, staged the bundled skills, and shuts down cleanly on
// SIGTERM. This gates the regression class that only exists inside the compiled artifact (dev + e2e run
// from source and can never see it) — extension/asset wiring that resolves out of `node_modules` or the
// source tree at runtime.
//
// Usage:  bun run scripts/smoke-binary.ts [path-to-binary]
//   Default binary: `dist/thinkrail` — run `bun run build:binary` first (we error if it's missing).

import { existsSync, globSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const binary = resolve(process.argv[2] ?? join(import.meta.dir, "..", "dist", "thinkrail"));
if (!existsSync(binary)) {
	console.error(`binary not found at ${binary} — run \`bun run build:binary\` first.`);
	process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), "thinkrail-smoke-"));
const cacheDir = join(tmp, "cache");

function fail(message: string): never {
	console.error(`smoke FAILED: ${message}`);
	process.exit(1);
}

/** `promise`, or fail with `what` after `ms`. */
function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`timed out after ${ms}ms: ${what}`)), ms),
		),
	]);
}

const proc = Bun.spawn([binary, "--no-open", "--port", "24262"], {
	env: {
		...process.env,
		// Full isolation: never touch the runner/dev machine's real state, and force a fresh
		// cache so the binary's staging path (web assets + skills) is exercised from scratch.
		THINKRAIL_DATA_DIR: join(tmp, "data"),
		PI_CODING_AGENT_DIR: join(tmp, "pi-agent"),
		XDG_CACHE_HOME: cacheDir,
	},
	stdout: "pipe",
	stderr: "inherit",
});

/** The URL from the CLI's `thinkrail → http://…` line (it may scan past a busy port). */
async function readServedUrl(): Promise<string> {
	const decoder = new TextDecoder();
	let buffered = "";
	for await (const chunk of proc.stdout) {
		buffered += decoder.decode(chunk, { stream: true });
		const match = buffered.match(/thinkrail → (http:\/\/\S+)/);
		if (match) return match[1];
	}
	throw new Error(`stdout closed without a serving URL (output: ${JSON.stringify(buffered)})`);
}

try {
	const url = await within(
		Promise.race([
			readServedUrl(),
			proc.exited.then((code) => {
				throw new Error(`binary exited early with code ${code}`);
			}),
		]),
		30_000,
		"binary did not report a serving URL",
	);

	const health = await within(fetch(`${url}/health`), 10_000, "GET /health");
	if (!health.ok || (await health.text()) !== "ok") fail(`/health answered ${health.status}`);

	const index = await within(fetch(url), 10_000, "GET /");
	const body = await index.text();
	if (!index.ok || !body.includes("ThinkRail")) {
		fail(`staged web UI not served: / answered ${index.status}`);
	}

	// The bundled extensions' skills must be staged to the real filesystem (pi reads SKILL.md via fs).
	for (const skill of ["spec-graph", "brainstorming"]) {
		const hits = globSync(join(cacheDir, "thinkrail", "skills", "*", skill, "SKILL.md"));
		if (hits.length === 0) fail(`bundled skill "${skill}" was not staged under ${cacheDir}`);
	}

	proc.kill("SIGTERM");
	const exitCode = await within(proc.exited, 15_000, "shutdown on SIGTERM");
	// Windows has no real SIGTERM: Bun force-terminates the process, so the CLI's graceful handler never
	// runs and the exit code isn't meaningful — we only require that it terminates within the timeout.
	// Elsewhere the handler must run and exit 0.
	if (process.platform !== "win32" && exitCode !== 0) {
		fail(`SIGTERM shutdown exited with code ${exitCode}`);
	}

	console.log(
		`smoke OK: ${binary} booted at ${url}, served the UI + staged skills, exited cleanly.`,
	);
} catch (err) {
	proc.kill("SIGKILL");
	fail(err instanceof Error ? err.message : String(err));
} finally {
	rmSync(tmp, { recursive: true, force: true });
}
