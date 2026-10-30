import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type {
	ProjectRun,
	RunExecution,
	RunRecipeDocument,
	RunWorkspaceState,
} from "@thinkrail/contracts";
import { type Static, Type } from "typebox";

export const RUN_PROJECT_TOOL_NAME = "run_project";

const WAIT_DEFAULT_MS = { listening: 60_000, exit: 600_000 } as const;
const WAIT_MAX_SEC = 1800;
const OUTPUT_DEFAULT_CHARS = 16 * 1024;
const OUTPUT_MAX_CHARS = 64 * 1024;
const LIVE = new Set<RunExecution["status"]>(["starting", "running", "listening", "stopping"]);

const RecipeTargetSchema = Type.Object({
	id: Type.String({ description: "Lowercase letters, digits, '.', '_' or '-'." }),
	title: Type.Optional(Type.String()),
	command: Type.String({ description: "POSIX sh, run by /bin/sh." }),
	kind: Type.Union([Type.Literal("serve"), Type.Literal("task")]),
	ports: Type.Optional(
		Type.Array(Type.String(), {
			description: "serve: the declared port variables this target binds.",
		}),
	),
	url: Type.Optional(
		Type.String({ description: `serve: e.g. http://localhost:\${PORT}/ over declared variables.` }),
	),
	cwd: Type.Optional(Type.String({ description: "Worktree-relative; default '.'." })),
});

export const RecipeSchema = Type.Object(
	{
		version: Type.Literal(1),
		ports: Type.Optional(
			Type.Record(Type.String(), Type.Integer(), {
				description: "Env variable name → the project's natural port, e.g. { PORT: 5173 }.",
			}),
		),
		prepare: Type.Optional(
			Type.Array(Type.String(), {
				description: "Idempotent POSIX sh commands run before every start.",
			}),
		),
		targets: Type.Array(RecipeTargetSchema),
		primary: Type.String({ description: "The id of the target the Run button starts." }),
		notes: Type.Optional(Type.String({ description: "Caveats for the user and future agents." })),
	},
	{ description: "The whole recipe document, as an object." },
);

export const RunProjectSchema = Type.Object({
	action: Type.Union(
		[
			Type.Literal("recipe"),
			Type.Literal("set_recipe"),
			Type.Literal("run"),
			Type.Literal("status"),
			Type.Literal("output"),
			Type.Literal("stop"),
		],
		{
			description:
				"recipe: read the recipe and the contract · set_recipe: replace the recipe · run: start a target · status: every target's state · output: a run's output tail · stop: stop a target",
		},
	),
	target: Type.Optional(Type.String({ description: "Target id for run / output / stop." })),
	recipe: Type.Optional(RecipeSchema),
	expectedRevision: Type.Optional(
		Type.Integer({
			description: "set_recipe: the revision you read; defaults to the current one.",
		}),
	),
	prepare: Type.Optional(
		Type.Boolean({ description: "run: false skips the prepare commands (default true)." }),
	),
	wait: Type.Optional(
		Type.Union([Type.Literal("start"), Type.Literal("listening"), Type.Literal("exit")], {
			description:
				"run: return at start (default), when the serve target listens, or when the run exits (one-shot targets).",
		}),
	),
	timeoutSec: Type.Optional(
		Type.Integer({
			minimum: 1,
			maximum: WAIT_MAX_SEC,
			description:
				"run: how long to wait (listening 60 s, exit 600 s by default). The run keeps going on timeout.",
		}),
	),
	runId: Type.Optional(
		Type.String({ description: "output: a specific execution (default: the latest)." }),
	),
	maxBytes: Type.Optional(
		Type.Integer({
			minimum: 256,
			maximum: OUTPUT_MAX_CHARS,
			description: "output / run: tail size.",
		}),
	),
});

export type RunProjectParams = Static<typeof RunProjectSchema>;

const DESCRIPTION =
	"Run this project the way its user does: read or write the project's run recipe (prepare commands, targets, port variables) and start, watch, read or stop a target in this workspace. Runs appear in the user's Run terminal with the workspace's own ports.";

const PROMPT_SNIPPET =
	"Run, verify or set up how this project runs (recipe, targets, ports) in this workspace";

const PROMPT_GUIDELINES = [
	"Use run_project for the project's own targets (dev server, tests, build): it shares the workspace's ports and is visible to the user. Use bash or background_command for anything else.",
	"After changing code that affects whether the project builds or starts, verify with run_project (wait: exit for a one-shot target, listening for a server) before you hand off.",
];

export interface RunToolContext {
	projectId: string;
	workspaceId: string;
	workspaceName: string;
	isDefaultWorkspace: boolean;
	projectPath: string;
	run: ProjectRun;
	platformSupported: boolean;
}

export interface RunToolHost {
	workspaceOf: (sessionId: string) => string | undefined;
	context: (workspaceId: string) => RunToolContext;
	setRecipe: (
		workspaceId: string,
		sessionId: string,
		recipe: unknown,
		expectedRevision: number,
	) => RunRecipeDocument;
	start: (workspaceId: string, targetId: string, prepare: boolean) => Promise<RunExecution>;
	stop: (workspaceId: string, targetId: string) => RunExecution;
	state: (workspaceId: string) => RunWorkspaceState;
	output: (
		workspaceId: string,
		targetId: string,
		runId: string | undefined,
		maxChars: number,
	) => { runId: string; text: string } | null;
}

const unavailableHost: RunToolHost = {
	workspaceOf: () => undefined,
	context: () => {
		throw new Error("Project runs are not available on this host.");
	},
	setRecipe: () => {
		throw new Error("Project runs are not available on this host.");
	},
	start: () => Promise.reject(new Error("Project runs are not available on this host.")),
	stop: () => {
		throw new Error("Project runs are not available on this host.");
	},
	state: () => {
		throw new Error("Project runs are not available on this host.");
	},
	output: () => null,
};

let host: RunToolHost = unavailableHost;

export function setRunToolHost(next: RunToolHost | null): void {
	host = next ?? unavailableHost;
}

const RUN_SECTION = "project-run";

export function runRecipeRule(run: ProjectRun): string | null {
	const recipe = run.document?.recipe;
	if (!recipe) return null;
	const targets = recipe.targets
		.map((target) => (target.id === recipe.primary ? `${target.id} (primary)` : target.id))
		.join(", ");
	return `This project has a run recipe (targets: ${targets}). Use run_project to run a target, read its output, or update the recipe when the way the project runs changes.`;
}

export function recipeContract(context: RunToolContext): string {
	const ports = Object.entries(context.run.ports[context.workspaceId] ?? {})
		.map(([name, port]) => `${name}=${port}`)
		.join(", ");
	return [
		"Recipe contract:",
		"- Commands are POSIX sh, run by /bin/sh in the worktree root with the host's login-shell environment (aliases and shell functions are not available).",
		"- `ports` declares env variable names with the project's natural ports; the host leases a stable port per workspace for each (the Default workspace prefers the natural port) and exports them under those names. Make the project read them (e.g. PORT, API_PORT); never hardcode a port.",
		'- `prepare` commands run before every start and must be idempotent (e.g. `bun install`, `[ -f .env ] || cp "$THINKRAIL_RUN_DEFAULT_WORKTREE/.env" .env`).',
		`- A \`serve\` target is long-running and should declare the \`ports\` it binds and a \`url\` such as \`http://localhost:\${PORT}/\`; a \`task\` target exits (tests, build).`,
		"- The host also exports THINKRAIL_RUN_DEFAULT_WORKTREE (the project folder), THINKRAIL_RUN_WORKSPACE, THINKRAIL_RUN_TARGET and THINKRAIL_RUN_ID.",
		"- Target ids: lowercase letters, digits, '.', '_' or '-'. Keep secrets out of the recipe: read them from env files the prepare step puts in place.",
		`This workspace: ${context.workspaceName}${context.isDefaultWorkspace ? " (Default — the project folder itself)" : ""}; assigned ports: ${ports || "none yet"}.`,
	].join("\n");
}

function json(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

function requireTarget(params: RunProjectParams): string {
	if (!params.target) throw new Error(`run_project ${params.action} needs a target id.`);
	return params.target;
}

function assertMayRun(context: RunToolContext, action: string): void {
	if (!context.platformSupported) {
		throw new Error("RUN_UNSUPPORTED_PLATFORM: project runs are not available on Windows yet.");
	}
	if (!context.run.settings.agentMayRun) {
		throw new Error(
			`RUN_AGENT_FORBIDDEN: the user switched off agent-started runs for this project, so run_project cannot ${action}. Ask the user to run the target and report back.`,
		);
	}
}

function waitTimeoutMs(wait: "listening" | "exit", timeoutSec: number | undefined): number {
	return timeoutSec === undefined
		? WAIT_DEFAULT_MS[wait]
		: Math.min(timeoutSec, WAIT_MAX_SEC) * 1000;
}

function executionOf(workspaceId: string, runId: string): RunExecution | undefined {
	return host.state(workspaceId).executions.find((execution) => execution.runId === runId);
}

async function waitForRun(
	workspaceId: string,
	runId: string,
	wait: "listening" | "exit",
	timeoutMs: number,
	signal: AbortSignal | undefined,
): Promise<{ execution: RunExecution | undefined; timedOut: boolean; aborted: boolean }> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const execution = executionOf(workspaceId, runId);
		if (!execution) return { execution, timedOut: false, aborted: false };
		if (!LIVE.has(execution.status)) return { execution, timedOut: false, aborted: false };
		if (wait === "listening" && execution.status === "listening") {
			return { execution, timedOut: false, aborted: false };
		}
		if (signal?.aborted) return { execution, timedOut: false, aborted: true };
		if (Date.now() >= deadline) return { execution, timedOut: true, aborted: false };
		await new Promise<void>((resolve) => {
			const timer = setTimeout(done, 300);
			function done() {
				clearTimeout(timer);
				signal?.removeEventListener("abort", done);
				resolve();
			}
			signal?.addEventListener("abort", done, { once: true });
		});
	}
}

export async function executeRunProject(
	sessionId: string,
	params: RunProjectParams,
	signal?: AbortSignal,
): Promise<string> {
	const workspaceId = host.workspaceOf(sessionId);
	if (!workspaceId) throw new Error("run_project is only available in a workspace chat.");
	const context = host.context(workspaceId);

	switch (params.action) {
		case "recipe":
			return [
				context.run.document
					? json({
							recipe: context.run.document.recipe,
							revision: context.run.document.revision,
							learnedAt: new Date(context.run.document.learnedAt).toISOString(),
							learnedBy: context.run.document.learnedBy,
						})
					: "No recipe yet (revision 0). Write one with set_recipe.",
				recipeContract(context),
				`Settings: agent may run targets: ${context.run.settings.agentMayRun ? "yes" : "no"}.`,
			].join("\n\n");
		case "set_recipe": {
			if (params.recipe === undefined) throw new Error("set_recipe needs the recipe document.");
			const expected = params.expectedRevision ?? context.run.document?.revision ?? 0;
			const document = host.setRecipe(workspaceId, sessionId, params.recipe, expected);
			return `Recipe saved (revision ${document.revision}): targets ${document.recipe.targets
				.map((target) => target.id)
				.join(", ")}; primary ${document.recipe.primary}.`;
		}
		case "status":
			return json(host.state(workspaceId).executions);
		case "output": {
			const target = requireTarget(params);
			const output = host.output(
				workspaceId,
				target,
				params.runId,
				params.maxBytes ?? OUTPUT_DEFAULT_CHARS,
			);
			if (!output) return `No output for '${target}' yet.`;
			return `Output of '${target}' (run ${output.runId}):\n${output.text}`;
		}
		case "stop": {
			assertMayRun(context, "stop a target");
			const target = requireTarget(params);
			return json(host.stop(workspaceId, target));
		}
		case "run": {
			assertMayRun(context, "start a target");
			const target = requireTarget(params);
			const started = await host.start(workspaceId, target, params.prepare !== false);
			const wait = params.wait ?? "start";
			if (wait === "start") return json(started);
			const recipeTarget = context.run.document?.recipe.targets.find(
				(entry) => entry.id === target,
			);
			if (
				wait === "listening" &&
				(recipeTarget?.kind !== "serve" || (!recipeTarget.url && !recipeTarget.ports?.length))
			) {
				throw new Error(
					`wait: "listening" needs a serve target with a url or declared ports; '${target}' has neither. The run was started.`,
				);
			}
			const result = await waitForRun(
				workspaceId,
				started.runId,
				wait,
				waitTimeoutMs(wait, params.timeoutSec),
				signal,
			);
			const execution = result.execution ?? started;
			const tail = host.output(
				workspaceId,
				target,
				started.runId,
				params.maxBytes ?? OUTPUT_DEFAULT_CHARS,
			);
			const note = result.aborted
				? "The wait was cancelled; the run keeps going."
				: result.timedOut
					? `Timed out waiting for ${wait}; the run keeps going.`
					: wait === "exit"
						? `Exited with code ${execution.exitCode ?? "unknown"}.`
						: execution.status === "listening"
							? `Listening${execution.url ? ` at ${execution.url}` : ""}.`
							: `Ended before listening (${execution.status}, code ${execution.exitCode ?? "unknown"}).`;
			return `${note}\n${json(execution)}\n\nOutput tail:\n${tail?.text ?? ""}`;
		}
	}
}

export function createRunProjectTool(): ToolDefinition<typeof RunProjectSchema, RunProjectParams> {
	return {
		name: RUN_PROJECT_TOOL_NAME,
		label: "Run Project",
		description: DESCRIPTION,
		promptSnippet: PROMPT_SNIPPET,
		promptGuidelines: PROMPT_GUIDELINES,
		parameters: RunProjectSchema,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const input = params as RunProjectParams;
			const text = await executeRunProject(ctx.sessionManager.getSessionId(), input, signal);
			return { content: [{ type: "text", text }], details: { action: input.action } };
		},
	};
}

export function runProjectExtension(pi: ExtensionAPI): void {
	pi.registerTool(createRunProjectTool());
	pi.on("before_agent_start", (event, ctx) => {
		const workspaceId = host.workspaceOf(ctx.sessionManager.getSessionId());
		let rule: string | null = null;
		if (workspaceId) {
			try {
				rule = runRecipeRule(host.context(workspaceId).run);
			} catch {
				rule = null;
			}
		}
		if (rule) event.systemPromptOptions.sections[RUN_SECTION] = rule;
		else delete event.systemPromptOptions.sections[RUN_SECTION];
	});
}
