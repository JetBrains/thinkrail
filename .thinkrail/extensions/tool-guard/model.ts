export const EXT_NAME = "tool-guard";
export const LOG_LIMIT = 200;
export const RULE_LIMIT = 100;
export const PATTERN_LIMIT = 300;
export const SUMMARY_LIMIT = 200;

export type RuleAction = "block" | "allow";
export type RuleTarget = "bash" | "path";
export type GuardTool = "bash" | "write" | "edit";

export interface UserRule {
	id: string;
	target: RuleTarget;
	pattern: string;
	action: RuleAction;
	enabled: boolean;
	note?: string;
}

export interface RuleView {
	id: string;
	source: "user" | "builtin";
	target: RuleTarget;
	action: RuleAction;
	enabled: boolean;
	label: string;
	description?: string;
}

export interface RuleRef {
	id: string;
	label: string;
}

export type Verdict =
	| { verdict: "allow"; rule?: RuleRef }
	| { verdict: "block"; rule: RuleRef; reason: string };

export interface Decision {
	id: string;
	at: number;
	sessionId: string;
	sessionTitle?: string;
	tool: GuardTool;
	summary: string;
	verdict: RuleAction;
	rule?: RuleRef;
	reason?: string;
}

export interface NewRule {
	target: RuleTarget;
	pattern: string;
	action: RuleAction;
	note?: string;
}

export type AddResult = { ok: true; rule: UserRule } | { ok: false; error: string };

export interface CheckRequest {
	tool: GuardTool;
	input: string;
}

export type CheckResult = Verdict | { verdict: "error"; error: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isOneOf = <T extends string>(value: unknown, options: readonly T[]): value is T =>
	typeof value === "string" && (options as readonly string[]).includes(value);

const ACTIONS = ["block", "allow"] as const satisfies readonly RuleAction[];
const TARGETS = ["bash", "path"] as const satisfies readonly RuleTarget[];
const TOOLS = ["bash", "write", "edit"] as const satisfies readonly GuardTool[];

const isGuardTool = (value: unknown): value is GuardTool => isOneOf(value, TOOLS);

export const isUserRule = (value: unknown): value is UserRule =>
	isRecord(value) &&
	typeof value.id === "string" &&
	typeof value.pattern === "string" &&
	typeof value.enabled === "boolean" &&
	isOneOf(value.target, TARGETS) &&
	isOneOf(value.action, ACTIONS) &&
	(value.note === undefined || typeof value.note === "string");

export const isNewRule = (value: unknown): value is NewRule =>
	isRecord(value) &&
	typeof value.pattern === "string" &&
	isOneOf(value.target, TARGETS) &&
	isOneOf(value.action, ACTIONS) &&
	(value.note === undefined || typeof value.note === "string");

export const isDecision = (value: unknown): value is Decision =>
	isRecord(value) &&
	typeof value.id === "string" &&
	typeof value.at === "number" &&
	typeof value.sessionId === "string" &&
	typeof value.summary === "string" &&
	isGuardTool(value.tool) &&
	isOneOf(value.verdict, ACTIONS);

export const isCheckRequest = (value: unknown): value is CheckRequest =>
	isRecord(value) && isGuardTool(value.tool) && typeof value.input === "string";

export const isAddResult = (value: unknown): value is AddResult =>
	isRecord(value) &&
	((value.ok === true && isUserRule(value.rule)) ||
		(value.ok === false && typeof value.error === "string"));

export const isCheckResult = (value: unknown): value is CheckResult =>
	isRecord(value) &&
	(value.verdict === "allow" || value.verdict === "block" || value.verdict === "error");

export const idPayload = (value: unknown) =>
	isRecord(value) && typeof value.id === "string" ? value.id : undefined;

export const clip = (text: string, limit: number) =>
	text.length > limit ? `${text.slice(0, limit - 1)}…` : text;

export const formatAgo = (ms: number) => {
	const seconds = Math.floor(ms / 1000);
	if (seconds < 60) return `${seconds}s ago`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.floor(minutes / 60);
	if (hours < 48) return `${hours}h ago`;
	return `${Math.floor(hours / 24)}d ago`;
};
