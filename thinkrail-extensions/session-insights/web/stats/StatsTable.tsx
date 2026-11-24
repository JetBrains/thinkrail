import { RiArrowDownLine, RiArrowUpLine } from "@remixicon/react";
import type { MessageKey } from "@thinkrail/locales";
import { useT } from "@thinkrail/locales/react";
import { Button } from "@thinkrail/ui/button";
import { cn } from "@thinkrail/ui/utils";
import { type ReactNode, useState } from "react";

const PAGE = 25;

export interface StatsColumn<R> {
	key: string;
	label: MessageKey;
	numeric?: boolean;
	/** The sort value; `null` sorts last. Absent: the column does not sort. */
	sort?: (row: R) => number | string | null;
	render: (row: R) => ReactNode;
	className?: string;
}

function compare(a: number | string | null, b: number | string | null, direction: 1 | -1) {
	if (a === b) return 0;
	if (a === null) return 1;
	if (b === null) return -1;
	return (a < b ? -1 : 1) * direction;
}

/**
 * A native table of server rows: sortable columns (descending first, missing values last, the server's
 * order between ties), 25 rows at a time with *Show N more*.
 */
export function StatsTable<R>({
	rows,
	columns,
	rowKey,
	testId,
	label,
	rowTestId,
	rowAttributes,
}: {
	rows: readonly R[];
	columns: readonly StatsColumn<R>[];
	rowKey: (row: R) => string;
	testId: string;
	label: string;
	rowTestId: string;
	rowAttributes?: (row: R) => Record<string, string>;
}) {
	const t = useT();
	const [sort, setSort] = useState<{ key: string; direction: 1 | -1 } | null>(null);
	const [shown, setShown] = useState(PAGE);
	const column = sort ? columns.find((candidate) => candidate.key === sort.key) : undefined;
	const ordered =
		sort && column?.sort
			? rows
					.map((row, at) => ({ row, at, value: column.sort?.(row) ?? null }))
					.sort((a, b) => compare(a.value, b.value, sort.direction) || a.at - b.at)
					.map(({ row }) => row)
			: rows;
	const visible = ordered.slice(0, shown);
	return (
		<div className="min-w-0 overflow-x-auto">
			<table data-testid={testId} aria-label={label} className="w-full border-collapse tr-text-ui">
				<thead className="sticky top-0 bg-control-bg">
					<tr>
						{columns.map((item) => {
							const active = sort?.key === item.key;
							return (
								<th
									key={item.key}
									scope="col"
									aria-sort={
										active ? (sort?.direction === 1 ? "ascending" : "descending") : undefined
									}
									className={cn(
										"whitespace-nowrap px-8 py-2 tr-text-caption text-text-subtle",
										item.numeric ? "text-right" : "text-left",
									)}
								>
									{item.sort ? (
										<button
											type="button"
											data-testid={`${testId}-sort-${item.key}`}
											onClick={() =>
												setSort(
													active
														? { key: item.key, direction: sort?.direction === -1 ? 1 : -1 }
														: { key: item.key, direction: -1 },
												)
											}
											className="inline-flex items-center gap-2 rounded-sm hover:text-text-default focus-visible:focus-ring"
										>
											{t(item.label)}
											{active ? (
												sort?.direction === 1 ? (
													<RiArrowUpLine aria-hidden className="size-12" />
												) : (
													<RiArrowDownLine aria-hidden className="size-12" />
												)
											) : null}
										</button>
									) : (
										t(item.label)
									)}
								</th>
							);
						})}
					</tr>
				</thead>
				<tbody>
					{visible.map((row) => (
						<tr
							key={rowKey(row)}
							data-testid={rowTestId}
							{...(rowAttributes?.(row) ?? {})}
							className="border-border-muted border-t hover:bg-control-bg-hovered"
						>
							{columns.map((item) => (
								<td
									key={item.key}
									className={cn(
										"px-8 py-2 align-middle tabular-nums",
										item.numeric ? "text-right" : "text-left",
										item.className,
									)}
								>
									{item.render(row)}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
			{ordered.length > shown ? (
				<div className="px-8 py-4">
					<Button variant="ghost" size="s" onClick={() => setShown(shown + PAGE)}>
						{t("sessionInsights.more", { count: Math.min(PAGE, ordered.length - shown) })}
					</Button>
				</div>
			) : null}
		</div>
	);
}
