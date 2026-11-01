import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("a killed host recovers real running resources and persists notification across two cold starts", async () => {
	const root = mkdtempSync(join(tmpdir(), "resource-restart-"));
	mkdirSync(join(root, "workspace"));
	const marker = join(root, "workspace", "keep-running");
	writeFileSync(marker, "keep fixture command running");
	const env: NodeJS.ProcessEnv = {
		HOME: root,
		USERPROFILE: root,
		PI_CODING_AGENT_DIR: join(root, "agent"),
		THINKRAIL_DATA_DIR: join(root, "data"),
		PI_OFFLINE: "1",
	};
	for (const key of [
		"PATH",
		"Path",
		"SystemRoot",
		"TEMP",
		"TMP",
		"ProgramFiles",
		"ProgramFiles(x86)",
		"SHELL",
	])
		if (process.env[key]) env[key] = process.env[key];
	const launch = (mode: string) => {
		const child = Bun.spawn(
			[
				process.execPath,
				fileURLToPath(new URL("./resourceInterruptions.fixture.ts", import.meta.url)),
				mode,
				root,
			],
			{ env, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
		);
		const output = Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
		void child.exited.then(() => clearTimeout(timer));
		return { child, output };
	};
	const original = launch("start");
	try {
		const deadline = Date.now() + 15_000;
		while (!existsSync(join(root, "start.json"))) {
			if (original.child.exitCode !== null || Date.now() > deadline)
				throw new Error(`Host fixture did not become ready: ${(await original.output).join("\n")}`);
			await Bun.sleep(10);
		}
		original.child.kill("SIGKILL");
		await original.child.exited;
		for (const mode of ["resume", "verify"]) {
			const restarted = launch(mode);
			const code = await restarted.child.exited;
			const output = await restarted.output;
			if (code !== 0)
				throw new Error(`Restart fixture ${mode} failed (${code}): ${output.join("\n")}`);
		}
		const started = JSON.parse(readFileSync(join(root, "start.json"), "utf8"));
		const resumed = JSON.parse(readFileSync(join(root, "resume.json"), "utf8"));
		const verified = JSON.parse(readFileSync(join(root, "verify.json"), "utf8"));
		expect(new Set([started.pid, resumed.pid, verified.pid]).size).toBe(3);
		for (const restored of [resumed, verified]) {
			expect(restored).toMatchObject({
				callsOnOpen: 0,
				callsAfterPrompt: 1,
				commandInterrupted: true,
				childInterrupted: true,
				commandInRequest: true,
				childInRequest: true,
			});
			expect(restored.after).toHaveLength(1);
			expect(restored.after[0].details.resourceIds).toEqual([
				`command:${started.commandId}`,
				`subagent:${started.childSessionId}`,
			]);
		}
		expect(resumed.before).toBe(0);
		expect(verified.before).toBe(1);
	} finally {
		rmSync(marker, { force: true });
		if (original.child.exitCode === null) original.child.kill("SIGKILL");
		await original.child.exited;
		rmSync(root, { recursive: true, force: true });
	}
}, 60_000);
