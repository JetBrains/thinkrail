import { FIELDS, parseFile, scalar } from "./parse.ts";
import type { SpecContentEntry } from "./query.ts";

export const MODULE_SECTIONS = [
	"Responsibility",
	"Boundary",
	"Behavior",
	"Invariants",
	"Decisions",
	"History",
] as const;
export const REQUIRED_MODULE_SECTIONS = ["Responsibility", "Boundary"] as const;
export const SECTIONED_TYPES = ["module-design", "submodule-design"] as const;

export interface SpecBudgets {
	maxLines: number;
	maxWords: number;
	maxBytes: number;
	maxHeadingGap: number;
	maxBulletLines: number;
	maxTableCellChars: number;
}

export const DEFAULT_SPEC_BUDGETS: SpecBudgets = {
	maxLines: 400,
	maxWords: 4000,
	maxBytes: 50 * 1024,
	maxHeadingGap: 60,
	maxBulletLines: 8,
	maxTableCellChars: 200,
};

export const LINT_RULES = [
	"lines",
	"words",
	"bytes",
	"heading-gap",
	"bullet-length",
	"table-cell",
	"missing-section",
	"unknown-section",
	"empty-section",
] as const;
export type LintRule = (typeof LINT_RULES)[number];

export interface LintFinding {
	rule: LintRule;
	path: string;
	line: number;
	message: string;
}

export interface LintReport {
	checked: number;
	findings: LintFinding[];
}

const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+/;
const FENCE_OPEN = /^\s*(`{3,}|~{3,})/;
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;
const TABLE_DELIMITER_ROW = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function splitCells(row: string): string[] {
	const cells: string[] = [];
	let cell = "";
	let backslashes = 0;
	for (const ch of row) {
		if (ch === "|" && backslashes % 2 === 0) {
			cells.push(cell);
			cell = "";
		} else if (ch === "|") {
			cell = `${cell.slice(0, -1)}|`;
		} else {
			cell += ch;
		}
		backslashes = ch === "\\" ? backslashes + 1 : 0;
	}
	cells.push(cell);
	return cells;
}

interface BodyLine {
	text: string;
	line: number;
	inFence: boolean;
	opensFence: boolean;
}

function bodyLines(entry: SpecContentEntry): BodyLine[] {
	const all = entry.content.split(/\r?\n/);
	const body = parseFile(entry.content).body.split(/\r?\n/);
	const offset = all.length - body.length;
	if (body.length > 0 && body[body.length - 1] === "") body.pop();
	const out: BodyLine[] = [];
	let fence: string | null = null;
	for (let i = 0; i < body.length; i++) {
		const text = body[i] ?? "";
		if (fence === null) {
			const opens = FENCE_OPEN.exec(text);
			if (opens) fence = opens[1] ?? null;
			const inFence = fence !== null;
			out.push({ text, line: offset + i + 1, inFence, opensFence: inFence });
			continue;
		}
		const closes = FENCE_CLOSE.exec(text)?.[1];
		if (closes && closes[0] === fence[0] && closes.length >= fence.length) fence = null;
		out.push({ text, line: offset + i + 1, inFence: true, opensFence: false });
	}
	return out;
}

function sizeFindings(entry: SpecContentEntry, lines: BodyLine[], b: SpecBudgets): LintFinding[] {
	const findings: LintFinding[] = [];
	const lineCount = lines.length;
	if (lineCount > b.maxLines) {
		findings.push({
			rule: "lines",
			path: entry.path,
			line: 1,
			message: `${lineCount} lines (budget ${b.maxLines})`,
		});
	}
	let words = 0;
	for (const l of lines) words += l.text.split(/\s+/).filter(Boolean).length;
	if (words > b.maxWords) {
		findings.push({
			rule: "words",
			path: entry.path,
			line: 1,
			message: `${words} words (budget ${b.maxWords})`,
		});
	}
	const bytes = new TextEncoder().encode(entry.content).length;
	if (bytes >= b.maxBytes) {
		findings.push({
			rule: "bytes",
			path: entry.path,
			line: 1,
			message: `${Math.round(bytes / 1024)} KB (budget ${Math.round(b.maxBytes / 1024)} KB)`,
		});
	}
	return findings;
}

function headingGapFindings(
	entry: SpecContentEntry,
	lines: BodyLine[],
	b: SpecBudgets,
): LintFinding[] {
	const findings: LintFinding[] = [];
	let lastEnd = lines.length;
	while (lastEnd > 0 && (lines[lastEnd - 1]?.text.trim() ?? "") === "") lastEnd--;
	let prevIndex = -1;
	let prevTitle: string | null = null;
	const flush = (endIndex: number): void => {
		const gap = endIndex - prevIndex - 1;
		if (gap <= b.maxHeadingGap) return;
		const anchor = lines[Math.max(prevIndex, 0)];
		if (!anchor) return;
		const where = prevTitle === null ? "before the first heading" : `after "${prevTitle}"`;
		findings.push({
			rule: "heading-gap",
			path: entry.path,
			line: anchor.line,
			message: `${gap} lines ${where} (budget ${b.maxHeadingGap})`,
		});
	};
	for (let i = 0; i < lastEnd; i++) {
		const l = lines[i];
		if (!l || l.inFence) continue;
		const m = HEADING.exec(l.text);
		if (!m) continue;
		flush(i);
		prevIndex = i;
		prevTitle = m[2] ?? "";
	}
	flush(lastEnd);
	return findings;
}

function bulletFindings(entry: SpecContentEntry, lines: BodyLine[], b: SpecBudgets): LintFinding[] {
	const findings: LintFinding[] = [];
	let start: BodyLine | null = null;
	let indent = 0;
	let length = 0;
	const close = (): void => {
		if (start && length > b.maxBulletLines) {
			findings.push({
				rule: "bullet-length",
				path: entry.path,
				line: start.line,
				message: `list item spans ${length} lines (budget ${b.maxBulletLines})`,
			});
		}
		start = null;
		length = 0;
	};
	for (const l of lines) {
		const text = l.text;
		if (l.inFence) {
			if (l.opensFence && start && text.length - text.trimStart().length <= indent) close();
			continue;
		}
		if (text.trim() === "" || HEADING.test(text)) {
			close();
			continue;
		}
		const item = LIST_ITEM.exec(text);
		if (item) {
			close();
			start = l;
			indent = item[1]?.length ?? 0;
			length = 1;
			continue;
		}
		if (start) length++;
	}
	close();
	return findings;
}

function tableRows(lines: BodyLine[]): BodyLine[] {
	const rows: BodyLine[] = [];
	let block: BodyLine[] = [];
	let isTable = false;
	const flush = (): void => {
		if (isTable) rows.push(...block);
		block = [];
		isTable = false;
	};
	for (const l of lines) {
		if (l.inFence || l.text.trim() === "" || HEADING.test(l.text)) {
			flush();
			continue;
		}
		if (block.length === 1 && TABLE_DELIMITER_ROW.test(l.text)) isTable = true;
		block.push(l);
	}
	flush();
	return rows;
}

function tableFindings(entry: SpecContentEntry, lines: BodyLine[], b: SpecBudgets): LintFinding[] {
	const findings: LintFinding[] = [];
	for (const l of tableRows(lines)) {
		const widest = splitCells(l.text)
			.map((cell) => cell.trim().length)
			.reduce((max, n) => Math.max(max, n), 0);
		if (widest > b.maxTableCellChars) {
			findings.push({
				rule: "table-cell",
				path: entry.path,
				line: l.line,
				message: `table cell of ${widest} chars (budget ${b.maxTableCellChars})`,
			});
		}
	}
	return findings;
}

function sectionFindings(entry: SpecContentEntry, lines: BodyLine[]): LintFinding[] {
	const type = scalar(entry.frontmatter, FIELDS.type);
	if (!type || !(SECTIONED_TYPES as readonly string[]).includes(type)) return [];
	const findings: LintFinding[] = [];
	const known = new Set<string>(MODULE_SECTIONS);
	const sections: { title: string; line: number; content: number }[] = [];
	for (const l of lines) {
		if (l.inFence) continue;
		const m = HEADING.exec(l.text);
		if (m && m[1] === "##") {
			sections.push({ title: m[2] ?? "", line: l.line, content: 0 });
			continue;
		}
		const current = sections[sections.length - 1];
		if (current && l.text.trim() !== "" && !HEADING.test(l.text)) current.content++;
	}
	const present = new Set(sections.map((s) => s.title));
	for (const required of REQUIRED_MODULE_SECTIONS) {
		if (!present.has(required)) {
			findings.push({
				rule: "missing-section",
				path: entry.path,
				line: 1,
				message: `no "## ${required}" section`,
			});
		}
	}
	for (const s of sections) {
		if (!known.has(s.title)) {
			findings.push({
				rule: "unknown-section",
				path: entry.path,
				line: s.line,
				message: `"## ${s.title}" is not a skeleton section`,
			});
		}
		if (s.content === 0) {
			findings.push({
				rule: "empty-section",
				path: entry.path,
				line: s.line,
				message: `"## ${s.title}" has no content`,
			});
		}
	}
	return findings;
}

export function lintSpec(
	entry: SpecContentEntry,
	budgets: SpecBudgets = DEFAULT_SPEC_BUDGETS,
): LintFinding[] {
	const lines = bodyLines(entry);
	return [
		...sizeFindings(entry, lines, budgets),
		...headingGapFindings(entry, lines, budgets),
		...bulletFindings(entry, lines, budgets),
		...tableFindings(entry, lines, budgets),
		...sectionFindings(entry, lines),
	].sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
}

export function lintSpecs(
	entries: SpecContentEntry[],
	budgets: SpecBudgets = DEFAULT_SPEC_BUDGETS,
): LintReport {
	const findings = entries.flatMap((entry) => lintSpec(entry, budgets));
	findings.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
	return { checked: entries.length, findings };
}

export function formatLintFinding(finding: LintFinding): string {
	return `${finding.path}:${finding.line} [${finding.rule}] ${finding.message}`;
}
