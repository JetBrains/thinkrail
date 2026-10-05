import { diagramKind, type MermaidArt, render } from "lovely-mermaid";

const LEADING_COMMENTS = /^(?:[ \t]*(?:%%[^\n]*)?\r?\n)+/;
const FRONTMATTER = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n/;
const FLOWCHART_DIRECTION = /^(?:flowchart|graph)\s+([^\s;]+)/i;
const DIRECTIONS = /^(?:TB|TD|BT|RL|LR|[<>^v])$/i;
const TRUNCATED = /^diagram truncated\b/;

function headerLine(source: string): string {
	const body = source
		.replace(LEADING_COMMENTS, "")
		.replace(FRONTMATTER, "")
		.replace(LEADING_COMMENTS, "");
	return body.split(/\r?\n/, 1)[0]?.trim() ?? "";
}

export function renderArt(source: string): MermaidArt | null {
	try {
		return render(source.replace(LEADING_COMMENTS, ""));
	} catch {
		return null;
	}
}

export function probeRenderability(source: string): void {
	const kind = diagramKind(source);
	if (kind === null) return;
	const direction = FLOWCHART_DIRECTION.exec(headerLine(source))?.[1];
	if (kind === "flowchart" && direction !== undefined && !DIRECTIONS.test(direction)) {
		throw new Error(`unknown flowchart direction "${direction}" — use TB, TD, BT, RL or LR.`);
	}
	const art = renderArt(source);
	if (art === null) {
		throw new Error(`no statement of this ${kind} diagram could be read.`);
	}
	const dropped = art.warnings.filter((warning) => !TRUNCATED.test(warning));
	if (dropped.length > 0) {
		throw new Error(`part of the diagram could not be read — ${dropped.join("; ")}.`);
	}
}
