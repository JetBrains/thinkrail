import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parseFile, type SpecContentEntry } from "../index.ts";
import questions from "./questions.json";
import { type BenchQuestion, formatReport, scoreQuestions } from "./score.ts";

const CORPUS = join(import.meta.dir, "corpus");
const FROZEN_SUFFIX = ".txt";
const REQUIRED = 16;

function frozenCorpus(dir = CORPUS): SpecContentEntry[] {
	return readdirSync(dir, { withFileTypes: true })
		.sort((a, b) => (a.name < b.name ? -1 : 1))
		.flatMap((entry) => {
			const abs = join(dir, entry.name);
			if (entry.isDirectory()) return frozenCorpus(abs);
			const content = readFileSync(abs, "utf8");
			const { frontmatter } = parseFile(content);
			if (frontmatter === null) throw new Error(`frozen spec without frontmatter: ${abs}`);
			const path = relative(CORPUS, abs).split(sep).join("/").slice(0, -FROZEN_SUFFIX.length);
			return [{ path, content, frontmatter }];
		});
}

test("the question → section benchmark finds the expected section in the top three", () => {
	const entries = frozenCorpus();
	const asked: readonly BenchQuestion[] = questions.questions;
	expect(asked.length).toBe(20);
	for (const question of asked) {
		expect(entries.some((entry) => entry.path === question.path)).toBe(true);
	}
	const report = scoreQuestions(entries, asked);
	if (report.found < REQUIRED) console.log(formatReport(report));
	expect(report.found).toBeGreaterThanOrEqual(REQUIRED);
});
