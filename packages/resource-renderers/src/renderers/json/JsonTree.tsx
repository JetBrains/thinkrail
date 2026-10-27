import {
	RiArrowDownSLine as ChevronDown,
	RiArrowRightSLine as ChevronRight,
} from "@remixicon/react";
import { type Translator, useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@thinkrail/ui/tooltip";
import { type ReactNode, useEffect, useState } from "react";
import type { ReviewThread } from "../../registry";
import type { JsonDiffMark, JsonNestedChange, JsonNestedChanges } from "./jsonDiff";
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

function ownChangeLabel(t: Translator, mark: JsonDiffMark): string {
	if (mark.kind === "added") return t("viewer.json.change.added");
	if (mark.kind === "removed") return t("viewer.json.change.removed");
	if (mark.kind === "moved" && mark.oldPointer !== undefined) {
		return t("viewer.json.change.movedFrom", { pointer: mark.oldPointer });
	}
	if (mark.kind === "moved") return t("viewer.json.change.moved");
	return t("viewer.json.change.changed");
}

function valueLabel(value: unknown): string {
	if (Array.isArray(value)) return `[${value.length}]`;
	if (value !== null && typeof value === "object") return `{${Object.keys(value).length}}`;
	return jsonPrimitiveLabel(value);
}

function displayPath(pointer: string): string {
	return pointer
		.split("/")
		.slice(1)
		.map((segment, index) => {
			if (/^\d+$/.test(segment)) return `[${segment}]`;
			const key = segment.replaceAll("~1", "/").replaceAll("~0", "~");
			return index === 0 ? key : `.${key}`;
		})
		.join("");
}

function NestedChangeLine({ change, base }: { change: JsonNestedChange; base: string }) {
	const t = useT();
	const { mark } = change;
	const replacement =
		mark.kind === "changed" && mark.oldValue !== undefined && mark.newValue !== undefined;
	return (
		<div className="truncate">
			<span className="tr-code-text text-primary">
				{displayPath(change.pointer.slice(base.length))}
			</span>
			{replacement ? null : <span className="px-4 text-text-muted">{ownChangeLabel(t, mark)}</span>}
			{mark.kind === "added" ? (
				<span className="tr-code-text text-feedback-success">{valueLabel(mark.newValue)}</span>
			) : null}
			{mark.kind === "removed" ? (
				<span className="tr-code-text text-feedback-error">{valueLabel(mark.oldValue)}</span>
			) : null}
			{replacement ? (
				<span className="pl-4 tr-code-text">
					<span className="text-feedback-error">{valueLabel(mark.oldValue)}</span>
					<span className="px-4 text-text-subtle">→</span>
					<span className="text-feedback-success">{valueLabel(mark.newValue)}</span>
				</span>
			) : null}
		</div>
	);
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
	nestedChangesFor,
	threadsFor,
	onSelect,
	onMarker,
	renderValue,
	initiallyExpanded = true,
}: {
	node: JsonNode;
	markFor?: ((node: JsonNode) => JsonDiffMark | undefined) | undefined;
	nestedChangesFor?: ((node: JsonNode) => JsonNestedChanges | undefined) | undefined;
	threadsFor: (node: JsonNode) => readonly JsonTreeThread[];
	onSelect: (node: JsonNode) => void;
	onMarker: (id: string) => void;
	renderValue?: ((node: JsonNode, mark: JsonDiffMark | undefined) => ReactNode) | undefined;
	initiallyExpanded?: boolean | undefined;
}) {
	const t = useT();
	const branch = node.type === "object" || node.type === "array";
	const [expanded, setExpanded] = useState(initiallyExpanded);
	const mark = markFor?.(node);
	const nested = nestedChangesFor?.(node);
	const ownLabel = mark ? ownChangeLabel(t, mark) : null;
	const threads = threadsFor(node);
	const containsThread = branch && subtreeHasThread(node, threadsFor);
	useEffect(() => {
		if (containsThread) setExpanded(true);
	}, [containsThread]);
	const row = (
		<div
			data-json-nested-changes={nested ? "" : undefined}
			className={`relative flex min-h-28 items-start gap-4 rounded-sm px-4 py-2 ${tint(mark)} ${
				threads.length > 0 ? "outline-2 -outline-offset-2 outline-text-subtle" : ""
			}`}
		>
			{branch ? (
				<IconButton
					icon={expanded ? ChevronDown : ChevronRight}
					label={expanded ? t("viewer.json.collapseNode") : t("viewer.json.expandNode")}
						className="shrink-0"
					aria-expanded={expanded}
					onClick={() => setExpanded((value) => !value)}
				/>
			) : (
				<span className="block size-24 shrink-0" />
			)}
			{nested ? (
				<span aria-hidden className="size-6 shrink-0 self-center rounded-full bg-feedback-info" />
			) : null}
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
							aria-label={t("viewer.region.showComment", { number: entry.number })}
							className="flex size-20 items-center justify-center rounded-full bg-primary tr-text-metadata text-text-on-primary outline-none focus-visible:ring-2 focus-visible:ring-primary"
							onClick={() => onMarker(entry.thread.id)}
						>
							{entry.number}
						</button>
					))}
				</span>
			) : null}
		</div>
	);
	return (
		<div data-json-pointer={node.pointer}>
			{ownLabel || nested ? (
				<Tooltip>
					<TooltipTrigger asChild>{row}</TooltipTrigger>
					<TooltipContent side="bottom" align="start" className="max-w-md">
						{ownLabel ? <div>{ownLabel}</div> : null}
						{nested?.first.map((change) => (
							<NestedChangeLine key={change.order} change={change} base={node.pointer} />
						))}
						{nested && nested.total > nested.first.length ? (
							<div className="text-text-muted">
								{t("viewer.json.nested.more", { count: nested.total - nested.first.length })}
							</div>
						) : null}
					</TooltipContent>
				</Tooltip>
			) : (
				row
			)}
			{branch && expanded ? (
				<div className="ml-16 border-border-muted border-l pl-4">
					{node.children.map((child) => (
						<JsonTree
							key={child.pointer}
							node={child}
							markFor={markFor}
							nestedChangesFor={nestedChangesFor}
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
