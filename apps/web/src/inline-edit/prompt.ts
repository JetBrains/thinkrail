import type { SelectionTarget } from "./types";

/**
 * Build the crafted user turn that seeds a hidden inline-edit session. We influence pi only through this
 * prompt (never a hand-assembled system prompt): it names the file + line range + the exact selection, the
 * user's instruction, and the guardrails that keep the edit tight and reviewable.
 */
export function buildSeedPrompt(target: SelectionTarget, instruction: string): string {
	return [
		`Edit the file \`${target.path}\` (in this workspace).`,
		`Focus on lines ${target.startLine}-${target.endLine}, which contain this selected text:`,
		"",
		"```",
		target.text,
		"```",
		"",
		`Instruction: ${instruction}`,
		"",
		"Rules:",
		"- Change only what the instruction requires; preserve surrounding text and voice.",
		"- Modify files only via your edit/write tools — never via bash/sed.",
		"- Do not ask clarifying questions; make your best judgment.",
		"- End with one short sentence explaining what you changed and why.",
	].join("\n");
}
