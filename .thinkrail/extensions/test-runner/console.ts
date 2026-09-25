import { cleanError, type Report } from "./junit";
import { MAX_ERROR_LINES, MAX_FAILURES } from "./model";

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const SUMMARY = /(?:^|\s)(\d+) (pass|fail|skip|todo)$/;
const RESULT = /\((pass|fail|skip|todo)\) (.+?)(?: \[[\d.]+m?s\])?$/;
const FILE_HEADER = /(?:^|\s)(\S+\.(?:test|spec|_test_|_spec_)[^\s:]*):$/;

export const parseConsole = (output: string): Report => {
	const counts = { pass: 0, fail: 0, skip: 0 };
	const failures: Report["failures"] = [];
	let failuresTotal = 0;
	let file: string | undefined;
	let block: string[] = [];
	let summarized = false;
	for (const raw of output.replace(ANSI, "").split("\n")) {
		const line = raw.trimEnd();
		const trimmed = line.trim();
		const summary = SUMMARY.exec(trimmed);
		if (summary) {
			summarized = true;
			const count = Number(summary[1]);
			if (summary[2] === "pass") counts.pass += count;
			else if (summary[2] === "fail") counts.fail += count;
			else counts.skip += count;
			continue;
		}
		const header = FILE_HEADER.exec(trimmed);
		if (header) {
			file = header[1];
			block = [];
			continue;
		}
		const result = RESULT.exec(trimmed);
		if (result) {
			if (result[1] === "fail") {
				failuresTotal += 1;
				if (failures.length < MAX_FAILURES)
					failures.push({
						name: result[2] ?? "(unnamed)",
						...(file ? { file } : {}),
						error: cleanError(block.join("\n").trim() || "failed"),
					});
			}
			block = [];
			continue;
		}
		block.push(line);
		if (block.length > MAX_ERROR_LINES * 4) block.shift();
	}
	if (!summarized) counts.fail = failuresTotal;
	return { counts, failures, failuresTotal: Math.max(failuresTotal, counts.fail) };
};
