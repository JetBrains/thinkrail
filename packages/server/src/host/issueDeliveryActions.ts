import { isDeepStrictEqual } from "node:util";
import type { IssueReference } from "@thinkrail/contracts";
import { EN } from "@thinkrail/locales";
import { CodedError } from "@thinkrail/shared/codedError";
import type { IssueDeliveryRemote, IssueMergeRequest } from "../issues";
import type { IssueConfirmationStore } from "./issueConfirmations";
import type { IssueSessionAssociation } from "./issueSessions";

export interface DeliveryRepository {
	projectId: string;
	workspaceId: string;
	name: string;
	path: string;
	role: "primary" | "associated";
}
export interface DeliveryPayload {
	stage: "delivery";
	sessionId: string;
	operationId: string;
	reference: IssueReference;
	repository: DeliveryRepository;
	repositoryId: string;
	title: string;
	body: string;
	sha: string;
	branch: string;
	url: string;
	targetBranch: string;
	hostTargetBranch: string;
	issueSnapshot: unknown;
	existing: IssueMergeRequest | null;
	warnings?: string[];
	sessionStage?: IssueSessionAssociation["stage"];
}
export interface IssueDeliveryActionOptions {
	binding(sessionId: string): Promise<IssueSessionAssociation>;
	access(binding: IssueSessionAssociation): Promise<{ remote: IssueDeliveryRemote; guard(): void }>;
	repositories(binding: IssueSessionAssociation): Promise<readonly DeliveryRepository[]>;
	checkout(
		repository: DeliveryRepository,
	): Promise<{ sha: string; branch: string; dirty: boolean }>;
	repositoryRemote(repository: DeliveryRepository): Promise<{
		remote: IssueDeliveryRemote;
		repositoryId: string;
		url: string;
		targetBranch: string;
	}>;
	push(
		repository: DeliveryRepository,
		input: { sha: string; branch: string; url: string },
		onDispatch: () => void,
	): Promise<void>;
	verifyAnswer(sessionId: string, payload: DeliveryPayload, toolCallId: string): Promise<void>;
	authorize?(sessionId: string, payload: DeliveryPayload, authorization: unknown): Promise<void>;
	journal: IssueConfirmationStore;
}
function stop(reason: string = "execution-snapshot-changed"): never {
	throw new CodedError(
		"ISSUE_DELIVERY_REFUSED",
		`Issue delivery refused [${reason}]. Inspect the operation with issue_prepare_confirmation({operationId, inspect:true}). To request a one-shot warned exception card, prepare with continueDespiteChecks:true; the flag grants no execution authority. Correct invalid or unavailable execution prerequisites and prepare current facts rather than treating confirmation as proof they are valid. If it is prepared without an intent, review the current facts and prepare a new confirmation for corrected inputs; completed deliveries allow a new confirmed update to the same PR/MR. If uncertain, inspect the remote result before authorizing recovery. Do not bypass the tool or silently repeat a possibly dispatched mutation.`,
	);
}
type DeliveryCheck = (valid: boolean, reason: string, detail?: string) => void;
function checks(warnings?: string[]): DeliveryCheck {
	return (valid, reason, detail) => {
		if (valid) return;
		if (!warnings) stop(reason);
		warnings.push(
			`${reason}: ${detail ?? "The remote may refuse this attempt; invalid execution prerequisites still require repair."}`,
		);
	};
}
function safeUrl(value: string, reason: string): void {
	try {
		const url = new URL(value);
		if (
			["http:", "https:"].includes(url.protocol) &&
			!url.username &&
			!url.password &&
			!url.search &&
			!url.hash
		)
			return;
	} catch {}
	stop(reason);
}
function branch(value: string): boolean {
	return (
		!!value &&
		!/[\s~^:?*[\\]/.test(value) &&
		![...value].some(
			(character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
		) &&
		!value.startsWith("-") &&
		!value.startsWith("/") &&
		!value.endsWith("/") &&
		!value.endsWith(".") &&
		!value.includes("..") &&
		!value.includes("@{") &&
		!value.includes("//") &&
		value !== "@" &&
		!value.split("/").some((part) => part.startsWith(".") || part.endsWith(".lock"))
	);
}
function validRequest(
	request: IssueMergeRequest,
	payload: Pick<DeliveryPayload, "repositoryId" | "branch" | "targetBranch" | "sha">,
	draft: boolean,
	check: DeliveryCheck = checks(),
): void {
	safeUrl(request.webUrl, "existing-request-url-invalid");
	check(
		typeof request.sha === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(request.sha),
		"existing-request-sha-invalid",
		"The request head is unknown or inexact; no push is authorized until its exact head is known.",
	);
	check(!draft || request.sha === payload.sha, "existing-request-sha-mismatch");
	check(
		Number.isSafeInteger(request.id) &&
			request.id > 0 &&
			Number.isSafeInteger(request.iid) &&
			request.iid > 0 &&
			request.state === "opened" &&
			request.sourceBranch === payload.branch &&
			request.targetBranch === payload.targetBranch &&
			request.sourceProjectId === Number(payload.repositoryId) &&
			request.targetProjectId === Number(payload.repositoryId) &&
			(!draft || request.draft === true),
		"existing-request-identity-invalid",
		`Expected repository ${payload.repositoryId}, source ${payload.branch}, target ${payload.targetBranch}, state opened; actual source repository ${request.sourceProjectId}, target repository ${request.targetProjectId}, source ${request.sourceBranch}, target ${request.targetBranch}, state ${request.state}, id ${request.id}, number ${request.iid}. Risk: this may be a fork or invalid request; no push to an unverified target is authorized and the remote client may refuse.`,
	);
}

function requestSnapshot(request: IssueMergeRequest | null) {
	if (!request) return null;
	return {
		id: request.id,
		iid: request.iid,
		webUrl: request.webUrl,
		state: request.state,
		sourceBranch: request.sourceBranch,
		targetBranch: request.targetBranch,
		sourceProjectId: request.sourceProjectId,
		targetProjectId: request.targetProjectId,
		sha: request.sha,
	};
}
export function deliveryQuestions(payload: DeliveryPayload) {
	const action = payload.existing
		? payload.existing.sha === payload.sha
			? `Reuse existing PR/MR #${payload.existing.iid}: ${payload.existing.webUrl}. No push or PR/MR modification.`
			: `Update existing PR/MR #${payload.existing.iid}: ${payload.existing.webUrl}. Non-force push ${payload.existing.sha} → ${payload.sha} to ${payload.url}, branch ${payload.branch}. Keep this request, title, body and draft status; do not create another PR/MR.`
		: `Non-force push exact commit ${payload.sha} to ${payload.url}, branch ${payload.branch}; then create a draft PR/MR targeting ${payload.targetBranch}.`;
	return {
		questions: [
			{
				question: payload.warnings?.length
					? "The delivery checks found a policy exception. Continue with the exact operation shown?"
					: (EN["issue.confirm.delivery.question"] ?? ""),
				header: EN["issue.confirm.delivery.header"] ?? "",
				preview: `Issue: ${payload.reference.instanceUrl} / ${payload.reference.projectId} #${payload.reference.number}\nRepository: ${payload.repository.name} (${payload.repository.projectId})\nPath: ${payload.repository.path}\nSource: ${payload.branch} @ ${payload.sha}\nRemote: ${payload.url}\nTarget: ${payload.targetBranch}\nUncommitted workspace changes are excluded; only this exact commit will be delivered.\n\nTitle: ${payload.title}\n\n${payload.body}\n\n${payload.warnings?.length ? `ONE-SHOT EXCEPTION: Continue despite these checks only for this displayed operation.\n${payload.warnings.join("\n")}\n\n` : ""}${action}\nNo merge or Issue closure is authorized.`,
				options: [{ label: "Looks right", description: EN["issue.confirm.delivery.option"] ?? "" }],
			},
		],
	};
}
export function createIssueDeliveryActions(options: IssueDeliveryActionOptions) {
	async function existing(
		remote: IssueDeliveryRemote,
		payload: Pick<DeliveryPayload, "repositoryId" | "branch" | "targetBranch" | "sha">,
		check: DeliveryCheck = checks(),
	) {
		const requests = (await remote.mergeRequests(payload.branch)).filter(
			(request) =>
				request.state !== "merged" &&
				request.state !== "closed" &&
				request.sourceBranch === payload.branch &&
				request.targetBranch === payload.targetBranch,
		);
		if (requests.length > 1) stop("existing-requests-ambiguous-select-explicit-request");
		const request = requests[0] ?? null;
		if (request) validRequest(request, payload, false, check);
		return request;
	}
	async function prepare(
		sessionId: string,
		input: {
			operationId: string;
			projectId: string;
			title: string;
			body: string;
			targetBranch?: string;
			continueDespiteChecks?: boolean;
		},
	) {
		const warnings: string[] = [];
		const check = checks(input.continueDespiteChecks ? warnings : undefined);
		if (
			!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.operationId) ||
			!input.title.trim() ||
			!input.body.trim()
		)
			stop("input-invalid");
		const binding = await options.binding(sessionId);
		if (binding.sessionId !== sessionId) stop("session-mismatch");
		check(binding.stage === "implementation", "session-not-implementation");
		const { remote, guard } = await options.access(binding);
		const repositories = await options.repositories(binding);
		guard();
		const selected = repositories.filter((repo) => repo.projectId === input.projectId);
		if (selected.length !== 1) stop("repository-not-participating-select-explicit-repository");
		const repository = selected[0];
		if (!repository) stop("repository-not-participating-select-explicit-repository");
		const state = await options.checkout(repository);
		guard();
		check(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(state.sha), "checkout-sha-invalid");
		check(branch(state.branch), "source-branch-invalid");
		const host = await options.repositoryRemote(repository);
		guard();
		const targetBranch = input.targetBranch ?? host.targetBranch;
		safeUrl(host.url, "remote-url-invalid");
		check(
			/^[1-9][0-9]*$/.test(host.repositoryId) && Number.isSafeInteger(Number(host.repositoryId)),
			"remote-identity-invalid",
		);
		check(branch(targetBranch), "target-branch-invalid");
		check(targetBranch !== state.branch, "target-equals-source");
		const issueSnapshot = await remote.issue(binding.reference.number);
		guard();
		check(issueSnapshot.iid === binding.reference.number, "issue-identity-mismatch");
		check(
			issueSnapshot.state === "opened",
			"issue-not-open",
			`Linked Issue state is ${issueSnapshot.state}; delivery will not change the Issue state.`,
		);

		const payload: DeliveryPayload = {
			stage: "delivery",
			sessionStage: binding.stage,
			sessionId,
			operationId: input.operationId,
			reference: binding.reference,
			repository,
			repositoryId: host.repositoryId,
			title: input.title,
			body: input.body,
			sha: state.sha,
			branch: state.branch,
			url: host.url,
			targetBranch,
			hostTargetBranch: host.targetBranch,
			issueSnapshot,
			existing: null,
			...(warnings.length ? { warnings } : {}),
		};
		payload.existing = await existing(host.remote, payload, check);
		if (warnings.length) payload.warnings = warnings;
		guard();
		const stored = await options.journal.prepare(sessionId, input.operationId, payload);
		return { digest: stored.digest, questions: deliveryQuestions(payload) };
	}
	async function execute(
		sessionId: string,
		operationId: string,
		toolCallId: string,
		authorization?: unknown,
	) {
		const stored = await options.journal.get(sessionId, operationId);
		if (!stored) stop();
		const payload = stored.payload as DeliveryPayload;
		if (
			payload.stage !== "delivery" ||
			payload.sessionId !== sessionId ||
			payload.operationId !== operationId
		)
			stop();
		if (authorization === undefined) await options.verifyAnswer(sessionId, payload, toolCallId);
		else {
			if (!options.authorize) stop("policy-authorization-unavailable");
			await options.authorize(sessionId, payload, authorization);
		}
		const binding = await options.binding(sessionId);
		if (binding.sessionId !== sessionId) stop("session-mismatch");
		if (binding.stage !== (payload.sessionStage ?? "implementation")) stop("session-stage-changed");
		if (!isDeepStrictEqual(binding.reference, payload.reference)) stop("issue-binding-changed");
		const { remote, guard } = await options.access(binding);
		async function revalidate() {
			const repositories = await options.repositories(binding);
			guard();
			const matches = repositories.filter(
				(repo) => repo.projectId === payload.repository.projectId,
			);
			if (matches.length !== 1) stop("repository-not-participating-select-explicit-repository");
			if (!isDeepStrictEqual(matches[0], payload.repository)) stop("repository-identity-changed");
			const state = await options.checkout(payload.repository);
			guard();
			if (state.sha !== payload.sha) stop("checkout-commit-changed");
			if (state.branch !== payload.branch) stop("checkout-branch-changed");
			const issue = await remote.issue(payload.reference.number);
			guard();
			if (!isDeepStrictEqual(issue, payload.issueSnapshot)) stop("issue-snapshot-changed");
			const host = await options.repositoryRemote(payload.repository);
			guard();
			if (host.repositoryId !== payload.repositoryId) stop("remote-project-changed");
			if (host.url !== payload.url) stop("push-remote-changed");
			if (host.targetBranch !== payload.hostTargetBranch) stop("default-target-changed");
			return host.remote;
		}
		const confirmedCheck: DeliveryCheck = (valid, reason) => {
			if (!valid && !payload.warnings?.some((warning) => warning.startsWith(`${reason}:`)))
				stop(reason);
		};
		function executable(request: IssueMergeRequest | null) {
			if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(payload.sha)) stop("checkout-sha-invalid");
			if (!branch(payload.branch)) stop("source-branch-invalid");
			if (!branch(payload.targetBranch)) stop("target-branch-invalid");
			if (
				!/^[1-9][0-9]*$/.test(payload.repositoryId) ||
				!Number.isSafeInteger(Number(payload.repositoryId))
			)
				stop("remote-identity-invalid");
			if (request)
				validRequest(
					{ ...request, state: request.state === "locked" ? "opened" : request.state },
					payload,
					false,
				);
		}
		let dispatched = false;
		return options.journal.execute(
			sessionId,
			operationId,
			stored.digest,
			toolCallId,
			async () => {
				let delivery = await revalidate();
				const before = await existing(delivery, payload, confirmedCheck);
				guard();
				if (!isDeepStrictEqual(requestSnapshot(before), requestSnapshot(payload.existing))) {
					stop(
						before?.id === payload.existing?.id
							? "existing-request-changed"
							: "matching-request-set-changed",
					);
				}
				executable(before);
				let request = before;
				if (request && request.sha !== payload.sha) {
					await options.push(
						payload.repository,
						{
							sha: payload.sha,
							branch: payload.branch,
							url: payload.url,
						},
						() => {
							dispatched = true;
						},
					);
					guard();
					delivery = await revalidate();
					const updated = await existing(delivery, payload, confirmedCheck);
					executable(updated);
					guard();
					if (
						!updated ||
						updated.id !== request.id ||
						updated.iid !== request.iid ||
						updated.webUrl !== request.webUrl ||
						updated.sha !== payload.sha
					)
						stop("updated-request-not-observed");
					request = updated;
				}
				if (!request) {
					await options.push(
						payload.repository,
						{
							sha: payload.sha,
							branch: payload.branch,
							url: payload.url,
						},
						() => {
							dispatched = true;
						},
					);
					guard();
					delivery = await revalidate();
					if (await existing(delivery, payload)) stop();
					guard();
					dispatched = true;
					request = await delivery.createMergeRequest({
						sourceBranch: payload.branch,
						targetBranch: payload.targetBranch,
						title: payload.title,
						description: payload.body,
						draft: true,
					});
					guard();
					validRequest(request, payload, true);
					await revalidate();
				}
				return {
					stage: "delivery",
					projectId: payload.repository.projectId,
					sha: payload.sha,
					url: request.webUrl,
					number: request.iid,
					created: payload.existing === null,
				};
			},
			async () => {
				const delivery = await revalidate();
				const actual = await existing(delivery, payload, confirmedCheck);
				guard();
				if (!isDeepStrictEqual(requestSnapshot(actual), requestSnapshot(payload.existing)))
					stop("existing-request-changed");
				executable(actual);
			},
			() => dispatched,
		);
	}
	async function observe(sessionId: string, payload: DeliveryPayload) {
		const binding = await options.binding(sessionId);
		if (!isDeepStrictEqual(binding.reference, payload.reference)) stop("issue-binding-changed");
		const { guard } = await options.access(binding);
		const repositories = await options.repositories(binding);
		if (!repositories.some((repository) => isDeepStrictEqual(repository, payload.repository)))
			stop("repository-identity-changed");
		const host = await options.repositoryRemote(payload.repository);
		guard();
		if (host.repositoryId !== payload.repositoryId || host.url !== payload.url)
			stop("remote-project-changed");
		const request = await existing(host.remote, payload);
		guard();
		if (!request || request.sha !== payload.sha) stop("recovery-result-not-observed");
		if (
			payload.existing &&
			(request.id !== payload.existing.id || request.iid !== payload.existing.iid)
		)
			stop("recovery-request-identity-mismatch");
		if (!payload.existing) validRequest(request, payload, true);
		return {
			evidence: requestSnapshot(request),
			result: {
				stage: "delivery",
				projectId: payload.repository.projectId,
				sha: payload.sha,
				url: request.webUrl,
				number: request.iid,
				created: payload.existing === null,
			},
		};
	}
	return { prepare, execute, observe };
}
