import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import type { ResourceContextInput } from "pi-delegation";
import { Type } from "typebox";
import { Check } from "typebox/value";
import {
	ControlSchema,
	type DagCallerBinding,
	type DagClient,
	type DagCommandRequest,
	type DagResult,
	type DagService,
	DecisionSchema,
	ReadQuerySchema,
	RequestSchema,
} from "../domain/index.ts";

export interface DagExtensionOptions {
	service: DagService;
	executionContext?: (ctx: ExtensionContext) => ResourceContextInput | undefined;
}

const closed = { additionalProperties: false };
const createProperties = RequestSchema.anyOf[0].properties;
const mutationEnvelope = Type.Omit(RequestSchema.anyOf[1], ["command"]).properties;
const editProperties = RequestSchema.anyOf[1].properties.command.anyOf[0].properties;
const toolNames = new Set(["dag_create", "dag_edit", "dag_control", "dag_decide", "dag_read"]);
const revoked: DagResult<never> = {
	ok: false,
	error: { code: "revoked", message: "DAG conversation binding is no longer current" },
};

function present(result: DagResult<unknown>) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
		details: result,
	};
}

function registryContext(ctx: ExtensionContext): ResourceContextInput {
	return {
		kind: "registry",
		modelRegistry: ctx.modelRegistry,
		cwd: ctx.cwd,
		...(ctx.model ? { model: { provider: ctx.model.provider, id: ctx.model.id } } : {}),
		thinkingLevel: ctx.thinkingLevel,
	};
}

interface Conversation {
	sessionId: string;
	controller: AbortController;
	service: DagService;
	listeners: Set<() => void>;
}

export function installDagAdapter(
	pi: ExtensionAPI,
	serviceFor: (ctx: ExtensionContext) => DagService,
	project: NonNullable<DagExtensionOptions["executionContext"]> = registryContext,
	close?: () => Promise<void>,
): void {
	let conversation: Conversation | undefined;
	const current = (life: Conversation | undefined, ctx: ExtensionContext): life is Conversation =>
		life !== undefined &&
		conversation === life &&
		!life.controller.signal.aborted &&
		ctx.sessionManager.getSessionId() === life.sessionId;
	const revoke = () => {
		conversation?.controller.abort();
		conversation?.listeners.clear();
		conversation = undefined;
	};

	pi.on("session_start", (_event, ctx) => {
		revoke();
		const life: Conversation = {
			sessionId: ctx.sessionManager.getSessionId(),
			controller: new AbortController(),
			service: serviceFor(ctx),
			listeners: new Set(),
		};
		conversation = life;
		life.service.bind({
			caller: { kind: "controller", sessionId: life.sessionId },
			signal: life.controller.signal,
			notices: {
				tryDeliver(notice) {
					if (!current(life, ctx) || !ctx.isIdle()) return "deferred";
					pi.sendMessage(
						{
							customType: "dag-notice",
							content: JSON.stringify(notice, null, 2),
							display: true,
							details: notice,
						},
						{ triggerTurn: false },
					);
					return "submitted";
				},
				onReady(listener) {
					if (current(life, ctx)) life.listeners.add(listener);
					return () => {
						life.listeners.delete(listener);
					};
				},
			},
		});
	});
	pi.on("agent_settled", (_event, ctx) => {
		if (current(conversation, ctx)) for (const listener of conversation.listeners) listener();
	});
	pi.on("session_shutdown", async (event) => {
		revoke();
		if (event.reason === "quit" || event.reason === "reload") await close?.();
	});
	pi.on("tool_result", (event) => {
		const details: unknown = event.details;
		if (
			toolNames.has(event.toolName) &&
			typeof details === "object" &&
			details !== null &&
			"ok" in details &&
			details.ok === false &&
			"error" in details
		)
			return { isError: true };
	});

	async function invoke(
		ctx: ExtensionContext,
		signal: AbortSignal | undefined,
		binding: Omit<DagCallerBinding, "signal">,
		run: (client: DagClient) => Promise<DagResult<unknown>>,
	): Promise<DagResult<unknown>> {
		const life = conversation;
		if (!current(life, ctx)) return revoked;
		const release = new AbortController();
		const combined = AbortSignal.any([
			life.controller.signal,
			release.signal,
			...(signal ? [signal] : []),
		]);
		try {
			return await run(life.service.bind({ ...binding, signal: combined }));
		} finally {
			release.abort();
		}
	}

	function execute(
		toolCallId: string,
		request: DagCommandRequest,
		signal: AbortSignal | undefined,
		ctx: ExtensionContext,
	) {
		if (!current(conversation, ctx)) return Promise.resolve(present(revoked));
		const sessionId = ctx.sessionManager.getSessionId();
		const execution = project(ctx);
		return invoke(
			ctx,
			signal,
			{
				caller: { kind: "controller", sessionId },
				...(execution ? { execution } : {}),
				mainHistory: {
					kind: "session",
					sessionId,
					sessionManager: ctx.sessionManager,
					cut: { kind: "before-tool-call", toolCallId },
				},
			},
			(client) => client.execute(request),
		).then(present);
	}

	pi.registerTool({
		name: "dag_create",
		label: "Create DAG",
		description:
			"Create a paused durable DAG. Preserve commandId for exact replay; ACK is not worker completion.",
		parameters: Type.Object(
			{
				commandId: createProperties.commandId,
				definition: createProperties.command.properties.definition,
			},
			closed,
		),
		execute: (id, { commandId, definition }, signal, _update, ctx) =>
			execute(id, { commandId, command: { kind: "create", definition } }, signal, ctx),
	});
	pi.registerTool({
		name: "dag_edit",
		label: "Edit DAG",
		description:
			"Apply atomic DAG edits at the explicit expectedVersion. Reuse commandId only for identical replay.",
		parameters: Type.Object({ ...mutationEnvelope, edits: editProperties.edits }, closed),
		execute: (id, { edits, ...envelope }, signal, _update, ctx) =>
			execute(id, { ...envelope, command: { kind: "edit", edits } }, signal, ctx),
	});
	pi.registerTool({
		name: "dag_control",
		label: "Control DAG",
		description:
			"Control a durable DAG as this controller, using the explicit commandId and expectedVersion. ACK records intent, not completion.",
		parameters: Type.Object({ ...mutationEnvelope, command: ControlSchema }, closed),
		execute: (id, request, signal, _update, ctx) => execute(id, request, signal, ctx),
	});
	pi.registerTool({
		name: "dag_decide",
		label: "Decide DAG",
		description:
			"Record a controller decision at expectedVersion. Human-only gates require a confirmed human operator, never this tool.",
		parameters: Type.Object({ ...mutationEnvelope, command: DecisionSchema }, closed),
		execute: (id, request, signal, _update, ctx) => execute(id, request, signal, ctx),
	});
	pi.registerTool({
		name: "dag_read",
		label: "Read DAG",
		description:
			"Read DAG lists, complete current topology/gates, immutable outputs or paged history without starting workers. Bulk bodies have readable captured-file references.",
		parameters: Type.Object({ query: ReadQuerySchema }, closed),
		async execute(_id, { query }, signal, _update, ctx) {
			if (!current(conversation, ctx)) return present(revoked);
			return present(
				await invoke(
					ctx,
					signal,
					{ caller: { kind: "controller", sessionId: ctx.sessionManager.getSessionId() } },
					(client) => {
						switch (query.kind) {
							case "list": {
								const { kind: _kind, ...request } = query;
								return client.listDags(request);
							}
							case "get":
								return client.getDag({ dagId: query.dagId });
							case "output":
								return client.getOutput({
									dagId: query.dagId,
									proposalId: query.proposalId,
									name: query.name,
								});
							case "history": {
								const { kind: _kind, ...request } = query;
								return client.listHistory(request);
							}
						}
					},
				),
			);
		},
	});

	pi.registerCommand("dag", {
		description: "Confirm a human DAG command: /dag <JSON command request>",
		async handler(args, ctx) {
			const life = conversation;
			if (!current(life, ctx) || !ctx.hasUI) return;
			let request: unknown;
			try {
				request = JSON.parse(args);
			} catch {
				ctx.ui.notify("Expected /dag <JSON command request>", "error");
				return;
			}
			if (!Check(RequestSchema, request)) {
				ctx.ui.notify("Invalid DAG command request", "error");
				return;
			}
			const confirmed = await ctx.ui.confirm(
				"Execute DAG command as human operator?",
				JSON.stringify(request, null, 2),
				{ signal: life.controller.signal },
			);
			if (!current(life, ctx) || !confirmed) return;
			const execution = project(ctx);
			const result = await invoke(
				ctx,
				undefined,
				{
					caller: {
						kind: "human",
						operatorId: `pi:${life.sessionId}`,
						conversationId: life.sessionId,
					},
					...(execution ? { execution } : {}),
					mainHistory: {
						kind: "session",
						sessionId: life.sessionId,
						sessionManager: ctx.sessionManager,
						cut: { kind: "at-entry", entryId: ctx.sessionManager.getLeafId() },
					},
				},
				(client) => client.execute(request),
			);
			if (current(life, ctx))
				pi.sendMessage(
					{
						customType: "dag-command",
						content: JSON.stringify(result, null, 2),
						display: true,
						details: result,
					},
					{ triggerTurn: false },
				);
		},
	});
}

export function createDagExtension(options: DagExtensionOptions): ExtensionFactory {
	return (pi) => installDagAdapter(pi, () => options.service, options.executionContext);
}
