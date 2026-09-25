import { XMLParser } from "fast-xml-parser";
import {
	type Counts,
	excerpt,
	type Failure,
	isRecord,
	MAX_ERROR_CHARS,
	MAX_ERROR_LINES,
	MAX_FAILURES,
} from "./model";

export interface Report {
	counts: Counts;
	failures: Failure[];
	failuresTotal: number;
}

const ARRAYS = new Set(["testsuite", "testcase", "failure", "error", "skipped"]);

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "",
	textNodeName: "text",
	parseAttributeValue: false,
	parseTagValue: false,
	htmlEntities: true,
	isArray: (name, _path, _leaf, isAttribute) => !isAttribute && ARRAYS.has(name),
});

const list = (value: unknown) => (Array.isArray(value) ? value.filter(isRecord) : []);

const str = (value: unknown) => (typeof value === "string" ? value : undefined);

const problemText = (problem: Record<string, unknown>) => {
	const body = str(problem.text)?.trim();
	const message = str(problem.message)?.trim();
	return body || message || str(problem.type) || "failed";
};

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

export const cleanError = (text: string) =>
	excerpt(text.replace(ANSI, ""), MAX_ERROR_LINES, MAX_ERROR_CHARS);

interface Walk {
	counts: Counts;
	failures: Failure[];
	failuresTotal: number;
}

const visitCase = (
	testcase: Record<string, unknown>,
	path: readonly string[],
	suiteFile: string | undefined,
	walk: Walk,
) => {
	const problems = [...list(testcase.failure), ...list(testcase.error)];
	if (problems.length === 0) {
		if (testcase.skipped !== undefined) walk.counts.skip += 1;
		else walk.counts.pass += 1;
		return;
	}
	walk.counts.fail += 1;
	walk.failuresTotal += 1;
	if (walk.failures.length >= MAX_FAILURES) return;
	const file = str(testcase.file) ?? suiteFile;
	const line = Number(str(testcase.line));
	walk.failures.push({
		name: [...path, str(testcase.name) ?? "(unnamed)"].join(" > "),
		...(file ? { file } : {}),
		...(Number.isInteger(line) && line > 0 ? { line } : {}),
		error: cleanError(problems.map(problemText).join("\n\n")),
	});
};

const visitSuite = (
	suite: Record<string, unknown>,
	path: readonly string[],
	suiteFile: string | undefined,
	walk: Walk,
) => {
	for (const testcase of list(suite.testcase)) visitCase(testcase, path, suiteFile, walk);
	for (const child of list(suite.testsuite)) {
		const name = str(child.name);
		visitSuite(child, name ? [...path, name] : path, str(child.file) ?? suiteFile, walk);
	}
};

export const parseJunit = (xml: string): Report | undefined => {
	const doc: unknown = parser.parse(xml);
	if (!isRecord(doc)) return undefined;
	const roots = isRecord(doc.testsuites) ? list(doc.testsuites.testsuite) : list(doc.testsuite);
	if (!isRecord(doc.testsuites) && roots.length === 0) return undefined;
	const walk: Walk = { counts: { pass: 0, fail: 0, skip: 0 }, failures: [], failuresTotal: 0 };
	for (const file of roots) {
		const fileName = str(file.file) ?? str(file.name);
		visitSuite(file, [], fileName, walk);
	}
	walk.failures.sort(
		(a, b) => (a.file ?? "").localeCompare(b.file ?? "") || (a.line ?? 0) - (b.line ?? 0),
	);
	return walk;
};
