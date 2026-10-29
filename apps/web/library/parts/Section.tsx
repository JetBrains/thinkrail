import type { ReactNode } from "react";

export function Section({
	id,
	title,
	description,
	children,
}: {
	id?: string;
	title: string;
	description?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section id={id} className="flex scroll-mt-16 flex-col gap-12">
			<div className="flex flex-col gap-4">
				<h2 className="tr-heading-sm text-text-default">{title}</h2>
				{description ? (
					<div className="tr-text-ui text-text-muted [overflow-wrap:anywhere]">{description}</div>
				) : null}
			</div>
			{children}
		</section>
	);
}

export function Table({ head, rows }: { head: readonly string[]; rows: readonly ReactNode[][] }) {
	return (
		<div className="overflow-x-auto rounded-sm border border-border-default">
			<table className="w-full border-collapse text-left">
				<thead className="bg-container-header-bg">
					<tr>
						{head.map((cell) => (
							<th key={cell} className="px-12 py-8 tr-text-eyebrow text-text-muted">
								{cell}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{rows.map((row, index) => (
						<tr key={String(index)} className="border-border-default border-t align-top">
							{row.map((cell, column) => (
								<td key={String(column)} className="px-12 py-8 tr-text-ui text-text-default">
									{cell}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
