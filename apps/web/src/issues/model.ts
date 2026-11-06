import {
	canonicalIssueInstanceUrl,
	ISSUES_ACTIONS_PROTOCOL_VERSION,
	ISSUES_APPROVAL_PROTOCOL_VERSION,
	ISSUES_AUTH_PROTOCOL_VERSION,
	ISSUES_IMPLEMENTATION_PROTOCOL_VERSION,
	ISSUES_PROTOCOL_VERSION,
	ISSUES_SESSION_STARTUP_PROTOCOL_VERSION,
	type IssueConnection,
	type IssueConnectionInput,
	type IssueList,
	type IssueReference,
	type IssueSessionLaunch,
	type IssueSummary,
	isIssueConnectionInput,
	isIssueSessionLaunch,
	requiresIssueHttpConsent,
	type WsMethodName,
	type WsParams,
	type WsResult,
} from "@thinkrail/contracts";
import { canonicalLocale, type MessageKey, resolveLocale } from "@thinkrail/locales";
import { resolveIssueRepositoryAddress, suggestIssueRepositoryAddress } from "./repositoryAddress";

export function supportsIssues(version: number | null): boolean {
	return version !== null && version >= ISSUES_PROTOCOL_VERSION;
}

export function supportsIssueAuth(version: number | null): boolean {
	return version !== null && version >= ISSUES_AUTH_PROTOCOL_VERSION;
}

/** The host-side launch surface (design/implementation sessions), v104. */
export function supportsIssueActions(version: number | null): boolean {
	return version !== null && version >= ISSUES_ACTIONS_PROTOCOL_VERSION;
}

/** The host-side approval surface (design/implementation receipts), v106. */
export function supportsIssueApproval(version: number | null): boolean {
	return version !== null && version >= ISSUES_APPROVAL_PROTOCOL_VERSION;
}

/** The host-side confirmation gate that starts implementation, v108. */
export function supportsIssueImplementation(version: number | null): boolean {
	return version !== null && version >= ISSUES_IMPLEMENTATION_PROTOCOL_VERSION;
}

/** Automatic localized agent startup, separate from legacy session creation. */
export function supportsIssueSessionStartup(version: number | null): boolean {
	return version !== null && version >= ISSUES_SESSION_STARTUP_PROTOCOL_VERSION;
}

/** Consume the active translator language, which already resolves the system preference. */
export function issueStartupLocale(language: string, available: readonly string[]): string {
	return canonicalLocale(resolveLocale(language, available, [])) ?? "en";
}

export type ProjectOpenGesture = "open" | "init" | "clone" | "create";

export function shouldPromptAssociation(gesture: ProjectOpenGesture): boolean {
	return gesture !== "create";
}

export function safeIssueUrl(value: string): string | undefined {
	try {
		const url = new URL(value);
		return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
			? url.href
			: undefined;
	} catch {
		return undefined;
	}
}

export type IssuePanelError =
	| "read"
	| "connect"
	| "list"
	| "disconnect"
	| "open"
	| IssueActionError;

/** Keyed action failures the host can answer; never transport text or the token. */
export type IssueActionError = "action" | "unsupported";

export const ISSUE_ERROR_KEY = {
	read: "issues.failed",
	connect: "issues.error.connect",
	list: "issues.error.list",
	disconnect: "issues.error.disconnect",
	open: "issues.error.open",
	action: "issues.error.action",
	unsupported: "issues.error.unsupported",
} as const satisfies Record<IssuePanelError, MessageKey>;

/**
 * The two actions this panel offers. Accepting a design or an implementation stays in GitLab —
 * the app never records an approval, and closing an issue is GitLab's too.
 */
export type IssueActionId = "design" | "implement";

/**
 * `needs-newer-host` — the host protocol floor for this action is missing.
 * `needs-trust` — the host refuses stage actions until the project is trusted.
 */
export type IssueActionReason = "needs-newer-host" | "needs-trust";

export interface IssueActionAvailability {
	action: IssueActionId;
	reason: IssueActionReason | null;
	/** This step already happened for the issue, so its control reads as completed. */
	done: boolean;
}

/**
 * What the panel may assume about the host: whether the design launch surface exists (v104),
 * whether the implementation confirmation gate exists (v108), and project trust.
 */
export interface IssueActionCapabilities {
	actionsSupported: boolean;
	startupSupported?: boolean;
	implementationSupported: boolean;
	/** The host refuses every stage action for an untrusted project. */
	trusted: boolean;
}

/** One stable key per listed issue, so a failure can be shown on the row that raised it. */
export function issueKey(issue: Pick<IssueSummary, "reference">): string {
	const { instanceUrl, projectId, number } = issue.reference;
	return `${instanceUrl}/${projectId}/${number}`;
}

export const ISSUE_ACTION_KEY = {
	design: "issues.action.design",
	implement: "issues.action.implement",
} as const satisfies Record<IssueActionId, MessageKey>;

export const ISSUE_ACTION_REASON_KEY = {
	"needs-newer-host": "issues.reason.needsNewerHost",
	"needs-trust": "issues.reason.needsTrust",
} as const satisfies Record<IssueActionReason, MessageKey>;

function hostReason(supported: boolean): IssueActionReason | null {
	return supported ? null : "needs-newer-host";
}

function blocked(capabilities: IssueActionCapabilities, supported: boolean) {
	return hostReason(supported) ?? (capabilities.trusted ? null : "needs-trust");
}

/**
 * Pure availability matrix for one issue. Closed issues offer nothing; the panel keeps an
 * unavailable control visible with its reason instead of hiding the capability, and never
 * invents an MR or merge control.
 */
export function issueActions(
	issue: Pick<IssueSummary, "stage">,
	capabilities: IssueActionCapabilities,
): IssueActionAvailability[] {
	if (issue.stage === "closed") return [];
	// Implementation is offered for every open stage: the host moves a backlog issue into
	// in-progress on approval and starts an already in-progress/in-review issue as it is.
	const designed = issue.stage !== "backlog";
	const implemented = issue.stage === "in-review";
	return [
		{
			action: "design",
			reason: blocked(capabilities, capabilities.actionsSupported),
			done: designed,
		},
		{
			action: "implement",
			reason: blocked(capabilities, capabilities.implementationSupported),
			done: implemented,
		},
	];
}

/**
 * The two-step implementation gate. Clicking implementation asks first (`null`: open the
 * confirmation and dispatch nothing), and only a confirmed dialog returns the action to run.
 * Design has no confirmation and dispatches directly.
 */
export type IssueActionResult =
	| { ok: true; launch: IssueSessionLaunch }
	| { ok: false; error: IssueActionError };

/** The transport calls one action needs; injected so the rules stay pure and testable. */
export interface IssueActionCall {
	launchDesign: () => Promise<IssueSessionLaunch>;
	/** The v108 confirmation gate: the host owns the label transition, worktree and session. */
	startImplementation: () => Promise<IssueSessionLaunch>;
}

export interface IssueActionRequest {
	locale: string;
	projectId: string;
	reference: IssueReference;
}

/** The exact call set a host at the current capability floor can answer. */
export function issueActionCall(
	request: IssueActionRequest,
	send: <M extends WsMethodName>(method: M, params: WsParams<M>) => Promise<WsResult<M>>,
	version: number | null,
): IssueActionCall {
	const params = { projectId: request.projectId, reference: request.reference };
	if (supportsIssueSessionStartup(version)) {
		const startup = { ...params, locale: request.locale };
		return {
			launchDesign: () => send("issues.beginDesign", startup),
			startImplementation: () => send("issues.beginImplementation", startup),
		};
	}
	return {
		launchDesign: () => send("issues.launchDesign", params),
		startImplementation: () => send("issues.startImplementation", params),
	};
}

async function launch(
	send: () => Promise<IssueSessionLaunch>,
	onLaunch: (launch: IssueSessionLaunch) => void,
): Promise<IssueActionResult> {
	try {
		const result = await send();
		if (!isIssueSessionLaunch(result)) return { ok: false, error: "action" };
		onLaunch(result);
		return { ok: true, launch: result };
	} catch {
		return { ok: false, error: "action" };
	}
}

/**
 * Runs one confirmed stage action. Each action is exactly one host-side operation: the host owns
 * the label transition, the worktree and the session, so no version is read or minted here.
 */
export async function runIssueAction(
	action: IssueActionId,
	call: IssueActionCall,
	onLaunch: (launch: IssueSessionLaunch) => void = () => {},
): Promise<IssueActionResult> {
	switch (action) {
		case "design":
			return launch(() => call.launchDesign(), onLaunch);
		case "implement":
			return launch(() => call.startImplementation(), onLaunch);
	}
}

const SSH_URL = /^(?:ssh|git\+ssh|ssh\+git):\/\//i;
const SCP_LIKE = /^(?:[^@\s/?#:]+@)?[^@\s/?#:]+:(?![/?#])/;

export function isSshRepositoryAddress(value: string): boolean {
	const address = value.trim();
	return SSH_URL.test(address) || SCP_LIKE.test(address);
}

export type IssueAddressChoice =
	| { status: "valid"; instanceUrl: string; projectId: string }
	| { status: "needs-instance"; instanceUrl: string; projectId: string }
	| { status: "invalid"; reason: "empty" | "ssh" | "unsupported" };

export function resolveIssueConnectionAddress(
	address: string,
	instanceUrl?: string,
): IssueAddressChoice {
	const trimmed = address.trim();
	if (!trimmed) return { status: "invalid", reason: "empty" };
	if (isSshRepositoryAddress(trimmed)) return { status: "invalid", reason: "ssh" };
	const confirmed = instanceUrl?.trim() ?? "";
	const resolved = resolveIssueRepositoryAddress(trimmed, confirmed || undefined);
	if (resolved.status === "valid") return resolved;
	if (resolved.status === "invalid") return { status: "invalid", reason: "unsupported" };
	const prefill = suggestIssueRepositoryAddress(trimmed);
	return prefill
		? { status: "needs-instance", ...prefill }
		: { status: "invalid", reason: "unsupported" };
}

export function issueAddressNotice(choice: IssueAddressChoice): MessageKey | null {
	if (choice.status !== "invalid" || choice.reason === "empty") return null;
	return choice.reason === "ssh" ? "issues.addressSsh" : "issues.addressInvalid";
}

export function issueHttpConsent(
	instanceUrl: string,
	acknowledgedInstance: string | null,
): { instanceUrl: string } | undefined {
	const canonical = canonicalIssueInstanceUrl(instanceUrl);
	if (canonical === null || acknowledgedInstance !== canonical) return undefined;
	return requiresIssueHttpConsent(canonical) ? { instanceUrl: canonical } : undefined;
}

export function issueConnectionInput(
	target: { instanceUrl: string; projectId: string },
	token: string,
	acknowledgedInstance: string | null,
): IssueConnectionInput | null {
	const instanceUrl = canonicalIssueInstanceUrl(target.instanceUrl);
	if (instanceUrl === null) return null;
	const consent = issueHttpConsent(instanceUrl, acknowledgedInstance);
	if (requiresIssueHttpConsent(instanceUrl) && !consent) return null;
	const input: IssueConnectionInput = {
		instanceUrl,
		projectId: target.projectId,
		token,
		...(consent ? { httpConsent: consent } : {}),
	};
	return isIssueConnectionInput(input) ? input : null;
}

export async function submitConnection<T>(
	input: IssueConnectionInput,
	clearToken: () => void,
	connect: (input: IssueConnectionInput) => Promise<T>,
): Promise<T> {
	clearToken();
	return connect(input);
}

export async function submitDisconnect(disconnect: () => Promise<unknown>): Promise<boolean> {
	try {
		await disconnect();
		return true;
	} catch {
		return false;
	}
}

export interface AssociationFormFields {
	connection: IssueConnection | null;
	address: string;
	instanceOverride: { address: string; value: string } | null;
	advancedOpen: boolean;
	acknowledged: string | null;
	token: string;
	pending: boolean;
	authSupported: boolean;
}

export interface AssociationFormState {
	base: IssueAddressChoice;
	addressNotice: MessageKey | null;
	showAdvanced: boolean;
	advancedToggle: boolean;
	instanceValue: string;
	choice: IssueAddressChoice;
	target: { instanceUrl: string; projectId: string } | null;
	projectPath: string;
	canonicalInstance: string | null;
	consentRequired: boolean;
	consentAcknowledged: boolean;
	input: IssueConnectionInput | null;
	canSubmit: boolean;
	authSupported: boolean;
}

export function associationFormState(fields: AssociationFormFields): AssociationFormState {
	const base = resolveIssueConnectionAddress(fields.address);
	const addressNotice = issueAddressNotice(base);
	const showAdvanced = fields.advancedOpen || base.status === "needs-instance";
	const prefillInstance = base.status === "invalid" ? "" : base.instanceUrl;
	const instanceValue =
		fields.instanceOverride?.address === fields.address
			? fields.instanceOverride.value
			: prefillInstance;
	const choice = fields.connection
		? {
				status: "valid" as const,
				instanceUrl: fields.connection.instanceUrl,
				projectId: fields.connection.remoteProjectId,
			}
		: showAdvanced && fields.address.trim()
			? resolveIssueConnectionAddress(fields.address, instanceValue)
			: base;
	const target =
		choice.status === "valid"
			? { instanceUrl: choice.instanceUrl, projectId: choice.projectId }
			: null;
	const projectPath =
		choice.status === "valid"
			? choice.projectId
			: base.status === "needs-instance"
				? base.projectId
				: "";
	const canonicalInstance = target ? canonicalIssueInstanceUrl(target.instanceUrl) : null;
	const consentRequired = canonicalInstance !== null && requiresIssueHttpConsent(canonicalInstance);
	const consentAcknowledged =
		canonicalInstance !== null && fields.acknowledged === canonicalInstance;
	const input =
		target && fields.authSupported
			? issueConnectionInput(target, fields.token, fields.acknowledged)
			: null;
	return {
		base,
		addressNotice,
		showAdvanced,
		advancedToggle: base.status !== "needs-instance",
		instanceValue,
		choice,
		target,
		projectPath,
		canonicalInstance,
		consentRequired,
		consentAcknowledged,
		input,
		canSubmit: input !== null && !fields.pending,
		authSupported: fields.authSupported,
	};
}

export type ConnectResult = { ok: true } | { ok: false; error: "connect" };

export interface AssociationDismissal {
	hideClose: boolean;
	onOpenChange: (open: boolean) => void;
	onEscapeKeyDown: (event: { preventDefault: () => void }) => void;
	onInteractOutside: (event: { preventDefault: () => void }) => void;
}

export function associationDismissal(pending: boolean, close: () => void): AssociationDismissal {
	return {
		hideClose: pending,
		onOpenChange: (open) => {
			if (!open && !pending) close();
		},
		onEscapeKeyDown: (event) => {
			if (pending) event.preventDefault();
		},
		onInteractOutside: (event) => {
			if (pending) event.preventDefault();
		},
	};
}

type IssueAssociationListener = (projectId: string) => void;
const associationListeners = new Set<IssueAssociationListener>();

export function subscribeIssueAssociation(listener: IssueAssociationListener): () => void {
	associationListeners.add(listener);
	return () => {
		associationListeners.delete(listener);
	};
}

export function notifyIssueAssociation(projectId: string): void {
	for (const listener of associationListeners) listener(projectId);
}

export interface AssociationPanelState {
	reconnecting: boolean;
	actionError: IssuePanelError | null;
	snapshotError: IssuePanelError | null;
}

export function associationPanelState(
	snapshotError: IssuePanelError | null,
): AssociationPanelState {
	return { reconnecting: false, actionError: null, snapshotError };
}

export const associationPanelInitialState: AssociationPanelState = associationPanelState(null);

export type AssociationPanelEvent =
	| { type: "startReconnect" }
	| { type: "cancelReconnect" }
	| { type: "connectSucceeded" }
	| { type: "connectFailed"; error: "connect" }
	| { type: "actionFailed"; error: IssuePanelError }
	| { type: "clearActionError" }
	| { type: "snapshotLanded"; error: IssuePanelError | null };

export function reconnectOutcome(
	state: AssociationPanelState,
	event: AssociationPanelEvent,
): AssociationPanelState {
	switch (event.type) {
		case "startReconnect":
			return { ...state, reconnecting: true, actionError: null };
		case "cancelReconnect":
			return { reconnecting: false, actionError: null, snapshotError: null };
		case "connectSucceeded":
			return { reconnecting: false, actionError: null, snapshotError: null };
		case "connectFailed":
			return { ...state, actionError: event.error };
		case "actionFailed":
			return { ...state, actionError: event.error };
		case "clearActionError":
			return { ...state, actionError: null };
		case "snapshotLanded":
			return event.error === null
				? { ...state, actionError: null, snapshotError: null }
				: { ...state, snapshotError: event.error };
	}
}

export interface IssueToolSnapshot {
	identity: string;
	connection: IssueConnection | null;
	issues: IssueSummary[];
	pending: boolean;
	error: IssuePanelError | null;
}

export function issueSnapshotUpdate(
	previous: IssueToolSnapshot | null,
	identity: string,
	patch: Partial<Omit<IssueToolSnapshot, "identity">>,
): IssueToolSnapshot {
	return {
		identity,
		connection: previous?.identity === identity ? previous.connection : null,
		issues: previous?.identity === identity ? previous.issues : [],
		pending: false,
		error: null,
		...patch,
	};
}

export function issueSnapshotAfterLoad(
	previous: IssueToolSnapshot | null,
	identity: string,
	loaded: IssueSnapshot,
): IssueToolSnapshot {
	return loaded.error === "connect"
		? issueSnapshotUpdate(previous, identity, { error: loaded.error })
		: issueSnapshotUpdate(previous, identity, {
				connection: loaded.connection,
				issues: loaded.issues,
				error: loaded.error,
			});
}

export interface IssueSnapshot {
	connection: IssueConnection | null;
	issues: IssueSummary[];
	error: IssuePanelError | null;
}

export interface IssueSnapshotCall {
	connection: () => Promise<IssueConnection | null>;
	connect?: (() => Promise<IssueConnection>) | undefined;
	list: () => Promise<IssueList>;
}

export async function loadIssueSnapshot(
	call: IssueSnapshotCall,
	isCurrent: () => boolean = () => true,
): Promise<IssueSnapshot | null> {
	const connect = call.connect;
	let connection: IssueConnection | null;
	try {
		connection = connect ? await connect() : await call.connection();
	} catch {
		if (!isCurrent()) return null;
		return { connection: null, issues: [], error: connect ? "connect" : "read" };
	}
	if (!isCurrent()) return null;
	if (!connection?.connected) return { connection, issues: [], error: null };
	try {
		const list = await call.list();
		return isCurrent() ? { connection, issues: list.issues, error: null } : null;
	} catch {
		return isCurrent() ? { connection, issues: [], error: "list" } : null;
	}
}
