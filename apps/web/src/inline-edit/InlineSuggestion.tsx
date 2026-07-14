import { wordDiff } from "./wordDiff";

/**
 * In-flow woven diff for a markdown review: old text struck through, new text highlighted, word-level.
 * Rendered as a normal document block in place of the changed lines (never fixed/floating) — `children`
 * (the action bar) renders directly below it, in the flow, pushing following content down.
 */
export function InlineSuggestion({
	oldText,
	newText,
	children,
}: {
	oldText: string;
	newText: string;
	children?: React.ReactNode;
}) {
	const parts = wordDiff(oldText, newText);
	return (
		<div
			data-testid="inline-edit-suggestion"
			className="my-md rounded-[var(--radius-sm)] border border-primary/30 bg-primary/5 px-sm py-xs"
		>
			<p className="text-sm leading-relaxed">
				{parts.map((p, i) =>
					p.kind === "del" ? (
						// biome-ignore lint/suspicious/noArrayIndexKey: diff parts are render-order-stable
						<del key={i} className="bg-red/10 text-red/80 decoration-red/60">
							{p.text}
						</del>
					) : p.kind === "add" ? (
						// biome-ignore lint/suspicious/noArrayIndexKey: diff parts are render-order-stable
						<mark key={i} className="rounded-[var(--radius-sm)] bg-green/15 text-green">
							{p.text}
						</mark>
					) : (
						// biome-ignore lint/suspicious/noArrayIndexKey: diff parts are render-order-stable
						<span key={i} className="text-text">
							{p.text}
						</span>
					),
				)}
			</p>
			{children}
		</div>
	);
}
