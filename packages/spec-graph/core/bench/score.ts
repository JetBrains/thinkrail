import {
	indexSections,
	type SpecContentEntry,
	type SpecSectionHit,
	searchSpecs,
} from "../index.ts";
import { cleanInline } from "../sections.ts";

export interface BenchQuestion {
	readonly query: string;
	readonly path: string;
	readonly heading: string;
	readonly why?: string;
}

export interface BenchRow {
	readonly question: BenchQuestion;
	readonly rank: number | null;
	readonly top: readonly SpecSectionHit[];
}

export interface BenchReport {
	readonly rows: readonly BenchRow[];
	readonly found: number;
}

export const BENCH_TOP = 3;

function isTarget(hit: SpecSectionHit, question: BenchQuestion): boolean {
	const heading = cleanInline(question.heading);
	return (
		hit.path === question.path && (hit.heading === heading || hit.heading.endsWith(` › ${heading}`))
	);
}

export function scoreQuestions(
	entries: readonly SpecContentEntry[],
	questions: readonly BenchQuestion[],
	top = BENCH_TOP,
): BenchReport {
	const index = indexSections(entries);
	const rows = questions.map((question): BenchRow => {
		const { hits } = searchSpecs(index, question.query, { limit: 20 });
		const at = hits.findIndex((hit) => isTarget(hit, question));
		return { question, rank: at === -1 ? null : at + 1, top: hits.slice(0, top) };
	});
	return { rows, found: rows.filter((row) => row.rank !== null && row.rank <= top).length };
}

export function formatReport(report: BenchReport, top = BENCH_TOP): string {
	const lines = report.rows.map((row) => {
		const mark = row.rank !== null && row.rank <= top ? "✓" : "✗";
		const rank = row.rank === null ? ">20" : `#${row.rank}`;
		const best = row.top[0];
		const got = best ? `${best.path} › ${best.heading || best.title}` : "(no hits)";
		return `${mark} ${rank.padEnd(4)} ${row.question.query}\n      want ${row.question.path} › ${row.question.heading}\n      got  ${got}`;
	});
	return `${lines.join("\n")}\n${report.found}/${report.rows.length} in the top ${top}`;
}
