import { delimiter, join } from "node:path";
import {
	type ExtensionContext,
	getAgentDir,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { BackgroundCommandContext } from "./types";

export function shellEnvironment(
	sessionId: string,
	context: BackgroundCommandContext,
): NodeJS.ProcessEnv {
	const env = { ...process.env };
	const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
	const currentPath = env[pathKey] ?? "";
	const binDir = join(getAgentDir(), "bin");
	if (!currentPath.split(delimiter).includes(binDir)) {
		env[pathKey] = [binDir, currentPath].filter(Boolean).join(delimiter);
	}
	delete env.PI_SESSION_ID;
	delete env.PI_SESSION_FILE;
	delete env.PI_PROVIDER;
	delete env.PI_MODEL;
	delete env.PI_REASONING_LEVEL;
	if (context.exposeSessionEnvironment !== false) {
		env.PI_SESSION_ID = sessionId;
		if (context.sessionFile) env.PI_SESSION_FILE = context.sessionFile;
		if (context.model) {
			env.PI_PROVIDER = context.model.provider;
			env.PI_MODEL = context.model.id;
		}
		if (context.thinkingLevel) env.PI_REASONING_LEVEL = context.thinkingLevel;
	}
	return env;
}

export function standaloneContext(ctx: ExtensionContext): BackgroundCommandContext {
	const settings = SettingsManager.create(ctx.cwd, getAgentDir(), {
		projectTrusted: ctx.isProjectTrusted(),
	});
	return {
		cwd: ctx.cwd,
		sessionFile: ctx.sessionManager.getSessionFile(),
		model: ctx.model,
		thinkingLevel: ctx.thinkingLevel,
		shellPath: settings.getShellPath(),
		commandPrefix: settings.getShellCommandPrefix(),
	};
}
