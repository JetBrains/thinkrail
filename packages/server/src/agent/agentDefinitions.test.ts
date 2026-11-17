import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureManagedAgentDefinition } from "./agentDefinitions";

const MARKER = "<!-- managed -->";
let agentDir: string;

beforeEach(() => {
	agentDir = mkdtempSync(join(tmpdir(), "trpi-agent-defs-"));
});
afterEach(() => rmSync(agentDir, { recursive: true, force: true }));

const file = () => join(agentDir, "agents", "x.md");

test("a missing definition is written", () => {
	ensureManagedAgentDefinition("x", `v1 ${MARKER}`, MARKER, agentDir);
	expect(readFileSync(file(), "utf8")).toBe(`v1 ${MARKER}`);
});

test("a managed definition is refreshed when its text changed", () => {
	ensureManagedAgentDefinition("x", `v1 ${MARKER}`, MARKER, agentDir);
	ensureManagedAgentDefinition("x", `v2 ${MARKER}`, MARKER, agentDir);
	expect(readFileSync(file(), "utf8")).toBe(`v2 ${MARKER}`);
});

test("a definition the user wrote or edited is never overwritten", () => {
	mkdirSync(join(agentDir, "agents"));
	writeFileSync(file(), "mine");
	ensureManagedAgentDefinition("x", `v2 ${MARKER}`, MARKER, agentDir);
	expect(readFileSync(file(), "utf8")).toBe("mine");
});
