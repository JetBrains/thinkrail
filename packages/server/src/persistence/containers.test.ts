import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Container } from "@thinkrail/contracts";
import { isContainerId, loadContainers, saveContainers } from "./persistence";

let root: string;
const savedDataDir = process.env.THINKRAIL_DATA_DIR;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "trpi-containers-store-"));
	process.env.THINKRAIL_DATA_DIR = root;
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
	if (savedDataDir === undefined) delete process.env.THINKRAIL_DATA_DIR;
	else process.env.THINKRAIL_DATA_DIR = savedDataDir;
});

const container = (id: string, workspaceIds: string[]): Container => ({
	id,
	name: `Container ${id}`,
	workspaceIds,
	createdAt: 1,
	updatedAt: 2,
});

const file = () => join(root, "containers.json");
const setAsideFiles = () => readdirSync(root).filter((name) => name.includes(".corrupt-"));

test("a missing file loads as an empty writable store", () => {
	expect(loadContainers()).toEqual({ containers: [], writable: true });
});

test("containers round-trip through a versioned, owner-only file", () => {
	const stored = [
		container("c1", ["w1", "w2"]),
		{ ...container("c2", ["w3"]), orchestratorSessionId: "s1" },
	];
	saveContainers(stored);
	expect(JSON.parse(readFileSync(file(), "utf8"))).toEqual({ version: 1, containers: stored });
	expect(statSync(file()).mode & 0o777).toBe(0o600);
	expect(loadContainers()).toEqual({ containers: stored, writable: true });
});

test("an unreadable or invalid file is set aside and loads empty", () => {
	for (const content of [
		"{ not json",
		JSON.stringify([]),
		JSON.stringify({ version: 1, containers: [{ ...container("../escape", ["w1"]) }] }),
		JSON.stringify({ version: 1, containers: [container("c1", ["w1"]), container("c1", ["w2"])] }),
		JSON.stringify({ version: 1, containers: [container("c1", ["w1"]), container("c2", ["w1"])] }),
	]) {
		writeFileSync(file(), content);
		expect(loadContainers()).toEqual({ containers: [], writable: true });
		expect(() => statSync(file())).toThrow();
	}
	expect(setAsideFiles().length).toBeGreaterThan(0);
});

test("a newer host's file is left untouched and refuses writes", () => {
	const newer = JSON.stringify({ version: 2, containers: [], future: true });
	writeFileSync(file(), newer);
	expect(loadContainers()).toEqual({ containers: [], writable: false });
	expect(readFileSync(file(), "utf8")).toBe(newer);
	expect(setAsideFiles()).toEqual([]);
});

test("a container id is one plain path segment", () => {
	expect(isContainerId("3f2b8c1e-0d4a-4c55-9a51-6b0f2f9a7c10")).toBe(true);
	for (const id of ["", ".", "..", "../x", "a/b", "a\\b", "-x", "x".repeat(65), 7]) {
		expect(isContainerId(id)).toBe(false);
	}
});
