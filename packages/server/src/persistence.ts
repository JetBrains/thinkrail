// App state under the data dir (THINKRAIL_PI_DATA_DIR for dev/e2e isolation, else ~/.thinkrail-pi).
// This is OUR state, never the agent's — pi's own session files live under ~/.pi/agent.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Project } from "@thinkrail-pi/contracts";

export function dataDir(): string {
	return process.env.THINKRAIL_PI_DATA_DIR ?? join(homedir(), ".thinkrail-pi");
}

function readJson<T>(file: string, fallback: T): T {
	try {
		return JSON.parse(readFileSync(join(dataDir(), file), "utf8")) as T;
	} catch {
		return fallback;
	}
}

function writeJson(file: string, value: unknown): void {
	mkdirSync(dataDir(), { recursive: true });
	writeFileSync(join(dataDir(), file), `${JSON.stringify(value, null, "\t")}\n`);
}

export function loadProjects(): Project[] {
	return readJson<Project[]>("projects.json", []);
}

export function saveProjects(projects: Project[]): void {
	writeJson("projects.json", projects);
}
