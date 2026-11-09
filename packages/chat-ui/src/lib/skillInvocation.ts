export interface SkillInvocation {
	name: string;
	location: string;
	content: string;
	userMessage?: string;
}

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
