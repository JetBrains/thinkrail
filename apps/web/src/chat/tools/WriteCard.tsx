import { RiFileAddLine as FilePlus } from "@remixicon/react";
import { projectRelativePath } from "@/lib";
import type { ToolRenderProps } from "../toolRegistry";
import { CodeBlock } from "./CodeBlock";
import { Collapsible, countLines } from "./Collapsible";
import { languageFromPath, resultText, strArg } from "./toolHelpers";

export function WriteCard({ args, result, status, workspaceRoot }: ToolRenderProps) {
	const path = strArg(args, "path");
	const displayPath = projectRelativePath(path, workspaceRoot);
	const content = strArg(args, "content");
	const lang = languageFromPath(path);
	const message = resultText(result);

	return (
		<div data-testid="tool-write" className="flex flex-col gap-4">
			<div className="flex items-center gap-4 tr-text-metadata">
				<FilePlus className="size-12 shrink-0 text-feedback-success" />
				<span className="truncate text-text-default" title={path}>
					{displayPath}
				</span>
				<span className="shrink-0 text-text-muted">written</span>
			</div>
			{status === "error" ? (
				<pre className="overflow-auto px-8 py-4 text-feedback-error tr-code-text">{message}</pre>
			) : content ? (
				<Collapsible lines={countLines(content)}>
					<CodeBlock code={content} lang={lang} />
				</Collapsible>
			) : (
				<span className="text-text-muted tr-text-metadata italic">(empty file)</span>
			)}
		</div>
	);
}
