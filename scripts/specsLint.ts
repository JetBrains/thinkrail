import { join, resolve } from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
import {
	buildGraph,
	FIELDS,
	linkTargets,
	LINK_KINDS,
	parseFile,
	scalar,
	SpecIndex,
	validateGraph,
} from "pi-spec-graph/core";

export const SPEC_BUDGET_FIELD = "spec-budget";
export const TASK_SPEC_TYPE = "task-spec";

export interface SpecLintRules {
	maxWords: number;
	maxBlockWords: number;
	wordsPerHeading: number;
	maxBudgetOverride: number;
}

export const DEFAULT_RULES: SpecLintRules = {
	maxWords: 3000,
	maxBlockWords: 120,
	wordsPerHeading: 500,
	maxBudgetOverride: 4500,
};

export interface SpecLintViolation {
	path: string;
	message: string;
}

export interface SpecFileMetrics {
	path: string;
	words: number;
	budget: number;
	headings: number;
	blocksOverCap: number;
	worstBlock: number;
}

export interface SpecLintReport {
	files: number;
	violations: SpecLintViolation[];
	metrics: SpecFileMetrics[];
}

interface MarkdownNode {
	type: string;
	value?: string;
	depth?: number;
	children?: readonly MarkdownNode[];
}

function countWords(text: string): number {
	return text.split(/\s+/).filter((token) => token.length > 0).length;
}

function wordsIn(node: MarkdownNode, skipLists: boolean): number {
	if (node.type === "code" || node.type === "html") return 0;
	if (skipLists && node.type === "list") return 0;
	let total = 0;
	if ((node.type === "text" || node.type === "inlineCode") && node.value !== undefined) {
		total += countWords(node.value);
	}
	for (const child of node.children ?? []) total += wordsIn(child, skipLists);
	return total;
}

interface Metrics {
	words: number;
	headings: number;
	blocks: number[];
}

function measure(body: string): Metrics {
	const tree = fromMarkdown(body) as MarkdownNode;
	const metrics: Metrics = { words: 0, headings: 0, blocks: [] };
	const visit = (node: MarkdownNode): void => {
		if (node.type === "code" || node.type === "html") return;
		if (node.type === "heading") {
			if ((node.depth ?? 1) >= 2) metrics.headings++;
			metrics.words += wordsIn(node, false);
			return;
		}
		if (node.type === "paragraph") {
			const words = wordsIn(node, false);
			metrics.words += words;
			metrics.blocks.push(words);
			return;
		}
		if (node.type === "listItem") {
			const words = wordsIn(node, true);
			metrics.words += words;
			metrics.blocks.push(words);
			for (const child of node.children ?? []) {
				if (child.type === "list") visit(child);
			}
			return;
		}
		for (const child of node.children ?? []) visit(child);
	};
	visit(tree);
	return metrics;
}

function budgetOverride(
	frontmatter: Record<string, string | string[]>,
	rules: SpecLintRules,
): { budget: number } | { violation: string } {
	const raw = scalar(frontmatter, SPEC_BUDGET_FIELD);
	if (raw === undefined) return { budget: rules.maxWords };
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isFinite(parsed) || parsed <= 0 || String(parsed) !== raw.trim()) {
		return { violation: `\`${SPEC_BUDGET_FIELD}: ${raw}\` is not a positive integer` };
	}
	if (parsed > rules.maxBudgetOverride) {
		return { violation: `\`${SPEC_BUDGET_FIELD}: ${parsed}\` exceeds the hard ceiling ${rules.maxBudgetOverride}` };
	}
	return { budget: parsed };
}

function lintFile(
	path: string,
	content: string,
	frontmatter: Record<string, string | string[]>,
	rules: SpecLintRules,
): { metrics: SpecFileMetrics; violations: SpecLintViolation[] } {
	const { body } = parseFile(content);
	const { words, headings, blocks } = measure(body);
	const override = budgetOverride(frontmatter, rules);
	const budget = "budget" in override ? override.budget : rules.maxWords;
	const metrics: SpecFileMetrics = {
		path,
		words,
		budget,
		headings,
		blocksOverCap: blocks.filter((block) => block > rules.maxBlockWords).length,
		worstBlock: blocks.reduce((max, block) => Math.max(max, block), 0),
	};
	const violations: SpecLintViolation[] = [];
	if ("violation" in override) {
		violations.push({ path, message: override.violation });
	}
	if (scalar(frontmatter, FIELDS.type) === TASK_SPEC_TYPE) {
		return { metrics, violations };
	}
	if (words > budget) {
		violations.push({ path, message: `${words} words exceeds the ${budget} budget` });
	}
	if (metrics.blocksOverCap > 0) {
		violations.push({
			path,
			message: `${metrics.blocksOverCap} prose block(s) over ${rules.maxBlockWords} words (worst: ${metrics.worstBlock})`,
		});
	}
	const requiredHeadings = Math.max(1, Math.ceil(words / rules.wordsPerHeading));
	if (headings < requiredHeadings) {
		violations.push({
			path,
			message: `${headings} section heading(s) for ${words} words; expected at least ${requiredHeadings} (one per ${rules.wordsPerHeading} words)`,
		});
	}
	return { metrics, violations };
}

export interface SpecLintOptions {
	rules?: SpecLintRules;
	trackedFiles?: readonly string[];
}

export function lintSpecs(inputRoot: string, options: SpecLintOptions = {}): SpecLintReport {
	const root = resolve(inputRoot);
	const rules = options.rules ?? DEFAULT_RULES;
	const tracked = options.trackedFiles === undefined ? null : new Set(options.trackedFiles);
	const entries = new SpecIndex(root)
		.contentEntries()
		.filter((entry) => tracked === null || tracked.has(entry.path))
		.sort((a, b) => a.path.localeCompare(b.path));

	const report: SpecLintReport = { files: 0, violations: [], metrics: [] };
	for (const entry of entries) {
		report.files++;
		const { metrics, violations } = lintFile(entry.path, entry.content, entry.frontmatter, rules);
		report.metrics.push(metrics);
		report.violations.push(...violations);
	}

	const graph = buildGraph(
		entries.map((entry) => ({ path: entry.path, frontmatter: entry.frontmatter })),
	);
	const validity = validateGraph(graph);
	for (const link of validity.danglingLinks) {
		report.violations.push({
			path: link.fromPath,
			message: `${link.kind} link to missing spec id \`${link.target}\``,
		});
	}
	for (const duplicate of validity.duplicateIds) {
		report.violations.push({
			path: duplicate.paths[0] ?? "",
			message: `duplicate spec id \`${duplicate.id}\` also used by ${duplicate.paths.slice(1).join(", ")}`,
		});
	}
	for (const cycle of validity.parentCycles) {
		report.violations.push({
			path: cycle.ids[0] ?? "",
			message: `parent cycle: ${cycle.ids.join(" -> ")}`,
		});
	}
	for (const node of graph.nodes.values()) {
		if (node.type === TASK_SPEC_TYPE) continue;
		for (const kind of LINK_KINDS) {
			for (const target of linkTargets(node.frontmatter, kind)) {
				const targetNode = graph.nodes.get(target);
				if (targetNode?.type === TASK_SPEC_TYPE) {
					report.violations.push({
						path: node.path,
						message: `durable spec links ${TASK_SPEC_TYPE} id \`${target}\` (${kind}); task-specs are temporary and removed when work lands`,
					});
				}
			}
		}
	}

	report.violations.sort((a, b) =>
		a.path === b.path ? a.message.localeCompare(b.message) : a.path.localeCompare(b.path),
	);
	return report;
}

export function trackedSpecFiles(root: string): string[] {
	const result = Bun.spawnSync(["git", "ls-files"], { cwd: join(root), stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) {
		throw new Error(`git ls-files failed: ${result.stderr.toString().trim()}`);
	}
	return result.stdout
		.toString()
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}
