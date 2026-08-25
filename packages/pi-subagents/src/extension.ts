// The subagents extension — the LLM-facing capability side (task-spec: tools joined to renderers by
// name). Registers `Agent` (spawn; Claude Code naming, decision 2) and `get_subagent_result`
// (collect detached results) over a `DelegationService`. The tool layer contains ZERO private
// child-assembly code (the core's acceptance criterion): it discovers a definition, maps it to
// `SessionOptions`, and hands the core the spawn.

import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	createDelegationService,
	DEFAULT_SCOPE,
	type DelegationService,
	defaultDelegationRoot,
	deriveChildSessionFile,
	type RunOutcome,
} from "pi-delegation";
import { Type } from "typebox";
import { type AgentDefinition, discoverAgentDefinitions } from "./definitions";
import { toSpawnMapping } from "./mapping";

/** The custom message type carrying a detached run's completion back into the parent turn. */
export const SUBAGENT_COMPLETION_MESSAGE = "subagent-completion";

/** Keep a child's report bounded in the parent context (full text stays in the child transcript). */
const MAX_RESULT_CHARS = 50_000;

export interface SubagentsExtensionOptions {
	/** The embedder-bound service (ThinkRail). Absent = pure pi: built lazily with default bindings. */
	service?: DelegationService;
	/** Mirrors the service's storage bindings — used for transcript paths in restart-loss errors. */
	delegationRoot?: string;
	scope?: string;
}

function discoverFor(ctx: ExtensionContext): AgentDefinition[] {
	return discoverAgentDefinitions({
		cwd: ctx.cwd,
		agentDir: getAgentDir(),
		includeProject: ctx.isProjectTrusted(),
	});
}

function agentListLines(definitions: AgentDefinition[]): string {
	return definitions.map((d) => `- "${d.name}" (${d.source}): ${d.description}`).join("\n");
}

function boundedText(outcome: RunOutcome): string {
	// An error's REASON leads; any partial text follows (a truncated report must not mask the failure).
	const text =
		outcome.status === "error"
			? `${outcome.errorMessage ?? "unknown error"}${outcome.finalText ? `\n\n${outcome.finalText}` : ""}`
			: (outcome.finalText ??
				(outcome.status === "completed" ? "(no output)" : `Run ${outcome.status}.`));
	return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n[truncated]` : text;
}

export function createSubagentsExtension(
	options: SubagentsExtensionOptions = {},
): ExtensionFactory {
	return (pi: ExtensionAPI) => {
		const delegationRoot = options.delegationRoot ?? defaultDelegationRoot();
		const scope = options.scope ?? DEFAULT_SCOPE;

		// Pure-pi default service: the parent projection is the LATEST tool ctx — read at spawn time
		// so the child inherits the parent's CURRENT model/thinking (pi never hands extensions the
		// raw AgentSession; ExtensionContext structurally satisfies ParentContext).
		let latestCtx: ExtensionContext | undefined;
		let fallbackService: DelegationService | undefined;
		function serviceFor(ctx: ExtensionContext): DelegationService {
			latestCtx = ctx;
			if (options.service) return options.service;
			fallbackService ??= createDelegationService({
				resolveParent: (sessionId) =>
					latestCtx && sessionId === latestCtx.sessionManager.getSessionId()
						? latestCtx
						: undefined,
				delegationRoot,
				scope,
			});
			return fallbackService;
		}

		pi.on("session_start", (_event, sessionCtx) => {
			const known = agentListLines(discoverFor(sessionCtx));

			pi.registerTool({
				name: "Agent",
				label: "Agent",
				description: `Delegate a task to a specialized subagent with its own isolated context window.
The subagent works autonomously and non-interactively: give it one complete, self-contained task
(everything it must know goes in the task text) and it returns a final report. Issue several Agent
calls in ONE message to run subagents in parallel; sequence dependent steps yourself across turns.
Set run_in_background for long tasks — you get the session id immediately, a completion message
arrives when it finishes, and get_subagent_result fetches the result on demand.

Available subagent types:
${known}`,
				parameters: Type.Object({
					subagent_type: Type.String({
						description: 'The agent definition to run, e.g. "scout"',
					}),
					task: Type.String({
						description: "The complete, self-contained task for the subagent",
					}),
					run_in_background: Type.Optional(
						Type.Boolean({
							description: "Do not wait: return the child session id immediately",
						}),
					),
				}),
				async execute(_toolCallId, params, signal, onUpdate, ctx) {
					const definitions = discoverFor(ctx);
					const definition = definitions.find((d) => d.name === params.subagent_type);
					if (!definition) {
						throw new Error(
							`Unknown subagent type "${params.subagent_type}". Available:\n${agentListLines(definitions)}`,
						);
					}
					const service = serviceFor(ctx);
					const mapping = toSpawnMapping(definition, {
						cwd: ctx.cwd,
						availableModels: ctx.modelRegistry.getAvailable(),
					});
					const child = await service.createChild({
						parent: ctx.sessionManager.getSessionId(),
						visibility: "hidden",
						info: {
							createdBy: "tool:Agent",
							roleName: definition.name,
							roleSource: definition.source,
						},
						session: mapping.session,
					});

					const run = child.runQueued(params.task, {
						...(mapping.maxTurns !== undefined ? { maxTurns: mapping.maxTurns } : {}),
						// The tool signal is the parent turn's abort — only AWAITED runs ride it; a detached
						// run must survive a parent-turn abort (core spec: Waiting & control → Abort).
						...(!params.run_in_background && signal !== undefined ? { signal } : {}),
						onUpdate: (details) => {
							onUpdate?.({ content: [{ type: "text", text: details.status }], details });
						},
					});

					if (params.run_in_background) {
						run
							.then((outcome) => {
								pi.sendMessage(
									{
										customType: SUBAGENT_COMPLETION_MESSAGE,
										content: `Subagent "${definition.name}" (${child.sessionId}) ${outcome.status}:\n\n${boundedText(outcome)}`,
										display: true,
										details: outcome.details,
									},
									{ deliverAs: "followUp", triggerTurn: true },
								);
							})
							.catch(() => {
								// Contract-misuse rejections cannot happen here (fresh child, first run);
								// run failures arrive as outcome VALUES and are delivered above.
							});
						// runQueued marks the run queued synchronously — the snapshot exists by construction.
						const details = child.snapshot?.details;
						if (details === undefined) {
							throw new Error("pi-delegation invariant violated: no run snapshot after runQueued");
						}
						return {
							content: [
								{
									type: "text",
									text: `Started background subagent "${definition.name}" (session ${child.sessionId}). A completion message will arrive when it finishes; use get_subagent_result to collect it on demand.`,
								},
							],
							details,
						};
					}

					const outcome = await run;
					if (outcome.status === "error") {
						throw new Error(
							`Subagent "${definition.name}" (${child.sessionId}) failed: ${boundedText(outcome)}`,
						);
					}
					return {
						content: [{ type: "text", text: boundedText(outcome) }],
						details: outcome.details,
					};
				},
			});

			pi.registerTool({
				name: "get_subagent_result",
				label: "Get subagent result",
				description:
					"Collect the result or current status of a subagent started with Agent (typically one started with run_in_background).",
				parameters: Type.Object({
					session_id: Type.String({ description: "The child session id returned by Agent" }),
				}),
				async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
					const service = serviceFor(ctx);
					const child = service.findChild(params.session_id);
					if (!child) {
						const transcript = deriveChildSessionFile(
							delegationRoot,
							scope,
							ctx.sessionManager.getSessionId(),
							params.session_id,
						);
						throw new Error(
							`Unknown subagent session ${params.session_id}. If the host restarted, the in-memory run registry was lost${
								transcript
									? `; the transcript survives at ${transcript}`
									: " and no transcript was found for it under this session"
							}.`,
						);
					}
					const snapshot = child.collectResult();
					if (!snapshot) {
						return {
							content: [{ type: "text", text: "The subagent has not been given a task yet." }],
							details: {},
						};
					}
					const terminal =
						snapshot.status === "completed" ||
						snapshot.status === "error" ||
						snapshot.status === "aborted";
					const text = !terminal
						? `Still ${snapshot.status}. Ask again later or continue with other work.`
						: snapshot.status === "error"
							? `Run error: ${snapshot.errorMessage ?? "unknown error"}${snapshot.finalText ? `\n\n${snapshot.finalText}` : ""}`
							: (snapshot.finalText ?? `Run ${snapshot.status}.`);
					return {
						content: [{ type: "text", text }],
						details: snapshot.details,
					};
				},
			});
		});
	};
}
