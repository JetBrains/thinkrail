import {
	RiArrowDownSLine,
	RiArrowRightSLine,
	RiBracesLine,
	RiContractUpDownLine,
	RiExpandUpDownLine,
	RiFileCopyLine,
	RiScissorsCutLine,
} from "@remixicon/react";
import { localeOf, useT } from "@thinkrail/locales/react";
import { IconButton } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useState } from "react";
import { formatCount } from "../format";
import {
	childPath,
	containsQuery,
	countMatches,
	cutIndex,
	cutPath,
	highlightParts,
	parseEmbedded,
} from "./json";

const CHILD_PAGE = 200;
const INLINE_STRING_CHARS = 160;
const STRING_PREVIEW_CHARS = 4000;
const OPEN_DEPTH = 2;

interface Context {
	query: string;
	cuts: ReadonlyMap<string, number>;
	expandAll: boolean | null;
	onCopy: (text: string, what: "path" | "value") => void;
}

export function Highlighted({ text, query }: { text: string; query: string }) {
	return (
		<>
			{highlightParts(text, query).map((part) =>
				part.match ? (
					<mark key={part.at} className="rounded-sm bg-feedback-warning-muted text-text-default">
						{part.text}
					</mark>
				) : (
					<span key={part.at}>{part.text}</span>
				),
			)}
		</>
	);
}

function CutChip({ size }: { size: number | undefined }) {
	const t = useT();
	const locale = localeOf(t);
	if (size === undefined) return null;
	return (
		<span
			data-testid="json-cut"
			className="ml-4 inline-flex items-center gap-2 rounded-sm border border-border-default px-4 tr-text-caption text-text-subtle"
		>
			<RiScissorsCutLine aria-hidden className="size-12" />
			{t("sessionInsights.json.cut", { size: formatCount(locale, size) })}
		</span>
	);
}

function KeyLabel({
	name,
	path,
	context,
}: {
	name: string | number | null;
	path: string;
	context: Context;
}) {
	const t = useT();
	if (name === null) return null;
	const text = typeof name === "number" ? String(name) : name;
	return (
		<>
			<button
				type="button"
				onClick={(event) => {
					event.stopPropagation();
					context.onCopy(path || "$", "path");
				}}
				className={cn(
					"rounded-sm hover:underline focus-visible:focus-ring",
					typeof name === "number" ? "text-text-subtle" : "text-text-default",
				)}
			>
				<Highlighted text={text} query={typeof name === "number" ? "" : context.query} />
				<span className="sr-only">{t("sessionInsights.json.copyPath", { path: path || "$" })}</span>
			</button>
			<span className="text-text-subtle">: </span>
		</>
	);
}

function ScalarValue({
	value,
	context,
}: {
	value: string | number | boolean | null;
	context: Context;
}) {
	const t = useT();
	const tone =
		value === null
			? "text-text-subtle"
			: typeof value === "string"
				? "text-series-5"
				: typeof value === "number"
					? "text-series-1"
					: "text-series-3";
	const shown = typeof value === "string" ? JSON.stringify(value) : String(value);
	return (
		<button
			type="button"
			onClick={() => context.onCopy(typeof value === "string" ? value : String(value), "value")}
			className={cn("min-w-0 break-all text-left focus-visible:focus-ring", tone)}
		>
			<Highlighted text={shown} query={context.query} />
			<span className="sr-only">{t("sessionInsights.json.copyValue")}</span>
		</button>
	);
}

function LongString({ value, depth, context }: { value: string; depth: number; context: Context }) {
	const t = useT();
	const locale = localeOf(t);
	const matched = containsQuery(value, context.query);
	const [open, setOpen] = useState(context.expandAll ?? (depth < 4 || matched));
	const [full, setFull] = useState(false);
	const embedded = parseEmbedded(value);
	const [asJson, setAsJson] = useState(false);
	const lines = value.split("\n").length;
	const shown =
		full || value.length <= STRING_PREVIEW_CHARS || matched
			? value
			: value.slice(0, STRING_PREVIEW_CHARS);
	const Chevron = open ? RiArrowDownSLine : RiArrowRightSLine;
	return (
		<>
			<button
				type="button"
				aria-expanded={open}
				onClick={() => setOpen(!open)}
				className="inline-flex items-center gap-2 rounded-sm text-text-subtle focus-visible:focus-ring"
			>
				<Chevron aria-hidden className="size-12" />
				{lines > 1
					? t("sessionInsights.json.stringLines", {
							lines: formatCount(locale, lines),
							chars: formatCount(locale, value.length),
						})
					: t("sessionInsights.json.string", { chars: formatCount(locale, value.length) })}
			</button>
			{embedded !== undefined ? (
				<button
					type="button"
					aria-pressed={asJson}
					onClick={() => {
						setAsJson(!asJson);
						setOpen(true);
					}}
					className={cn(
						"ml-4 inline-flex items-center gap-2 rounded-sm border px-4 tr-text-caption focus-visible:focus-ring",
						asJson ? "border-primary-muted text-primary" : "border-border-default text-text-muted",
					)}
				>
					<RiBracesLine aria-hidden className="size-12" />
					{t("sessionInsights.json.parse")}
				</button>
			) : null}
			<button
				type="button"
				onClick={() => context.onCopy(value, "value")}
				aria-label={t("sessionInsights.json.copyValue")}
				className="ml-4 inline-flex items-center rounded-sm text-text-subtle hover:text-text-default focus-visible:focus-ring"
			>
				<RiFileCopyLine aria-hidden className="size-12" />
			</button>
			{open ? (
				<div className="mt-2 mb-4">
					{asJson && embedded !== undefined ? (
						<div className="rounded-sm border border-border-muted p-4">
							<JsonNode
								name={null}
								value={embedded}
								path=""
								raw=""
								depth={0}
								context={{ ...context, cuts: new Map() }}
							/>
						</div>
					) : (
						<>
							<pre className="max-h-320 overflow-auto whitespace-pre-wrap break-all rounded-sm bg-container-content-bg p-4 tr-code-text-small text-series-5">
								<Highlighted text={shown} query={context.query} />
							</pre>
							{shown.length < value.length ? (
								<button
									type="button"
									onClick={() => setFull(true)}
									className="mt-2 rounded-sm text-primary tr-text-caption hover:underline focus-visible:focus-ring"
								>
									{t("sessionInsights.json.showAll", { chars: formatCount(locale, value.length) })}
								</button>
							) : null}
						</>
					)}
				</div>
			) : null}
		</>
	);
}

function JsonNode({
	name,
	value,
	path,
	raw,
	depth,
	context,
}: {
	name: string | number | null;
	value: unknown;
	path: string;
	raw: string;
	depth: number;
	context: Context;
}) {
	const t = useT();
	const locale = localeOf(t);
	const isObject = typeof value === "object" && value !== null;
	const entries: [string | number, unknown][] = isObject
		? Array.isArray(value)
			? value.map((item, index): [number, unknown] => [index, item])
			: Object.entries(value)
		: [];
	const matched = isObject && containsQuery(value, context.query);
	const [open, setOpen] = useState(
		context.expandAll ?? (entries.length > 0 && (depth < OPEN_DEPTH || matched)),
	);
	const [limit, setLimit] = useState(CHILD_PAGE);
	const cut = context.cuts.get(raw);
	if (!isObject) {
		const long =
			typeof value === "string" &&
			(value.includes("\n") ||
				value.length > INLINE_STRING_CHARS ||
				parseEmbedded(value) !== undefined);
		return (
			<div data-testid="json-node" className="pl-16">
				<KeyLabel name={name} path={path} context={context} />
				{long ? (
					<LongString value={value} depth={depth} context={context} />
				) : (
					<ScalarValue
						value={
							typeof value === "string" || typeof value === "number" || typeof value === "boolean"
								? value
								: null
						}
						context={context}
					/>
				)}
				<CutChip size={cut} />
			</div>
		);
	}
	const array = Array.isArray(value);
	const Chevron = open ? RiArrowDownSLine : RiArrowRightSLine;
	const summary = array
		? t("sessionInsights.json.items", {
				count: entries.length,
				n: formatCount(locale, entries.length),
			})
		: t("sessionInsights.json.keys", {
				count: entries.length,
				n: formatCount(locale, entries.length),
			});
	return (
		<div data-testid="json-node">
			<div className="flex min-w-0 items-start">
				<button
					type="button"
					aria-expanded={entries.length > 0 ? open : undefined}
					aria-label={t(open ? "sessionInsights.json.collapse" : "sessionInsights.json.expand")}
					disabled={entries.length === 0}
					onClick={() => setOpen(!open)}
					className="flex size-16 shrink-0 items-center justify-center rounded-sm text-text-subtle focus-visible:focus-ring"
				>
					{entries.length > 0 ? <Chevron aria-hidden className="size-12" /> : null}
				</button>
				<span className="min-w-0">
					<KeyLabel name={name} path={path} context={context} />
					<span className="text-text-subtle">{array ? "[" : "{"}</span>
					{open ? null : (
						<>
							<span className="px-4 text-text-subtle">{summary}</span>
							<span className="text-text-subtle">{array ? "]" : "}"}</span>
						</>
					)}
					<CutChip size={cut} />
				</span>
			</div>
			{open ? (
				<div className="ml-8 border-border-muted border-l">
					{entries.slice(0, limit).map(([key, item]) => (
						<JsonNode
							key={String(key)}
							name={key}
							value={item}
							path={childPath(path, key)}
							raw={cutPath(raw, key)}
							depth={depth + 1}
							context={context}
						/>
					))}
					{entries.length > limit ? (
						<button
							type="button"
							onClick={() => setLimit(limit + CHILD_PAGE)}
							className="ml-16 rounded-sm text-primary tr-text-caption hover:underline focus-visible:focus-ring"
						>
							{t("sessionInsights.json.more", {
								count: Math.min(CHILD_PAGE, entries.length - limit),
							})}
						</button>
					) : null}
				</div>
			) : null}
			{open ? <span className="pl-16 text-text-subtle">{array ? "]" : "}"}</span> : null}
		</div>
	);
}

/**
 * A collapsible JSON tree: counts on closed nodes, type colours, long strings cut with *Show all*,
 * multi-line strings as preformatted blocks with a parse toggle for embedded JSON, click a key to copy
 * its path or a value to copy it, and matches of the search highlighted.
 */
export function JsonViewer({
	value,
	cuts = [],
	label,
	query: initialQuery = "",
	testId = "json-viewer",
	actions,
}: {
	value: unknown;
	cuts?: readonly (readonly [string, number])[];
	label: string;
	query?: string;
	testId?: string;
	actions?: ReactNode;
}) {
	const t = useT();
	const locale = localeOf(t);
	const [query, setQuery] = useState(initialQuery);
	const [expand, setExpand] = useState<{ all: boolean | null; generation: number }>({
		all: null,
		generation: 0,
	});
	const [copied, setCopied] = useState<string | null>(null);
	const matches = query.trim() ? countMatches(value, query.trim()) : 0;
	const onCopy = (text: string, what: "path" | "value") => {
		void navigator.clipboard?.writeText(text).then(
			() =>
				setCopied(
					what === "path"
						? t("sessionInsights.json.copiedPath", { path: text })
						: t("sessionInsights.json.copiedValue"),
				),
			() => setCopied(t("sessionInsights.json.copyFailed")),
		);
	};
	const context: Context = {
		query: query.trim(),
		cuts: cutIndex(cuts),
		expandAll: expand.all,
		onCopy,
	};
	return (
		<section
			data-testid={testId}
			aria-label={label}
			className="flex min-w-0 flex-col rounded-sm border border-border-default"
		>
			<div className="flex min-w-0 flex-wrap items-center gap-4 border-border-default border-b px-8 py-4">
				<span className="tr-text-eyebrow text-text-muted">{label}</span>
				<input
					type="search"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder={t("sessionInsights.json.search")}
					aria-label={t("sessionInsights.json.search")}
					className="h-20 min-w-80 flex-1 rounded-sm border border-control-border-default bg-control-bg px-4 tr-text-metadata text-text-default placeholder:text-text-subtle focus-visible:focus-ring focus:border-control-border-active"
				/>
				{query.trim() ? (
					<span
						data-testid="json-matches"
						className="tr-text-caption text-text-subtle tabular-nums"
					>
						{t("sessionInsights.json.matches", { count: matches, n: formatCount(locale, matches) })}
					</span>
				) : null}
				<span className="ml-auto flex items-center gap-2">
					<IconButton
						icon={RiExpandUpDownLine}
						size="s"
						label={t("sessionInsights.json.expandAll")}
						onClick={() =>
							setExpand((current) => ({ all: true, generation: current.generation + 1 }))
						}
					/>
					<IconButton
						icon={RiContractUpDownLine}
						size="s"
						label={t("sessionInsights.json.collapseAll")}
						onClick={() =>
							setExpand((current) => ({ all: false, generation: current.generation + 1 }))
						}
					/>
					<IconButton
						icon={RiFileCopyLine}
						size="s"
						label={t("sessionInsights.json.copyAll")}
						onClick={() => onCopy(JSON.stringify(value, null, 2), "value")}
					/>
					{actions}
				</span>
			</div>
			<div className="overflow-auto p-4 tr-code-text-small">
				<JsonNode
					key={expand.generation}
					name={null}
					value={value}
					path=""
					raw=""
					depth={0}
					context={context}
				/>
			</div>
			<span role="status" className="sr-only">
				{copied}
			</span>
		</section>
	);
}
