#!/usr/bin/env bun

import { join } from "node:path";
import { runSpecLintCheck } from "./specLint";

if (import.meta.main) {
	process.exitCode = runSpecLintCheck(join(import.meta.dir, ".."), {
		updateBaseline: process.argv.includes("--update-baseline"),
	});
}
