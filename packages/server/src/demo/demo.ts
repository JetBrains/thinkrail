import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Project } from "@thinkrail/contracts";
import { dataDir } from "../persistence";
import { initProject, setProjectName } from "../projects";

export const DEMO_APP_DIR = "to-do-app";
export const DEMO_DISPLAY_NAME = "To Do App";

function templateRoot(): string {
	return process.env.THINKRAIL_DEMO_DIR ?? resolve(import.meta.dir, "../../assets/demo");
}

export function demoProjectPath(): string {
	return join(dataDir(), "demo", DEMO_APP_DIR);
}

export function ensureDemoProject(): Project {
	const target = demoProjectPath();
	if (!existsSync(target)) {
		const source = join(templateRoot(), DEMO_APP_DIR);
		if (!existsSync(source)) throw new Error(`Demo template not found: ${source}`);
		mkdirSync(join(dataDir(), "demo"), { recursive: true });
		cpSync(source, target, { recursive: true });
	}
	return setProjectName(initProject(target).id, DEMO_DISPLAY_NAME);
}

export function removeDemoFiles(): void {
	rmSync(demoProjectPath(), { recursive: true, force: true });
}
