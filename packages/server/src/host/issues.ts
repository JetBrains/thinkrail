import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	canonicalIssueInstanceUrl,
	ISSUES_DESIGN_APPROVAL_PROTOCOL_VERSION,
	type IssueTarget,
	isIssueConnectionInput,
	isIssueTarget,
} from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";
import { sessionReuseStatus, startInitialSessionPrompt } from "../agent";
import { gitAsync, originUrls } from "../git";
import {
	createIssuesService,
	type IssueCredentialStore,
	type IssueStoredBinding,
	type IssuesService,
	type IssuesServiceOptions,
	type WorkflowRecord,
} from "../issues";
import { logger } from "../log";
import { dataDir } from "../persistence";
import { getProjects } from "../projects";
import { getConfig } from "../settings";
import { getWorkspace } from "../workspaces";
import {
	createIssueAgentSessionHost,
	type IssueAgentSessionHostOptions,
} from "./issueAgentSessions";
import { createIssueCredentials } from "./issueCredentials";
import { createIssueSessionStore, type IssueSessionStore } from "./issueSessions";
import { createIssuesActions, type IssueActionSessions, privateDirectory } from "./issuesActions";
import { createIssueWorkflowPersistence } from "./issueWorkflowPersistence";

function invalid(): never {
	throw new CodedError("RANGE_INVALID", "Invalid Issue request.");
}
function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: string[]): boolean {
	return (
		Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
	);
}
const connectionKeys = ["instanceUrl", "projectId", "token"];
function request(
	params: unknown,
	connect = false,
): Record<string, unknown> & { projectId: string } {
	if (
		!record(params) ||
		!exact(params, connect ? ["projectId", "input"] : ["projectId"]) ||
		typeof params.projectId !== "string" ||
		!params.projectId.trim()
	)
		invalid();
	if (connect) {
		if (!record(params.input)) invalid();
		const keys = Object.keys(params.input);
		if (
			connectionKeys.some((key) => !keys.includes(key)) ||
			keys.some((key) => ![...connectionKeys, "httpConsent"].includes(key)) ||
			!isIssueConnectionInput(params.input)
		)
			invalid();
	}
	return params as Record<string, unknown> & { projectId: string };
}
function project(projectId: string, trusted: boolean) {
	const found = getProjects().find((candidate) => candidate.id === projectId);
	if (!found) throw new CodedError("RESOURCE_UNAVAILABLE", "Issue project is unavailable.");
	if (trusted && found.trusted !== true)
		throw new CodedError("RESOURCE_UNAVAILABLE", "Issue project requires trust.");
	return found;
}

/** Exact shared target only: no caller version, path, actor or credential reaches the read. */
function designTarget(params: unknown): IssueTarget {
	if (!isIssueTarget(params)) invalid();
	return { projectId: params.projectId, reference: { ...params.reference } };
}

/**
 * A design receipt is readable only while it is settled (`approved` and not pending); the
 * digest is the receipt's own publication version, never a re-derived or caller-supplied one.
 * Implementation receipts are deliberately not consulted.
 */
function approvedDesignVersion(record: WorkflowRecord | null): string | null {
	const design = record?.design;
	if (!record || record.pending || design?.approved !== true) return null;
	return design.publication.version;
}

/**
 * Exactly one remote named `origin`, read from local config only: no fetch, no credential
 * helper, no network. Several remotes or a differently named one are ambiguous, never guessed.
 */
async function originRepositoryUrl(path: string): Promise<string | null> {
	const remotes = await gitAsync(path, ["remote"]);
	if (!remotes.ok) return null;
	const names = remotes.out.split(/\r?\n/).filter((name) => name !== "");
	if (names.length !== 1 || names[0] !== "origin") return null;
	return safeRepositoryUrl((await originUrls(path)).fetch);
}

/**
 * Credential-free canonical HTTP(S) only, returned as the remote spells it minus terminal
 * slashes: SSH/SCP, userinfo, query and fragment forms all stay null. The web resolver parses
 * the instance/project split; this never echoes git output.
 */
function safeRepositoryUrl(value: string | null): string | null {
	if (value === null) return null;
	const address = value.replace(/\/+$/, "");
	return canonicalIssueInstanceUrl(address) === null ? null : address;
}

const storedKeys = ["projectId", "instanceUrl", "remoteProjectId"];
const optionalStoredKeys = ["credentialId", "httpConsentInstanceUrl", "cleanupCredentialIds"];
function storedRow(value: Record<string, unknown>): boolean {
	const keys = Object.keys(value);
	return (
		storedKeys.every((key) => typeof value[key] === "string") &&
		keys.every((key) => [...storedKeys, ...optionalStoredKeys].includes(key)) &&
		(value.credentialId === undefined || typeof value.credentialId === "string") &&
		(value.httpConsentInstanceUrl === undefined ||
			typeof value.httpConsentInstanceUrl === "string") &&
		(value.cleanupCredentialIds === undefined ||
			(Array.isArray(value.cleanupCredentialIds) &&
				value.cleanupCredentialIds.every((id) => typeof id === "string")))
	);
}

// Synchronous read/merge/atomic-replace is one process-local critical section, including
// across adapter instances. Never hold an old loaded snapshot across an await before save.
function persistence(dir: string): IssuesServiceOptions["persistence"] {
	const file = join(dir, "issue-bindings.json");
	function load(): IssueStoredBinding[] {
		let text: string;
		try {
			text = readFileSync(file, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
			throw error;
		}
		const rows: unknown = JSON.parse(text);
		if (!Array.isArray(rows) || !rows.every((row) => record(row) && storedRow(row))) invalid();
		return rows as IssueStoredBinding[];
	}
	return {
		async load() {
			return load();
		},
		async save(binding) {
			const rows = load().filter((row) => row.projectId !== binding.projectId);
			// Explicit projection: no input, client or token can enter this file.
			rows.push({
				projectId: binding.projectId,
				instanceUrl: binding.instanceUrl,
				remoteProjectId: binding.remoteProjectId,
				...(binding.credentialId ? { credentialId: binding.credentialId } : {}),
				...(binding.httpConsentInstanceUrl
					? { httpConsentInstanceUrl: binding.httpConsentInstanceUrl }
					: {}),
				...(binding.cleanupCredentialIds?.length
					? { cleanupCredentialIds: [...binding.cleanupCredentialIds] }
					: {}),
			});
			mkdirSync(dir, { recursive: true });
			const temporary = `${file}.${randomUUID()}.tmp`;
			try {
				writeFileSync(temporary, `${JSON.stringify(rows, null, "\t")}\n`, { mode: 0o600 });
				renameSync(temporary, file);
			} finally {
				rmSync(temporary, { force: true });
			}
		},
	};
}

const log = logger("issues");

/** Host-only composition seam; credentials remain solely inside the issues service. */
export function createIssuesHost(
	options: {
		dir?: string;
		fetch?: IssuesServiceOptions["fetch"];
		sessions?: IssueActionSessions;
		start?: IssueAgentSessionHostOptions["start"];
		/** Tests must inject a disposable store; production uses the host OS vault. */
		credentials?: IssueCredentialStore;
	} = {},
) {
	const root = resolve(options.dir ?? dataDir());
	const credentials =
		options.credentials ?? createIssueCredentials({ namespace: `profile:${root}` });
	let pending: Promise<IssuesService> | undefined;
	function service(): Promise<IssuesService> {
		if (!pending) {
			pending = createIssuesService({
				persistence: persistence(root),
				credentialStore: credentials,
				...(options.fetch ? { fetch: options.fetch } : {}),
			}).catch((error) => {
				pending = undefined;
				throw error;
			});
		}
		return pending;
	}
	async function restore(projectId: string, trusted: boolean): Promise<void> {
		const issues = await service();
		project(projectId, trusted);
		await issues.restore(projectId);
		project(projectId, trusted);
	}
	let store: IssueSessionStore | undefined;
	const agentSessions = createIssueAgentSessionHost({
		service,
		store: () => {
			if (!store) {
				privateDirectory(root);
				const path = join(root, "issue-sessions");
				privateDirectory(path);
				store = createIssueSessionStore(path);
			}
			return store;
		},
		project: (id) => project(id, true),
		workspace: getWorkspace,
		status: options.sessions?.status ?? sessionReuseStatus,
		start:
			options.start ?? ((id, _workspaceId, _cwd, prompt) => startInitialSessionPrompt(id, prompt)),
		locale: () => {
			const locale = getConfig().locale;
			return locale === "system" ? Intl.DateTimeFormat().resolvedOptions().locale : locale;
		},
	});
	return {
		agentSessions,
		...createIssuesActions(service, root, options.sessions, agentSessions),
		async connection(params: unknown) {
			const { projectId } = request(params);
			project(projectId, false);
			// A saved credential restores on its own; stage actions still require project trust.
			await restore(projectId, false);
			return (await service()).connection(projectId);
		},
		async connect(params: unknown) {
			const { projectId, input } = request(params, true);
			if (!getProjects().some((candidate) => candidate.id === projectId)) {
				log.warn("issues connect rejected: unknown project");
				project(projectId, false);
			}
			project(projectId, false);
			const issues = await service();
			// Reconstruct the write-only input; do not retain the ingress envelope.
			if (!isIssueConnectionInput(input)) invalid();
			return issues.connect(projectId, {
				instanceUrl: input.instanceUrl,
				projectId: input.projectId,
				token: input.token,
				...(input.httpConsent ? { httpConsent: input.httpConsent } : {}),
			});
		},
		async disconnect(params: unknown) {
			const { projectId } = request(params);
			project(projectId, false);
			// Await deletion: success is only reported after credentials are gone.
			await (await service()).disconnect(projectId);
			return { ok: true } as const;
		},
		async list(params: unknown) {
			const { projectId } = request(params);
			project(projectId, false);
			await restore(projectId, false);
			return (await service()).list(projectId);
		},
		async designApproval(params: unknown, protocolVersion?: number) {
			if (
				protocolVersion !== undefined &&
				protocolVersion < ISSUES_DESIGN_APPROVAL_PROTOCOL_VERSION
			)
				throw new CodedError(
					"RESOURCE_UNAVAILABLE",
					"Issue design approvals are unavailable for this protocol version.",
				);
			const target = designTarget(params);
			// Membership only: this reads a receipt digest, never a credential or remote state.
			project(target.projectId, false);
			const receipts = join(root, "issue-workflow");
			// No store means no receipt at all; a read never creates or repairs one.
			if (!existsSync(receipts)) return { approvedDesignVersion: null };
			const record = await createIssueWorkflowPersistence(receipts).load(target.reference);
			return { approvedDesignVersion: approvedDesignVersion(record) };
		},
		async repositoryAddress(params: unknown) {
			const { projectId } = request(params);
			const found = project(projectId, true);
			return { repositoryUrl: await originRepositoryUrl(found.path) };
		},
	};
}

export const issuesHost = createIssuesHost();
export const issuesBeginDesign = issuesHost.beginDesign;
export const issuesBeginImplementation = issuesHost.beginImplementation;
export const issuesApproveDesign = issuesHost.approveDesign;
export const issuesApproveImplementation = issuesHost.approveImplementation;
export const issuesConnection = issuesHost.connection;
export const issuesConnect = issuesHost.connect;
export const issuesDesignApproval = issuesHost.designApproval;
export const issuesDisconnect = issuesHost.disconnect;
export const issuesList = issuesHost.list;
export const issuesLaunchDesign = issuesHost.launchDesign;
export const issuesLaunchImplementation = issuesHost.launchImplementation;
export const issuesPublishDesign = issuesHost.publishDesign;
export const issuesPublishImplementation = issuesHost.publishImplementation;
export const issuesRepositoryAddress = issuesHost.repositoryAddress;
export const issuesStartImplementation = issuesHost.startImplementation;
export const issuesValidateDesign = issuesHost.validateDesign;
export const issuesValidateImplementation = issuesHost.validateImplementation;
