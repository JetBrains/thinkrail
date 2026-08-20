import "./env";
import { completeOnce } from "@thinkrail/server/agent";

export interface UserSimConfig {
	brief: string;
	opening?: string;
	maxUserTurns?: number;
}

export const SIM_DONE = "DONE";

const SIM_SYSTEM = [
	"You are role-playing a HUMAN USER chatting with a coding agent inside a dev tool. Stay in",
	"character per the brief; be concise (1-3 sentences), like a real user typing. Given the",
	"conversation so far, reply with the user's next chat message only — no quotes, no markdown, no",
	`meta-commentary. If the goal is accomplished or there is nothing useful left to say, reply exactly ${SIM_DONE}.`,
].join(" ");

export function parseSimReply(reply: string): string | null {
	const text = reply.trim();
	if (!text || text.toUpperCase() === SIM_DONE) return null;
	return text;
}

export async function nextUserMessage(transcript: string, brief: string): Promise<string | null> {
	try {
		const tail = transcript.length > 6000 ? transcript.slice(-6000) : transcript;
		const { text } = await completeOnce({
			system: SIM_SYSTEM,
			prompt: `Brief: ${brief}\n\nConversation so far:\n${tail || "(conversation start)"}`,
			tier: "cheap",
			maxTokens: 200,
			temperature: 0.4,
		});
		return parseSimReply(text);
	} catch {
		return null;
	}
}

export async function openingMessage(config: UserSimConfig): Promise<string> {
	if (config.opening) return config.opening;
	const composed = await nextUserMessage("", config.brief);
	return composed ?? config.brief;
}
