/** Pi's canonical persisted representation of an explicitly-invoked `/skill:<name>` command. */
export interface SkillInvocation {
	name: string;
	location: string;
	/** The full skill payload inside `<skill>`, including Pi's relative-reference preamble. */
	content: string;
	/** Text supplied after the slash command, kept outside the skill block by Pi. */
	userMessage?: string;
}

/**
 * Parse Pi's canonical expanded skill user message.
 *
 * This intentionally mirrors `pi-coding-agent`'s anchored `parseSkillBlock` grammar rather than
 * value-importing that server-only package into the browser bundle. Anything other than the exact
 * persisted shape fails closed and remains an ordinary user message.
 */
export function parseSkillInvocation(text: string): SkillInvocation | null {
	const match =
		/^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/.exec(
			text,
		);
	if (!match) return null;
	const [, name, location, content, userMessage] = match;
	if (name === undefined || location === undefined || content === undefined) return null;
	return {
		name,
		location,
		content,
		...(userMessage?.trim() ? { userMessage: userMessage.trim() } : {}),
	};
}

/**
 * Whether an optimistic raw slash command is the source of this expanded invocation. Parsing follows
 * Pi's own expansion rules exactly: the first literal space separates the name and trimmed arguments.
 */
export function matchesSkillInvocationCommand(
	commandText: string,
	invocation: Pick<SkillInvocation, "name" | "userMessage">,
): boolean {
	if (!commandText.startsWith("/skill:")) return false;
	const spaceIndex = commandText.indexOf(" ");
	const name = spaceIndex === -1 ? commandText.slice(7) : commandText.slice(7, spaceIndex);
	const args = spaceIndex === -1 ? "" : commandText.slice(spaceIndex + 1).trim();
	return name === invocation.name && (args || undefined) === invocation.userMessage;
}
