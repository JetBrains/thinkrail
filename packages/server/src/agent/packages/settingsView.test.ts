import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createPiSettings, setDisabledPackagesResolver } from "./settingsView";

describe("createPiSettings", () => {
	let root: string;
	let agentDir: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "pi-settings-view-"));
		agentDir = join(root, "agent");
		mkdirSync(join(root, "project", ".pi"), { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(
			join(agentDir, "settings.json"),
			JSON.stringify({ packages: ["npm:keep", { source: "npm:drop", extensions: [] }] }),
		);
		writeFileSync(
			join(root, "project", ".pi", "settings.json"),
			JSON.stringify({ packages: ["npm:repo"] }),
		);
	});
	afterEach(() => {
		setDisabledPackagesResolver(() => new Set());
		rmSync(root, { recursive: true, force: true });
	});

	it("shows all, only enabled, or no declarations, and a view refuses package writes", () => {
		setDisabledPackagesResolver(() => new Set(["npm:drop", "npm:repo"]));
		const cwd = join(root, "project");
		const all = createPiSettings(cwd, agentDir, { projectTrusted: true, packages: "all" });
		expect(all.getGlobalSettings().packages).toEqual([
			"npm:keep",
			{ source: "npm:drop", extensions: [] },
		]);
		const enabled = createPiSettings(cwd, agentDir, { projectTrusted: true, packages: "enabled" });
		expect(enabled.getGlobalSettings().packages).toEqual(["npm:keep"]);
		expect(enabled.getProjectSettings().packages).toEqual([]);
		const none = createPiSettings(cwd, agentDir, { projectTrusted: true, packages: "none" });
		expect(none.getGlobalSettings().packages).toEqual([]);
		expect(none.getGlobalSettings().packages).toEqual([]);
		expect(() => enabled.setPackages([])).toThrow();
		expect(() => none.setProjectPackages([])).toThrow();
		all.setPackages(["npm:keep"]);
	});

	it("re-evaluates the switch set on every read", () => {
		const settings = createPiSettings(root, agentDir, { packages: "enabled" });
		expect(settings.getGlobalSettings().packages).toHaveLength(2);
		setDisabledPackagesResolver(() => new Set(["npm:keep"]));
		expect(settings.getGlobalSettings().packages).toEqual([{ source: "npm:drop", extensions: [] }]);
	});
});

describe("the host opens pi settings only through createPiSettings", () => {
	it("no other source file calls SettingsManager.create", () => {
		const src = join(import.meta.dir, "..", "..");
		const offenders: string[] = [];
		const walk = (dir: string) => {
			for (const entry of readdirSync(dir, { withFileTypes: true })) {
				const path = join(dir, entry.name);
				if (entry.isDirectory()) {
					if (entry.name !== "node_modules") walk(path);
					continue;
				}
				if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
				if (readFileSync(path, "utf8").includes("SettingsManager.create(")) {
					offenders.push(relative(src, path));
				}
			}
		};
		walk(src);
		expect(offenders).toEqual(["agent/packages/settingsView.ts"]);
	});
});
