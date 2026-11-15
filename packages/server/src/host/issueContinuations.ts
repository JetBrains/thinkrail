import { randomUUID } from "node:crypto";
import { CodedError } from "@thinkrail/shared/codedError";

const maxSnapshotBytes = 128 * 1024;
const maxEntries = 100;
const lifetimeMs = 30 * 60 * 1000;
type Phase = "prepare" | "execute";

export interface IssueContinuationQuestions {
	questions: {
		question: string;
		header: string;
		preview: string;
		options: { label: string; description: string }[];
	}[];
}
export interface IssueContinuationBlocked {
	status: "blocked";
	reason: { code: string; message: string };
	continuationId: string;
	questions: IssueContinuationQuestions;
	nextAction: string;
}
export interface IssueContinuationOptions {
	enabled?: () => boolean;
	verify(
		sessionId: string,
		toolCallId: string,
		exactQuestions: IssueContinuationQuestions,
	): Promise<void>;
}
interface Entry {
	sessionId: string;
	operationId: string;
	phase: Phase;
	snapshot: string;
	questions: IssueContinuationQuestions;
	expiresAt: number;
	attempt: (continued?: boolean) => Promise<unknown>;
	result?: Promise<unknown>;
	finished: boolean;
}
const messages = {
	ISSUE_DELIVERY_REFUSED:
		"Issue delivery was refused. Review the original operation and current prerequisites.",
	ISSUE_CONFIRMATION_BLOCKED:
		"Issue confirmation was blocked. Inspect the original operation before continuing.",
	RANGE_INVALID: "Invalid Issue request.",
	RESOURCE_UNAVAILABLE:
		"The Issue operation could not continue. Inspect its state and prerequisites.",
} as const;
const knownReasonTags = new Set([
	"capacity_reached",
	"checkout-branch-changed",
	"checkout-commit-changed",
	"checkout-dirty-state-changed",
	"checkout-dirty-without-approved-warning",
	"checkout-invalid",
	"checkout-sha-invalid",
	"confirmation_mismatch",
	"default-target-changed",
	"digest_mismatch",
	"execution-snapshot-changed",
	"existing-request-changed",
	"existing-request-identity-invalid",
	"existing-request-sha-invalid",
	"existing-request-sha-mismatch",
	"existing-request-url-invalid",
	"existing-requests-ambiguous-select-explicit-request",
	"input-invalid",
	"intent_conflict",
	"invalid_input",
	"invalid_payload",
	"issue-binding-changed",
	"issue-identity-mismatch",
	"issue-not-open",
	"issue-snapshot-changed",
	"journal_invalid",
	"journal_unavailable",
	"matching-request-set-changed",
	"operation-binding-mismatch",
	"operation_missing",
	"payload_changed",
	"preflight_failed",
	"push-remote-changed",
	"recovery-labels-not-observed",
	"recovery-report-note-ambiguous-or-missing",
	"recovery-request-identity-mismatch",
	"recovery-result-not-observed",
	"remote-identity-invalid",
	"remote-project-changed",
	"remote-url-invalid",
	"repository-identity-changed",
	"repository-not-participating-select-explicit-repository",
	"session-mismatch",
	"session-not-implementation",
	"session-stage-changed",
	"source-branch-invalid",
	"stage-snapshot-changed",
	"target-branch-invalid",
	"target-equals-source",
	"uncertain_intent",
	"unsafe_directory",
	"updated-request-not-observed",
]);
function reason(error: unknown): IssueContinuationBlocked["reason"] {
	let code: unknown;
	let text: unknown;
	if (error instanceof CodedError) {
		code = error.code;
		text = error.message;
	} else if (error !== null && typeof error === "object" && "reason" in error) {
		const value = error.reason;
		if (value !== null && typeof value === "object" && "code" in value) code = value.code;
		else if (typeof value === "string") text = value;
	}
	let tag: string | undefined;
	if (typeof text === "string") {
		const delivery = /^Issue delivery refused \[([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\]\./.exec(text);
		const confirmation = /^Issue confirmation blocked \(([a-z][a-z0-9]*(?:_[a-z0-9]+)*)\)\./.exec(
			text,
		);
		const stage = /^Issue stage confirmation refused \[([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\]\./.exec(
			text,
		);
		const match = delivery ?? confirmation ?? stage;
		const hostCode = delivery ? "ISSUE_DELIVERY_REFUSED" : "ISSUE_CONFIRMATION_BLOCKED";
		if (match && knownReasonTags.has(match[1] ?? "") && (code === undefined || code === hostCode)) {
			code = hostCode;
			tag = match[0];
		}
	}
	if (
		code !== "ISSUE_DELIVERY_REFUSED" &&
		code !== "ISSUE_CONFIRMATION_BLOCKED" &&
		code !== "RANGE_INVALID"
	)
		code = "RESOURCE_UNAVAILABLE";
	const guidance = messages[code as keyof typeof messages];
	return { code: code as keyof typeof messages, message: tag ? `${tag} ${guidance}` : guidance };
}
function isBlocked(value: unknown): boolean {
	return (
		value !== null && typeof value === "object" && "status" in value && value.status === "blocked"
	);
}
const inputKeys = new Set([
	"operationId",
	"report",
	"projectId",
	"title",
	"body",
	"targetBranch",
	"target",
	"stage",
	"digest",
	"toolCallId",
	"inspect",
	"recovery",
	"candidateDigest",
	"continueDespiteChecks",
]);
function snapshot(input: unknown): string {
	try {
		const seen = new Set<object>();
		const copy = (value: unknown, depth: number): unknown => {
			if (depth > 32) throw new Error();
			if (value === null || typeof value === "string" || typeof value === "boolean") return value;
			if (typeof value === "number" && Number.isFinite(value)) return value;
			if (typeof value !== "object" || seen.has(value)) throw new Error();
			seen.add(value);
			try {
				if (Array.isArray(value)) return value.map((item) => copy(item, depth + 1));
				if (
					Object.getPrototypeOf(value) !== Object.prototype &&
					Object.getPrototypeOf(value) !== null
				)
					throw new Error();
				const result: Record<string, unknown> = Object.create(null);
				for (const key of Object.keys(value)) {
					if (
						(depth === 0 && !inputKeys.has(key)) ||
						/token|secret|password|credential|authorization|cookie|api.?key/i.test(key)
					)
						continue;
					const property = Object.getOwnPropertyDescriptor(value, key);
					if (!property || !("value" in property)) throw new Error();
					if (property.value !== undefined) result[key] = copy(property.value, depth + 1);
				}
				return result;
			} finally {
				seen.delete(value);
			}
		};
		const text = JSON.stringify(copy(input, 0), null, 2);
		if (Buffer.byteLength(text, "utf8") > maxSnapshotBytes) throw new Error();
		return text;
	} catch {
		throw new CodedError(
			"RANGE_INVALID",
			"Issue continuation requires a plain JSON input preview of at most 128 KiB.",
		);
	}
}
function unavailable(): never {
	throw new CodedError(
		"RESOURCE_UNAVAILABLE",
		"This Issue continuation is unavailable. Prepare a fresh request and review its current state.",
	);
}

export function createIssueContinuations(options: IssueContinuationOptions) {
	const entries = new Map<string, Entry>();
	const enabled = options.enabled ?? (() => process.env.THINKRAIL_ISSUE_CONTINUATIONS !== "0");
	function prune() {
		for (const [id, entry] of entries) {
			if (entry.expiresAt <= Date.now() && (!entry.result || entry.finished)) entries.delete(id);
		}
	}
	function offer(
		sessionId: string,
		operationId: string,
		phase: Phase,
		input: string,
		attempt: (continued?: boolean) => Promise<unknown>,
		error: unknown,
	): IssueContinuationBlocked {
		prune();
		if (entries.size >= maxEntries) {
			for (const [id, entry] of entries) {
				if (entry.finished) {
					entries.delete(id);
					break;
				}
			}
		}
		if (entries.size >= maxEntries)
			throw new CodedError(
				"RESOURCE_UNAVAILABLE",
				"Issue continuation capacity reached. Wait for existing cards to expire or finish.",
			);
		const continuationId = randomUUID();
		const refusal = reason(error);
		const scope =
			phase === "prepare"
				? "Retry preparation only using the original input. This does not authorize a remote write. Any new normal confirmation card still needs separate approval."
				: "Attempt the fixed original execution once, ignoring only explicitly accepted policy checks supported by the host. This authorizes no arbitrary command and does NOT resend uncertain intents. Inspect and reconcile any possibly dispatched write first.";
		const questions: IssueContinuationQuestions = {
			questions: [
				{
					question: `Continue this Issue ${phase} attempt?`,
					header: "Continue Issue",
					preview: `Phase: ${phase}\nOperation: ${operationId}\nContinuation: ${continuationId}\n\n${refusal.message}\n\n${scope}\nThis cannot manufacture credentials or repair invalid identities or prerequisites. A further refusal requires another separately approved card.\n\nOriginal input:\n${input}`,
					options: [{ label: "Looks right", description: scope }],
				},
			],
		};
		entries.set(continuationId, {
			sessionId,
			operationId,
			phase,
			snapshot: input,
			questions,
			expiresAt: Date.now() + lifetimeMs,
			attempt,
			finished: false,
		});
		return {
			status: "blocked",
			reason: refusal,
			continuationId,
			questions: structuredClone(questions),
			nextAction:
				"Ask the user this exact card with ask_user_question, then submit its real Looks right tool-call receipt to execute the continuation.",
		};
	}
	async function attemptOnce(
		sessionId: string,
		operationId: string,
		phase: Phase,
		input: string,
		attempt: (continued?: boolean) => Promise<unknown>,
		continued = false,
	): Promise<unknown> {
		let failure: unknown;
		try {
			const result = await attempt(continued);
			if (!isBlocked(result)) return result;
			failure = result;
		} catch (error) {
			failure = error;
		}
		if (
			failure instanceof CodedError &&
			failure.code === "ISSUE_CONFIRMATION_BLOCKED" &&
			"reason" in failure &&
			failure.reason === "confirmation_mismatch"
		)
			throw failure;
		return offer(sessionId, operationId, phase, input, attempt, failure);
	}
	return {
		async run(
			sessionId: string,
			operationId: string,
			phase: Phase,
			input: unknown,
			attempt: (continued?: boolean) => Promise<unknown>,
		): Promise<unknown> {
			if (!enabled()) return attempt(false);
			return attemptOnce(sessionId, operationId, phase, snapshot(input), attempt, false);
		},
		async execute(
			sessionId: string,
			operationId: string,
			continuationId: string,
			toolCallId: string,
		): Promise<unknown> {
			if (!enabled()) unavailable();
			prune();
			const entry = entries.get(continuationId);
			if (!entry || entry.sessionId !== sessionId || entry.operationId !== operationId)
				unavailable();
			await options.verify(sessionId, toolCallId, structuredClone(entry.questions));
			if (
				!enabled() ||
				entries.get(continuationId) !== entry ||
				(!entry.result && entry.expiresAt <= Date.now())
			)
				unavailable();
			if (!entry.result) {
				entry.result = Promise.resolve()
					.then(() =>
						attemptOnce(sessionId, operationId, entry.phase, entry.snapshot, entry.attempt, true),
					)
					.finally(() => {
						entry.finished = true;
					});
			}
			return entry.result;
		},
	};
}
