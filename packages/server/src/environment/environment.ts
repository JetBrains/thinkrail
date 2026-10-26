import { statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import type {
	HostEnvironment,
	HostEnvironmentIssue,
	HostEnvironmentStatus,
	HostEnvironmentUpdateResult,
} from "@thinkrail/contracts";
import { launchEnvKeys } from "@thinkrail/shared/shellEnv";
import { logger } from "../log";
import { loadHostEnvironment, saveHostEnvironment } from "../persistence";

const AGENT_DIR_VAR = "PI_CODING_AGENT_DIR";
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED_NAMES = new Set(["PATH", "HOME", "USERPROFILE", AGENT_DIR_VAR]);
const RESERVED_PREFIX = "THINKRAIL_";

const log = logger("environment");

let applied: HostEnvironment = { vars: [] };
let launchKeys: ReadonlySet<string> = new Set();

function expandAgentDir(value: string): string {
	if (value === "~") return homedir();
	if (value.startsWith("~/") || value.startsWith("~\\")) return join(homedir(), value.slice(2));
	return value;
}

function agentDirIssue(value: string): HostEnvironmentIssue | undefined {
	const path = expandAgentDir(value);
	if (!isAbsolute(path)) return { field: "agentDir", code: "notAbsolute" };
	try {
		if (!statSync(path).isDirectory()) return { field: "agentDir", code: "notDirectory" };
	} catch {
		return { field: "agentDir", code: "notFound" };
	}
	return undefined;
}

function isReserved(name: string): boolean {
	return RESERVED_NAMES.has(name.toUpperCase()) || name.toUpperCase().startsWith(RESERVED_PREFIX);
}

export function validateHostEnvironment(environment: HostEnvironment): HostEnvironmentIssue[] {
	const issues: HostEnvironmentIssue[] = [];
	if (environment.agentDir !== undefined) {
		const issue = agentDirIssue(environment.agentDir);
		if (issue) issues.push(issue);
	}
	const seen = new Set<string>();
	environment.vars.forEach(({ name }, index) => {
		if (!ENV_NAME.test(name)) issues.push({ field: "var", index, code: "invalidName" });
		else if (isReserved(name)) issues.push({ field: "var", index, code: "reserved" });
		else if (seen.has(name)) issues.push({ field: "var", index, code: "duplicate" });
		seen.add(name);
	});
	return issues;
}

function parseHostEnvironment(value: unknown): HostEnvironment | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	const { agentDir, vars } = value as Record<string, unknown>;
	if (agentDir !== undefined && typeof agentDir !== "string") return null;
	if (!Array.isArray(vars)) return null;
	const parsed: HostEnvironment["vars"] = [];
	for (const entry of vars) {
		if (typeof entry !== "object" || entry === null) return null;
		const { name, value: varValue } = entry as Record<string, unknown>;
		if (typeof name !== "string" || typeof varValue !== "string") return null;
		const trimmed = name.trim();
		if (trimmed.length === 0 && varValue.length === 0) continue;
		parsed.push({ name: trimmed, value: varValue });
	}
	const dir = agentDir?.trim();
	return { ...(dir ? { agentDir: dir } : {}), vars: parsed };
}

function sameEnvironment(a: HostEnvironment, b: HostEnvironment): boolean {
	return (
		a.agentDir === b.agentDir &&
		a.vars.length === b.vars.length &&
		a.vars.every((entry, i) => entry.name === b.vars[i]?.name && entry.value === b.vars[i]?.value)
	);
}

function launchOverridden(environment: HostEnvironment): string[] {
	const invalid = new Set(
		validateHostEnvironment(environment).flatMap((issue) =>
			issue.field === "var" ? [issue.index] : [],
		),
	);
	const names = [
		...(environment.agentDir !== undefined ? [AGENT_DIR_VAR] : []),
		...environment.vars.filter((_, index) => !invalid.has(index)).map(({ name }) => name),
	];
	return names.filter((name) => launchKeys.has(name));
}

export function applyHostEnvironment(): void {
	const stored = loadHostEnvironment();
	applied = stored;
	launchKeys = new Set(launchEnvKeys());
	const issues = validateHostEnvironment(stored);
	const skippedVars = new Set(
		issues.flatMap((issue) => (issue.field === "var" ? [issue.index] : [])),
	);
	stored.vars.forEach(({ name, value }, index) => {
		if (!skippedVars.has(index) && !launchKeys.has(name)) process.env[name] = value;
	});
	const agentDirInvalid = issues.some((issue) => issue.field === "agentDir");
	if (stored.agentDir !== undefined && !agentDirInvalid && !launchKeys.has(AGENT_DIR_VAR)) {
		process.env[AGENT_DIR_VAR] = expandAgentDir(stored.agentDir);
	}
	for (const issue of issues)
		log.warn(`stored environment entry skipped: ${issue.field}/${issue.code}`);
}

export function hostEnvironmentStatus(): HostEnvironmentStatus {
	const stored = loadHostEnvironment();
	return {
		stored,
		restartRequired: !sameEnvironment(stored, applied),
		launchOverridden: launchOverridden(stored),
		effectiveAgentDir: getAgentDir(),
	};
}

export function updateHostEnvironment(value: unknown): HostEnvironmentUpdateResult {
	const environment = parseHostEnvironment(value);
	if (!environment) throw new Error("Invalid environment record");
	const issues = validateHostEnvironment(environment);
	if (issues.length > 0) return { ok: false, issues };
	saveHostEnvironment(environment);
	return { ok: true, status: hostEnvironmentStatus() };
}
