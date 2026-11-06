import { CodedError } from "@thinkrail/shared/codedError";
import { logger } from "../log";
import type {
	IssueLabelEvent,
	IssueMember,
	IssueMergeRequest,
	IssueMergeRequestInput,
	IssueNote,
	IssueProject,
	IssueRecord,
	IssueUpdate,
	IssueWorkflowRemote,
} from "./remote";

export type GitLabIssue = IssueRecord;
export type GitLabNote = IssueNote;
export type GitLabLabelEvent = IssueLabelEvent;
export type GitLabMember = IssueMember;
export type GitLabMergeRequest = IssueMergeRequest;
export type GitLabIssueUpdate = IssueUpdate;
export type GitLabMergeRequestInput = IssueMergeRequestInput;
export interface GitLabClientOptions {
	instanceUrl: string;
	project: string | number;
	token: string;
	fetch?: (url: string, init: RequestInit) => Promise<Response>;
	timeoutMs?: number;
	maxBytes?: number;
	maxPages?: number;
	maxItems?: number;
}
export type GitLabProject = IssueProject;
export type GitLabClient = IssueWorkflowRemote;

const log = logger("issues");

function invalid(): never {
	throw new CodedError("RANGE_INVALID", "Invalid Issue API input or response.");
}
function unavailable(): CodedError {
	return new CodedError("RESOURCE_UNAVAILABLE", "Issue API request unavailable.");
}
function limit(): never {
	throw new CodedError("RESOURCE_UNAVAILABLE", "Issue API resource limit exceeded.");
}
function positive(value: number): number {
	if (!Number.isSafeInteger(value) || value <= 0) invalid();
	return value;
}
function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
	return value as Record<string, unknown>;
}
function text(value: unknown): string {
	if (typeof value !== "string") invalid();
	return value;
}
function id(value: unknown): number {
	if (typeof value !== "number") invalid();
	return positive(value);
}
function timestamp(value: unknown): string {
	const result = text(value);
	if (!Number.isFinite(Date.parse(result))) invalid();
	return result;
}
function issue(value: unknown): GitLabIssue {
	const v = record(value);
	if (!Array.isArray(v.labels) || (v.state !== "opened" && v.state !== "closed")) invalid();
	return {
		iid: id(v.iid),
		title: text(v.title),
		description: v.description === null ? "" : text(v.description),
		state: v.state,
		labels: v.labels.map(text),
		updatedAt: timestamp(v.updated_at),
	};
}
function identifier(value: unknown): string {
	const result = text(value);
	if (
		!result ||
		result.trim() !== result ||
		[...result].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
	)
		invalid();
	return result;
}
function commitSha(value: unknown): string {
	const result = text(value);
	if (!/^[a-fA-F0-9]{40}$/.test(result)) invalid();
	return result;
}
function nullable<T>(value: unknown, parse: (value: unknown) => T): T | null {
	return value == null ? null : parse(value);
}
function boolean(value: unknown): boolean {
	if (typeof value !== "boolean") invalid();
	return value;
}
function branchName(value: unknown): string {
	const result = identifier(value);
	if (
		/\s/.test(result) ||
		[...result].some(
			(character) => "~^:?*[".includes(character) || character.charCodeAt(0) === 92,
		) ||
		result.includes("..") ||
		result.includes("@{") ||
		result === "@" ||
		result.startsWith("-") ||
		result.endsWith(".") ||
		result.split("/").some((part) => !part || part.startsWith(".") || part.endsWith(".lock"))
	)
		invalid();
	return result;
}
// A self-hosted instance may serve HTTP only; both schemes stay accepted, credentials never.
function httpCloneUrl(value: unknown): string {
	const result = identifier(value);
	const url = new URL(result);
	if (
		!(url.protocol === "https:" || url.protocol === "http:") ||
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.href !== result ||
		url.pathname === "/"
	)
		invalid();
	return result;
}
function sshCloneUrl(value: unknown): string {
	const result = identifier(value);
	if (/\s|[?#]/.test(result) || [...result].some((character) => character.charCodeAt(0) === 92))
		invalid();
	if (result.startsWith("ssh://")) {
		const url = new URL(result);
		if (
			!url.hostname ||
			url.password ||
			url.search ||
			url.hash ||
			!url.pathname ||
			url.pathname === "/" ||
			url.href !== result
		)
			invalid();
	} else if (!/^(?:[a-zA-Z0-9._-]+@)?[a-zA-Z0-9.-]+:[^:]+$/.test(result)) invalid();
	return result;
}
function mergeRequest(value: unknown): GitLabMergeRequest {
	const v = record(value);
	if (v.state !== "opened" && v.state !== "closed" && v.state !== "merged" && v.state !== "locked")
		invalid();
	const webUrl = identifier(v.web_url);
	const url = new URL(webUrl);
	if (
		!(url.protocol === "https:" || url.protocol === "http:") ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	)
		invalid();
	return {
		id: id(v.id),
		iid: id(v.iid),
		webUrl,
		state: v.state,
		sourceBranch: identifier(v.source_branch),
		targetBranch: identifier(v.target_branch),
		sha: nullable(v.sha, commitSha),
		mergeStatus: identifier(v.merge_status),
		sourceProjectId: nullable(v.source_project_id, id),
		targetProjectId: nullable(v.target_project_id, id),
		draft: nullable(v.draft, boolean),
		detailedMergeStatus: nullable(v.detailed_merge_status, identifier),
		mergeCommitSha: nullable(v.merge_commit_sha, commitSha),
		squashCommitSha: nullable(v.squash_commit_sha, commitSha),
		headPipeline: nullable(v.head_pipeline, (value) => {
			const pipeline = record(value);
			return {
				id: nullable(pipeline.id, id),
				sha: nullable(pipeline.sha, commitSha),
				status: identifier(pipeline.status),
			};
		}),
	};
}
function matchingIid<T extends { iid: number }>(parse: (value: unknown) => T, iid: number) {
	return (value: unknown): T => {
		const result = parse(value);
		if (result.iid !== iid) invalid();
		return result;
	};
}
function note(value: unknown): GitLabNote {
	const v = record(value);
	return { id: id(v.id), body: text(v.body), createdAt: timestamp(v.created_at) };
}
function labelEvent(value: unknown): GitLabLabelEvent {
	const v = record(value);
	if (v.action !== "add" && v.action !== "remove") invalid();
	return {
		id: id(v.id),
		action: v.action,
		userId: id(record(v.user).id),
		label: v.label === null ? null : text(record(v.label).name),
		createdAt: timestamp(v.created_at),
	};
}
export function createGitLabClient(options: GitLabClientOptions): GitLabClient {
	let base: URL;
	try {
		base = new URL(options.instanceUrl);
	} catch {
		return invalid();
	}
	if (
		!["https:", "http:"].includes(base.protocol) ||
		base.username ||
		base.password ||
		base.search ||
		base.hash ||
		!options.token ||
		/[\r\n]/.test(options.token)
	)
		invalid();
	const project =
		typeof options.project === "number" ? String(positive(options.project)) : options.project;
	if (
		!project ||
		project.trim() !== project ||
		/[?#\\]/.test(project) ||
		[...project].some((character) => character.charCodeAt(0) < 32) ||
		project.split("/").some((part) => !part || part === "." || part === "..")
	)
		invalid();
	const timeoutMs = positive(options.timeoutMs ?? 15000);
	const maxBytes = positive(options.maxBytes ?? 2_000_000);
	const maxPages = positive(options.maxPages ?? 100);
	const maxItems = positive(options.maxItems ?? 10000);
	if (timeoutMs > 60000 || maxBytes > 10_000_000 || maxPages > 1000 || maxItems > 100000) invalid();
	const apiRoot = `${base.toString().replace(/\/$/, "")}/api/v4`;
	const root = `${apiRoot}/projects/${encodeURIComponent(project)}`;
	const fetcher = options.fetch ?? fetch;
	const token = options.token;
	const encodedToken = encodeURIComponent(token);
	const escapedToken = JSON.stringify(token).slice(1, -1);
	if (root.includes(token) || root.includes(encodedToken)) invalid();
	async function request(
		path: string,
		deadline: number,
		write?: { method: "POST" | "PUT"; body: string },
		requestRoot = root,
	): Promise<{ value: unknown; next: string | null }> {
		const remaining = deadline - Date.now();
		if (remaining <= 0) throw unavailable();
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
		const work = async () => {
			const response = await fetcher(`${requestRoot}${path}`, {
				...(write ? { method: write.method, body: write.body } : {}),
				headers: {
					"PRIVATE-TOKEN": token,
					Accept: "application/json",
					...(write ? { "Content-Type": "application/json" } : {}),
				},
				redirect: "error",
				signal: controller.signal,
			});
			if (response.status < 200 || response.status >= 300 || response.redirected) {
				await response.body?.cancel();
				// Classifier only: the status and redirect flag, never the URL, headers or body.
				log.warn(
					`gitlab request rejected (status ${response.status}${response.redirected ? ", redirected" : ""})`,
				);
				throw unavailable();
			}
			const length = response.headers.get("content-length");
			if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) {
				await response.body?.cancel();
				limit();
			}
			const reader = response.body?.getReader();
			if (!reader) invalid();
			activeReader = reader;
			const chunks: Uint8Array[] = [];
			let size = 0;
			try {
				while (true) {
					const part = await reader.read();
					if (part.done) break;
					size += part.value.byteLength;
					if (size > maxBytes) {
						await reader.cancel();
						limit();
					}
					chunks.push(part.value);
				}
			} finally {
				reader.releaseLock();
			}
			const bytes = new Uint8Array(size);
			let offset = 0;
			for (const chunk of chunks) {
				bytes.set(chunk, offset);
				offset += chunk.byteLength;
			}
			const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
			const serialized = JSON.stringify(value);
			if (
				serialized.includes(token) ||
				serialized.includes(escapedToken) ||
				serialized.includes(encodedToken)
			)
				throw unavailable();
			return { value, next: response.headers.get("x-next-page") };
		};
		try {
			return await Promise.race([
				work(),
				new Promise<never>((_resolve, reject) => {
					timer = setTimeout(() => {
						controller.abort();
						reject(unavailable());
					}, remaining);
				}),
			]);
		} catch {
			controller.abort();
			void activeReader?.cancel().catch(() => undefined);
			throw unavailable();
		} finally {
			if (timer !== undefined) clearTimeout(timer);
		}
	}
	async function list<T>(path: string, parse: (value: unknown) => T): Promise<T[]> {
		const result: T[] = [];
		const deadline = Date.now() + timeoutMs;
		for (let page = 1; page <= maxPages; page++) {
			const response = await request(
				`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
				deadline,
			);
			if (!Array.isArray(response.value)) invalid();
			if (response.value.length > 100 || result.length + response.value.length > maxItems) limit();
			result.push(...response.value.map(parse));
			if (response.next === "") return result;
			if (response.next === null) {
				if (response.value.length < 100) return result;
			} else if (response.next !== String(page + 1)) invalid();
		}
		return limit();
	}
	async function decoded<T>(
		path: string,
		parse: (value: unknown) => T,
		write?: { method: "POST" | "PUT"; body: Record<string, unknown> },
		requestRoot = root,
	): Promise<T> {
		const payload = write && { method: write.method, body: JSON.stringify(write.body) };
		if (payload && (payload.body.includes(escapedToken) || payload.body.includes(encodedToken)))
			invalid();
		try {
			return parse((await request(path, Date.now() + timeoutMs, payload, requestRoot)).value);
		} catch {
			// A failed write may already have reached GitLab. Callers must reconcile it.
			throw unavailable();
		}
	}
	return {
		updateIssue: async (iid, input) => {
			const path = `/issues/${positive(iid)}`;
			record(input);
			const body: Record<string, unknown> = {};
			if (input.description !== undefined) body.description = text(input.description);
			if (input.labels !== undefined) {
				if (!Array.isArray(input.labels)) invalid();
				body.labels = input.labels
					.map((label) => {
						const value = identifier(label);
						if (value.includes(",")) invalid();
						return value;
					})
					.join(",");
			}
			if (Object.keys(body).length === 0) invalid();
			return decoded(path, matchingIid(issue, iid), { method: "PUT", body });
		},
		addNote: async (iid, body) =>
			decoded(`/issues/${positive(iid)}/notes`, note, {
				method: "POST",
				body: { body: text(body) },
			}),
		mergeRequests: async (sourceBranch) => {
			const branch = identifier(sourceBranch);
			const query = new URLSearchParams({ source_branch: branch, scope: "all", state: "all" });
			if (branch.includes(token) || query.toString().includes(encodedToken)) invalid();
			const path = `/merge_requests?${query}`;
			try {
				return await list(path, (value) => {
					const result = mergeRequest(value);
					if (result.sourceBranch !== branch) invalid();
					return result;
				});
			} catch {
				throw unavailable();
			}
		},
		createMergeRequest: async (input) => {
			record(input);
			return decoded("/merge_requests", mergeRequest, {
				method: "POST",
				body: {
					source_branch: identifier(input.sourceBranch),
					target_branch: identifier(input.targetBranch),
					title: identifier(input.title),
					description: text(input.description),
				},
			});
		},
		mergeRequest: async (iid) =>
			decoded(`/merge_requests/${positive(iid)}`, matchingIid(mergeRequest, iid)),
		mergeMergeRequest: async (iid, sha) =>
			decoded(`/merge_requests/${positive(iid)}/merge`, matchingIid(mergeRequest, iid), {
				method: "PUT",
				body: { sha: commitSha(sha) },
			}),
		closeIssue: async (iid) =>
			decoded(`/issues/${positive(iid)}`, matchingIid(issue, iid), {
				method: "PUT",
				body: { state_event: "close" },
			}),
		provider: "gitlab" as const,
		project: () =>
			decoded("", (response) => {
				const value = record(response);
				const projectId = id(value.id);
				if (/^\d+$/.test(project) && projectId !== Number(project)) invalid();
				return {
					id: projectId,
					pathWithNamespace: text(value.path_with_namespace),
					defaultBranch: nullable(value.default_branch, branchName),
					httpUrlToRepo: nullable(value.http_url_to_repo, httpCloneUrl),
					sshUrlToRepo: nullable(value.ssh_url_to_repo, sshCloneUrl),
				};
			}),
		currentUser: () =>
			decoded("/user", (value) => ({ id: id(record(value).id) }), undefined, apiRoot),
		issue: async (iid) =>
			issue((await request(`/issues/${positive(iid)}`, Date.now() + timeoutMs)).value),
		issues: () => list("/issues", issue),
		notes: (iid) => list(`/issues/${positive(iid)}/notes`, note),
		labelEvents: (iid) => list(`/issues/${positive(iid)}/resource_label_events`, labelEvent),
		member: async (userId) => {
			const v = record(
				(await request(`/members/all/${positive(userId)}`, Date.now() + timeoutMs)).value,
			);
			if (
				id(v.id) !== userId ||
				typeof v.access_level !== "number" ||
				!Number.isSafeInteger(v.access_level)
			)
				invalid();
			return { userId, accessLevel: v.access_level };
		},
	};
}
