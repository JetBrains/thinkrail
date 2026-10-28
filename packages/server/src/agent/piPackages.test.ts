import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isLoaderPackagePolicyStale, packagePolicyKey } from "./extensions";
import { watchUserMcpConfig } from "./mcpSessions";
import {
	handlePiSettingsFileChanged,
	handleProjectPiSettingsChanged,
	primeUserPiSettings,
	setPiPackagesPublisher,
} from "./piPackages";

describe("pi package settings changes", () => {
	let root: string;
	let agentDir: string;
	let settingsPath: string;
	const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
	let published = 0;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "thinkrail-pi-settings-watch-"));
		agentDir = join(root, "agent");
		mkdirSync(agentDir, { recursive: true });
		settingsPath = join(agentDir, "settings.json");
		process.env.PI_CODING_AGENT_DIR = agentDir;
		published = 0;
		setPiPackagesPublisher(() => {
			published += 1;
		});
	});
	afterEach(() => {
		setPiPackagesPublisher(null);
		if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
		rmSync(root, { recursive: true, force: true });
	});

	it("refreshes only on a semantic change to the resource declarations", () => {
		writeFileSync(settingsPath, JSON.stringify({ packages: ["npm:a"], defaultModel: "x" }));
		primeUserPiSettings();
		const before = packagePolicyKey();

		writeFileSync(settingsPath, JSON.stringify({ packages: ["npm:a"], defaultModel: "y" }));
		expect(handlePiSettingsFileChanged(settingsPath)).toBe(false);
		expect(packagePolicyKey()).toBe(before);
		expect(published).toBe(0);

		writeFileSync(
			settingsPath,
			JSON.stringify({ packages: ["npm:a", "npm:b"], defaultModel: "y" }),
		);
		expect(handlePiSettingsFileChanged(settingsPath)).toBe(true);
		expect(packagePolicyKey()).not.toBe(before);
		expect(published).toBe(1);

		expect(handlePiSettingsFileChanged(settingsPath)).toBe(false);
		expect(published).toBe(1);

		writeFileSync(settingsPath, "{ not json");
		expect(handlePiSettingsFileChanged(settingsPath)).toBe(true);
	});

	it("treats a repository .pi/settings.json the same way, keyed by worktree", () => {
		const worktree = join(root, "wt");
		mkdirSync(join(worktree, ".pi"), { recursive: true });
		writeFileSync(join(worktree, ".pi", "settings.json"), JSON.stringify({ skills: ["./s"] }));
		expect(handleProjectPiSettingsChanged(worktree)).toBe(true);
		expect(handleProjectPiSettingsChanged(worktree)).toBe(false);
		writeFileSync(join(worktree, ".pi", "settings.json"), JSON.stringify({ skills: [] }));
		expect(handleProjectPiSettingsChanged(worktree)).toBe(true);
	});

	it("the agent-dir watcher hands settings.json edits to the packages layer", async () => {
		writeFileSync(settingsPath, JSON.stringify({ packages: [] }));
		primeUserPiSettings();
		const seen: string[] = [];
		const stop = watchUserMcpConfig({ onSettingsChanged: (path) => seen.push(path) });
		try {
			await new Promise((resolve) => setTimeout(resolve, 50));
			writeFileSync(settingsPath, JSON.stringify({ packages: ["npm:a"] }));
			const deadline = Date.now() + 3_000;
			while (seen.length === 0 && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 25));
			}
			expect(seen.at(-1)).toBe(settingsPath);
		} finally {
			stop();
		}
	});

	it("isLoaderPackagePolicyStale ignores loaders it never recorded", () => {
		expect(isLoaderPackagePolicyStale({} as never)).toBe(false);
	});
});
