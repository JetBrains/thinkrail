import { RiFileAddLine as FilePlus } from "@remixicon/react";
import type { ToolRenderProps } from "../toolRegistry";
import { CodeBlock } from "./CodeBlock";
import { Collapsible, countLines } from "./Collapsible";
import { ToolFileLink } from "./ToolFileLink";
import { languageFromPath, resultText, strArg } from "./toolHelpers";

export function WriteCard({ args, result, status, workspaceRoot, onOpenFile }: ToolRenderProps) {
	const path = strArg(args, "path");
	const content = strArg(args, "content");
	const lang = languageFromPath(path);
	const message = resultText(result);

	return (
		<div data-testid="tool-write" className="flex flex-col gap-4">
			<div className="flex items-center gap-4 tr-text-metadata">
				<FilePlus className="size-12 shrink-0 text-feedback-success" />
				<ToolFileLink
					path={path}
					workspaceRoot={workspaceRoot}
					onOpenFile={onOpenFile}
					disabled={status !== "done"}
					className="text-text-default"
				/>
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
