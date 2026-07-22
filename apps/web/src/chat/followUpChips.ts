// MOCK follow-up chips for the composer's always-present action-chip row (Conductor-style).
//
// TODO(real-followups): replace this mock with STRUCTURED follow-up data emitted by the agent — its
// pending question + the options it offers, as typed fields on the wire. That is a contracts/wire change
// and is intentionally OUT OF SCOPE here (we must not parse the agent's prose to guess options, nor invent
// a streamed field). Until it lands, these mocked chips drive the row's layout, states, and
// click-to-send. `selectFollowUpChips` is the single seam where the real source will plug in.

/** One follow-up action chip: `label` is what the pill shows; `text` is submitted as the user message. */
export interface FollowUpChip {
	id: string;
	label: string;
	text: string;
}

/** MOCK chip sets for the two states the row must cover. */
export const mockFollowUpChips: {
	/** The priority case: the agent is asking the user to decide — its options become chips. */
	asking: FollowUpChip[];
	/** The fallback: no active agent question — default starter actions keep the row present. */
	idle: FollowUpChip[];
} = {
	asking: [
		{ id: "ask-yes", label: "Yes, proceed", text: "Yes, go ahead." },
		{ id: "ask-no", label: "No, hold off", text: "No, don't do that yet." },
		{ id: "ask-explain", label: "Explain the options", text: "Explain the trade-offs first." },
	],
	idle: [
		{ id: "idle-next", label: "What's next?", text: "What should we do next?" },
		{ id: "idle-tests", label: "Run the tests", text: "Run the test suite and report failures." },
		{ id: "idle-explain", label: "Explain this code", text: "Explain what the current code does." },
	],
};

/**
 * Pick the chips to show. MOCK selector: while the agent is busy we surface the "asking" set (the
 * priority options case); otherwise the idle starters — so both states are reviewable. Returns `[]` only
 * when there is genuinely nothing to show, which hides the row. The real implementation will key off the
 * structured follow-up/ask data described in the TODO above, not `isBusy`.
 */
export function selectFollowUpChips(isBusy: boolean): FollowUpChip[] {
	return isBusy ? mockFollowUpChips.asking : mockFollowUpChips.idle;
}
