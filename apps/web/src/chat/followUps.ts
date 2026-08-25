import type { ChatTurn } from "./types";

export type FollowUp = { label: string; prompt: string };

const DEFAULT_FOLLOW_UPS: FollowUp[] = [
	{ label: "Continue", prompt: "Continue with the implementation." },
	{ label: "Explain this", prompt: "Explain what you just did and why." },
	{ label: "Run the tests", prompt: "Run the tests and report the results." },
];

const RULES: { match: RegExp; items: FollowUp[] }[] = [
	{
		match: /\b(option|recommend|approach|alternativ|prefer)/i,
		items: [
			{
				label: "Use the recommended option",
				prompt: "Use the recommended option and continue with the implementation.",
			},
			{
				label: "Compare the options",
				prompt: "Compare the options in more detail before deciding.",
			},
		],
	},
	{
		match: /\b(error|fail|issue|bug|broke|broken|exception|crash)/i,
		items: [
			{ label: "Fix the issues", prompt: "Fix the issues you found and re-run the checks." },
			{ label: "Explain the cause", prompt: "Explain the root cause of the failure." },
		],
	},
	{
		match: /\b(test|spec|coverage)/i,
		items: [
			{ label: "Run the tests", prompt: "Run the tests and report the results." },
			{ label: "Add tests", prompt: "Add tests covering the new behavior." },
		],
	},
	{
		match: /\b(implement|refactor|added|updated|created|changed|change)/i,
		items: [
			{
				label: "Update the implementation",
				prompt: "Update the implementation based on the notes above.",
			},
			{ label: "Explain this", prompt: "Explain what you just did and why." },
		],
	},
];

function lastAssistantText(turns: ChatTurn[]): string | null {
	for (let i = turns.length - 1; i >= 0; i--) {
		const turn = turns[i];
		if (turn?.kind === "assistant") {
			return turn.message.content
				.filter((b) => b.type === "text")
				.map((b) => b.text)
				.join("\n");
		}
	}
	return null;
}

export function deriveFollowUps(turns: ChatTurn[]): FollowUp[] {
	const text = lastAssistantText(turns);
	if (text === null || text.trim() === "") return [];
	for (const rule of RULES) {
		if (rule.match.test(text)) return rule.items;
	}
	return DEFAULT_FOLLOW_UPS;
}
