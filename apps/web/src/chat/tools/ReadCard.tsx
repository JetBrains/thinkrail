import { RiFileTextLine as FileText } from "@remixicon/react";
import { projectRelativePath } from "@/lib";
import type { ToolRenderProps } from "../toolRegistry";
import { CodeBlock } from "./CodeBlock";
import { Collapsible, countLines } from "./Collapsible";
import { languageFromPath, numArg, resultText, strArg } from "./toolHelpers";

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
		<div data-testid="tool-read" className="flex flex-col gap-4">
			<div className="flex items-center gap-4 tr-text-metadata">
				<FileText className="size-12 shrink-0 text-text-muted" />
				<span className="truncate text-primary" title={path}>
					{displayPath}
				</span>
				{range ? <span className="shrink-0 text-text-muted">{range}</span> : null}
			</div>
			{status === "running" ? (
				<span className="text-text-muted tr-text-metadata">Reading…</span>
			) : status === "error" ? (
				<pre className="overflow-auto px-8 py-4 text-feedback-error tr-code-text">{output}</pre>
			) : output ? (
				<Collapsible lines={countLines(output)}>
					<CodeBlock code={output} lang={lang} />
				</Collapsible>
			) : (
				<span className="text-text-muted tr-text-metadata italic">(empty file)</span>
			)}
		</div>
	);
}
