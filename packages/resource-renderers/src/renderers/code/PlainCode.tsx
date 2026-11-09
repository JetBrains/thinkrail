import type { PlainRow, PlainRowKind } from "./plainRows";

const MARKER: Record<PlainRowKind, string> = {
	hunk: "",
	context: " ",
	deletion: "-",
	addition: "+",
};

export function PlainCode({ rows, diff = false }: { rows: readonly PlainRow[]; diff?: boolean }) {
	return (
		<pre
			data-testid="plain-code"
			className="m-0 min-w-0 overflow-x-auto px-12 py-4 tr-code-editor text-text-default"
		>
			{rows.map((row) => (
				<div
					key={row.key}
					data-kind={row.kind}
					className={row.kind === "hunk" ? "text-text-muted" : undefined}
				>
					{diff ? <span className="select-none pr-8">{MARKER[row.kind]}</span> : null}
					<span>{row.text || " "}</span>
				</div>
			))}
		</pre>
	);
}
