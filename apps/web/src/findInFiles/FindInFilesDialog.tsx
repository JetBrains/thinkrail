import { RiFileTextLine, RiSearchLine, RiWifiOffLine } from "@remixicon/react";
import type { SearchContext, TextSearchFile } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { Dialog, DialogContent, DialogTitle } from "@thinkrail/ui/dialog";
import { cn } from "@thinkrail/ui/utils";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef } from "react";
import { shortcutKeys } from "../commands";
import { KeyHint } from "../components/Keycaps";
import { highlightRanges } from "../components/MatchHighlight";
import { hasPlatformModifier } from "../lib";
import { contextKeyOf, requestKeyOf, runTextSearch, wasRequested } from "./runner";
import {
	closeFindInFiles,
	type FindInFilesSelection,
	selectFindInFilesMatch,
	setFindInFilesQuery,
	toggleFindInFilesCase,
	toggleFindInFilesWord,
	useFindInFiles,
} from "./state";

export interface FindInFilesTarget {
	projectId: string;
	workspaceId: string;
	path: string;
	line: number;
	column: number;
	length: number;
}

export type FindInFilesHostState = "ready" | "offline" | "unsupported";

export interface FindInFilesDialogProps {
	context: SearchContext | null;
	scopeLabel: string | null;
	host: FindInFilesHostState;
	onOpen: (target: FindInFilesTarget, keep: boolean) => void;
	renderPreview: (target: FindInFilesTarget) => ReactNode;
}

const DEBOUNCE_MS = 150;

interface MatchRow {
	path: string;
	line: number;
	column: number;
	length: number;
	text: string;
	ranges: readonly (readonly [number, number])[];
}

function flatten(files: readonly TextSearchFile[]): MatchRow[] {
	return files.flatMap((file) => file.matches.map((match) => ({ path: file.path, ...match })));
}

function sameSelection(row: MatchRow, selected: FindInFilesSelection | null): boolean {
	return selected !== null && row.path === selected.path && row.line === selected.line;
}

function splitPath(path: string): { name: string; dir: string } {
	const slash = path.lastIndexOf("/");
	return slash === -1
		? { name: path, dir: "" }
		: { name: path.slice(slash + 1), dir: path.slice(0, slash) };
}

export function FindInFilesDialog(props: FindInFilesDialogProps) {
	const t = useT();
	const open = useFindInFiles((state) => state.open);
	return (
		<Dialog open={open} onOpenChange={(next) => (next ? undefined : closeFindInFiles())}>
			<DialogContent
				hideClose
				data-testid="find-in-files"
				aria-describedby={undefined}
				className="top-[10vh] w-auto max-w-none translate-y-0 gap-0 overflow-visible p-0"
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					const input = document.querySelector<HTMLInputElement>(
						'[data-testid="find-in-files-input"]',
					);
					input?.focus();
					input?.select();
				}}
			>
				<DialogTitle className="sr-only">{t("findInFiles.title")}</DialogTitle>
				{open ? <FindInFilesBody {...props} /> : null}
			</DialogContent>
		</Dialog>
	);
}

function FindInFilesBody({
	context,
	scopeLabel,
	host,
	onOpen,
	renderPreview,
}: FindInFilesDialogProps) {
	const t = useT();
	const query = useFindInFiles((state) => state.query);
	const caseSensitive = useFindInFiles((state) => state.caseSensitive);
	const wholeWord = useFindInFiles((state) => state.wholeWord);
	const searching = useFindInFiles((state) => state.searching);
	const failed = useFindInFiles((state) => state.failed);
	const results = useFindInFiles((state) => state.results);
	const selected = useFindInFiles((state) => state.selected);
	const listRef = useRef<HTMLDivElement>(null);
	const contextKey = context ? contextKeyOf(context) : "";

	useEffect(() => {
		if (!context || host !== "ready") return;
		const request = { query, caseSensitive, wholeWord, context };
		if (wasRequested(requestKeyOf(request))) return;
		const timer = setTimeout(() => runTextSearch(request), DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [query, caseSensitive, wholeWord, context, host]);

	const current = results && results.contextKey === contextKey ? results : null;
	const rows = useMemo(() => flatten(current?.files ?? []), [current]);
	const countByPath = useMemo(
		() => new Map((current?.files ?? []).map((file) => [file.path, file.matches.length])),
		[current],
	);
	const selectedIndex = Math.max(
		0,
		rows.findIndex((row) => sameSelection(row, selected)),
	);
	const selectedRow = rows[selectedIndex];
	const root = current?.root ?? null;
	const target = (row: MatchRow): FindInFilesTarget | null =>
		root
			? {
					projectId: root.projectId,
					workspaceId: root.workspaceId,
					path: row.path,
					line: row.line,
					column: row.column,
					length: row.length,
				}
			: null;

	useEffect(() => {
		if (!selectedRow) return;
		const element = listRef.current?.querySelector<HTMLElement>(
			`[data-match-key="${CSS.escape(`${selectedRow.path}:${selectedRow.line}`)}"]`,
		);
		element?.scrollIntoView({ block: "nearest" });
	}, [selectedRow]);

	const select = (index: number) => {
		const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
		if (row) selectFindInFilesMatch({ path: row.path, line: row.line });
	};
	const openRow = (row: MatchRow | undefined, keep: boolean) => {
		const next = row ? target(row) : null;
		if (!next) return;
		closeFindInFiles();
		onOpen(next, keep);
	};
	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.nativeEvent.isComposing) return;
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			select(selectedIndex + (event.key === "ArrowDown" ? 1 : -1));
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			openRow(selectedRow, hasPlatformModifier(event.nativeEvent));
			return;
		}
		if (event.key === "Escape") {
			event.preventDefault();
			closeFindInFiles();
			return;
		}
		if (event.altKey && !event.metaKey && !event.ctrlKey && event.code === "KeyC") {
			event.preventDefault();
			toggleFindInFilesCase();
			return;
		}
		if (event.altKey && !event.metaKey && !event.ctrlKey && event.code === "KeyW") {
			event.preventDefault();
			toggleFindInFilesWord();
		}
	};

	const status: ReactNode = !context ? (
		t("findInFiles.noWorkspace")
	) : host !== "ready" ? (
		<span className="flex items-center gap-4 text-feedback-warning">
			<RiWifiOffLine aria-hidden className="size-14" />
			{t(host === "offline" ? "findInFiles.offline" : "findInFiles.olderHost")}
		</span>
	) : failed ? (
		<span className="text-feedback-error">{t("findInFiles.failed")}</span>
	) : current?.done ? (
		t("findInFiles.counts", {
			matches: t("findInFiles.matches", { count: current.done.lines }),
			files: t("findInFiles.files", { count: current.done.files }),
		})
	) : searching ? (
		t("findInFiles.searching")
	) : null;
	const previewTarget = selectedRow ? target(selectedRow) : null;

	return (
		<div
			data-testid="find-in-files-body"
			className="flex max-h-[min(80vh,760px)] w-[min(60rem,calc(100vw-32px))] flex-col rounded-lg"
		>
			<div className="flex h-48 shrink-0 items-center gap-8 border-border-muted border-b px-16">
				<RiSearchLine aria-hidden className="size-16 shrink-0 text-text-muted" />
				<input
					data-testid="find-in-files-input"
					aria-label={t("findInFiles.title")}
					autoComplete="off"
					spellCheck={false}
					value={query}
					placeholder={t("findInFiles.placeholder")}
					onChange={(event) => setFindInFilesQuery(event.target.value)}
					onKeyDown={onKeyDown}
					className="h-full min-w-0 flex-1 bg-transparent tr-code-text text-text-default outline-none placeholder:text-text-subtle"
				/>
				<ToggleButton
					testId="find-in-files-case"
					label={t("findInFiles.caseSensitive")}
					pressed={caseSensitive}
					onToggle={toggleFindInFilesCase}
				>
					{t("findInFiles.caseToggle")}
				</ToggleButton>
				<ToggleButton
					testId="find-in-files-word"
					label={t("findInFiles.wholeWord")}
					pressed={wholeWord}
					onToggle={toggleFindInFilesWord}
				>
					{t("findInFiles.wordToggle")}
				</ToggleButton>
			</div>
			<div className="flex h-32 shrink-0 items-center gap-8 border-border-muted border-b px-16 tr-text-metadata text-text-subtle">
				{scopeLabel ? (
					<span data-testid="find-in-files-scope" className="truncate">
						{t("findInFiles.scope", { workspace: scopeLabel })}
					</span>
				) : null}
				<span data-testid="find-in-files-status" className="ml-auto shrink-0">
					{status}
				</span>
			</div>
			{current?.done?.reason === "limit" ? (
				<p
					data-testid="find-in-files-limit"
					className="shrink-0 border-border-muted border-b bg-feedback-warning-subtle px-16 py-4 tr-text-metadata text-feedback-warning"
				>
					{t("findInFiles.limit", { count: current.done.lines })}
				</p>
			) : null}
			<div
				ref={listRef}
				data-testid="find-in-files-results"
				role="listbox"
				aria-label={t("findInFiles.title")}
				className="min-h-0 flex-1 overflow-y-auto px-8 py-4"
			>
				{rows.length === 0 && current?.done?.reason === "complete" && scopeLabel ? (
					<p
						data-testid="find-in-files-empty"
						className="px-8 py-16 text-center text-text-muted tr-text-ui"
					>
						{t("findInFiles.nothing", { workspace: scopeLabel })}
					</p>
				) : null}
				{rows.map((row, index) => {
					const header = rows[index - 1]?.path !== row.path;
					const { name, dir } = splitPath(row.path);
					const count = countByPath.get(row.path) ?? 0;
					const isSelected = index === selectedIndex;
					return (
						<div key={`${row.path}:${row.line}`}>
							{header ? (
								<div
									data-testid="find-in-files-file"
									data-path={row.path}
									className="flex items-center gap-8 px-8 pt-8 pb-2 tr-text-ui"
								>
									<RiFileTextLine aria-hidden className="size-14 shrink-0 text-text-muted" />
									<span className="shrink-0 text-text-default">{name}</span>
									<span className="min-w-0 truncate tr-code-text-small text-text-subtle">
										{dir}
									</span>
									<span className="ml-auto shrink-0 tr-text-metadata text-text-subtle">
										{count}
									</span>
								</div>
							) : null}
							<div
								role="option"
								tabIndex={-1}
								aria-selected={isSelected}
								data-testid="find-in-files-match"
								data-match-key={`${row.path}:${row.line}`}
								data-path={row.path}
								data-line={row.line}
								onMouseMove={isSelected ? undefined : () => select(index)}
								onMouseDown={(event) => event.preventDefault()}
								onClick={(event) => openRow(row, hasPlatformModifier(event.nativeEvent))}
								onKeyDown={(event) => {
									if (event.key === "Enter" || event.key === " ") {
										event.preventDefault();
										openRow(row, hasPlatformModifier(event.nativeEvent));
									}
								}}
								className={cn(
									"flex cursor-pointer gap-12 rounded-sm py-2 pr-8 pl-24 tr-code-text",
									isSelected ? "bg-control-bg-selected text-text-default" : "text-text-muted",
								)}
							>
								<span className="w-40 shrink-0 text-right text-text-subtle">{row.line}</span>
								<span className="min-w-0 truncate whitespace-pre">
									{highlightRanges(row.text, row.ranges)}
								</span>
							</div>
						</div>
					);
				})}
			</div>
			{previewTarget ? (
				<div
					data-testid="find-in-files-preview"
					className="h-[min(14rem,30vh)] shrink-0 border-border-muted border-t"
				>
					{renderPreview(previewTarget)}
				</div>
			) : null}
			<footer className="flex h-32 shrink-0 items-center gap-12 overflow-hidden border-border-muted border-t px-16 tr-text-metadata text-text-subtle">
				<KeyHint keys={["↑", "↓"]} label={t("findInFiles.hint.move")} />
				<KeyHint keys={["↵"]} label={t("findInFiles.hint.open")} />
				<KeyHint keys={shortcutKeys({ key: "↵", mod: true })} label={t("findInFiles.hint.keep")} />
				<span className="flex-1" />
				<KeyHint
					keys={shortcutKeys({ key: "C", alt: true })}
					label={t("findInFiles.caseSensitive")}
				/>
				<KeyHint keys={shortcutKeys({ key: "W", alt: true })} label={t("findInFiles.wholeWord")} />
			</footer>
		</div>
	);
}

function ToggleButton({
	testId,
	label,
	pressed,
	onToggle,
	children,
}: {
	testId: string;
	label: string;
	pressed: boolean;
	onToggle: () => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			tabIndex={-1}
			data-testid={testId}
			aria-label={label}
			aria-pressed={pressed}
			title={label}
			onMouseDown={(event) => event.preventDefault()}
			onClick={onToggle}
			className={cn(
				"inline-flex h-24 min-w-24 shrink-0 items-center justify-center rounded-sm border px-4 tr-code-text-small",
				pressed
					? "border-primary text-primary"
					: "border-border-default text-text-muted hover:bg-control-bg-hovered",
			)}
		>
			{children}
		</button>
	);
}
