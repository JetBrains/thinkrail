import { RiArrowRightSLine as ChevronRight } from "@remixicon/react";
import type { McpResultSummary } from "@thinkrail/contracts";
import { cn } from "@thinkrail/ui/utils";
import { useFold } from "../../foldState";
import { isRecord } from "./mcpResult";

const CHILD_LIMIT = 100;
const SMALL_TREE_NODES = 40;

type JsonContainer = unknown[] | Record<string, unknown>;

function isBranch(value: unknown): value is JsonContainer {
	return Array.isArray(value) ? value.length > 0 : isRecord(value) && Object.keys(value).length > 0;
}

function entriesOf(value: JsonContainer): [string, unknown][] {
	return Array.isArray(value)
		? value.map((item, index): [string, unknown] => [String(index), item])
		: Object.entries(value);
}

function countJsonNodes(value: unknown, limit: number): number {
	let count = 0;
	const stack: unknown[] = [value];
	while (stack.length > 0 && count <= limit) {
		const next = stack.pop();
		count += 1;
		if (isBranch(next)) for (const [, child] of entriesOf(next)) stack.push(child);
	}
	return count;
}

const pointerSegment = (key: string): string => key.replaceAll("~", "~0").replaceAll("/", "~1");

const toggleClass =
	"flex min-w-0 items-center gap-4 rounded-[var(--radius-xs)] text-left outline-none hover:text-text-default focus-visible:ring-2 focus-visible:ring-primary";

const Indent = () => <span aria-hidden className="size-16 shrink-0" />;

function JsonScalar({ value }: { value: unknown }) {
	return (
		<span
			className={cn(
				"min-w-0 whitespace-pre-wrap break-words",
				typeof value === "string" ? "text-text-default" : "text-primary",
			)}
		>
			{JSON.stringify(value) ?? String(value)}
		</span>
	);
}

function JsonNode({
	id,
	label,
	value,
	expandAll,
}: {
	id: string;
	label: string;
	value: unknown;
	expandAll: boolean;
}) {
	if (!isBranch(value)) {
		return (
			<div className="flex min-w-0 gap-4">
				<Indent />
				<span className="shrink-0 text-text-muted">{label}:</span>
				<JsonScalar value={value} />
			</div>
		);
	}
	return <JsonBranch id={id} label={label} value={value} expandAll={expandAll} />;
}

function JsonEntries({
	id,
	value,
	expandAll,
}: {
	id: string;
	value: JsonContainer;
	expandAll: boolean;
}) {
	const [all, toggleAll, toggleAllRef] = useFold(`${id}:all`);
	const entries = entriesOf(value);
	const shown = all ? entries : entries.slice(0, CHILD_LIMIT);
	return (
		<div className="ml-8 flex min-w-0 flex-col border-border-muted border-l pl-4">
			{shown.map(([key, child]) => (
				<JsonNode
					key={key}
					id={`${id}/${pointerSegment(key)}`}
					label={key}
					value={child}
					expandAll={expandAll}
				/>
			))}
			{entries.length > CHILD_LIMIT ? (
				<button
					ref={toggleAllRef}
					type="button"
					aria-expanded={all}
					onClick={toggleAll}
					className={cn(toggleClass, "self-start text-primary hover:underline")}
				>
					<Indent />
					{all ? "Show fewer" : `Show all ${entries.length}`}
				</button>
			) : null}
		</div>
	);
}

function JsonBranch({
	id,
	label,
	value,
	expandAll,
}: {
	id: string;
	label: string;
	value: JsonContainer;
	expandAll: boolean;
}) {
	const [open, toggle, toggleRef] = useFold(id, expandAll);
	const size = Array.isArray(value) ? `[${value.length}]` : `{${Object.keys(value).length}}`;
	return (
		<div data-chat-fold-root data-expanded={open} className="min-w-0">
			<button
				ref={toggleRef}
				type="button"
				aria-expanded={open}
				onClick={toggle}
				className={cn(toggleClass, "text-text-muted")}
			>
				<ChevronRight
					className={cn("size-16 shrink-0 transition-transform", open && "rotate-90")}
				/>
				<span className="shrink-0">{label}:</span>
				<span className="text-text-subtle">{size}</span>
			</button>
			{open ? <JsonEntries id={id} value={value} expandAll={expandAll} /> : null}
		</div>
	);
}

export function McpJsonTree({ id, value }: { id: string; value: unknown }) {
	return (
		<div data-testid="mcp-json-tree" className="min-w-0 tr-code-text">
			{isBranch(value) ? (
				<JsonEntries
					id={id}
					value={value}
					expandAll={countJsonNodes(value, SMALL_TREE_NODES) <= SMALL_TREE_NODES}
				/>
			) : (
				<div className="flex min-w-0 gap-4">
					<Indent />
					<JsonScalar value={value} />
				</div>
			)}
		</div>
	);
}

export function McpStructuredContent({
	id,
	summary,
}: {
	id: string;
	summary: McpResultSummary | null;
}) {
	const [open, toggle, toggleRef] = useFold(id);
	if (summary?.structuredContentTruncated) {
		return (
			<span
				data-testid="mcp-structured-truncated"
				className="text-text-muted tr-text-metadata italic"
			>
				Structured content too large to keep.
			</span>
		);
	}
	if (summary?.structuredContent === undefined) return null;
	return (
		<div
			data-testid="mcp-structured"
			data-chat-fold-root
			data-expanded={open}
			className="flex min-w-0 flex-col gap-2"
		>
			<button
				ref={toggleRef}
				type="button"
				data-testid="mcp-structured-toggle"
				aria-expanded={open}
				onClick={toggle}
				className={cn(toggleClass, "self-start text-text-muted tr-text-metadata")}
			>
				<ChevronRight
					className={cn("size-16 shrink-0 transition-transform", open && "rotate-90")}
				/>
				Structured content
			</button>
			{open ? <McpJsonTree id={`${id}:tree`} value={summary.structuredContent} /> : null}
		</div>
	);
}
