// On-demand pure-pi smoke for the subagents stack (the pi-delegation SPEC's pure-pi bar): the
// `pi-subagents` extension — embedding the `pi-delegation` core with DEFAULT bindings, no ThinkRail
// host — loads under the repo-pinned VANILLA pi CLI and completes a real delegated run.
//
//   bun run smoke:subagents            (override the model: THINKRAIL_E2E_MODEL="<provider>/<id>")
//
// Needs pi auth (copies your auth.json/models.json into a throwaway agent dir, never touching
// ~/.pi/agent) and spends real provider tokens — NEVER a commit/CI gate. The interactive half of the
// acceptance bar (default TUI tool rendering) stays a manual check via ~/IdeaProjects/
// subagents-playground (config A); this script is the repeatable, assertable core of it: extension
// loads → Agent tool executes → child completes → transcript persisted under <agentDir>/delegation.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const piBin = join(repoRoot, "node_modules", ".bin", "pi");
const extensionEntry = join(repoRoot, "packages", "pi-subagents", "index.ts");

function fail(message: string): never {
	console.error(`smoke-pure-pi-subagents: FAIL — ${message}`);
	process.exit(1);
}

// ── Isolated agent dir: auth copied in, deterministic default model, nothing of the user's touched ──
const agentDir = mkdtempSync(join(tmpdir(), "thinkrail-smoke-pi-agent-"));
const workDir = mkdtempSync(join(tmpdir(), "thinkrail-smoke-cwd-"));
try {
	const userAgentDir = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
	let copied = 0;
	for (const file of ["auth.json", "models.json"]) {
		const src = join(userAgentDir, file);
		if (existsSync(src)) {
			copyFileSync(src, join(agentDir, file));
			copied += 1;
		}
	}
	if (copied === 0) {
		fail(
			`no auth found under ${userAgentDir} — authenticate pi first (this smoke drives a real provider)`,
		);
	}
	const [provider, ...idParts] = (
		process.env.THINKRAIL_E2E_MODEL ?? "anthropic/claude-opus-4-8"
	).split("/");
	writeFileSync(
		join(agentDir, "settings.json"),
		`${JSON.stringify(
			{ defaultProvider: provider, defaultModel: idParts.join("/"), defaultThinkingLevel: "low" },
			null,
			2,
		)}\n`,
	);

	// ── One shot through vanilla pi: print mode, json events, the extension loaded by path ──
	const prompt =
		'Use the Agent tool with subagent_type "scout" and task "Reply with exactly the single word pong. Do not use any tools." After it returns, reply with the single word done.';
	console.log(`smoke-pure-pi-subagents: running vanilla pi (${provider}/${idParts.join("/")}) …`);
	let stdout = "";
	try {
		stdout = execFileSync(
			piBin,
			["-p", "--mode", "json", "--no-session", "-e", extensionEntry, prompt],
			{
				cwd: workDir, // an empty dir: no repo resources, no project trust in play — pure pi defaults
				env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
				encoding: "utf8",
				timeout: 300_000,
				maxBuffer: 64 * 1024 * 1024,
			},
		);
	} catch (error) {
		const e = error as { stdout?: string; stderr?: string; message?: string };
		fail(
			`pi exited abnormally: ${e.message}\n--- stdout tail ---\n${(e.stdout ?? "").slice(-2000)}\n--- stderr tail ---\n${(e.stderr ?? "").slice(-2000)}`,
		);
	}

	// ── Assertions over the event stream ──
	const events = stdout
		.split("\n")
		.filter((line) => line.trim().startsWith("{"))
		.flatMap((line) => {
			try {
				return [JSON.parse(line) as Record<string, unknown>];
			} catch {
				return [];
			}
		});
	const agentEnd = events.find((e) => e.type === "tool_execution_end" && e.toolName === "Agent") as
		| { isError?: boolean; result?: { content?: Array<{ type?: string; text?: string }> } }
		| undefined;
	if (!agentEnd) {
		fail(
			`no Agent tool_execution_end in pi's event stream — did the extension load?\n--- stdout tail ---\n${stdout.slice(-2000)}`,
		);
	}
	if (agentEnd.isError) {
		const text = agentEnd.result?.content?.find((c) => c.type === "text")?.text ?? "";
		fail(`the Agent run errored: ${text.slice(0, 500)}`);
	}

	// ── The child transcript persisted under the DEFAULT delegation root (<agentDir>/delegation) ──
	const delegationRoot = join(agentDir, "delegation", "default");
	const parents = existsSync(delegationRoot) ? readdirSync(delegationRoot) : [];
	const transcripts = parents.flatMap((parent) =>
		readdirSync(join(delegationRoot, parent)).filter((f) => f.endsWith(".jsonl")),
	);
	if (transcripts.length === 0) {
		fail(
			`no child transcript under ${delegationRoot} — the default storage binding did not engage`,
		);
	}

	console.log(
		`smoke-pure-pi-subagents: OK — Agent tool completed under vanilla pi; ${transcripts.length} child transcript(s) in ${delegationRoot}`,
	);
} finally {
	rmSync(agentDir, { recursive: true, force: true });
	rmSync(workDir, { recursive: true, force: true });
}
