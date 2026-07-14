import { wordDiff } from "./wordDiff";

/**
 * In-flow woven diff for a markdown review: old text struck through, new text highlighted, word-level, in
 * PLAIN document prose in place of the changed lines — with a GitHub-style colored left bar marking the
 * reviewed region: **green** when the change adds/rewrites content, **red** when it's a pure deletion. The
 * action box renders separately in a between-lines box below it (composed by the controller).
 */
export function InlineSuggestion({ oldText, newText }: { oldText: string; newText: string }) {
	const parts = wordDiff(oldText, newText);
	// Pure deletion (nothing left after the edit) reads red; anything that adds or rewrites content reads green.
	const barColor = newText.trim() === "" ? "border-red" : "border-green";
	return (
		<p
			data-testid="inline-edit-suggestion"
			className={`my-md border-l-2 ${barColor} pl-sm text-pretty text-[length:var(--font-md)] text-text leading-[1.65]`}
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
