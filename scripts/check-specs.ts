#!/usr/bin/env bun

import { join, resolve } from "node:path";
import { lintSpecs, type SpecLintOptions, trackedSpecFiles } from "./specsLint";

export interface SpecsLintRunOptions {
	enforce?: boolean;
	verbose?: boolean;
	trackedFiles?: readonly string[];
	stdout?: (line: string) => void;
	stderr?: (line: string) => void;
}

export function runSpecsLintCheck(inputRoot: string, options: SpecsLintRunOptions = {}): 0 | 1 {
	const root = resolve(inputRoot);
	const stdout = options.stdout ?? console.log;
	const stderr = options.stderr ?? console.error;
	const lintOptions: SpecLintOptions = {
		trackedFiles: options.trackedFiles ?? trackedSpecFiles(root),
	};
	const report = lintSpecs(root, lintOptions);

	if (options.verbose) {
		for (const metrics of report.metrics) {
			stdout(
				`  ${metrics.path}: ${metrics.words}/${metrics.budget} words, ${metrics.headings} headings, worst block ${metrics.worstBlock}`,
			);
		}
	}

	const summary = `${report.files} specs linted, ${report.violations.length} violation(s)`;
	if (report.violations.length === 0) {
		stdout(`check:specs: OK (${summary}).`);
		return 0;
	}

	const channel = options.enforce ? stderr : stdout;
	channel("Spec lint violations:");
	for (const violation of report.violations) {
		channel(`  - ${violation.path}: ${violation.message}`);
	}
	if (!options.enforce) {
		stdout(`check:specs: warn-only (${summary}); enforcement arrives with the corpus convergence.`);
		return 0;
	}
	stderr(`\ncheck:specs: FAILED (${summary}).`);
	return 1;
}

if (import.meta.main) {
	process.exitCode = runSpecsLintCheck(join(import.meta.dir, ".."), {
		enforce: process.argv.includes("--enforce"),
		verbose: process.argv.includes("--verbose"),
	});
}
