import type { ReactNode } from "react";
import type { ToolRenderProps } from "../toolRegistry";
import { Collapsible, countLines } from "./Collapsible";
import { ToolFileLink } from "./ToolFileLink";
import { resultText, strArg } from "./toolHelpers";

interface LinkedTextSegment {
	text: string;
	path?: string;
}

const PATH_PREFIX_BOUNDARY = /[\s([{"'=]/;
const PATH_SUFFIX_BOUNDARY = /[\s)\]}"',;:]/;

function boundedPathIndex(text: string, path: string, cursor: number): number {
	let from = cursor;
	while (from < text.length) {
		const index = text.indexOf(path, from);
		if (index < 0) return -1;
		const before = index === 0 ? "" : text[index - 1];
		const afterIndex = index + path.length;
		const after = afterIndex === text.length ? "" : text[afterIndex];
		if (
			(!before || PATH_PREFIX_BOUNDARY.test(before)) &&
			(!after || PATH_SUFFIX_BOUNDARY.test(after))
		) {
			return index;
		}
		from = index + 1;
	}
	return -1;
}

function objectValue(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function stringField(value: unknown, key: string): string | null {
	const object = objectValue(value);
	return object && typeof object[key] === "string" ? object[key] : null;
}

function objectsField(value: unknown, key: string): Record<string, unknown>[] {
	const object = objectValue(value);
	const items = object?.[key];
	return Array.isArray(items)
		? items.flatMap((item) => {
				const record = objectValue(item);
				return record ? [record] : [];
			})
		: [];
}

function uniquePaths(paths: Array<string | null>): string[] {
	return [...new Set(paths.filter((path): path is string => Boolean(path)))];
}

export function specToolPaths(
	toolName: string,
	args: Record<string, unknown>,
	result: unknown,
): string[] {
	const details = objectValue(result)?.details;
	switch (toolName) {
		case "spec_grep":
			return uniquePaths(
				objectsField(details, "matches").map((match) => stringField(match, "path")),
			);
		case "spec_get":
			return uniquePaths([
				stringField(details, "path"),
				...objectsField(details, "links").map((link) => stringField(link, "path")),
				...objectsField(details, "reverseLinks").map((link) => stringField(link, "path")),
			]);
		case "spec_graph":
			return uniquePaths(objectsField(details, "nodes").map((node) => stringField(node, "path")));
		case "spec_create":
			return uniquePaths([strArg(args, "path"), stringField(details, "path")]);
		case "spec_update":
			return uniquePaths([stringField(details, "path")]);
		case "spec_validate":
			return uniquePaths([
				...objectsField(details, "duplicateIds").flatMap((duplicate) => {
					const paths = duplicate.paths;
					return Array.isArray(paths)
						? paths.filter((path): path is string => typeof path === "string")
						: [];
				}),
				...objectsField(details, "danglingLinks").map((link) => stringField(link, "fromPath")),
			]);
		default:
			return [];
	}
}

export function splitKnownPathReferences(text: string, paths: string[]): LinkedTextSegment[] {
	const references = [...new Set(paths.filter(Boolean))].sort((a, b) => b.length - a.length);
	if (!text || references.length === 0) return text ? [{ text }] : [];

	const segments: LinkedTextSegment[] = [];
	let cursor = 0;
	while (cursor < text.length) {
		let nextIndex = -1;
		let nextPath = "";
		for (const path of references) {
			const index = boundedPathIndex(text, path, cursor);
			if (index < 0) continue;
			if (
				nextIndex < 0 ||
				index < nextIndex ||
				(index === nextIndex && path.length > nextPath.length)
			) {
				nextIndex = index;
				nextPath = path;
			}
		}
		if (nextIndex < 0) {
			segments.push({ text: text.slice(cursor) });
			break;
		}
		if (nextIndex > cursor) segments.push({ text: text.slice(cursor, nextIndex) });
		segments.push({ text: nextPath, path: nextPath });
		cursor = nextIndex + nextPath.length;
	}
	return segments;
}

function LinkedResultText({
	text,
	paths,
	workspaceRoot,
	onOpenFile,
}: {
	text: string;
	paths: string[];
	workspaceRoot?: string | undefined;
	onOpenFile?: ((path: string) => void) | undefined;
}): ReactNode {
	return splitKnownPathReferences(text, paths).map((segment, index) =>
		segment.path ? (
			<ToolFileLink
				key={`${index}:${segment.path}`}
				path={segment.path}
				label={segment.text}
				workspaceRoot={workspaceRoot}
				onOpenFile={onOpenFile}
				className="text-primary"
			/>
		) : (
			segment.text
		),
	);
}

export function specToolSummary({ toolName, args }: ToolRenderProps): string {
	switch (toolName) {
		case "spec_grep":
			return strArg(args, "pattern");
		case "spec_graph":
			return strArg(args, "root");
		case "spec_create":
			return strArg(args, "path");
		case "spec_validate":
			return "graph";
		default:
			return strArg(args, "id");
	}
}

export function SpecToolCard({
	toolName,
	args,
	result,
	status,
	workspaceRoot,
	onOpenFile,
}: ToolRenderProps) {
	const output = resultText(result);
	if (status === "running") {
		return <span className="text-text-muted tr-text-metadata">Inspecting specs…</span>;
	}
	if (!output) {
		return <span className="text-text-muted tr-text-metadata italic">(no result)</span>;
	}
	const content = (
		<pre
			data-testid="tool-spec-result"
			className={`overflow-auto whitespace-pre-wrap px-8 py-4 tr-code-text ${
				status === "error" ? "text-feedback-error" : "text-text-default"
			}`}
		>
			<LinkedResultText
				text={output}
				paths={status === "done" ? specToolPaths(toolName, args, result) : []}
				workspaceRoot={workspaceRoot}
				onOpenFile={onOpenFile}
			/>
		</pre>
	);
	return (
		<div data-testid={`tool-${toolName}`}>
			<Collapsible lines={countLines(output)}>{content}</Collapsible>
		</div>
	);
}
