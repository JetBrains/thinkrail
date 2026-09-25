import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FILTER_MAX_CHARS, isRecord, type RunnerInfo } from "./model";

export type Runner =
	| { kind: "bun-default" }
	| { kind: "bun-script"; script: string }
	| { kind: "vitest-script"; script: string }
	| { kind: "script"; script: string };

export type Detected = { ok: true; runner: Runner } | { ok: false; message: string };

const PLACEHOLDER = /no test specified/;
const SHELL_OPERATORS = /[;&|<>`$()\n]/;

export const detectRunner = (pkg: unknown): Runner => {
	const scripts = isRecord(pkg) && isRecord(pkg.scripts) ? pkg.scripts : {};
	const script = typeof scripts.test === "string" ? scripts.test.trim() : "";
	if (!script || PLACEHOLDER.test(script)) return { kind: "bun-default" };
	if (!SHELL_OPERATORS.test(script)) {
		if (/^bun test(\s|$)/.test(script)) return { kind: "bun-script", script };
		if (/^vitest(\s|$)/.test(script)) return { kind: "vitest-script", script };
	}
	return { kind: "script", script };
};

export const readRunner = (path: string): Detected => {
	if (!existsSync(path)) return { ok: false, message: `${path} does not exist.` };
	const file = join(path, "package.json");
	if (!existsSync(file)) return { ok: true, runner: { kind: "bun-default" } };
	try {
		return { ok: true, runner: detectRunner(JSON.parse(readFileSync(file, "utf8"))) };
	} catch (error) {
		return { ok: false, message: `package.json is not valid JSON: ${String(error)}` };
	}
};

export const runnerLabel = (runner: Runner) =>
	runner.kind === "bun-default" ? "bun test" : `bun run test (${runner.script})`;

export const isStructured = (runner: Runner) => runner.kind !== "script";

export const runnerInfo = (detected: Detected): RunnerInfo =>
	detected.ok
		? {
				state: "ready",
				label: runnerLabel(detected.runner),
				structured: isStructured(detected.runner),
			}
		: { state: "error", message: detected.message };

export type ParsedFilter = { ok: true; parts: string[] } | { ok: false; message: string };

export const parseFilter = (filter: string | undefined): ParsedFilter => {
	const text = filter?.trim() ?? "";
	if (text.length > FILTER_MAX_CHARS)
		return { ok: false, message: `filter is longer than ${FILTER_MAX_CHARS} characters` };
	const parts = text ? text.split(/\s+/) : [];
	const flag = parts.find((part) => part.startsWith("-"));
	if (flag) return { ok: false, message: `filter part "${flag}" looks like a flag` };
	return { ok: true, parts };
};

export const planArgs = (runner: Runner, filters: readonly string[], reportFile: string) => {
	switch (runner.kind) {
		case "bun-default":
			return ["test", ...filters, "--reporter=junit", `--reporter-outfile=${reportFile}`];
		case "bun-script":
			return [
				"run",
				"test",
				"--",
				...filters,
				"--reporter=junit",
				`--reporter-outfile=${reportFile}`,
			];
		case "vitest-script":
			return [
				"run",
				"test",
				"--",
				...filters,
				"--reporter=default",
				"--reporter=junit",
				`--outputFile.junit=${reportFile}`,
			];
		case "script":
			return filters.length > 0 ? ["run", "test", "--", ...filters] : ["run", "test"];
	}
};

export const commandText = (runner: Runner, filters: readonly string[]) =>
	[
		runner.kind === "bun-default" ? "bun test" : "bun run test",
		...(runner.kind !== "bun-default" && filters.length > 0 ? ["--"] : []),
		...filters,
	].join(" ");
