import { expect, test } from "bun:test";
import { resolve } from "node:path";
import hutchConfig from "../hutch.config";
import manifest from "../package.json";

const desktopDir = resolve(import.meta.dir, "..");

test("selects real Bun and preserves the physical runtime resources without retired v1 fields", () => {
	const result = Bun.spawnSync(
		[
			process.execPath,
			"--eval",
			'const { default: config } = await import("./electrobun.config.ts"); console.log(JSON.stringify(config));',
		],
		{
			cwd: desktopDir,
			env: { ...process.env, THINKRAIL_DESKTOP_VERSION: "0.0.0-test" },
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	expect(result.exitCode).toBe(0);
	const config = JSON.parse(result.stdout.toString());
	expect(config.app).toEqual({
		name: "ThinkRail",
		identifier: "ai.thinkrail.app",
		version: "0.0.0-test",
	});
	expect(config.runtime).toEqual({ exitOnLastWindowClosed: true });
	expect(config.build).toMatchObject({
		mainProcess: "bun",
		bun: { entrypoint: "src/index.ts" },
		copy: { ".stage/web": "views/web", ".stage/runtime": "runtime" },
		mac: { bundleCEF: false },
		linux: { bundleCEF: false },
		win: { bundleCEF: false },
	});
	expect(config.build).not.toHaveProperty("bunVersion");
	expect(config.build).not.toHaveProperty("useAsar");
});

test("uses the exact npm bootstrap pin while Bun owns the workspace dependency graph", () => {
	expect(manifest.devDependencies.electrobun).toBe("2.0.1");
	expect(manifest.dependencies).not.toHaveProperty("electrobun");
	expect(hutchConfig).toEqual({ packageManager: "bun" });
});
