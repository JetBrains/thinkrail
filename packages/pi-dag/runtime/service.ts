import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type * as Core from "pi-delegation";
import { DelegationError } from "pi-delegation";
import { Check } from "typebox/value";
import * as D from "../domain";
import { createDagStore, type DagLease, type DagStore } from "../persistence";
import { hash, page, recover, relevantNotice, snapshot } from "./reads";
import { type Submission, WORKER_TOOLS, type WorkerReceipt, workerExtension } from "./worker";

type Command =
	| Exclude<D.DagCommandRequest["command"], { kind: "create" | "edit" }>
	| ({ kind: "edit" } & ReturnType<typeof D.prepareEdit>);
interface Job {
	target: D.ActivationRef;
	controller: AbortController;
	child?: Core.ResourceChildHandle;
	promise?: Promise<void>;
	runningObserved: boolean;
}
interface Owned {
	state: D.DagState;
	lease: DagLease;
	resource?: Core.ResourceDelegation;
	jobs: Map<string, Job>;
	children: Map<string, Core.ResourceChildHandle>;
	effects: Set<Promise<void>>;
	fault?: D.DagError;
	scheduled: boolean;
}
interface Binding {
	value: D.DagCallerBinding;
	key: string;
	detach?: () => void;
	delivered: Set<string>;
}
export interface DagServiceOptions {
	storageRoot: string;
	scope: string;
	delegation: Core.DelegationService;
}
const uid = (prefix: string) => `${prefix}-${randomUUID()}`;
const text = (bytes: Uint8Array) => new TextDecoder("utf8", { fatal: true }).decode(bytes);
const sameTarget = (a: D.ActivationRef, b: D.ActivationRef) =>
	a.nodeId === b.nodeId && a.attempt === b.attempt && a.activation === b.activation;
const targetOf = (node: D.NodeRecord): D.ActivationRef => {
	const current = D.latest(node);
	if (!current) return D.fail("stale-target", "Node has no current attempt");
	return {
		nodeId: node.id,
		attempt: current.attempt.number,
		activation: current.activation.number,
	};
};
function failure(error: unknown): D.DagError {
	if (error instanceof D.DagError) return error;
	if (error instanceof DelegationError)
		return new D.DagError({
			code:
				error.code.includes("history") || error.code.includes("transcript")
					? "history-unavailable"
					: "model-unavailable",
			message: error.message,
		});
	return new D.DagError({
		code: "storage-error",
		message: error instanceof Error ? error.message : String(error),
	});
}

class Engine implements D.DagService {
	private readonly store: DagStore;
	private readonly owners = new Map<string, Owned>();
	private readonly queues = new Map<string, Promise<void>>();
	private readonly bindings = new Set<Binding>();
	private closed = false;
	private closing?: Promise<void>;

	constructor(private readonly options: DagServiceOptions) {
		this.store = createDagStore(options);
	}

	bind(value: D.DagCallerBinding): D.DagClient {
		const caller = structuredClone(value.caller);
		const key =
			caller.kind === "controller"
				? `session:${caller.sessionId}`
				: caller.kind === "human"
					? `human:${caller.conversationId ?? caller.operatorId}`
					: `owner:${caller.ownerId}`;
		const binding: Binding = { value: { ...value, caller }, key, delivered: new Set() };
		if (value.notices && !value.signal.aborted && !this.closed)
			this.attachNoticeSink({
				value: { caller, signal: value.signal, notices: value.notices },
				key,
				delivered: new Set(),
			});
		return {
			execute: (request) => this.result(binding, () => this.execute(binding, request)),
			getDag: (request) =>
				this.result(binding, async () => {
					this.id(request.dagId);
					const state = await this.read(request.dagId);
					const owner = this.owners.has(request.dagId)
						? "local"
						: (await this.store.ownerStatus(request.dagId)) === "held"
							? "other"
							: "none";
					if (owner === "none") recover(state);
					return snapshot(this.store, state, owner);
				}),
			listDags: (request = {}) =>
				this.result(binding, async () => {
					const items = await this.store.list();
					for (const item of items)
						if (
							!this.owners.has(item.dagId) &&
							(await this.store.ownerStatus(item.dagId)) === "inactive"
						)
							item.mode = "paused";
					return page(items, request, `list:${this.options.scope}`, hash(D.canonicalJson(items)));
				}),
			getOutput: (request) =>
				this.result(binding, async () => {
					this.id(request.dagId);
					this.id(request.proposalId);
					this.id(request.name);
					const state = await this.read(request.dagId);
					const proposal = state.proposals[request.proposalId];
					const value = proposal?.outputs[request.name];
					if (!proposal || !value) return D.fail("not-found", "Unknown output");
					return {
						proposalId: proposal.id,
						target: proposal.target,
						name: request.name,
						value: { ...value, file: this.store.reference(state.dagId, value.file) },
						disposition: proposal.disposition,
						...(proposal.acceptance ? { acceptance: proposal.acceptance } : {}),
					};
				}),
			listHistory: (request) =>
				this.result(binding, async () => {
					this.id(request.dagId);
					const state = await this.read(request.dagId);
					const { dagId, ...paging } = request;
					const selected = page(
						state.history,
						paging,
						`history:${this.options.scope}:${dagId}`,
						state.version,
					);
					return {
						...selected,
						items: selected.items.map((item) => ({
							...item,
							content: this.store.reference(dagId, item.content),
							files: item.files.map((file) => this.store.reference(dagId, file)),
						})),
					};
				}),
		};
	}
	private attachNoticeSink(observer: Binding): void {
		const sink = observer.value.notices;
		if (!sink) return;
		this.bindings.add(observer);
		const ready = sink.onReady(() => this.refreshNotices(observer));
		const detach = () => {
			this.bindings.delete(observer);
			ready();
			observer.value.signal.removeEventListener("abort", detach);
		};
		observer.detach = detach;
		observer.value.signal.addEventListener("abort", detach, { once: true });
		if (observer.value.signal.aborted) detach();
		else this.refreshNotices(observer);
	}
	private id(id: string): void {
		if (!Check(D.IdSchema, id)) D.fail("invalid-command", "Invalid identity");
	}
	private guard(binding: Binding): void {
		if (this.closed) D.fail("closed", "DAG service is closing");
		if (binding.value.signal.aborted) D.fail("revoked", "Caller binding was revoked");
	}
	private async result<T>(binding: Binding, operation: () => Promise<T>): Promise<D.DagResult<T>> {
		try {
			this.guard(binding);
			const value = await operation();
			return { ok: true, value };
		} catch (error) {
			return { ok: false, error: failure(error).failure };
		}
	}
	private serial<T>(id: string, operation: () => Promise<T>): Promise<T> {
		const current = (this.queues.get(id) ?? Promise.resolve()).then(operation, operation);
		const tail = current.then(
			() => {},
			() => {},
		);
		this.queues.set(id, tail);
		void tail.then(() => {
			if (this.queues.get(id) === tail) this.queues.delete(id);
		});
		return current;
	}
	private async read(id: string): Promise<D.DagState> {
		const owned = this.owners.get(id);
		if (owned?.fault) throw owned.fault;
		const state = owned ? structuredClone(owned.state) : await this.store.read(id);
		return state ?? D.fail("not-found", "Unknown DAG");
	}
	private async event(
		state: D.DagState,
		kind: string,
		content: unknown,
		actor?: D.DagCaller,
		target?: D.ActivationRef,
		files: D.StoredFile[] = [],
	): Promise<void> {
		state.history.push({
			id: uid("event"),
			version: state.version,
			at: state.updatedAt,
			kind,
			content: await this.store.put(state.dagId, D.canonicalJson(content)),
			files: [...new Map(files.map((file) => [file.artifactId, file])).values()],
			...(actor ? { actor: structuredClone(actor) } : {}),
			...(target ? { target: { ...target } } : {}),
		});
	}
	private notice(
		state: D.DagState,
		kind: D.DagNotice["kind"],
		message: string,
		source: Pick<D.DagNotice, "target" | "gateId" | "proposalId"> = {},
	): void {
		state.notices.push({
			dagId: state.dagId,
			noticeId: uid("notice"),
			version: state.version,
			kind,
			text: message.slice(0, D.LIMITS.preview),
			...structuredClone(source),
		});
	}
	private next(owned: Owned): D.DagState {
		if (owned.fault) throw owned.fault;
		const state = structuredClone(owned.state);
		state.version++;
		state.updatedAt = new Date().toISOString();
		return state;
	}
	private async save(owned: Owned, state: D.DagState, beforePublish?: () => void): Promise<void> {
		try {
			await owned.lease.save(state, owned.state.version, beforePublish);
		} catch (error) {
			if (!(error instanceof D.DagError && ["revoked", "closed"].includes(error.failure.code)))
				this.halt(owned, error);
			throw error;
		}
		owned.state = state;
		this.flushNotices();
	}
	private halt(owned: Owned, error: unknown): void {
		owned.fault = failure(error);
		for (const job of owned.jobs.values()) job.controller.abort();
		console.error(
			JSON.stringify({
				module: "pi-dag",
				event: "execution-held",
				dagId: owned.state.dagId,
				code: owned.fault.failure.code,
			}),
		);
	}
	private deliverNotices(binding: Binding, saved: D.DagState): void {
		for (const notice of saved.notices) {
			const state = this.owners.get(saved.dagId)?.state ?? saved;
			if (
				this.closed ||
				binding.value.signal.aborted ||
				!binding.value.notices ||
				!state.attachments.includes(binding.key)
			)
				break;
			if (binding.delivered.has(notice.noticeId) || !relevantNotice(state, notice)) continue;
			try {
				if (binding.value.notices.tryDeliver(structuredClone(notice)) === "deferred") break;
				binding.delivered.add(notice.noticeId);
			} catch {
				break;
			}
		}
	}
	private flushNotices(): void {
		for (const binding of this.bindings)
			for (const owned of this.owners.values()) this.deliverNotices(binding, owned.state);
	}
	private refreshNotices(binding: Binding): void {
		this.flushNotices();
		void (async () => {
			for (const item of await this.store.list()) {
				if (this.closed || binding.value.signal.aborted) return;
				const state = this.owners.get(item.dagId)?.state ?? (await this.store.read(item.dagId));
				if (state) this.deliverNotices(binding, state);
			}
		})().catch((error) => {
			if (!this.closed && !binding.value.signal.aborted)
				console.error(
					JSON.stringify({
						module: "pi-dag",
						event: "notice-read-failed",
						code: failure(error).failure.code,
					}),
				);
		});
	}
	private async own(id: string): Promise<Owned> {
		const existing = this.owners.get(id);
		if (existing) return existing;
		const lease = await this.store.claim(id);
		let state: D.DagState;
		try {
			state =
				(await this.store.read(id)) ?? D.fail("not-found", "DAG disappeared before acquisition");
		} catch (error) {
			await lease.release();
			throw error;
		}
		const owned: Owned = {
			state,
			lease,
			jobs: new Map(),
			children: new Map(),
			effects: new Set(),
			scheduled: false,
		};
		this.owners.set(id, owned);
		const recovered = this.next(owned);
		if (recover(recovered)) {
			await this.event(recovered, "recovered", {
				message: "Reacquired paused; unresolved invocations require reconciliation",
			});
			this.notice(
				recovered,
				"recovery",
				"DAG recovered paused. Reconcile uncertain work before continuing or retrying.",
			);
			await this.save(owned, recovered);
		}
		return owned;
	}
	private session(state: D.DagState, spec: D.DagNodeSpec): D.DagSessionOptions {
		const session = { ...state.definitionValue.defaults, ...spec.session };
		const tools = [...new Set([...session.tools, ...WORKER_TOOLS])];
		if (tools.length > 64)
			D.fail("limit-exceeded", "The 64-tool limit includes mandatory DAG protocol tools");
		return { ...session, tools };
	}
	private async resource(owned: Owned, binding: Binding): Promise<Core.ResourceDelegation> {
		if (owned.resource) return owned.resource;
		const execution = binding.value.execution;
		if (!execution)
			return D.fail("context-required", "An explicit host execution context is required");
		const state = owned.state;
		const context = {
			...execution,
			cwd: state.profile.cwd,
			...(state.definitionValue.defaults.model
				? { model: state.definitionValue.defaults.model }
				: {}),
			...(state.definitionValue.defaults.thinkingLevel
				? { thinkingLevel: state.definitionValue.defaults.thinkingLevel }
				: {}),
		};
		const resource = await this.options.delegation.registerResource(state.dagId, context, {
			maxConcurrent: state.definitionValue.maxConcurrent ?? 4,
			childExtensionFactories: [
				workerExtension({
					submit: (sessionId, callId, args, signal) =>
						this.protocol(
							owned,
							sessionId,
							callId,
							{ kind: "proposal", outputs: args.outputs },
							signal,
						),
					input: (sessionId, callId, question, signal) =>
						this.protocol(owned, sessionId, callId, { kind: "input", question }, signal),
				}),
			],
		});
		owned.resource = resource;
		return resource;
	}
	private async models(
		owned: Owned,
		binding: Binding,
		definition = owned.state.definitionValue,
	): Promise<void> {
		const resource = await this.resource(owned, binding);
		const models = definition.nodes.map(
			(node) =>
				this.session(owned.state, node).model ??
				D.fail("model-unavailable", `No frozen model for ${node.id}`),
		);
		await resource.validateModels(models);
	}
	private async capture(state: D.DagState, source: Core.HistoryCaptureSource): Promise<string> {
		const history = await this.options.delegation.captureHistory(source);
		const file = await this.store.put(state.dagId, history.jsonl, D.LIMITS.historyBytes);
		const { jsonl: _jsonl, ...metadata } = history;
		state.captures[history.sha256] = { ...metadata, file };
		await this.event(state, "history-captured", metadata, undefined, undefined, [file]);
		return history.sha256;
	}
	private async mainSeed(state: D.DagState, binding: Binding): Promise<void> {
		if (
			state.mainHistoryId ||
			!state.definitionValue.connections.some((connection) => D.endpoints(connection).from === null)
		)
			return;
		const source = binding.value.mainHistory;
		if (!source)
			return D.fail("history-unavailable", "A trusted main history boundary is required");
		if (
			binding.value.caller.kind === "controller" &&
			source.sessionId !== binding.value.caller.sessionId
		)
			D.fail("forbidden", "Main history must belong to the bound controller");
		state.mainHistoryId = await this.capture(state, source);
	}
	private authorize(
		state: D.DagState,
		command: Command,
		actor: D.DagCaller,
	): D.GateAuthority | undefined {
		if (command.kind === "approve" || command.kind === "reject" || command.kind === "answer") {
			const gate = state.gates[command.gateId];
			if (!gate) D.fail("not-found", "Unknown gate");
			D.authorizeGate(actor, gate.authority);
			return gate.authority;
		}
		if (command.kind === "edit") return command.authority;
		if (command.kind === "skip") {
			const policy = state.definitionValue.nodes.find(
				(node) => node.id === command.nodeId,
			)?.approval;
			const authorities = D.unresolvedGates(state)
				.filter((gate) => gate.target.nodeId === command.nodeId)
				.map((gate) => gate.authority);
			if (policy) authorities.push(policy.authority);
			const authority = authorities.includes("human") ? "human" : authorities[0];
			if (authority) D.authorizeGate(actor, authority);
			return authority;
		}
		return undefined;
	}
	private async execute(binding: Binding, input: D.DagCommandRequest): Promise<D.DagReceipt> {
		const encoded = D.canonicalJson(input);
		if (!Check(D.RequestSchema, input)) return D.fail("invalid-command", "Invalid DAG command");
		const request: D.DagCommandRequest = JSON.parse(encoded);
		const fingerprint = hash(encoded);
		const id =
			"dagId" in request
				? request.dagId
				: `dag-${hash(`${this.options.scope}\0${request.commandId}`)}`;
		return this.serial(id, async () => {
			this.guard(binding);
			const stored = await this.store.read(id);
			const prior = stored?.receipts[request.commandId];
			if (prior) {
				if (prior.authority) D.authorizeGate(binding.value.caller, prior.authority);
				if (prior.fingerprint !== fingerprint)
					return D.fail("id-reused", "Command id was already accepted with another payload");
				return structuredClone(prior.receipt);
			}
			if (!("dagId" in request)) return this.create(binding, id, request, fingerprint);
			if (!stored) return D.fail("not-found", "Unknown DAG");
			if (stored.lifecycle !== "active" && request.command.kind !== "dispose")
				return D.fail("closed", "DAG has been disposed");
			const prepared: Command =
				request.command.kind === "edit"
					? { kind: "edit", ...D.prepareEdit(stored, request.command.edits, binding.value.caller) }
					: request.command;
			const authority = this.authorize(stored, prepared, binding.value.caller);
			const owned = await this.own(id);
			if (stored.version !== owned.state.version || request.expectedVersion !== owned.state.version)
				throw new D.DagError({
					code: "stale-version",
					message: "Read the current DAG version before issuing a changed command",
					currentVersion: owned.state.version,
				});
			const state = this.next(owned);
			const effects: Array<() => Promise<void>> = [];
			await this.command(owned, state, binding, request.commandId, prepared, effects);
			this.guard(binding);
			const receipt = {
				commandId: request.commandId,
				dagId: id,
				version: state.version,
				graphRevision: state.graphRevision,
			};
			state.receipts[request.commandId] = {
				fingerprint,
				receipt,
				...(authority ? { authority } : {}),
			};
			const command = request.command;
			const answer = command.kind === "answer" ? state.gates[command.gateId]?.answer : undefined;
			const continuation =
				command.kind === "continue"
					? state.nodes[command.target.nodeId]?.continuation?.payload
					: undefined;
			const steering = command.kind === "steer" ? state.interventions.at(-1)?.text : undefined;
			await this.event(
				state,
				command.kind,
				answer && command.kind === "answer"
					? { kind: command.kind, gateId: command.gateId, answer }
					: command,
				binding.value.caller,
				undefined,
				[
					command.kind === "edit" ? state.definitionFile : undefined,
					answer,
					continuation,
					steering,
				].filter((file) => file !== undefined),
			);
			this.guard(binding);
			await this.save(owned, state, () => this.guard(binding));
			for (const effect of effects) {
				const pending = effect().catch((error) => this.halt(owned, error));
				owned.effects.add(pending);
				void pending.then(() => owned.effects.delete(pending));
			}
			this.kick(owned);
			return structuredClone(receipt);
		});
	}
	private async create(
		binding: Binding,
		id: string,
		request: Extract<D.DagCommandRequest, { command: { kind: "create" } }>,
		fingerprint: string,
	): Promise<D.DagReceipt> {
		D.validateDefinition(request.command.definition);
		const execution = binding.value.execution;
		if (!execution)
			return D.fail(
				"context-required",
				"Creating a DAG requires explicit execution context, even while paused",
			);
		const definition = structuredClone(request.command.definition);
		definition.defaults = {
			...definition.defaults,
			...(definition.defaults.model
				? {}
				: execution.model
					? { model: structuredClone(execution.model) }
					: {}),
			thinkingLevel: definition.defaults.thinkingLevel ?? execution.thinkingLevel ?? "off",
		};
		const lease = await this.store.claim(id);
		let owned: Owned | undefined;
		try {
			const now = new Date().toISOString();
			const definitionFile = await this.store.put(
				id,
				D.canonicalJson(definition),
				D.LIMITS.definitionBytes,
			);
			const state: D.DagState = {
				schemaVersion: 1,
				scope: this.options.scope,
				dagId: id,
				title: definition.title,
				version: 1,
				graphRevision: 1,
				mode: "paused",
				lifecycle: "active",
				createdAt: now,
				updatedAt: now,
				definitionValue: definition,
				definitionFile,
				profile: { cwd: await realpath(execution.cwd) },
				nodes: {},
				proposals: {},
				gates: {},
				captures: {},
				receipts: {},
				interventions: [],
				history: [],
				notices: [],
				attachments: [binding.key],
			};
			owned = {
				state,
				lease,
				jobs: new Map(),
				children: new Map(),
				effects: new Set(),
				scheduled: false,
			};
			for (const spec of definition.nodes)
				state.nodes[spec.id] = {
					id: spec.id,
					taskFile: await this.store.put(id, spec.task),
					attempts: [],
					held: false,
					cancelled: false,
				};
			await this.mainSeed(state, binding);
			await this.models(owned, binding);
			const receipt = { commandId: request.commandId, dagId: id, version: 1, graphRevision: 1 };
			state.receipts[request.commandId] = { fingerprint, receipt };
			await this.event(
				state,
				"created",
				{ definition: definitionFile },
				binding.value.caller,
				undefined,
				[definitionFile],
			);
			this.guard(binding);
			await lease.save(state, undefined, () => this.guard(binding));
			this.owners.set(id, owned);
			return structuredClone(receipt);
		} catch (error) {
			await owned?.resource?.release();
			await lease.release();
			throw error;
		}
	}

	private spec(state: D.DagState, id: string): D.DagNodeSpec {
		return (
			state.definitionValue.nodes.find((node) => node.id === id) ??
			D.fail("not-found", "Node is not in the current graph")
		);
	}
	private node(state: D.DagState, id: string): D.NodeRecord {
		this.spec(state, id);
		return state.nodes[id] ?? D.fail("corrupt-state", "Missing node state");
	}
	private quiet(node: D.NodeRecord): void {
		if (D.active(node)) D.fail("invalid-command", "Interrupt and settle active work first");
		if (D.latest(node)?.activation.phase === "uncertain")
			D.fail("recovery-required", "Reconcile uncertain work before changing it");
	}
	private decision(binding: Binding, commandId: string, reason: string): D.DecisionRecord {
		return {
			actor: structuredClone(binding.value.caller),
			commandId,
			reason,
			at: new Date().toISOString(),
		};
	}
	private supersede(state: D.DagState, target: D.ActivationRef): void {
		for (const proposal of Object.values(state.proposals))
			if (sameTarget(proposal.target, target) && proposal.disposition === "pending")
				proposal.disposition = "superseded";
		for (const gate of Object.values(state.gates))
			if (sameTarget(gate.target, target) && gate.disposition === "pending")
				gate.disposition = "superseded";
		for (const intervention of state.interventions)
			if (sameTarget(intervention.target, target)) intervention.status = "superseded";
	}
	private continuable(state: D.DagState, target: D.ActivationRef) {
		const current = D.currentTarget(state, target);
		this.spec(state, target.nodeId);
		this.quiet(current.node);
		if (
			current.attempt.stale ||
			current.node.cancelled ||
			current.node.skipped ||
			current.node.retryOutputs !== undefined
		)
			D.fail("stale-target", "This attempt requires retry, not continuation");
		if (!current.attempt.birth)
			D.fail(
				"history-unavailable",
				"No existing worker session can be continued; retry this attempt",
			);
		return current;
	}
	private async command(
		owned: Owned,
		state: D.DagState,
		binding: Binding,
		commandId: string,
		command: Command,
		effects: Array<() => Promise<void>>,
	): Promise<void> {
		const decision = (reason: string) => this.decision(binding, commandId, reason);
		switch (command.kind) {
			case "pause":
				state.mode = "paused";
				return;
			case "resume":
				await this.models(owned, binding);
				state.mode = "running";
				return;
			case "attach-notices":
				if (!state.attachments.includes(binding.key)) state.attachments.push(binding.key);
				return;
			case "detach-notices":
				state.attachments = state.attachments.filter((key) => key !== binding.key);
				return;
			case "dispose":
			case "interrupt":
			case "cancel": {
				if (command.kind === "dispose" && state.lifecycle === "disposed") return;
				let nodes: D.NodeRecord[];
				const target = "target" in command ? command.target : { kind: "dag" as const };
				if (target.kind === "dag") {
					state.mode = "paused";
					nodes = state.definitionValue.nodes.map((spec) => this.node(state, spec.id));
				} else if (target.kind === "activation") {
					const node = D.currentTarget(state, target).node;
					if (!D.active(node)) D.fail("stale-target", "The activation already settled");
					nodes = [node];
				} else nodes = [this.node(state, target.nodeId)];
				for (const node of nodes) {
					if (["completed", "skipped"].includes(D.nodeStatus(state, node.id))) {
						if (target.kind !== "dag")
							D.fail("stale-target", "Completed work requires retry to change");
						continue;
					}
					node.held = true;
					delete node.continuation;
					const current = D.latest(node);
					if (current) current.activation.interrupted = true;
					if (command.kind !== "interrupt") {
						node.cancelled = true;
						if (current) this.supersede(state, targetOf(node));
					}
					const job = owned.jobs.get(node.id);
					if (job)
						effects.push(async () => {
							if (owned.jobs.get(node.id) !== job) return;
							job.controller.abort();
							await job.child?.abort();
						});
				}
				if (command.kind === "dispose") {
					state.lifecycle = "disposing";
					effects.push(() => this.dispose(owned));
				}
				return;
			}
			case "steer": {
				const { node, attempt } = D.currentTarget(state, command.target);
				if (!D.active(node) || attempt.stale || node.held || node.cancelled)
					D.fail("stale-target", "Steering requires the captured active invocation");
				const job = owned.jobs.get(node.id);
				if (!job || !sameTarget(job.target, command.target))
					D.fail("stale-target", "Invocation is not owned by this process");
				state.interventions.push({
					commandId,
					target: { ...command.target },
					text: await this.store.put(state.dagId, command.text),
					status: "pending",
				});
				effects.push(() => this.steer(owned, job, commandId, command.text));
				return;
			}
			case "continue": {
				const { node, activation } = this.continuable(state, command.target);
				if (
					Object.values(state.gates).some(
						(gate) => sameTarget(gate.target, command.target) && gate.disposition === "pending",
					)
				)
					D.fail("invalid-command", "Resolve the pending gate before continuing");
				if (
					activation.proposalId &&
					state.proposals[activation.proposalId]?.disposition === "accepted"
				)
					D.fail("invalid-command", "Accepted work requires retry to run again");
				await this.resource(owned, binding);
				this.supersede(state, command.target);
				node.held = false;
				const queued = node.continuation?.payload;
				const contextPayload =
					queued ?? (activation.outcome?.stopReason === undefined ? activation.payload : undefined);
				const instructions =
					command.instructions ??
					"Continue the current task. Submit a result explicitly when ready.";
				const payload =
					queued && command.instructions === undefined
						? queued
						: await this.store.put(
								state.dagId,
								contextPayload
									? `${text(await this.store.load(state.dagId, contextPayload))}\n\n${instructions}`
									: instructions,
							);
				node.continuation = { payload };
				return;
			}
			case "retry": {
				const node = this.node(state, command.target.nodeId);
				const current = D.latest(node);
				if (!current || current.attempt.number !== command.target.attempt)
					D.fail("stale-target", "Retry must target the current attempt");
				this.quiet(node);
				const affected = D.descendants(state.definitionValue, node.id);
				for (const id of affected) this.quiet(this.node(state, id));
				for (const selection of command.previousOutputs ?? []) {
					const proposal = state.proposals[selection.proposalId];
					if (!proposal?.outputs[selection.name])
						D.fail("not-found", "Retry values must name existing declared outputs");
					if (proposal.target.nodeId !== node.id && !proposal.acceptance)
						D.fail("forbidden", "Unreleased outputs of another node cannot seed a retry");
				}
				D.invalidate(state, affected);
				node.cancelled = false;
				node.held = false;
				node.retryOutputs = structuredClone(command.previousOutputs ?? []);
				await this.resource(owned, binding);
				return;
			}
			case "skip": {
				const node = this.node(state, command.nodeId);
				this.quiet(node);
				const affected = D.descendants(state.definitionValue, node.id);
				for (const id of affected) this.quiet(this.node(state, id));
				D.invalidate(state, affected);
				node.skipped = decision(command.reason);
				node.held = false;
				node.cancelled = false;
				delete node.retryOutputs;
				return;
			}
			case "edit": {
				const { definition, affected } = command;
				await this.models(owned, binding, definition);
				D.invalidate(state, affected);
				for (const id of affected) effects.push(() => this.retire(owned, id));
				state.definitionValue = definition;
				state.graphRevision++;
				state.definitionFile = await this.store.put(
					state.dagId,
					D.canonicalJson(definition),
					D.LIMITS.definitionBytes,
				);
				for (const spec of definition.nodes) {
					state.nodes[spec.id] = {
						...(state.nodes[spec.id] ?? {
							id: spec.id,
							attempts: [],
							held: false,
							cancelled: false,
						}),
						taskFile: await this.store.put(state.dagId, spec.task),
					};
				}
				await this.mainSeed(state, binding);
				for (const proposal of Object.values(state.proposals))
					if (
						proposal.disposition === "accepted" &&
						definition.nodes.some((node) => node.id === proposal.target.nodeId)
					)
						await this.release(state, proposal);
				return;
			}
			case "reconcile": {
				const { node, activation } = D.currentTarget(state, command.target);
				if (activation.phase !== "uncertain")
					D.fail("stale-target", "Only uncertain work can be reconciled");
				if (owned.jobs.has(node.id))
					D.fail("resource-in-use", "This process still owns a live invocation");
				activation.phase = "settled";
				activation.interrupted = true;
				node.held = true;
				for (const intervention of state.interventions)
					if (sameTarget(intervention.target, command.target)) intervention.status = "superseded";
				const proposal = activation.proposalId ? state.proposals[activation.proposalId] : undefined;
				if (proposal) await this.release(state, proposal);
				return;
			}
			case "answer":
			case "approve":
			case "reject": {
				const gate = state.gates[command.gateId];
				if (gate?.disposition !== "pending") D.fail("stale-target", "Gate is no longer pending");
				const { node, attempt, activation } = D.currentTarget(state, gate.target);
				if (attempt.stale || node.cancelled || activation.phase === "uncertain")
					D.fail("stale-target", "Gate belongs to ineligible work");
				if (command.kind === "answer") {
					if (gate.kind !== "input") D.fail("invalid-command", "Only input gates accept answers");
					await this.resource(owned, binding);
					gate.answer = await this.store.put(state.dagId, D.canonicalJson(command.value));
					gate.disposition = "answered";
					gate.decision = decision("Answered input request");
					node.continuation = {
						payload: await this.store.put(
							state.dagId,
							`Answer to input request ${gate.id}:\n${D.canonicalJson(command.value)}\nContinue the same task and explicitly submit your result.`,
						),
					};
				} else {
					if (gate.kind !== "approval") D.fail("invalid-command", "Input gates require an answer");
					gate.disposition = command.kind === "approve" ? "approved" : "rejected";
					gate.decision = decision(command.reason);
					const proposal = gate.proposalId ? state.proposals[gate.proposalId] : undefined;
					if (!proposal) D.fail("corrupt-state", "Approval has no proposal");
					if (command.kind === "reject") {
						if (!proposal.acceptance) {
							proposal.disposition = "rejected";
							node.held = true;
						}
					} else await this.release(state, proposal);
				}
				return;
			}
			case "accept-result":
			case "reject-result": {
				const proposal = state.proposals[command.proposalId];
				if (proposal?.disposition !== "pending")
					D.fail("stale-target", "Result is not an eligible proposal");
				const { node, attempt, activation } = D.currentTarget(state, proposal.target);
				this.quiet(node);
				if (attempt.stale || node.cancelled || activation.proposalId !== proposal.id)
					D.fail("stale-target", "Result belongs to superseded work");
				if (command.kind === "reject-result") {
					proposal.disposition = "rejected";
					this.supersede(state, proposal.target);
				} else {
					await this.release(state, proposal, decision(command.reason));
					if (state.proposals[command.proposalId]?.disposition !== "accepted")
						D.fail("forbidden", "Required gates must be approved before manual acceptance");
				}
				return;
			}
		}
	}
	private kick(owned: Owned): void {
		if (
			this.closed ||
			owned.fault ||
			owned.scheduled ||
			owned.state.mode !== "running" ||
			owned.state.lifecycle !== "active"
		)
			return;
		owned.scheduled = true;
		queueMicrotask(() => {
			void this.serial(owned.state.dagId, async () => {
				owned.scheduled = false;
				if (
					this.closed ||
					owned.fault ||
					owned.state.mode !== "running" ||
					owned.state.lifecycle !== "active"
				)
					return;
				const slots = (owned.state.definitionValue.maxConcurrent ?? 4) - owned.jobs.size;
				if (slots <= 0) return;
				const state = this.next(owned);
				const jobs: Job[] = [];
				for (const spec of state.definitionValue.nodes) {
					if (jobs.length >= slots) break;
					const node = this.node(state, spec.id);
					if (owned.jobs.has(node.id) || node.held || node.cancelled || node.skipped) continue;
					let current = D.latest(node);
					const continuing = node.continuation;
					if (!continuing && current && node.retryOutputs === undefined) continue;
					if (
						continuing &&
						(!current || current.attempt.stale || current.activation.phase !== "settled")
					)
						continue;
					if (!continuing) {
						const ready = D.readyInputs(state, node.id);
						if (!ready) continue;
						const attempt: D.Attempt = {
							number: node.attempts.length + 1,
							graphRevision: state.graphRevision,
							configuration: await this.store.put(
								state.dagId,
								D.canonicalJson(this.session(state, spec)),
							),
							...(node.retryOutputs ? { reusedOutputs: node.retryOutputs } : {}),
							inputs: ready.inputs,
							...(ready.historyCaptureId ? { historyCaptureId: ready.historyCaptureId } : {}),
							activations: [],
							stale: false,
						};
						delete node.retryOutputs;
						node.attempts.push(attempt);
						attempt.activations.push({
							number: 1,
							phase: "preparing",
							payload: node.taskFile,
							createdAt: state.updatedAt,
						});
						current = {
							attempt,
							activation: attempt.activations[0] ?? D.fail("corrupt-state", "Missing preparation"),
						};
					} else if (current) {
						current.attempt.activations.push({
							number: current.attempt.activations.length + 1,
							phase: "preparing",
							payload: continuing.payload,
							createdAt: state.updatedAt,
						});
						delete node.continuation;
					}
					const job: Job = {
						target: targetOf(node),
						controller: new AbortController(),
						runningObserved: false,
					};
					jobs.push(job);
					await this.event(
						state,
						"admitted",
						{ continuation: !!continuing },
						undefined,
						job.target,
					);
				}
				if (!jobs.length) return;
				await this.save(owned, state);
				for (const job of jobs) {
					owned.jobs.set(job.target.nodeId, job);
					job.promise = this.run(owned, job)
						.catch((error) => this.halt(owned, error))
						.finally(() => {
							owned.jobs.delete(job.target.nodeId);
							this.kick(owned);
						});
				}
			}).catch((error) => this.halt(owned, error));
		});
	}
	private async release(
		state: D.DagState,
		proposal: D.Proposal,
		manual?: D.DecisionRecord,
	): Promise<void> {
		const { node, attempt, activation } = D.currentTarget(state, proposal.target);
		if (
			attempt.stale ||
			node.cancelled ||
			activation.phase !== "settled" ||
			activation.proposalId !== proposal.id ||
			!["pending", "accepted"].includes(proposal.disposition)
		)
			return;
		if (activation.gateId && state.gates[activation.gateId]?.disposition === "pending") return;
		const spec = this.spec(state, node.id);
		const needsHistory = state.definitionValue.connections.some(
			(connection) => connection.context === "fork" && D.endpoints(connection).from === node.id,
		);
		if (needsHistory && !proposal.historyCaptureId && attempt.birth && activation.outcome) {
			try {
				proposal.historyCaptureId = await this.capture(state, {
					kind: "resource-child",
					resourceId: state.dagId,
					sessionId: attempt.birth.sessionId,
					entryId: activation.outcome.historyEntryId,
				});
			} catch (error) {
				activation.failure = await this.store.put(state.dagId, failure(error).message);
				this.notice(
					state,
					"attention",
					`${node.id}: history export is unavailable; output release is separate.`,
					{ target: proposal.target },
				);
			}
		}
		const guards = Object.values(state.gates).filter(
			(gate) => gate.kind === "approval" && gate.proposalId === proposal.id,
		);
		if (
			spec.approval &&
			!guards.some(
				(gate) =>
					gate.historyCaptureId === proposal.historyCaptureId &&
					["pending", "approved", "rejected"].includes(gate.disposition),
			)
		) {
			const gate: D.Gate = {
				id: uid("gate"),
				kind: "approval",
				target: { ...proposal.target },
				authority: spec.approval.authority,
				question: await this.store.put(state.dagId, spec.approval.question),
				questionPreview: spec.approval.question.slice(0, D.LIMITS.preview),
				proposalId: proposal.id,
				disposition: "pending",
				...(proposal.historyCaptureId ? { historyCaptureId: proposal.historyCaptureId } : {}),
			};
			state.gates[gate.id] = gate;
			guards.push(gate);
			await this.event(state, "approval-requested", gate, undefined, gate.target, [gate.question]);
			this.notice(state, "waiting", `${node.id}: approval required.`, {
				target: gate.target,
				gateId: gate.id,
			});
		}
		const outputApproval = guards.find((gate) => gate.disposition === "approved");
		const historyApproval = guards.find(
			(gate) =>
				gate.disposition === "approved" && gate.historyCaptureId === proposal.historyCaptureId,
		);
		if (spec.approval && !outputApproval) return;
		const interventions = state.interventions.filter((item) =>
			sameTarget(item.target, proposal.target),
		);
		for (const intervention of interventions)
			if (
				intervention.status === "offered" &&
				intervention.offeredVersion !== undefined &&
				intervention.offeredVersion < proposal.createdVersion
			)
				intervention.status = "settled";
		if (proposal.disposition === "pending") {
			if (
				!manual &&
				(!D.successful(activation) ||
					node.held ||
					interventions.some((item) => item.status !== "settled" && item.status !== "superseded"))
			)
				return;
			if (manual) {
				for (const intervention of interventions) intervention.status = "superseded";
				node.held = false;
			}
			proposal.disposition = "accepted";
			proposal.acceptance = manual ?? {
				actor: { kind: "owner", ownerId: "dag-runtime" },
				at: state.updatedAt,
				reason: "Positive settled execution, explicit result and satisfied output gates",
			};
			this.notice(state, "completed", `${node.id}: result accepted.`, {
				target: proposal.target,
				proposalId: proposal.id,
			});
		}
		const releaseDecision = historyApproval?.decision ?? proposal.acceptance;
		if (proposal.historyCaptureId && (!spec.approval || historyApproval) && releaseDecision)
			proposal.historyRelease = releaseDecision;
	}
	private previousValues(state: D.DagState, attempt: D.Attempt) {
		return (attempt.reusedOutputs ?? []).map((selection) => {
			const value = state.proposals[selection.proposalId]?.outputs[selection.name];
			if (!value) D.fail("corrupt-state", "Missing selected retry output");
			return { ...selection, value };
		});
	}
	private async continuationPayload(
		state: D.DagState,
		attempt: D.Attempt,
		payload: D.StoredFile,
	): Promise<D.StoredFile> {
		const values = [...attempt.inputs, ...this.previousValues(state, attempt)];
		const artifacts = new Map(
			values
				.filter((item) => item.value.kind === "artifact")
				.map((item) => [item.value.file.artifactId, item.value.file]),
		);
		if (!artifacts.size) return payload;
		const paths: D.CapturedFileRef[] = [];
		for (const file of artifacts.values()) {
			await this.store.load(state.dagId, file);
			paths.push(this.store.reference(state.dagId, file));
		}
		return this.store.put(
			state.dagId,
			`${text(await this.store.load(state.dagId, payload))}\nCurrent paths for the same immutable captured artifacts:\n${D.canonicalJson(paths)}`,
		);
	}
	private async materialize(
		state: D.DagState,
		node: D.NodeRecord,
		attempt: D.Attempt,
	): Promise<string> {
		const value = async (stored: D.StoredValue): Promise<unknown> => {
			const bytes = await this.store.load(state.dagId, stored.file);
			return stored.kind === "artifact"
				? this.store.reference(state.dagId, stored.file)
				: stored.kind === "json"
					? JSON.parse(text(bytes))
					: text(bytes);
		};
		const inputs: Record<string, unknown> = {};
		for (const input of attempt.inputs) inputs[input.input] = await value(input.value);
		const previous: Array<{ proposalId: string; name: string; value: unknown }> = [];
		for (const { value: stored, ...selection } of this.previousValues(state, attempt))
			previous.push({ ...selection, value: await value(stored) });
		return D.canonicalJson({
			task: this.spec(state, node.id).task,
			inputs,
			previousOutputs: previous,
			protocol:
				"Work only on this task. Call dag_submit_result with exactly the declared outputs, or dag_request_input if blocked. Each protocol call must be the sole tool in its assistant batch. Prose alone is not a result.",
			outputs: this.spec(state, node.id).outputs,
		});
	}
	private async retire(owned: Owned, nodeId: string): Promise<void> {
		const child = owned.children.get(nodeId);
		if (!child) return;
		await child.dispose();
		if (owned.children.get(nodeId) === child) owned.children.delete(nodeId);
	}
	private async run(owned: Owned, job: Job): Promise<void> {
		try {
			const frozen = structuredClone(owned.state);
			const { node, attempt, activation } = D.currentTarget(frozen, job.target);
			if (job.controller.signal.aborted || this.closed)
				throw new Error("Interrupted before worker assembly");
			const configured: unknown = JSON.parse(
				text(await this.store.load(frozen.dagId, attempt.configuration)),
			);
			if (!Check(D.SessionSchema, configured))
				D.fail("corrupt-state", "Invalid frozen worker configuration");
			const resource =
				owned.resource ?? D.fail("context-required", "No retained execution context");
			const session = { ...configured, extensions: true };
			let history: Core.CapturedHistory | undefined;
			if (!attempt.birth && attempt.historyCaptureId) {
				const capture =
					frozen.captures[attempt.historyCaptureId] ??
					D.fail("corrupt-state", "Missing inherited capture");
				const { file, ...metadata } = capture;
				history = { ...metadata, jsonl: text(await this.store.load(frozen.dagId, file)) };
			}
			const retained = owned.children.get(node.id);
			if (retained && retained.sessionId !== attempt.birth?.sessionId)
				await this.retire(owned, node.id);
			job.child =
				attempt.birth && retained?.sessionId === attempt.birth.sessionId
					? retained
					: attempt.birth
						? await resource.reopenChild({ birth: attempt.birth, session })
						: await resource.createChild({
								info: { createdBy: "dag", roleName: node.id },
								visibility: "hidden",
								interactive: false,
								session,
								...(history ? { origin: { kind: "fork-captured", history } } : {}),
							});
			owned.children.set(node.id, job.child);
			const payload =
				activation.number === 1
					? await this.store.put(frozen.dagId, await this.materialize(frozen, node, attempt))
					: await this.continuationPayload(frozen, attempt, activation.payload);
			await this.serial(frozen.dagId, async () => {
				const state = this.next(owned);
				const current = D.currentTarget(state, job.target);
				const child = job.child ?? D.fail("corrupt-state", "Missing assembled worker");
				const { sessionFile: _path, ...birth } = child.record;
				current.attempt.birth = D.decodeBirth(structuredClone(birth));
				current.activation.payload = payload;
				current.activation.phase = "queued";
				await this.event(
					state,
					"dispatch-intent",
					{ sessionId: child.sessionId, payload, configuration: attempt.configuration },
					undefined,
					job.target,
					[
						payload,
						attempt.configuration,
						...attempt.inputs.map((input) => input.value.file),
						...this.previousValues(state, attempt).map((item) => item.value.file),
					],
				);
				await this.save(owned, state);
			});
			const outcome = await job.child.runQueued(
				text(await this.store.load(frozen.dagId, payload)),
				{
					signal: job.controller.signal,
					onUpdate: (update) => {
						if (update.status !== "running" || job.runningObserved) return;
						job.runningObserved = true;
						void this.serial(frozen.dagId, async () => {
							const state = this.next(owned);
							const current = D.currentTarget(state, job.target);
							if (current.activation.phase !== "queued") return;
							current.activation.phase = "running";
							await this.event(
								state,
								"running",
								{ sessionId: job.child?.sessionId ?? null },
								undefined,
								job.target,
							);
							await this.save(owned, state);
						}).catch((error) => this.halt(owned, error));
					},
				},
			);
			await this.serial(frozen.dagId, async () => {
				const state = this.next(owned);
				const current = D.currentTarget(state, job.target);
				const { details, finalText, errorMessage, ...evidence } = outcome;
				const { task: _task, ...stats } = details;
				current.activation.phase = "settled";
				const observed: D.StoredOutcome = { ...evidence, details: stats };
				const rejected: string[] = [];
				for (const [field, content] of [
					["finalText", finalText],
					["errorMessage", errorMessage],
				] as const) {
					if (content === undefined) continue;
					try {
						observed[field] = await this.store.put(state.dagId, content);
					} catch (error) {
						if (!(error instanceof D.DagError) || error.failure.code !== "limit-exceeded")
							throw error;
						rejected.push(`${field} was not captured: ${error.message}`);
					}
				}
				if (rejected.length)
					current.activation.failure = await this.store.put(state.dagId, rejected.join("\n"));
				current.activation.outcome = observed;
				await this.event(
					state,
					"settled",
					{
						outcome: current.activation.outcome,
						...(current.activation.failure ? { failure: current.activation.failure } : {}),
					},
					undefined,
					job.target,
					[
						current.activation.outcome.finalText,
						current.activation.outcome.errorMessage,
						current.activation.failure,
					].filter((file) => file !== undefined),
				);
				await this.save(owned, state);
			});
			await this.serial(frozen.dagId, async () => {
				const state = this.next(owned);
				const { activation: completed } = D.currentTarget(state, job.target);
				const proposal = completed.proposalId ? state.proposals[completed.proposalId] : undefined;
				if (proposal) await this.release(state, proposal);
				if (D.nodeStatus(state, job.target.nodeId) === "needs-attention")
					this.notice(
						state,
						"attention",
						`${job.target.nodeId}: execution settled without an accepted result.`,
						{ target: job.target },
					);
				await this.event(
					state,
					"release-evaluated",
					{ proposalId: proposal?.id ?? null, disposition: proposal?.disposition ?? null },
					undefined,
					job.target,
				);
				await this.save(owned, state);
			});
		} catch (error) {
			if (owned.fault) throw error;
			await this.serial(owned.state.dagId, async () => {
				const state = this.next(owned);
				const { activation } = D.currentTarget(state, job.target);
				activation.phase = "settled";
				activation.failure = await this.store.put(state.dagId, failure(error).message);
				await this.event(
					state,
					"execution-failed",
					{ failure: activation.failure },
					undefined,
					job.target,
					[activation.failure],
				);
				this.notice(state, "attention", `${job.target.nodeId}: execution needs attention.`, {
					target: job.target,
				});
				await this.save(owned, state);
			});
		} finally {
			const node = owned.state.nodes[job.target.nodeId];
			const current = node ? D.latest(node) : undefined;
			if (
				owned.fault ||
				!current ||
				current.attempt.stale ||
				node?.cancelled ||
				!owned.state.definitionValue.nodes.some((spec) => spec.id === job.target.nodeId) ||
				current.attempt.birth?.sessionId !== job.child?.sessionId
			)
				await this.retire(owned, job.target.nodeId);
		}
	}
	private async artifact(state: D.DagState, path: string): Promise<D.StoredFile> {
		const root = await realpath(state.profile.cwd);
		const full = await realpath(resolve(root, path));
		const subpath = relative(root, full);
		if (
			!subpath ||
			subpath === ".." ||
			subpath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
			isAbsolute(subpath)
		)
			D.fail("forbidden", "Artifacts must be regular workspace files");
		const file = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
		try {
			const stat = await file.stat();
			if (!stat.isFile() || stat.size > D.LIMITS.valueBytes)
				D.fail("limit-exceeded", "Artifact must be a regular file within the value quota");
			const bytes = new Uint8Array(stat.size + 1);
			let size = 0;
			while (size < bytes.length) {
				const read = await file.read(bytes, size, bytes.length - size, null);
				if (!read.bytesRead) break;
				size += read.bytesRead;
			}
			if (size !== stat.size) D.fail("invalid-command", "Artifact changed during capture");
			return this.store.put(state.dagId, bytes.subarray(0, size));
		} finally {
			await file.close();
		}
	}
	private async protocol(
		owned: Owned,
		sessionId: string,
		invocationId: string,
		value:
			| { kind: "proposal"; outputs: Submission["outputs"] }
			| { kind: "input"; question: string },
		signal: AbortSignal,
	): Promise<WorkerReceipt> {
		const encoded = D.canonicalJson(value);
		const fingerprint = hash(encoded),
			call = hash(invocationId);
		const job = [...owned.jobs.values()].find((item) => item.child?.sessionId === sessionId);
		if (!job) return D.fail("stale-target", "No active worker binding");
		return this.serial(owned.state.dagId, async () => {
			if (this.closed || signal.aborted) return D.fail("revoked", "Worker invocation was revoked");
			if (owned.jobs.get(job.target.nodeId) !== job)
				return D.fail("stale-target", "Worker activation changed");
			const state = this.next(owned);
			const { node, attempt, activation } = D.currentTarget(state, job.target);
			if (
				attempt.stale ||
				node.cancelled ||
				node.held ||
				!D.active(node) ||
				job.controller.signal.aborted
			)
				return D.fail("stale-target", "Worker invocation no longer admits results");
			const prior = activation.calls?.[call];
			if (prior) {
				if (prior.fingerprint !== fingerprint)
					return D.fail("id-reused", "Worker call id was reused with different arguments");
				return { dagId: state.dagId, id: prior.id, kind: prior.kind };
			}
			if (activation.gateId)
				return D.fail(
					"invalid-command",
					"Resolve the existing input request before further submissions",
				);
			const spec = this.spec(state, node.id);
			const id = uid(value.kind === "proposal" ? "proposal" : "gate");
			if (activation.proposalId) {
				const priorProposal = state.proposals[activation.proposalId];
				if (priorProposal) priorProposal.disposition = "superseded";
				delete activation.proposalId;
			}
			if (value.kind === "proposal") {
				if (
					!Check(D.SubmissionSchema, value.outputs) ||
					Object.keys(value.outputs).sort().join("\0") !==
						Object.keys(spec.outputs).sort().join("\0")
				)
					D.fail("invalid-command", "Submit exactly the declared output names and kinds");
				const outputs: Record<string, D.StoredValue> = {};
				for (const [name, output] of Object.entries(value.outputs)) {
					if (spec.outputs[name]?.kind !== output.kind)
						D.fail("invalid-command", `Wrong output kind for ${name}`);
					const body =
						output.kind === "text"
							? output.text
							: output.kind === "json"
								? D.canonicalJson(output.value)
								: output.path;
					outputs[name] = {
						kind: output.kind,
						file:
							output.kind === "artifact"
								? await this.artifact(state, output.path)
								: await this.store.put(state.dagId, body),
						preview: body.slice(0, D.LIMITS.preview),
					};
				}
				state.proposals[id] = {
					id,
					createdVersion: state.version,
					target: { ...job.target },
					outputs,
					createdAt: state.updatedAt,
					disposition: "pending",
				};
				activation.proposalId = id;
			} else {
				if (!value.question.trim()) D.fail("invalid-command", "An input request needs a question");
				state.gates[id] = {
					id,
					kind: "input",
					target: { ...job.target },
					authority: spec.inputAuthority ?? "human",
					question: await this.store.put(state.dagId, value.question),
					questionPreview: value.question.slice(0, D.LIMITS.preview),
					disposition: "pending",
				};
				activation.gateId = id;
				this.notice(state, "waiting", `${node.id}: input required.`, {
					target: job.target,
					gateId: id,
				});
			}
			activation.calls ??= {};
			activation.calls[call] = { fingerprint, id, kind: value.kind };
			const proposal = state.proposals[id];
			const gate = state.gates[id];
			await this.event(
				state,
				value.kind === "proposal" ? "result-submitted" : "input-requested",
				proposal ?? gate ?? D.fail("corrupt-state", "Missing protocol evidence"),
				undefined,
				job.target,
				proposal
					? Object.values(proposal.outputs).map((output) => output.file)
					: gate
						? [gate.question]
						: [],
			);
			await this.save(owned, state, () => {
				if (this.closed || signal.aborted || job.controller.signal.aborted)
					D.fail("revoked", "Worker invocation was revoked");
			});
			return { dagId: state.dagId, id, kind: value.kind };
		});
	}
	private async steer(owned: Owned, job: Job, commandId: string, message: string): Promise<void> {
		let offered = false;
		if (owned.jobs.get(job.target.nodeId) === job && job.child && !job.controller.signal.aborted) {
			try {
				await job.child.steer(message);
				offered = true;
			} catch (error) {
				if (!(error instanceof DelegationError && error.code === "not-running")) throw error;
			}
		}
		await this.serial(owned.state.dagId, async () => {
			const state = this.next(owned);
			const item = state.interventions.find((intervention) => intervention.commandId === commandId);
			if (item?.status !== "pending") return;
			item.status = offered ? "offered" : "not-enqueued";
			if (offered) item.offeredVersion = state.version;
			await this.event(state, "steer-observed", { commandId, offered }, undefined, job.target);
			await this.save(owned, state);
		});
	}
	private async dispose(owned: Owned): Promise<void> {
		await Promise.all([...owned.jobs.values()].map((job) => job.promise));
		await owned.resource?.release();
		owned.children.clear();
		delete owned.resource;
		await this.serial(owned.state.dagId, async () => {
			const state = this.next(owned);
			state.lifecycle = "disposed";
			state.mode = "paused";
			await this.event(state, "disposed", {});
			this.notice(state, "disposed", "DAG disposed; retained evidence remains readable.");
			await this.save(owned, state);
		});
	}
	close(): Promise<void> {
		if (this.closing) return this.closing;
		this.closed = true;
		this.closing = (async () => {
			for (const binding of this.bindings) binding.detach?.();
			this.bindings.clear();
			await Promise.all(this.queues.values());
			const owners = [...this.owners.values()];
			const errors: unknown[] = [];
			await Promise.all(
				owners.map(async (owned) => {
					try {
						await this.serial(owned.state.dagId, async () => {
							const state = this.next(owned);
							state.mode = "paused";
							for (const job of owned.jobs.values()) {
								const current = D.currentTarget(state, job.target);
								if (D.active(current.node)) {
									current.node.held = true;
									current.activation.interrupted = true;
								}
							}
							await this.event(state, "owner-closing", {});
							await this.save(owned, state);
						});
					} catch (error) {
						errors.push(error);
					}
				}),
			);
			for (const owned of owners) for (const job of owned.jobs.values()) job.controller.abort();
			await Promise.all(
				owners.map(async (owned) => {
					await Promise.all([...owned.jobs.values()].map((job) => job.promise));
					await Promise.all(owned.effects);
					try {
						await owned.resource?.release();
						await owned.lease.release();
					} catch (error) {
						errors.push(error);
					}
					if (owned.fault) errors.push(owned.fault);
				}),
			);
			this.owners.clear();
			if (errors.length) throw new AggregateError(errors, "DAG close did not complete cleanly");
		})();
		return this.closing;
	}
}

export function createDagService(options: DagServiceOptions): D.DagService {
	return new Engine(options);
}
