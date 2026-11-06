import { isLocalePreference } from "./domain";

export type IssueProvider = "gitlab" | "github";
export interface IssueReference {
	provider: IssueProvider;
	instanceUrl: string;
	projectId: string;
	number: number;
}
export interface IssueConnectionInput {
	instanceUrl: string;
	projectId: string;
	token: string;
	httpConsent?: { instanceUrl: string };
}
export interface IssueConnection {
	projectId: string;
	instanceUrl: string;
	remoteProjectId: string;
	connected: boolean;
}
export type IssueStage = "backlog" | "in-progress" | "in-review" | "closed";
export type IssueAction = "design" | "approve-design" | "implement" | "approve-implementation";
export interface IssueSummary {
	reference: IssueReference;
	title: string;
	url: string;
	labels: string[];
	stage: IssueStage;
	updatedAt: string;
}
export interface IssueList {
	issues: IssueSummary[];
	fetchedAt: string;
}
/**
 * The project's Git `origin` fetch URL when the host could read one that is already a
 * credential-free HTTP(S) address. Null for SSH, absent, ambiguous or unsupported remotes:
 * the association form then starts empty instead of guessing.
 */
export interface IssueRepositoryAddress {
	repositoryUrl: string | null;
}
export interface IssueSessionLaunch {
	workspaceId: string;
	sessionId: string;
}
/**
 * The one credential-free read an implementation launch needs: the approved design receipt
 * digest the host holds, or null when this issue has no settled approved design.
 */
export interface IssueDesignApproval {
	approvedDesignVersion: string | null;
}
function record(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Canonical identity: HTTP(S) only, no credentials or parser-repaired delimiters. */
export function canonicalIssueInstanceUrl(value: unknown): string | null {
	if (
		typeof value !== "string" ||
		value.length > 2048 ||
		/[\s\\?#@]/.test(value) ||
		[...value].some((character) => {
			const code = character.charCodeAt(0);
			return code < 32 || (code >= 127 && code <= 159);
		}) ||
		!/^https?:\/\/[^/]+/i.test(value)
	)
		return null;
	try {
		const url = new URL(value);
		if (
			(url.protocol !== "http:" && url.protocol !== "https:") ||
			!url.hostname ||
			url.username ||
			url.password ||
			url.search ||
			url.hash
		)
			return null;
		return url.href.replace(/\/+$/, "");
	} catch {
		return null;
	}
}
/**
 * One rule for every consumer: `github.com` is GitHub, every other host is GitLab. Null reports an
 * instance that is not a canonical credential-free HTTP(S) URL, never a guessed provider.
 */
export function issueProviderForInstanceUrl(value: unknown): IssueProvider | null {
	const canonical = canonicalIssueInstanceUrl(value);
	if (canonical === null) return null;
	try {
		return new URL(canonical).hostname.toLowerCase() === "github.com" ? "github" : "gitlab";
	} catch {
		return null;
	}
}
/** Fail closed for invalid instances; never resolves a hostname to infer loopback. */
export function requiresIssueHttpConsent(instance: string): boolean {
	const canonical = canonicalIssueInstanceUrl(instance);
	if (canonical === null) return true;
	if (canonical.startsWith("https:")) return false;
	// Inspect literal authority, not WHATWG's normalized numeric IPv4 aliases.
	const authority = instance.slice(instance.indexOf("://") + 3).split("/")[0] ?? "";
	const hostname = authority.startsWith("[")
		? authority.slice(0, authority.indexOf("]") + 1)
		: (authority.split(":")[0] ?? "");
	if (hostname.toLowerCase() === "localhost" || hostname === "[::1]") return false;
	const octets = hostname.split(".");
	return !(
		octets.length === 4 &&
		octets[0] === "127" &&
		octets.every((part) => /^(0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255)
	);
}
function httpConsent(value: unknown): value is { instanceUrl: string } {
	return (
		exact(value, ["instanceUrl"]) &&
		typeof value.instanceUrl === "string" &&
		canonicalIssueInstanceUrl(value.instanceUrl) === value.instanceUrl
	);
}
/** Service must enforce before any token-bearing request; stored consent is host-owned. */
export function hasIssueHttpConsent(input: IssueConnectionInput, stored?: unknown): boolean {
	if (!isIssueConnectionInput(input)) return false;
	const canonical = canonicalIssueInstanceUrl(input.instanceUrl);
	if (canonical === null) return false;
	if (!requiresIssueHttpConsent(input.instanceUrl)) return true;
	return [input.httpConsent, stored].some(
		(consent) => httpConsent(consent) && consent.instanceUrl === canonical,
	);
}
function issuePath(projectPath: string): string[] | null {
	const parts = projectPath.split("/");
	return parts.length >= 2 &&
		parts.every((part) => part && part !== "." && part !== ".." && !/[\s%?#@]/.test(part))
		? parts
		: null;
}

/** The one credential-free issue URL each provider publishes; never built from caller text. */
export function issueWebUrl(
	provider: IssueProvider,
	instanceUrl: string,
	projectPath: string,
	number: number,
): string | null {
	const parts = issuePath(projectPath);
	if (parts === null || !Number.isSafeInteger(number) || number <= 0) return null;
	const canonical = canonicalIssueInstanceUrl(instanceUrl);
	if (canonical === null || issueProviderForInstanceUrl(canonical) !== provider) return null;
	return provider === "github"
		? `https://github.com/${parts.join("/")}/issues/${number}`
		: `${canonical}/${parts.join("/")}/-/issues/${number}`;
}

/** Structural check of a provider issue URL against its reference; the numeric id is not a path. */
export function isIssueWebUrl(value: unknown, reference: IssueReference): boolean {
	if (typeof value !== "string" || canonicalIssueInstanceUrl(value) !== value) return false;
	const suffix = `/issues/${reference.number}`;
	if (providerOf(reference) === "github") {
		const prefix = "https://github.com/";
		if (!value.startsWith(prefix) || !value.endsWith(suffix)) return false;
		const parts = value.slice(prefix.length, -suffix.length).split("/");
		return parts.length === 2 && issuePath(parts.join("/")) !== null;
	}
	const prefix = `${reference.instanceUrl}/`;
	const gitlabSuffix = `/-/issues/${reference.number}`;
	if (!value.startsWith(prefix) || !value.endsWith(gitlabSuffix)) return false;
	const parts = value.slice(prefix.length, -gitlabSuffix.length).split("/");
	return issuePath(parts.join("/")) !== null;
}
function providerOf(reference: IssueReference): IssueProvider {
	return issueProviderForInstanceUrl(reference.instanceUrl) ?? "gitlab";
}

export function isIssueReference(value: unknown): value is IssueReference {
	return (
		record(value) &&
		value.provider === issueProviderForInstanceUrl(value.instanceUrl) &&
		typeof value.projectId === "string" &&
		value.projectId.trim().length > 0 &&
		typeof value.number === "number" &&
		Number.isSafeInteger(value.number) &&
		value.number > 0
	);
}
function projectIdentifier(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.trim() === value &&
		!/[?#\\]/.test(value) &&
		![...value].some((character) => character.charCodeAt(0) < 32) &&
		value.split("/").every((part) => part !== "" && part !== "." && part !== "..")
	);
}
export function isIssueConnectionInput(value: unknown): value is IssueConnectionInput {
	return (
		record(value) &&
		canonicalIssueInstanceUrl(value.instanceUrl) !== null &&
		projectIdentifier(value.projectId) &&
		typeof value.token === "string" &&
		value.token.trim().length > 0 &&
		!/[\r\n]/.test(value.token) &&
		(!Object.hasOwn(value, "httpConsent") || httpConsent(value.httpConsent))
	);
}
/** Shared by launchDesign, validateDesign and validateImplementation. Not an RPC registration. */
export interface IssueTarget {
	projectId: string;
	reference: IssueReference;
}
/** Effective client language for automatic stage startup (v109), never the system preference. */
export interface IssueSessionStartupTarget extends IssueTarget {
	locale: string;
}
/** Shared by launchImplementation and publishImplementation; host derives commit/workspace identity. */
export interface IssueImplementationTarget extends IssueTarget {
	approvedDesignVersion: string;
}
export interface IssueDesignPublicationInput extends IssueTarget {
	expectedDescription: string;
	newDescription: string;
}
export interface IssuePublication {
	stage: "design" | "implementation";
	version: string;
	noteId: number;
	resetEventId: number;
	body: string;
}
export type IssueApprovalResult =
	| { approved: true; eventId: number; userId: number }
	| { approved: false; reason: "unproven" };
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
	return (
		record(value) &&
		Object.getPrototypeOf(value) === Object.prototype &&
		Reflect.ownKeys(value).length === keys.length &&
		keys.every((key) => Object.hasOwn(value, key))
	);
}
function positiveSafeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
// Deliberately separate from the legacy read/connection guards above.
function actionReference(value: unknown): value is IssueReference {
	return (
		exact(value, ["provider", "instanceUrl", "projectId", "number"]) &&
		isIssueReference(value) &&
		canonicalIssueInstanceUrl(value.instanceUrl) === value.instanceUrl &&
		/^[1-9][0-9]{0,15}$/.test(value.projectId) &&
		Number.isSafeInteger(Number(value.projectId))
	);
}
function actionTarget(value: Record<string, unknown>): boolean {
	return (
		typeof value.projectId === "string" &&
		/^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$/.test(value.projectId) &&
		actionReference(value.reference)
	);
}
export function isIssueTarget(value: unknown): value is IssueTarget {
	return exact(value, ["projectId", "reference"]) && actionTarget(value);
}
export function isIssueSessionStartupTarget(value: unknown): value is IssueSessionStartupTarget {
	return (
		exact(value, ["projectId", "reference", "locale"]) &&
		actionTarget(value) &&
		value.locale !== "system" &&
		isLocalePreference(value.locale)
	);
}
export function isIssueImplementationTarget(value: unknown): value is IssueImplementationTarget {
	return (
		exact(value, ["projectId", "reference", "approvedDesignVersion"]) &&
		actionTarget(value) &&
		typeof value.approvedDesignVersion === "string" &&
		/^design:[a-f0-9]{64}$/.test(value.approvedDesignVersion)
	);
}
function description(value: unknown): value is string {
	return typeof value === "string" && new TextEncoder().encode(value).byteLength <= 262144;
}
export function isIssueDesignPublicationInput(
	value: unknown,
): value is IssueDesignPublicationInput {
	return (
		exact(value, ["projectId", "reference", "expectedDescription", "newDescription"]) &&
		actionTarget(value) &&
		description(value.expectedDescription) &&
		description(value.newDescription)
	);
}
export function isIssueSessionLaunch(value: unknown): value is IssueSessionLaunch {
	return (
		exact(value, ["workspaceId", "sessionId"]) &&
		typeof value.workspaceId === "string" &&
		value.workspaceId.length > 0 &&
		typeof value.sessionId === "string" &&
		value.sessionId.length > 0
	);
}
export function isIssuePublication(value: unknown): value is IssuePublication {
	return (
		exact(value, ["stage", "version", "noteId", "resetEventId", "body"]) &&
		(value.stage === "design" || value.stage === "implementation") &&
		typeof value.version === "string" &&
		new RegExp(`^${value.stage}:[a-f0-9]{64}$`).test(value.version) &&
		positiveSafeInteger(value.noteId) &&
		typeof value.resetEventId === "number" &&
		Number.isSafeInteger(value.resetEventId) &&
		value.resetEventId >= 0 &&
		typeof value.body === "string"
	);
}
export function isIssueDesignApproval(value: unknown): value is IssueDesignApproval {
	return (
		exact(value, ["approvedDesignVersion"]) &&
		(value.approvedDesignVersion === null ||
			(typeof value.approvedDesignVersion === "string" &&
				/^design:[a-f0-9]{64}$/.test(value.approvedDesignVersion)))
	);
}
export function isIssueApprovalResult(value: unknown): value is IssueApprovalResult {
	return (
		(exact(value, ["approved", "eventId", "userId"]) &&
			value.approved === true &&
			positiveSafeInteger(value.eventId) &&
			positiveSafeInteger(value.userId)) ||
		(exact(value, ["approved", "reason"]) &&
			value.approved === false &&
			value.reason === "unproven")
	);
}
