import { useEffect, useMemo, useRef } from "react";
import type { ResourceDiffProps, ReviewThread, SurfaceReview } from "@/resources";
import { ReviewComposer } from "../../ReviewComposer";
import { ReviewThreadCard } from "../../ReviewThreadCard";
import { diffContentStamp, useStampedComposer } from "../reviewComposerState";
import { StaleComposerNotice } from "../StaleComposerNotice";
import {
	type AlignedCsvRow,
	alignCsvRows,
	type CsvCell,
	type CsvRow,
	type CsvSelection,
	csvSelectionDraft,
	parseCsv,
	placedTableThreadIds,
	sniffDelimiter,
	tableCellOfAnchor,
} from "./csvModel";

const NO_THREADS: ReadonlySet<string> = new Set();
type Side = "base" | "worktree";

interface SelectionState {
	side: Side;
	rows: readonly CsvRow[];
	selection: CsvSelection;
}

interface ThreadEntry {
	thread: ReviewThread;
	number: number;
	side: Side;
}

function rowForSide(row: AlignedCsvRow, side: Side): CsvRow | null {
	if (side === "base") return "original" in row ? row.original : null;
	return "modified" in row ? row.modified : null;
}

function selected(state: SelectionState | null, side: Side, row: number, col: number): boolean {
	if (!state || state.side !== side) return false;
	const firstRow = Math.min(state.selection.anchor.row, state.selection.focus.row);
	const lastRow = Math.max(state.selection.anchor.row, state.selection.focus.row);
	const firstCol = Math.min(state.selection.anchor.col, state.selection.focus.col);
	const lastCol = Math.max(state.selection.anchor.col, state.selection.focus.col);
	return row >= firstRow && row <= lastRow && col >= firstCol && col <= lastCol;
}

function rowTint(kind: AlignedCsvRow["kind"]): string {
	if (kind === "added") return "bg-feedback-success-subtle";
	if (kind === "removed") return "bg-feedback-error-subtle";
	return "bg-container-content-bg";
}

export default function CsvDiff({
	resource,
	original,
	modified,
	review,
	onPlacedThreadIds,
}: ResourceDiffProps) {
	const delimiter = sniffDelimiter(
		resource.path,
		modified.kind === "text" ? modified.text : "",
		original.kind === "text" ? original.text : "",
	);
	const originalTable = useMemo(
		() => parseCsv(original.kind === "text" ? original.text : "", delimiter),
		[delimiter, original],
	);
	const modifiedTable = useMemo(
		() => parseCsv(modified.kind === "text" ? modified.text : "", delimiter),
		[delimiter, modified],
	);
	const aligned = useMemo(
		() => alignCsvRows(originalTable.rows, modifiedTable.rows),
		[originalTable.rows, modifiedTable.rows],
	);
	const composer = useStampedComposer<SelectionState>(diffContentStamp(original, modified));
	const selection = composer.selection;
	const cardRefs = useRef(new Map<string, HTMLDivElement>());
	const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
	const handledFocusRef = useRef<string | null>(null);
	const placed = useMemo(() => {
		const ids = new Set<string>();
		for (const id of placedTableThreadIds(review?.base.threads ?? [], originalTable.rows))
			ids.add(id);
		for (const id of placedTableThreadIds(review?.worktree.threads ?? [], modifiedTable.rows)) {
			ids.add(id);
		}
		return ids;
	}, [modifiedTable.rows, originalTable.rows, review?.base.threads, review?.worktree.threads]);
	const threadEntries = useMemo(() => {
		const result = new Map<string, ThreadEntry[]>();
		let number = 0;
		for (const [side, surface, rows] of [
			["base", review?.base, originalTable.rows],
			["worktree", review?.worktree, modifiedTable.rows],
		] as const) {
			for (const thread of surface?.threads ?? []) {
				const cell = tableCellOfAnchor(thread.anchor, rows);
				if (!cell) continue;
				number += 1;
				const key = `${side}:${cell.row}:${cell.col}`;
				const entries = result.get(key) ?? [];
				entries.push({ thread, number, side });
				result.set(key, entries);
			}
		}
		return result;
	}, [modifiedTable.rows, originalTable.rows, review]);
	const draft = selection ? csvSelectionDraft(selection.rows, selection.selection) : null;
	const focusSurface = review
		? review.worktree.focus
			? review.worktree
			: review.base.focus
				? review.base
				: null
		: null;
	const focusId = focusSurface?.focus?.id ?? null;

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
		focusSurface?.onFocusHandled();
	}, [focusId, focusSurface, placed]);

	const choose = (side: Side, rows: readonly CsvRow[], cell: CsvCell, shift: boolean) => {
		composer.select({
			side,
			rows,
			selection:
				shift && selection?.side === side
					? { anchor: selection.selection.anchor, focus: cell }
					: { anchor: cell, focus: cell },
		});
	};
	const surfaceFor = (side: Side): SurfaceReview | undefined =>
		side === "base" ? review?.base : review?.worktree;
	const scrollToCard = (id: string) =>
		cardRefs.current.get(id)?.scrollIntoView({ block: "center" });
	const scrollToThread = (thread: ReviewThread, side: Side) => {
		const rows = side === "base" ? originalTable.rows : modifiedTable.rows;
		const cell = tableCellOfAnchor(thread.anchor, rows);
		if (!cell) return;
		rowRefs.current.get(`${side}:${cell.row}`)?.scrollIntoView({ block: "center" });
	};
	const maxColumns = Math.max(
		1,
		...originalTable.rows.map((row) => row.cells.length),
		...modifiedTable.rows.map((row) => row.cells.length),
	);

	return (
		<div data-testid="csv-diff" className="flex h-full min-h-0 flex-col bg-container-content-bg">
			<div className="min-h-40 flex-1 overflow-auto">
				<table className="w-max min-w-full border-collapse">
					<tbody>
						{aligned.map((row, alignedIndex) => {
							const side: Side = row.kind === "removed" ? "base" : "worktree";
							const sourceRows = side === "base" ? originalTable.rows : modifiedTable.rows;
							const sourceRow = rowForSide(row, side);
							if (!sourceRow) return null;
							const originalRow = rowForSide(row, "base");
							const modifiedRow = rowForSide(row, "worktree");
							const rowKey = `${row.kind}:${originalRow?.index ?? ""}:${modifiedRow?.index ?? ""}`;
							return (
								<tr
									key={rowKey}
									ref={(node) => {
										if (node) {
											if (originalRow) rowRefs.current.set(`base:${originalRow.index}`, node);
											if (modifiedRow) rowRefs.current.set(`worktree:${modifiedRow.index}`, node);
										}
									}}
									className={rowTint(row.kind)}
								>
									<td className="sticky left-0 z-10 w-40 border border-border-muted bg-container-header-bg px-4 py-4 text-right tr-code-text text-text-subtle">
										{row.kind === "removed" ? `−${sourceRow.index}` : sourceRow.index}
									</td>
									{Array.from({ length: maxColumns }, (_value, col) => {
										const entries = [
											...(originalRow
												? (threadEntries.get(`base:${originalRow.index}:${col}`) ?? [])
												: []),
											...(modifiedRow
												? (threadEntries.get(`worktree:${modifiedRow.index}:${col}`) ?? [])
												: []),
										];
										const changed = row.kind === "changed" && row.changedCells.includes(col);
										const header = alignedIndex === 0;
										const Cell = header ? "th" : "td";
										return (
											<Cell
												key={col}
												className={`relative min-w-96 max-w-[360px] border border-border-muted px-8 py-4 text-left align-top tr-code-text text-text-default ${
													changed ? "bg-feedback-info-subtle" : ""
												} ${
													selected(selection, side, sourceRow.index, col)
														? "outline-2 -outline-offset-2 outline-primary"
														: ""
												} ${entries.length > 0 ? "outline-2 -outline-offset-2 outline-text-subtle" : ""}`}
											>
												<button
													type="button"
													className="block min-h-16 w-full whitespace-pre-wrap text-left"
													onClick={(event) =>
														choose(side, sourceRows, { row: sourceRow.index, col }, event.shiftKey)
													}
												>
													{changed ? (
														<>
															<span className="text-feedback-error">
																{originalRow?.cells[col] ?? ""}
															</span>
															<span className="px-4 text-text-subtle">→</span>
															<span className="text-feedback-success">
																{modifiedRow?.cells[col] ?? ""}
															</span>
														</>
													) : (
														(sourceRow.cells[col] ?? "")
													)}
												</button>
												{entries.length > 0 ? (
													<span className="absolute top-2 right-2 flex gap-2">
														{entries.map((entry) => (
															<button
																key={entry.thread.id}
																type="button"
																aria-label={`Show comment ${entry.number}`}
																className="flex size-20 items-center justify-center rounded-full bg-primary tr-text-metadata text-text-on-primary outline-none focus-visible:ring-2 focus-visible:ring-primary"
																onClick={() => scrollToCard(entry.thread.id)}
															>
																{entry.number}
															</button>
														))}
													</span>
												) : null}
											</Cell>
										);
									})}
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
			<StaleComposerNotice visible={composer.stale} />
			{composer.composing && selection && draft && surfaceFor(selection.side) ? (
				<div className="shrink-0 border-border-default border-t bg-container-header-bg p-8">
					<ReviewComposer
						draft={draft}
						label={draft.label}
						commenting={(surfaceFor(selection.side) as SurfaceReview).commenting}
						onClose={composer.close}
					/>
				</div>
			) : null}
			{review && placed.size > 0 ? (
				<div className="max-h-[32vh] shrink-0 overflow-auto border-border-default border-t p-4">
					{(["base", "worktree"] as const).flatMap((side) =>
						review[side].threads
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
										actions={review[side].actions}
										onActivate={() => scrollToThread(thread, side)}
									/>
								</div>
							)),
					)}
				</div>
			) : null}
		</div>
	);
}
