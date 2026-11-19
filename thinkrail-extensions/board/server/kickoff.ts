import type { Card, Workflow } from "./model";

/** The skill M and L cards start with, sent the way the composer sends a picked skill. */
export const BRAINSTORMING_COMMAND = "/skill:brainstorming";

/** S cards, bugs and unsized cards implement directly; M and L start with brainstorming. */
export function workflowFor(card: Pick<Card, "type" | "size">): Workflow {
	if (card.type === "bug") return "implement";
	return card.size === "M" || card.size === "L" ? "brainstorm" : "implement";
}

/** The first prompt of a card's attempt: its title, description, acceptance criteria and spec refs. */
export function kickoffText(
	card: Pick<Card, "id" | "title" | "description" | "acceptance" | "specRefs">,
	workflow: Workflow,
): string {
	const lines = [`Card ${card.id}: ${card.title.trim()}`];
	const description = card.description.trim();
	if (description) lines.push("", description);
	const acceptance = card.acceptance.map((item) => item.trim()).filter(Boolean);
	if (acceptance.length > 0)
		lines.push("", "Acceptance criteria:", ...acceptance.map((item) => `- ${item}`));
	const specs = card.specRefs.map((ref) => ref.trim()).filter(Boolean);
	if (specs.length > 0) lines.push("", "Specs:", ...specs.map((ref) => `- ${ref}`));
	const body = lines.join("\n");
	return workflow === "brainstorm" ? `${BRAINSTORMING_COMMAND} ${body}` : body;
}
