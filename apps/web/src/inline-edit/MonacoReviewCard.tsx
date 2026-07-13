import type { EditHunk } from "./types";

/**
 * Monaco v0 review: a compact removed/added card floating over the editor (no in-text strikethrough — that
 * needs view zones; a named follow-up). One card per request, summarizing its target-file hunks. `children`
 * is the action bar.
 */
export function MonacoReviewCard({
	hunks,
	children,
}: {
	hunks: EditHunk[];
	children?: React.ReactNode;
}) {
	return (
		<div
			data-testid="inline-edit-monaco-card"
			className="absolute top-2 right-2 z-20 w-[380px] rounded-[var(--radius-md)] border border-primary/40 bg-elevated p-sm shadow-[var(--shadow-lg)]"
		>
			<div className="mb-xs text-primary text-[11px]">✦ Inline edit — review</div>
			<div className="max-h-40 overflow-auto rounded-[var(--radius-sm)] border border-border2 font-[var(--font-mono)] text-[11px] leading-relaxed">
				{hunks.map((h, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: hunks are render-order-stable
					<div key={i}>
						{h.oldText ? (
							<div className="bg-red/10 px-sm text-red">
								<span className="select-none pr-1">−</span>
								{h.oldText}
							</div>
						) : null}
						<div className="bg-green/10 px-sm text-green">
							<span className="select-none pr-1">+</span>
							{h.newText}
						</div>
					</div>
				))}
			</div>
			{children}
		</div>
	);
}
