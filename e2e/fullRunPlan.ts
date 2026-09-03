export type FullRunPhase = "no-agent" | "agent";

const forcedListArgs = ["--list", "--reporter=json", "--workers=1"];

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
	return value !== null && typeof value === "object" ? (value as JsonRecord) : null;
}

function countSuiteTests(value: unknown): number {
	const suite = record(value);
	if (!suite) return 0;
	let count = 0;
	if (Array.isArray(suite.specs)) {
		for (const value of suite.specs) {
			const spec = record(value);
			if (spec && Array.isArray(spec.tests)) count += spec.tests.length;
		}
	}
	if (Array.isArray(suite.suites)) {
		for (const child of suite.suites) count += countSuiteTests(child);
	}
	return count;
}

export function createPlaywrightListArgs(args: readonly string[]): string[] {
	const separator = args.indexOf("--");
	const options = separator === -1 ? args : args.slice(0, separator);
	const positionals = separator === -1 ? [] : args.slice(separator);
	return [...forcedListArgs, ...options, "--reporter=json", "--workers=1", ...positionals];
}

export function countSelectedPlaywrightTests(output: string): number {
	let parsed: unknown;
	try {
		parsed = JSON.parse(output);
	} catch {
		throw new Error("Playwright selection preflight did not return JSON");
	}
	const report = record(parsed);
	if (!report || !Array.isArray(report.suites) || !Array.isArray(report.errors)) {
		throw new Error("Playwright selection preflight returned an invalid report");
	}
	let count = 0;
	for (const suite of report.suites) count += countSuiteTests(suite);
	for (const value of report.errors) {
		const error = record(value);
		const message = error?.message;
		if (count === 0 && typeof message === "string" && message.includes("No tests found")) continue;
		throw new Error(
			typeof message === "string"
				? `Playwright selection preflight failed: ${message}`
				: "Playwright selection preflight failed",
		);
	}
	return count;
}

export function selectFocusedFullRunPhases(
	noAgentTests: number,
	agentTests: number,
): FullRunPhase[] {
	if (!Number.isInteger(noAgentTests) || noAgentTests < 0) {
		throw new Error("No-agent selected test count must be a non-negative integer");
	}
	if (!Number.isInteger(agentTests) || agentTests < 0) {
		throw new Error("Agent selected test count must be a non-negative integer");
	}
	const phases: FullRunPhase[] = [];
	if (noAgentTests > 0) phases.push("no-agent");
	if (agentTests > 0) phases.push("agent");
	if (phases.length === 0) throw new Error("No tests matched the focused full E2E selection");
	return phases;
}
