import { renderMermaidASCII } from "beautiful-mermaid";
import { diagramFamily, withoutPreamble } from "./diagramFamily.ts";

export function renderBoxDrawing(source: string): string | undefined {
	if (diagramFamily(source) === undefined) return undefined;
	const drawing = renderMermaidASCII(withoutPreamble(source), { colorMode: "none" });
	return drawing.trim() === "" ? undefined : drawing;
}

export function probeRenderability(source: string): void {
	if (diagramFamily(source) === undefined) return;
	if (renderBoxDrawing(source) === undefined) {
		throw new Error("the diagram renders empty — no nodes or edges were recognised in the source.");
	}
}
