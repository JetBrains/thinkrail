import { join } from "node:path";

export function toolHomeEnv(home: string): Record<string, string> {
	return {
		HOME: home,
		USERPROFILE: home,
		CLAUDE_CONFIG_DIR: join(home, ".claude"),
		CLAUDE_SECURESTORAGE_CONFIG_DIR: "",
		CLAUDE_CODE_OAUTH_TOKEN: "",
		CODEX_HOME: join(home, ".codex"),
		GEMINI_CLI_HOME: home,
		XDG_CONFIG_HOME: join(home, ".config"),
		COPILOT_HOME: join(home, ".copilot"),
		KIMI_SHARE_DIR: join(home, ".kimi"),
		GROK_HOME: join(home, ".grok"),
		GROK_AUTH_PATH: "",
	};
}
