import { createHash } from "node:crypto";
import {
	closeSync,
	fstatSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	readSync,
	writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { IssueReference } from "@thinkrail/contracts";
import { isIssueReference } from "@thinkrail/contracts";
import { CodedError } from "@thinkrail/shared/codedError";

const maxRecordBytes = 65536;
const maxRevisions = 10000;
export type IssueDeliveryPolicy = "draft" | "auto-merge" | "manual";
export type ValidationResult =
	| "passed"
	| "failed"
	| "skipped"
	| "not-run"
	| "not-applicable"
	| "environment-limited";
export interface IssueValidationEvidence {
	command: string;
	result: ValidationResult;
	sha: string;
	tree: string;
	targetBranch: string;
	toolVersion: string;
	platform: string;
	observedAt: string;
	source: "host-observed" | "agent-reported";
}
export interface IssueDeliveryRepositoryState {
	projectId: string;
	worktreeId: string;
	sourceBranch: string;
	targetBranch: string;
	policy: IssueDeliveryPolicy;
	dependsOn: string[];
	checkoutSha: string;
	checkoutTree: string;
	mergeRequest?: {
		iid: number;
		webUrl: string;
		headSha: string;
		targetBranch: string;
		state: string;
	};
	validations: IssueValidationEvidence[];
	updatedAt: string;
}
export interface IssueDeliveryStateRecord {
	revision: number;
	repositories: IssueDeliveryRepositoryState[];
}
function stop(): never {
	throw new CodedError("RESOURCE_UNAVAILABLE", "Issue delivery state requires reconciliation.");
}
function object(value: unknown): value is Record<string, unknown> {
	return (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) === Object.prototype
	);
}
function exact(
	value: Record<string, unknown>,
	required: string[],
	optional: string[] = [],
): boolean {
	return (
		required.every((key) => Object.hasOwn(value, key)) &&
		Reflect.ownKeys(value).every(
			(key) => typeof key === "string" && [...required, ...optional].includes(key),
		)
	);
}
function text(value: unknown, max = 4096): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= max &&
		value.trim() === value &&
		![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
	);
}
function sha(value: unknown): value is string {
	return typeof value === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
}
function reference(value: unknown): IssueReference {
	if (
		!object(value) ||
		!exact(value, ["provider", "instanceUrl", "projectId", "number"]) ||
		!isIssueReference(value) ||
		!text(value.instanceUrl, 2048) ||
		!/^\d+$/.test(value.projectId)
	)
		stop();
	return { ...value };
}
function validation(value: unknown): IssueValidationEvidence {
	if (
		!object(value) ||
		!exact(value, [
			"command",
			"result",
			"sha",
			"tree",
			"targetBranch",
			"toolVersion",
			"platform",
			"observedAt",
			"source",
		]) ||
		!text(value.command) ||
		!["passed", "failed", "skipped", "not-run", "not-applicable", "environment-limited"].includes(
			String(value.result),
		) ||
		!sha(value.sha) ||
		!sha(value.tree) ||
		!text(value.targetBranch, 256) ||
		!text(value.toolVersion, 256) ||
		!text(value.platform, 256) ||
		!(value.source === "host-observed" || value.source === "agent-reported") ||
		!text(value.observedAt, 64) ||
		!Number.isFinite(Date.parse(value.observedAt))
	)
		stop();
	return value as unknown as IssueValidationEvidence;
}
function repository(value: unknown): IssueDeliveryRepositoryState {
	if (
		!object(value) ||
		!exact(
			value,
			[
				"projectId",
				"worktreeId",
				"sourceBranch",
				"targetBranch",
				"policy",
				"dependsOn",
				"checkoutSha",
				"checkoutTree",
				"validations",
				"updatedAt",
			],
			["mergeRequest"],
		) ||
		!text(value.projectId, 256) ||
		!text(value.worktreeId, 256) ||
		!text(value.sourceBranch, 256) ||
		!text(value.targetBranch, 256) ||
		!["draft", "auto-merge", "manual"].includes(String(value.policy)) ||
		!Array.isArray(value.dependsOn) ||
		value.dependsOn.some((id) => !text(id, 256)) ||
		!sha(value.checkoutSha) ||
		!sha(value.checkoutTree) ||
		!Array.isArray(value.validations) ||
		value.validations.length > 1000 ||
		!text(value.updatedAt, 64) ||
		!Number.isFinite(Date.parse(value.updatedAt))
	)
		stop();
	let mergeRequest: IssueDeliveryRepositoryState["mergeRequest"];
	if (value.mergeRequest !== undefined) {
		const mr = value.mergeRequest;
		if (
			!object(mr) ||
			!exact(mr, ["iid", "webUrl", "headSha", "targetBranch", "state"]) ||
			!Number.isSafeInteger(mr.iid) ||
			Number(mr.iid) <= 0 ||
			!text(mr.webUrl, 2048) ||
			!sha(mr.headSha) ||
			!text(mr.targetBranch, 256) ||
			!text(mr.state, 64)
		)
			stop();
		mergeRequest = mr as unknown as NonNullable<IssueDeliveryRepositoryState["mergeRequest"]>;
	}
	return {
		projectId: value.projectId,
		worktreeId: value.worktreeId,
		sourceBranch: value.sourceBranch,
		targetBranch: value.targetBranch,
		policy: value.policy as IssueDeliveryPolicy,
		dependsOn: [...value.dependsOn] as string[],
		checkoutSha: value.checkoutSha,
		checkoutTree: value.checkoutTree,
		...(mergeRequest ? { mergeRequest } : {}),
		validations: value.validations.map(validation),
		updatedAt: value.updatedAt,
	};
}
function transition(
	previous: IssueDeliveryStateRecord | null,
	next: IssueDeliveryStateRecord,
): void {
	if (!previous) return;
	const nextProjects = new Set(next.repositories.map((repo) => repo.projectId));
	if (previous.repositories.some((repo) => !nextProjects.has(repo.projectId))) stop();
	const previousByProject = new Map(previous.repositories.map((repo) => [repo.projectId, repo]));
	for (const current of next.repositories) {
		const before = previousByProject.get(current.projectId);
		if (!before) stop();
		if (current.targetBranch !== before.targetBranch && current.validations.length > 0) stop();
		if (
			(current.checkoutSha !== before.checkoutSha ||
				current.checkoutTree !== before.checkoutTree) &&
			current.validations.some(
				(item) => item.sha !== current.checkoutSha || item.tree !== current.checkoutTree,
			)
		)
			stop();
		if (
			current.mergeRequest &&
			(current.mergeRequest.targetBranch !== current.targetBranch ||
				current.mergeRequest.headSha !== current.checkoutSha)
		)
			stop();
	}
}
function record(value: unknown): IssueDeliveryStateRecord {
	if (
		!object(value) ||
		!exact(value, ["revision", "repositories"]) ||
		!Number.isSafeInteger(value.revision) ||
		Number(value.revision) < 1 ||
		Number(value.revision) > maxRevisions ||
		!Array.isArray(value.repositories) ||
		value.repositories.length > 33
	)
		stop();
	const repositories = value.repositories.map(repository);
	if (
		repositories.some((repo) =>
			repo.validations.some(
				(item) =>
					item.sha !== repo.checkoutSha ||
					item.tree !== repo.checkoutTree ||
					item.targetBranch !== repo.targetBranch,
			),
		) ||
		new Set(repositories.map((repo) => repo.projectId)).size !== repositories.length ||
		repositories.some((repo) => repo.dependsOn.includes(repo.projectId))
	)
		stop();
	return { revision: Number(value.revision), repositories };
}
function absent(error: unknown): boolean {
	return (error as NodeJS.ErrnoException).code === "ENOENT";
}
function syncDirectory(path: string): void {
	let fd: number | undefined;
	try {
		fd = openSync(path, "r");
		fsyncSync(fd);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (
			process.platform !== "win32" ||
			!["EISDIR", "EPERM", "EACCES", "EINVAL", "ENOTSUP"].includes(code ?? "")
		)
			throw error;
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}
function key(ref: IssueReference, projectId: string): string {
	return createHash("sha256")
		.update(JSON.stringify([ref.provider, ref.instanceUrl, ref.projectId, ref.number, projectId]))
		.digest("hex");
}
export function createIssueDeliveryStatePersistence(root: string) {
	const dir = resolve(root);
	function load(refInput: unknown, projectId: string): IssueDeliveryStateRecord | null {
		const ref = reference(refInput);
		if (!text(projectId, 256)) stop();
		const folder = join(dir, key(ref, projectId));
		const rootStat = lstatSync(dir);
		if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) stop();
		let names: string[];
		try {
			const stat = lstatSync(folder);
			if (!stat.isDirectory() || stat.isSymbolicLink()) stop();
			names = readdirSync(folder);
		} catch (error) {
			if (absent(error)) return null;
			throw error;
		}
		if (names.length > maxRevisions || names.some((name) => !/^[1-9][0-9]*\.json$/.test(name)))
			stop();
		names.sort((a, b) => Number(a.slice(0, -5)) - Number(b.slice(0, -5)));
		let current: IssueDeliveryStateRecord | null = null;
		for (let index = 0; index < names.length; index++) {
			const name = names[index];
			if (!name || name !== `${index + 1}.json`) stop();
			const path = join(folder, name);
			const stat = lstatSync(path);
			if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > maxRecordBytes)
				stop();
			const fd = openSync(path, "r");
			try {
				const opened = fstatSync(fd);
				const size = opened.size;
				if (!opened.isFile() || size < 1 || size > maxRecordBytes) stop();
				const bytes = Buffer.alloc(size);
				const read = readSync(fd, bytes, 0, size, 0);
				if (read !== size) stop();
				const envelope: unknown = JSON.parse(
					new TextDecoder("utf-8", { fatal: true }).decode(bytes),
				);
				if (
					!object(envelope) ||
					!exact(envelope, ["reference", "projectId", "record"]) ||
					JSON.stringify(reference(envelope.reference)) !== JSON.stringify(ref) ||
					envelope.projectId !== projectId
				)
					stop();
				current = record(envelope.record);
				if (current.revision !== index + 1) stop();
			} finally {
				closeSync(fd);
			}
		}
		syncDirectory(folder);
		return current;
	}
	return {
		load(projectId: string, ref: IssueReference): IssueDeliveryStateRecord | null {
			try {
				return load(ref, projectId);
			} catch {
				return stop();
			}
		},
		compareAndSet(
			projectId: string,
			refInput: IssueReference,
			expectedRevision: number,
			nextInput: IssueDeliveryStateRecord,
		): boolean {
			try {
				const ref = reference(refInput);
				if (
					!Number.isSafeInteger(expectedRevision) ||
					expectedRevision < 0 ||
					expectedRevision >= maxRevisions
				)
					stop();
				const next = record(nextInput);
				const previous = load(ref, projectId);
				if (
					next.revision !== expectedRevision + 1 ||
					(previous?.revision ?? 0) !== expectedRevision
				)
					return false;
				transition(previous, next);
				const folder = join(dir, key(ref, projectId));
				try {
					mkdirSync(folder, { mode: 0o700 });
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
				}
				const body = JSON.stringify({ reference: ref, projectId, record: next });
				if (Buffer.byteLength(body) > maxRecordBytes) stop();
				let fd: number;
				try {
					fd = openSync(join(folder, `${next.revision}.json`), "wx", 0o600);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === "EEXIST") {
						load(ref, projectId);
						return false;
					}
					throw error;
				}
				try {
					writeFileSync(fd, body);
					fsyncSync(fd);
				} finally {
					closeSync(fd);
				}
				syncDirectory(folder);
				syncDirectory(dir);
				return true;
			} catch {
				return stop();
			}
		},
	};
}
