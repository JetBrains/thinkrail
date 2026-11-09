import { RiFileTextLine as FileText } from "@remixicon/react";
import {
	languageFromPath,
	numArg,
	resultText,
	strArg,
	type ToolRenderProps,
} from "@thinkrail/extension-api/web";
import { useT } from "@thinkrail/locales/react";
import { CodeBlock } from "./CodeBlock";
import { Collapsible, countLines } from "./Collapsible";
import { ToolFileLink } from "./ToolFileLink";

export function ReadCard({
	toolCallId,
	args,
	result,
	status,
	workspaceRoot,
	onOpenFile,
}: ToolRenderProps) {
	const t = useT();
	const path = strArg(args, "path");
	const offset = numArg(args, "offset");
	const limit = numArg(args, "limit");
	const output = resultText(result);
	const lang = languageFromPath(path);

	let range = "";
	if (offset != null && offset > 1) {
		range =
			limit != null
				? t("tools.read.lineRange", { start: offset, end: offset + limit - 1 })
				: t("tools.read.fromLine", { offset });
	} else if (limit != null) {
		range = t("tools.read.firstLines", { count: limit });
	}

	return (
		<div data-testid="tool-read" className="flex flex-col gap-4">
			<div className="flex items-center gap-4 tr-text-metadata">
				<FileText className="size-12 shrink-0 text-text-muted" />
				<ToolFileLink
					path={path}
					workspaceRoot={workspaceRoot}
					onOpenFile={onOpenFile}
					disabled={status === "running"}
					className="text-primary"
				/>
				{range ? <span className="shrink-0 text-text-muted">{range}</span> : null}
			</div>
			{status === "running" ? (
				<span className="text-text-muted tr-text-metadata">{t("tools.read.reading")}</span>
			) : status === "error" ? (
				<pre className="overflow-auto px-8 py-4 text-feedback-error tr-code-text">{output}</pre>
			) : output ? (
				<Collapsible id={`${toolCallId}:content`} lines={countLines(output)}>
					<CodeBlock code={output} lang={lang} />
				</Collapsible>
			) : (
				<span className="text-text-muted tr-text-metadata italic">{t("tools.read.emptyFile")}</span>
			)}
		</div>
	);
}
