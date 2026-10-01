import { useEffect, useMemo, useRef } from "react";
import { TableVirtuoso, type TableVirtuosoHandle } from "react-virtuoso";
import type { ResourceViewProps, ReviewThread } from "@/resources";
import { ReviewComposer } from "../../ReviewComposer";
import { ReviewThreadCard } from "../../ReviewThreadCard";
import { contentStamp, useStampedComposer } from "../reviewComposerState";
import { StaleComposerNotice } from "../StaleComposerNotice";
import {
	type CsvCell,
	type CsvRow,
	type CsvSelection,
	csvSelectionDraft,
	delimiterForPath,
	parseCsv,
	placedTableThreadIds,
	tableCellOfAnchor,
} from "./csvModel";

const NO_THREADS: ReadonlySet<string> = new Set();

function selected(selection: CsvSelection | null, row: number, col: number): boolean {
	if (!selection) return false;
	const firstRow = Math.min(selection.anchor.row, selection.focus.row);
	const lastRow = Math.max(selection.anchor.row, selection.focus.row);
	const firstCol = Math.min(selection.anchor.col, selection.focus.col);
	const lastCol = Math.max(selection.anchor.col, selection.focus.col);
	return row >= firstRow && row <= lastRow && col >= firstCol && col <= lastCol;
}

export default function CsvView({
	resource,
	content,
	review,
	onPlacedThreadIds,
}: ResourceViewProps) {
	const text = content.kind === "text" ? content.text : "";
	const table = useMemo(
		() => parseCsv(text, delimiterForPath(resource.path)),
		[text, resource.path],
	);
	const composer = useStampedComposer<CsvSelection>(contentStamp(content));
	const selection = composer.selection;
	const virtuosoRef = useRef<TableVirtuosoHandle>(null);
	const cardRefs = useRef(new Map<string, HTMLDivElement>());
	const handledFocusRef = useRef<string | null>(null);
	const placed = useMemo(
		() => placedTableThreadIds(review?.threads ?? [], table.rows),
		[review?.threads, table.rows],
	);
	const threadsByCell = useMemo(() => {
		const result = new Map<string, { thread: ReviewThread; number: number }[]>();
		let number = 0;
		for (const thread of review?.threads ?? []) {
			const cell = tableCellOfAnchor(thread.anchor, table.rows);
			if (!cell) continue;
			number += 1;
			const key = `${cell.row}:${cell.col}`;
			const entries = result.get(key) ?? [];
			entries.push({ thread, number });
			result.set(key, entries);
		}
		return result;
	}, [review?.threads, table.rows]);
	const draft = selection ? csvSelectionDraft(table.rows, selection) : null;
	const focusId = review?.focus?.id ?? null;

	useEffect(() => {
		onPlacedThreadIds?.(placed);
		return () => onPlacedThreadIds?.(NO_THREADS);
	}, [onPlacedThreadIds, placed]);

	useEffect(() => {
		if (!focusId) {
			handledFocusRef.current = null;
			return;
		}
		if (handledFocusRef.current === focusId || !placed.has(focusId)) return;
		const card = cardRefs.current.get(focusId);
		if (!card) return;
		handledFocusRef.current = focusId;
		card.scrollIntoView({ block: "center" });
		review?.onFocusHandled();
	}, [focusId, placed, review]);

	const choose = (cell: CsvCell, shift: boolean) => {
		composer.select(
			shift && selection
				? { anchor: selection.anchor, focus: cell }
				: { anchor: cell, focus: cell },
		);
	};
	const scrollToCard = (id: string) =>
		cardRefs.current.get(id)?.scrollIntoView({ block: "center" });
	const scrollToCell = (thread: ReviewThread) => {
		const cell = tableCellOfAnchor(thread.anchor, table.rows);
		if (!cell) return;
		virtuosoRef.current?.scrollToIndex({ index: Math.max(0, cell.row - 1), align: "center" });
	};
	const renderCell = (row: CsvRow, col: number, header: boolean) => {
		const entries = threadsByCell.get(`${row.index}:${col}`) ?? [];
		const active = selected(selection, row.index, col);
		const className = [
			"relative min-w-96 max-w-[360px] border border-border-muted px-8 py-4 text-left align-top tr-code-text text-text-default",
			header ? "bg-container-header-bg" : "bg-container-workspace-bg",
			active ? "outline-2 -outline-offset-2 outline-primary" : "",
			entries.length > 0 ? "outline-2 -outline-offset-2 outline-text-subtle" : "",
		].join(" ");
		const contents = (
			<>
				<button
					type="button"
					className="block min-h-16 w-full whitespace-pre-wrap break-words text-left"
					onClick={(event) => choose({ row: row.index, col }, event.shiftKey)}
				>
					{row.cells[col] ?? ""}
				</button>
				{entries.length > 0 ? (
					<span className="absolute top-2 right-2 flex gap-2">
						{entries.map((entry) => (
							<button
								key={entry.thread.id}
								type="button"
								aria-label={`Show comment ${entry.number}`}
								className="flex size-20 items-center justify-center rounded-full bg-primary tr-text-metadata text-text-on-primary outline-none focus-visible:ring-2 focus-visible:ring-primary"
								onClick={(event) => {
									event.stopPropagation();
									scrollToCard(entry.thread.id);
								}}
							>
								{entry.number}
							</button>
						))}
					</span>
				) : null}
			</>
		);
		return header ? (
			<th key={col} className={className}>
				{contents}
			</th>
		) : (
			<td key={col} className={className}>
				{contents}
			</td>
		);
	};
	const header = table.rows[0];
	const body = table.rows.slice(1);

	return (
		<div data-testid="csv-view" className="flex h-full min-h-0 flex-col bg-container-workspace-bg">
			{header ? (
				<div className="min-h-40 flex-1">
					<TableVirtuoso
						ref={virtuosoRef}
						data={body}
						className="h-full"
						computeItemKey={(_index, row) => row.index}
						components={{
							Table: (props) => <table {...props} className="w-max min-w-full border-collapse" />,
						}}
						fixedHeaderContent={() => (
							<tr>
								<th className="sticky left-0 z-10 w-40 border border-border-muted bg-container-header-bg px-4 py-4 text-right tr-code-text text-text-subtle">
									0
								</th>
								{header.cells.map((_cell, col) => renderCell(header, col, true))}
							</tr>
						)}
						itemContent={(_index, row) => (
							<>
								<td className="sticky left-0 z-10 w-40 border border-border-muted bg-container-header-bg px-4 py-4 text-right tr-code-text text-text-subtle">
									{row.index}
								</td>
								{Array.from(
									{ length: Math.max(header.cells.length, row.cells.length) },
									(_value, col) => renderCell(row, col, false),
								)}
							</>
						)}
					/>
				</div>
			) : (
				<p className="p-12 tr-text-ui text-text-muted">Empty table</p>
			)}
			<StaleComposerNotice visible={composer.stale} />
			{composer.composing && draft && review ? (
				<div className="shrink-0 border-border-default border-t bg-container-header-bg p-8">
					<ReviewComposer
						draft={draft}
						label={draft.label}
						commenting={review.commenting}
						onClose={composer.close}
					/>
				</div>
			) : null}
			{review && placed.size > 0 ? (
				<div className="max-h-[32vh] shrink-0 overflow-auto border-border-default border-t bg-container-workspace-bg p-4">
					{review.threads
						.filter((thread) => placed.has(thread.id))
						.map((thread) => (
							<div
								key={thread.id}
								ref={(node) => {
									if (node) cardRefs.current.set(thread.id, node);
									else cardRefs.current.delete(thread.id);
								}}
							>
								<ReviewThreadCard
									thread={thread}
									actions={review.actions}
									onActivate={() => scrollToCell(thread)}
								/>
							</div>
						))}
				</div>
			) : null}
		</div>
	);
}
