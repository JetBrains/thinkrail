import { wordDiff } from "./wordDiff";

/**
 * In-flow woven diff for a markdown review: old text struck through, new text highlighted, word-level,
 * rendered as PLAIN document prose in place of the changed lines — no card/box, so it reads as part of the
 * document itself (the "changes inlined" half). The action box renders separately in a between-lines box
 * below it (composed by the controller), never wrapping the diff.
 */
export function InlineSuggestion({ oldText, newText }: { oldText: string; newText: string }) {
	const parts = wordDiff(oldText, newText);
	return (
		<p
			data-testid="inline-edit-suggestion"
			className="my-md text-pretty text-[length:var(--font-md)] text-text leading-[1.65]"
		>
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
					<span key={i}>{p.text}</span>
				),
			)}
		</p>
	);
}
