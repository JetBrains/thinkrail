#!/usr/bin/env bun

import { join, resolve } from "node:path";
import { checkSpecSurfaces } from "./specSurface";

export interface SpecSurfaceRunOptions {
	listSkipped?: boolean;
	stdout?: (line: string) => void;
	stderr?: (line: string) => void;
}

export function runSpecSurfaceCheck(inputRoot: string, options: SpecSurfaceRunOptions = {}): 0 | 1 {
	const root = resolve(inputRoot);
	const stdout = options.stdout ?? console.log;
	const stderr = options.stderr ?? console.error;
	const report = checkSpecSurfaces(root);
	const summary = `${report.enrolled} enrolled, ${report.checked} compared; ${report.skipped.length} not enrolled`;

	if (options.listSkipped) {
		for (const entry of report.skipped) stdout(`  ${entry.path}: ${entry.reason}`);
	}

	if (report.violations.length > 0) {
		stderr("Spec surface drift:");
		for (const violation of report.violations) stderr(`  - ${violation}`);
		stderr(`\n${summary}. Run with --list-skipped to see every unenrolled spec.`);
		return 1;
	}

	stdout(
		`check-spec-surface: OK (${summary}). Run with --list-skipped to see every unenrolled spec.`,
	);
	return 0;
}

if (import.meta.main) {
	process.exitCode = runSpecSurfaceCheck(join(import.meta.dir, ".."), {
		listSkipped: process.argv.includes("--list-skipped"),
	});
}
