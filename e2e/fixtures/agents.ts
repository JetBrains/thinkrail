import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { E2E_PI_AGENT_DIR } from "./paths";

export function seedAgentDefinitionFixtures(agentDir: string = E2E_PI_AGENT_DIR): void {
	const dir = join(agentDir, "agents");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "echo.md"),
		`---
name: echo
description: Test subagent that follows the task instruction exactly and replies tersely.
tools: read
max_turns: 3
---
You are EchoAgent, a test subagent. Follow the task instruction exactly and reply with exactly the
text it asks for — nothing else. Do not use tools unless the task explicitly requires reading a file.
`,
	);
}
