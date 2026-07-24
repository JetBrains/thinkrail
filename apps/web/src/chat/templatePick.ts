/**
 * Should a `template.get` response — an async pick from the composer's `/` menu — still be applied to
 * the composer? Two independent staleness rules, both required:
 *
 * - **Newest pick wins:** `generation` must still be the latest one issued. Two quick picks can resolve
 *   out of order (nothing on the wire guarantees ordering across requests), and only the most recent
 *   choice may insert — a slower first response arriving second must be dropped.
 * - **The draft is untouched:** the current draft must be byte-identical to what it was at pick time.
 *   If the user typed anything while the fetch was in flight, a late `insertTemplate` would silently
 *   destroy that newer input — the same "programmatic replace must respect what the user did since"
 *   class of bug `Composer`'s `replaceDraft` doc describes for recall.
 *
 * Pure and exported so the race rules are unit-testable (`templatePick.test.ts`) without a transport;
 * `ChatView.tsx`'s `onPickTemplate` is the only production caller.
 */
export function shouldApplyTemplatePick(pick: {
	/** The generation stamped when this pick was issued. */
	generation: number;
	/** The newest generation issued so far (read when the response arrives). */
	latestGeneration: number;
	/** The composer draft exactly as it was when this pick was issued. */
	draftAtPick: string;
	/** The composer draft as it is when the response arrives. */
	currentDraft: string;
}): boolean {
	return pick.generation === pick.latestGeneration && pick.draftAtPick === pick.currentDraft;
}
