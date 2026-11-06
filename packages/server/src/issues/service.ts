import {
	canonicalIssueInstanceUrl,
	hasIssueHttpConsent,
	type IssueConnection,
	type IssueConnectionInput,
	type IssueList,
	type IssueReference,
	type IssueStage,
	isIssueConnectionInput,
	isIssueReference,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { logger } from "../log";
import { createGitLabClient, type GitLabClientOptions, type GitLabIssue } from "./client";
import type { IssueRemote, IssueWorkflowRemote } from "./remote";

export type IssueBinding = Omit<IssueConnection, "connected">;

/** Opaque vault keys are host-only and never part of a public projection. */
export interface IssueStoredBinding extends IssueBinding {
	credentialId?: string;
	httpConsentInstanceUrl?: string;
	cleanupCredentialIds?: string[];
}

export interface IssueCredentialStore {
	get(id: string): Promise<string | null>;
	set(id: string, token: string): Promise<void>;
	delete(id: string): Promise<void>;
}

/** Save atomically upserts one metadata record by local project id. */
export interface IssueBindingPersistence {
	load(): Promise<readonly IssueStoredBinding[]>;
	save(binding: IssueStoredBinding): Promise<void>;
}

export interface IssuesServiceOptions {
	persistence: IssueBindingPersistence;
	credentialStore: IssueCredentialStore;
	fetch?: GitLabClientOptions["fetch"];
}

export interface IssuesService {
	connection(projectId: string): IssueConnection | null;
	connect(projectId: string, input: IssueConnectionInput): Promise<IssueConnection>;
	restore(projectId: string): Promise<IssueConnection | null>;
	disconnect(projectId: string): Promise<void>;
	list(projectId: string): Promise<IssueList>;
	/** Server-only authenticated read capability; never serialize or expose through RPC. */
	remoteFor(projectId: string, reference: IssueReference): IssueRemote;
	/** The GitLab-only workflow capability; a GitHub reference is refused before any request. */
	workflowFor(projectId: string, reference: IssueReference): IssueWorkflowRemote;
}

const log = logger("issues");

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maxCleanup = 32;
function validToken(token: string): boolean {
	return (
		typeof token === "string" && token.length > 0 && token.length <= 4096 && /^[!-~]+$/.test(token)
	);
}
function publicBinding(binding: IssueBinding): IssueBinding {
	return {
		projectId: binding.projectId,
		instanceUrl: binding.instanceUrl,
		remoteProjectId: binding.remoteProjectId,
	};
}
function storedBinding(row: IssueStoredBinding): IssueStoredBinding {
	const binding: IssueStoredBinding = bindingOf(
		row.projectId,
		row.instanceUrl,
		row.remoteProjectId,
	);
	if (row.credentialId !== undefined) {
		if (typeof row.credentialId !== "string" || !uuid.test(row.credentialId)) invalid();
		binding.credentialId = row.credentialId;
	}
	if (row.httpConsentInstanceUrl !== undefined) {
		if (
			canonicalIssueInstanceUrl(row.httpConsentInstanceUrl) !== row.httpConsentInstanceUrl ||
			row.httpConsentInstanceUrl !== binding.instanceUrl
		)
			invalid();
		binding.httpConsentInstanceUrl = row.httpConsentInstanceUrl;
	}
	if (row.cleanupCredentialIds !== undefined) {
		if (
			!Array.isArray(row.cleanupCredentialIds) ||
			row.cleanupCredentialIds.length > maxCleanup ||
			row.cleanupCredentialIds.some(
				(id) => typeof id !== "string" || !uuid.test(id) || id === row.credentialId,
			) ||
			new Set(row.cleanupCredentialIds).size !== row.cleanupCredentialIds.length
		)
			invalid();
		binding.cleanupCredentialIds = [...row.cleanupCredentialIds];
	}
	return binding;
}

/** Closed stage labels only: no URL, token, provider text or error message is logged. */
type ConnectStage =
	| "consent"
	| "verify"
	| "metadata"
	| "vault-write"
	| "binding-save"
	| "cleanup"
	| "list-fetch"
	| "restore-vault"
	| "restore-verify";
function failAt(stage: ConnectStage): never {
	log.warn(`issue connection failed at ${stage}`);
	throw new CodedError("RESOURCE_UNAVAILABLE", "Issue connection unavailable.");
}

function invalid(): never {
	throw new CodedError("RANGE_INVALID", "Invalid Issue binding.");
}

function unavailable(message: string): never {
	throw new CodedError("RESOURCE_UNAVAILABLE", message);
}

function bindingOf(projectId: string, instanceUrl: string, remoteProjectId: string): IssueBinding {
	if (
		typeof projectId !== "string" ||
		!projectId.trim() ||
		!isIssueReference({ provider: "gitlab", instanceUrl, projectId: remoteProjectId, number: 1 }) ||
		!/^[1-9]\d*$/.test(remoteProjectId) ||
		!Number.isSafeInteger(Number(remoteProjectId))
	)
		invalid();
	return {
		projectId,
		instanceUrl: canonicalIssueInstanceUrl(instanceUrl) ?? invalid(),
		remoteProjectId,
	};
}

/** Reads only; workflow actions still reject unknown or conflicting labels before any write. */
function stageOf(issue: GitLabIssue): IssueStage {
	if (issue.state === "closed") return "closed";
	const workflow = issue.labels.filter((label) => label.toLowerCase().startsWith("workflow::"));
	if (workflow.length !== 1) return "backlog";
	const [label] = workflow;
	return label === "workflow::in-progress"
		? "in-progress"
		: label === "workflow::in-review"
			? "in-review"
			: "backlog";
}

function projectPath(path: string): string {
	// GitLab project paths contain slug segments. Do not interpret API text as a URL.
	const parts = path.split("/");
	if (parts.length < 2 || parts.some((part) => !/^[a-z\d_][a-z\d_.-]*$/i.test(part))) invalid();
	return parts.join("/");
}

export async function createIssuesService({
	persistence,
	credentialStore,
	fetch,
}: IssuesServiceOptions): Promise<IssuesService> {
	const bindings = new Map<string, IssueStoredBinding>();
	const clients = new Map<string, { client: IssueWorkflowRemote; path: string }>();
	type Operation = { cancelled: boolean; done: Promise<unknown> };
	const pending = new Map<string, Operation>();
	const disconnecting = new Map<string, Promise<void>>();
	const blocked = new Set<string>();
	try {
		for (const row of await persistence.load()) {
			const binding = storedBinding(row);
			if (bindings.has(binding.projectId)) invalid();
			bindings.set(binding.projectId, binding);
		}
	} catch {
		return unavailable("Issue bindings could not be loaded.");
	}
	const connection = (id: string): IssueConnection | null => {
		const binding = bindings.get(id);
		return binding ? { ...publicBinding(binding), connected: clients.has(id) } : null;
	};
	const check = (operation: Operation) => {
		if (operation.cancelled) unavailable("Issue connection was cancelled.");
	};
	const save = async (binding: IssueStoredBinding) => {
		try {
			await persistence.save(structuredClone(binding));
		} catch {
			unavailable("Issue binding could not be saved.");
		}
		bindings.set(binding.projectId, binding);
	};
	const cleanup = async (id: string, operation?: Operation) => {
		const binding = bindings.get(id);
		if (!binding?.cleanupCredentialIds?.length) return;
		for (const key of binding.cleanupCredentialIds) {
			try {
				await credentialStore.delete(key);
			} catch {
				unavailable("Issue credential cleanup failed.");
			}
			if (operation) check(operation);
		}
		await save({ ...binding, cleanupCredentialIds: [] });
		if (operation) check(operation);
	};
	const run = <T>(id: string, work: (operation: Operation) => Promise<T>): Promise<T> => {
		const operation: Operation = { cancelled: false, done: Promise.resolve() };
		pending.set(id, operation);
		const done = Promise.resolve()
			.then(() => {
				check(operation);
				return work(operation);
			})
			.finally(() => {
				if (pending.get(id) === operation) pending.delete(id);
			});
		operation.done = done;
		return done;
	};
	const makeClient = (instanceUrl: string, project: string, token: string) =>
		createGitLabClient({ instanceUrl, project, token, ...(fetch ? { fetch } : {}) });
	return {
		connection,
		connect(projectId, input) {
			if (
				typeof projectId !== "string" ||
				!projectId.trim() ||
				!isIssueConnectionInput(input) ||
				!validToken(input.token)
			)
				return Promise.reject(new CodedError("RANGE_INVALID", "Invalid Issue binding."));
			if (pending.has(projectId) || disconnecting.has(projectId) || blocked.has(projectId))
				return Promise.reject(
					new CodedError("RESOURCE_UNAVAILABLE", "Issue connection is busy or blocked."),
				);
			return run(projectId, async (operation) => {
				const instanceUrl = canonicalIssueInstanceUrl(input.instanceUrl) ?? invalid();
				const previous = bindings.get(projectId);
				if (
					!hasIssueHttpConsent(
						input,
						previous?.httpConsentInstanceUrl
							? { instanceUrl: previous.httpConsentInstanceUrl }
							: undefined,
					)
				)
					invalid();
				const project = await makeClient(instanceUrl, input.projectId, input.token)
					.project()
					.catch(() => failAt("verify"));
				check(operation);
				const path = projectPath(project.pathWithNamespace);
				const binding: IssueStoredBinding = bindingOf(projectId, instanceUrl, String(project.id));
				if (
					[...Object.values(binding), `${instanceUrl}/${path}/-/issues/`].some(
						(field) =>
							field.includes(input.token) || field.includes(encodeURIComponent(input.token)),
					)
				)
					invalid();
				if (instanceUrl.startsWith("http:")) binding.httpConsentInstanceUrl = instanceUrl;
				await cleanup(projectId, operation).catch(() => failAt("cleanup"));
				check(operation);
				const old = bindings.get(projectId);
				const credentialId = crypto.randomUUID();
				// Persist a deletion marker BEFORE a potentially uncertain vault write.
				const staged: IssueStoredBinding = {
					...(old ?? binding),
					cleanupCredentialIds: [credentialId],
				};
				await save(staged).catch(() => failAt("binding-save"));
				check(operation);
				try {
					await credentialStore.set(credentialId, input.token).catch(() => failAt("vault-write"));
					check(operation);
					await save({
						...binding,
						credentialId,
						cleanupCredentialIds: old?.credentialId ? [old.credentialId] : [],
					}).catch(() => failAt("binding-save"));
				} catch {
					// Never delete an active key, even if cancellation raced a successful metadata save.
					if (bindings.get(projectId)?.credentialId !== credentialId) {
						try {
							await cleanup(projectId);
						} catch {
							/* durable marker retains cleanup debt */
						}
					}
					unavailable("Issue credential or binding could not be saved.");
				}
				check(operation);
				clients.set(projectId, {
					client: makeClient(instanceUrl, binding.remoteProjectId, input.token),
					path,
				});
				// Cleanup failure is reported, but the committed replacement remains live.
				await cleanup(projectId, operation);
				check(operation);
				return connection(projectId) ?? invalid();
			});
		},
		restore(projectId) {
			if (blocked.has(projectId) || disconnecting.has(projectId))
				return Promise.reject(
					new CodedError("RESOURCE_UNAVAILABLE", "Issue connection is blocked."),
				);
			const existing = pending.get(projectId);
			if (existing) return existing.done as Promise<IssueConnection | null>;
			if (clients.has(projectId)) return Promise.resolve(connection(projectId));
			return run(projectId, async (operation) => {
				await cleanup(projectId, operation);
				check(operation);
				const binding = bindings.get(projectId);
				if (!binding?.credentialId) return connection(projectId);
				let token: string | null;
				try {
					token = await credentialStore.get(binding.credentialId);
				} catch {
					log.warn("issue connection failed at restore-vault");
					unavailable("Issue credential could not be loaded.");
				}
				check(operation);
				if (token === null) return connection(projectId);
				if (!validToken(token)) invalid();
				const input = {
					instanceUrl: binding.instanceUrl,
					projectId: binding.remoteProjectId,
					token,
				};
				if (
					!hasIssueHttpConsent(
						input,
						binding.httpConsentInstanceUrl
							? { instanceUrl: binding.httpConsentInstanceUrl }
							: undefined,
					)
				)
					invalid();
				const client = makeClient(binding.instanceUrl, binding.remoteProjectId, token);
				const project = await client.project().catch(() => failAt("restore-verify"));
				check(operation);
				if (String(project.id) !== binding.remoteProjectId) invalid();
				const path = projectPath(project.pathWithNamespace);
				if (
					[...Object.values(publicBinding(binding)), path].some(
						(field) => field.includes(token) || field.includes(encodeURIComponent(token)),
					)
				)
					invalid();
				clients.set(projectId, { client, path });
				return connection(projectId);
			});
		},
		disconnect(projectId) {
			clients.delete(projectId);
			blocked.add(projectId);
			const operation = pending.get(projectId);
			if (operation) operation.cancelled = true;
			const existing = disconnecting.get(projectId);
			if (existing) return existing;
			const done = (async () => {
				if (operation) await operation.done.catch(() => {});
				const binding = bindings.get(projectId);
				if (binding) {
					const keys = [
						...new Set([
							...(binding.cleanupCredentialIds ?? []),
							...(binding.credentialId ? [binding.credentialId] : []),
						]),
					];
					if (keys.length > maxCleanup) invalid();
					const retired = { ...binding, cleanupCredentialIds: keys };
					delete retired.credentialId;
					await save(retired);
					await cleanup(projectId);
				}
				blocked.delete(projectId);
			})().finally(() => disconnecting.delete(projectId));
			disconnecting.set(projectId, done);
			return done;
		},
		remoteFor(projectId, reference) {
			if (!isIssueReference(reference)) invalid();
			const binding = bindings.get(projectId);
			const connected = clients.get(projectId);
			if (!binding || !connected) return unavailable("Issue project is not connected.");
			if (
				reference.instanceUrl !== binding.instanceUrl ||
				reference.projectId !== binding.remoteProjectId
			)
				invalid();
			return connected.client;
		},
		workflowFor(projectId, reference) {
			if (!isIssueReference(reference)) invalid();
			if (reference.provider !== "gitlab")
				throw new CodedError(
					"RESOURCE_UNAVAILABLE",
					"Issue workflow actions are unavailable for this provider.",
				);
			const binding = bindings.get(projectId);
			const connected = clients.get(projectId);
			if (!binding || !connected) return unavailable("Issue project is not connected.");
			if (
				reference.instanceUrl !== binding.instanceUrl ||
				reference.projectId !== binding.remoteProjectId
			)
				invalid();
			return connected.client;
		},
		async list(projectId) {
			const binding = bindings.get(projectId);
			const connected = clients.get(projectId);
			if (!binding || !connected) return unavailable("Issue project is not connected.");
			const issues = await connected.client.issues().catch(() => failAt("list-fetch"));
			if (clients.get(projectId) !== connected)
				unavailable("Issue connection changed during the read.");
			return {
				issues: issues.map((issue) => ({
					reference: {
						provider: "gitlab",
						instanceUrl: binding.instanceUrl,
						projectId: binding.remoteProjectId,
						number: issue.iid,
					},
					title: issue.title,
					url: `${binding.instanceUrl}/${connected.path}/-/issues/${issue.iid}`,
					labels: issue.labels,
					stage: stageOf(issue),
					updatedAt: issue.updatedAt,
				})),
				fetchedAt: new Date().toISOString(),
			};
		},
	};
}
