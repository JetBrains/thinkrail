import {
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
} from "@remixicon/react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ReviewThread } from "@/resources";
import type { JsonDiffMark } from "./jsonDiff";
import { type JsonNode, jsonPrimitiveLabel } from "./jsonScanner";

export interface JsonTreeThread {
	thread: ReviewThread;
	number: number;
	side: "base" | "worktree";
}

function tint(mark: JsonDiffMark | undefined): string {
	if (mark?.kind === "added") return "bg-feedback-success-subtle";
	if (mark?.kind === "removed") return "bg-feedback-error-subtle";
	if (mark?.kind === "changed" || mark?.kind === "moved") return "bg-feedback-info-subtle";
	return "";
}

function summary(node: JsonNode): string {
	if (node.type === "object") return `{${node.children.length}}`;
	if (node.type === "array") return `[${node.children.length}]`;
	return jsonPrimitiveLabel(node.value);
}

function subtreeHasThread(
	node: JsonNode,
	threadsFor: (node: JsonNode) => readonly JsonTreeThread[],
): boolean {
	return (
		threadsFor(node).length > 0 ||
		node.children.some((child) => subtreeHasThread(child, threadsFor))
	);
}

export function JsonTree({
	node,
	markFor,
	threadsFor,
	onSelect,
	onMarker,
	renderValue,
	initiallyExpanded = true,
}: {
	node: JsonNode;
	markFor?: ((node: JsonNode) => JsonDiffMark | undefined) | undefined;
	threadsFor: (node: JsonNode) => readonly JsonTreeThread[];
	onSelect: (node: JsonNode) => void;
	onMarker: (id: string) => void;
	renderValue?: ((node: JsonNode, mark: JsonDiffMark | undefined) => ReactNode) | undefined;
	initiallyExpanded?: boolean | undefined;
}) {
	const branch = node.type === "object" || node.type === "array";
	const [expanded, setExpanded] = useState(initiallyExpanded);
	const mark = markFor?.(node);
	const threads = threadsFor(node);
	const containsThread = branch && subtreeHasThread(node, threadsFor);
	useEffect(() => {
		if (containsThread) setExpanded(true);
	}, [containsThread]);
	return (
		<div data-json-pointer={node.pointer}>
			<div
				className={`relative flex min-h-28 items-start gap-4 rounded-[var(--radius-sm)] px-4 py-2 ${tint(mark)} ${
					threads.length > 0 ? "outline-2 -outline-offset-2 outline-text-subtle" : ""
				}`}
			>
				{branch ? (
					<Button
						variant="ghost"
						size="icon"
						className="size-24 shrink-0"
						aria-label={expanded ? "Collapse JSON node" : "Expand JSON node"}
						aria-expanded={expanded}
						onClick={() => setExpanded((value) => !value)}
					>
						{expanded ? <ChevronDown className="size-16" /> : <ChevronRight className="size-16" />}
					</Button>
				) : (
					<span className="block size-24 shrink-0" />
				)}
				<button
					type="button"
					disabled={node.pointer.length === 0}
					className="min-w-0 flex-1 truncate py-2 text-left tr-code-text text-text-default outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none"
					onClick={() => onSelect(node)}
				>
					{node.key !== undefined ? (
						<span className="text-primary">{JSON.stringify(node.key)}: </span>
					) : null}
					{renderValue ? renderValue(node, mark) : summary(node)}
				</button>
				{threads.length > 0 ? (
					<span className="flex shrink-0 gap-2 py-2">
						{threads.map((entry) => (
							<button
								key={entry.thread.id}
								type="button"
								aria-label={`Show comment ${entry.number}`}
								className="flex size-20 items-center justify-center rounded-full bg-primary tr-text-metadata text-text-on-primary outline-none focus-visible:ring-2 focus-visible:ring-primary"
								onClick={() => onMarker(entry.thread.id)}
							>
								{entry.number}
							</button>
						))}
					</span>
				) : null}
			</div>
			{branch && expanded ? (
				<div className="ml-16 border-border-muted border-l pl-4">
					{node.children.map((child) => (
						<JsonTree
							key={child.pointer}
							node={child}
							markFor={markFor}
							threadsFor={threadsFor}
							onSelect={onSelect}
							onMarker={onMarker}
							renderValue={renderValue}
							initiallyExpanded={false}
						/>
					))}
				</div>
			) : null}
		</div>
	);
}
