import { FilePlus } from "lucide-react";
import type { ToolRenderProps } from "../toolRegistry";
import { CodeBlock } from "./CodeBlock";
import { Collapsible, countLines } from "./Collapsible";
import { fileName, languageFromPath, resultText, strArg } from "./toolHelpers";

/** Body for the `write` tool: file header + highlighted preview of the written content. */
export function WriteCard({ args, result, status }: ToolRenderProps) {
	const path = strArg(args, "path");
	const content = strArg(args, "content");
	const lang = languageFromPath(path);
	const message = resultText(result);

	return (
		<div data-testid="tool-write" className="flex flex-col gap-xs">
			<div className="flex items-center gap-xs text-xs">
				<FilePlus className="size-3.5 shrink-0 text-green" />
				<span className="truncate text-text" title={path}>
					{fileName(path)}
				</span>
				<span className="shrink-0 text-hint">written</span>
			</div>
			{status === "error" ? (
				<pre className="overflow-auto px-sm py-xs text-red text-xs">{message}</pre>
			) : content ? (
				<Collapsible lines={countLines(content)}>
					<CodeBlock code={content} lang={lang} />
				</Collapsible>
			) : (
				<span className="text-hint text-xs italic">(empty file)</span>
			)}
		</div>
	);
}
