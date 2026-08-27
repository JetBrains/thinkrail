import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CANARY = "19.3.0-canary-a1124489-20260826";
const roots: string[] = [];

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function runCheckWithLock(
	packages: Record<string, unknown>,
	overrides: Record<string, string> = { react: "catalog:", "react-dom": "catalog:" },
) {
	const root = mkdtempSync(join(tmpdir(), "thinkrail-check-catalog-"));
	roots.push(root);
	mkdirSync(join(root, "scripts"));
	cpSync(join(import.meta.dir, "check-catalog.ts"), join(root, "scripts/check-catalog.ts"));
	cpSync(join(import.meta.dir, "exactVersion.ts"), join(root, "scripts/exactVersion.ts"));
	writeFileSync(
		join(root, "package.json"),
		JSON.stringify({
			name: "dependency-check-fixture",
			private: true,
			workspaces: {
				packages: [],
				catalog: { react: CANARY, "react-dom": CANARY },
			},
			overrides,
		}),
	);
	writeFileSync(
		join(root, "bun.lock"),
		JSON.stringify({ lockfileVersion: 1, configVersion: 1, workspaces: {}, packages }),
	);
	return Bun.spawnSync({
		cmd: [process.execPath, "scripts/check-catalog.ts"],
		cwd: root,
		stderr: "pipe",
		stdout: "pipe",
	});
}

test("dependency check rejects multiple React runtime versions", () => {
	const result = runCheckWithLock({
		react: [`react@${CANARY}`, "", {}],
		"react-dom": [`react-dom@${CANARY}`, "", {}],
		"nested/react": ["react@19.2.7", "", {}],
		"nested/react-dom": ["react-dom@19.2.7", "", {}],
	});

	expect(result.exitCode).toBe(1);
	expect(result.stderr.toString()).toContain(
		`bun.lock: react resolves to multiple versions: 19.2.7, ${CANARY}`,
	);
	expect(result.stderr.toString()).toContain(
		`bun.lock: react-dom resolves to multiple versions: 19.2.7, ${CANARY}`,
	);
});

test("dependency check requires catalog-backed React overrides", () => {
	const result = runCheckWithLock(
		{
			react: [`react@${CANARY}`, "", {}],
			"react-dom": [`react-dom@${CANARY}`, "", {}],
		},
		{},
	);

	expect(result.exitCode).toBe(1);
	expect(result.stderr.toString()).toContain(
		'package.json: overrides.react must be "catalog:" to keep one runtime',
	);
	expect(result.stderr.toString()).toContain(
		'package.json: overrides.react-dom must be "catalog:" to keep one runtime',
	);
});
