import { parseFile } from "./parse.ts";

export interface SpecSection {
	readonly headings: readonly string[];
	readonly line: number;
	readonly endLine: number;
	readonly body: readonly string[];
	readonly bodyLine: number;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)]) {1,4}(?=\S)/;
const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;

export function cleanInline(text: string): string {
	return text
		.replace(/\[\[([^\]]+)\]\]/g, "$1")
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/`+/g, "")
		.replace(/\*\*|__/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function closesFence(line: string, open: string): boolean {
	const match = FENCE.exec(line);
	const marker = match?.[1];
	return (
		marker !== undefined &&
		marker[0] === open[0] &&
		marker.length >= open.length &&
		line.slice((match?.index ?? 0) + (match?.[0].length ?? 0)).trim() === ""
	);
}

interface Heading {
	readonly index: number;
	readonly level: number;
	readonly text: string;
}

interface Fence {
	readonly marker: string;
	readonly indent: number;
}

function fenceOpenedBy(line: string): Fence | null {
	const indent = LIST_ITEM.exec(line)?.[0].length ?? 0;
	const rest = line.slice(indent);
	const match = FENCE.exec(rest);
	const marker = match?.[1];
	if (!match || marker === undefined) return null;
	if (marker[0] === "`" && rest.slice(match[0].length).includes("`")) return null;
	return { marker, indent };
}

const TAB_STOP = 4;

function afterColumns(line: string, columns: number): { column: number; rest: string } {
	let column = 0;
	let index = 0;
	while (index < line.length && column < columns) {
		const char = line[index];
		if (char === " ") column += 1;
		else if (char === "\t") column += TAB_STOP - (column % TAB_STOP);
		else break;
		index += 1;
	}
	return { column, rest: " ".repeat(Math.max(0, column - columns)) + line.slice(index) };
}

function headingsOf(lines: readonly string[], from: number): Heading[] {
	const headings: Heading[] = [];
	let fence: Fence | null = null;
	for (let index = from; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		if (fence !== null) {
			const { column, rest } = afterColumns(line, fence.indent);
			if (line.trim() === "" || column >= fence.indent) {
				if (closesFence(rest, fence.marker)) fence = null;
				continue;
			}
			fence = null;
		}
		const opened = fenceOpenedBy(line);
		if (opened) {
			fence = opened;
			continue;
		}
		const heading = ATX_HEADING.exec(line);
		if (heading) {
			headings.push({
				index,
				level: heading[1]?.length ?? 1,
				text: cleanInline(heading[2] ?? ""),
			});
		}
	}
	return headings;
}

export function splitSections(content: string): SpecSection[] {
	const lines = (content.startsWith("\ufeff") ? content.slice(1) : content)
		.split("\n")
		.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
	const from = lines.length - parseFile(content).body.split("\n").length;
	const headings = headingsOf(lines, from);
	const titled =
		headings[0]?.level === 1 && headings.filter((heading) => heading.level === 1).length === 1;
	const sections: SpecSection[] = [];
	const push = (trail: readonly string[], start: number, bodyStart: number, end: number) => {
		const body = lines.slice(bodyStart, end);
		if (trail.length === 0 && body.every((line) => line.trim() === "")) return;
		sections.push({
			headings: trail,
			line: start + 1,
			endLine: end,
			body,
			bodyLine: bodyStart + 1,
		});
	};
	push([], from, from, headings[0]?.index ?? lines.length);
	const trail: Heading[] = [];
	headings.forEach((heading, at) => {
		const end = headings[at + 1]?.index ?? lines.length;
		if (titled && at === 0) {
			push([], heading.index, heading.index + 1, end);
			return;
		}
		while ((trail[trail.length - 1]?.level ?? 0) >= heading.level) trail.pop();
		trail.push(heading);
		push(
			trail.map((entry) => entry.text),
			heading.index,
			heading.index + 1,
			end,
		);
	});
	return sections;
}
