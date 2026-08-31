import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	createDelegationService,
	DEFAULT_SCOPE,
	type DelegationRunDetails,
	type DelegationService,
	defaultDelegationRoot,
	deriveChildSessionFile,
	type RunStatus,
} from "pi-delegation";
import { Type } from "typebox";
import { type AgentDefinition, discoverAgentDefinitions } from "./definitions";
import { toSpawnMapping } from "./mapping";

export const SUBAGENT_COMPLETION_MESSAGE = "subagent-completion";

const MAX_RESULT_CHARS = 50_000;

export interface SubagentsExtensionOptions {
	service?: DelegationService;
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
	return definitions
		.map(
			(d) =>
				`- "${d.name}" (${d.source}): ${d.description} [tools: ${d.tools?.join(", ") ?? "pi defaults: read, bash, edit, write"}]`,
		)
		.join("\n");
}

export function boundedText(run: {
	status: RunStatus;
	finalText?: string | undefined;
	errorMessage?: string | undefined;
}): string {
	const text =
		run.status === "error"
			? `${run.errorMessage ?? "unknown error"}${run.finalText ? `\n\n${run.finalText}` : ""}`
			: (run.finalText ?? (run.status === "completed" ? "(no output)" : `Run ${run.status}.`));
	return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n[truncated]` : text;
}

export function createSubagentsExtension(
	options: SubagentsExtensionOptions = {},
): ExtensionFactory {
	return (pi: ExtensionAPI) => {
		const delegationRoot = options.delegationRoot ?? defaultDelegationRoot();
		const scope = options.scope ?? DEFAULT_SCOPE;

		let shuttingDown = false;
		const erroredRunDetails = new Map<string, DelegationRunDetails>();
		pi.on("tool_result", (event) => {
			const details = erroredRunDetails.get(event.toolCallId);
			if (details === undefined) return undefined;
			erroredRunDetails.delete(event.toolCallId);
			return event.isError ? { details } : undefined;
		});
		pi.on("turn_end", () => {
			erroredRunDetails.clear();
		});
		pi.on("session_shutdown", async (_event, ctx) => {
			shuttingDown = true;
			erroredRunDetails.clear();
			const service = fallbackService;
			if (!service) return;
			fallbackService = undefined;
			await service.disposeChildrenOf(ctx.sessionManager.getSessionId());
		});

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
				async execute(toolCallId, params, signal, onUpdate, ctx) {
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
						...(!params.run_in_background && signal !== undefined ? { signal } : {}),
						onUpdate: (details) => {
							onUpdate?.({ content: [{ type: "text", text: details.status }], details });
						},
					});

					if (params.run_in_background) {
						run
							.then((outcome) => {
								if (shuttingDown) return;
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
							.catch(() => {});
						const details = child.snapshot?.details;
						if (details === undefined) {
							throw new Error("pi-delegation invariant violated: no run snapshot after runQueued");
						}
						return {
							content: [
								{
									type: "text",
									text: `Started "${definition.name}" in the background: ${child.sessionId}`,
								},
							],
							details,
						};
					}

					const outcome = await run;
					if (outcome.status === "error") {
						erroredRunDetails.set(toolCallId, outcome.details);
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
					const found = service.findChild(params.session_id);
					const child =
						found?.record.parentSessionId === ctx.sessionManager.getSessionId() ? found : undefined;
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
					const status = snapshot.status;
					if (status === "queued" || status === "running") {
						return {
							content: [
								{
									type: "text",
									text: `Still ${status}. Ask again later or continue with other work.`,
								},
							],
							details: snapshot.details,
						};
					}
					const report = boundedText({
						status,
						finalText: snapshot.finalText,
						errorMessage: snapshot.errorMessage,
					});
					return {
						content: [{ type: "text", text: status === "error" ? `Run error: ${report}` : report }],
						details: snapshot.details,
					};
				},
			});
		});
	};
}
