import { FileText } from "lucide-react";
import type { ToolRenderProps } from "../toolRegistry";
import { CodeBlock } from "./CodeBlock";
import { Collapsible, countLines } from "./Collapsible";
import { languageFromPath, numArg, projectRelativePath, resultText, strArg } from "./toolHelpers";

/** Body for the `read` tool: file path + optional line range + highlighted content. */
export function ReadCard({ args, result, status, workspaceRoot }: ToolRenderProps) {
	const path = strArg(args, "path");
	const displayPath = projectRelativePath(path, workspaceRoot);
	const offset = numArg(args, "offset");
	const limit = numArg(args, "limit");
	const output = resultText(result);
	const lang = languageFromPath(path);

	let range = "";
	if (offset != null && offset > 1) {
		range = limit != null ? `lines ${offset}–${offset + limit - 1}` : `from line ${offset}`;
	} else if (limit != null) {
		range = `first ${limit} lines`;
	}

	return (
		<div data-testid="tool-read" className="flex flex-col gap-xs">
			<div className="flex items-center gap-xs text-xs">
				<FileText className="size-3.5 shrink-0 text-muted" />
				<span className="truncate text-primary" title={path}>
					{displayPath}
				</span>
				{range ? <span className="shrink-0 text-hint">{range}</span> : null}
			</div>
			{status === "running" ? (
				<span className="text-muted text-xs">Reading…</span>
			) : status === "error" ? (
				<pre className="overflow-auto px-sm py-xs text-red text-xs">{output}</pre>
			) : output ? (
				<Collapsible lines={countLines(output)}>
					<CodeBlock code={output} lang={lang} />
				</Collapsible>
			) : (
				<span className="text-hint text-xs italic">(empty file)</span>
			)}
		</div>
	);
}
