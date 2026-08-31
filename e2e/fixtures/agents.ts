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
	writeFileSync(
		join(dir, "slow.md"),
		`---
name: slow
description: Test subagent that executes a requested blocking command before replying.
tools: bash
max_turns: 3
---
You are SlowAgent, a test subagent. When the task gives you a shell command, run it with the bash tool
before replying. Do not alter, background, or skip the command.
`,
	);
}
