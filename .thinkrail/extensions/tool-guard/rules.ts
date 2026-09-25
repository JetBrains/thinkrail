import { basename, isAbsolute, join, resolve } from "node:path";
import { pathMatcher } from "./glob";
import {
	type AddResult,
	type NewRule,
	PATTERN_LIMIT,
	RULE_LIMIT,
	type RuleAction,
	type RuleRef,
	type RuleTarget,
	type RuleView,
	type UserRule,
	type Verdict,
} from "./model";
import {
	expandPath,
	isInside,
	isRedirect,
	isShell,
	parseCommandLine,
	type SimpleCommand,
} from "./shell";

export interface GuardContext {
	root: string;
	home: string;
}

export interface RuleSet {
	user: readonly UserRule[];
	disabled: ReadonlySet<string>;
}

interface Builtin<T extends RuleTarget> {
	id: string;
	target: T;
	label: string;
	description: string;
	test: (subject: T extends "bash" ? SimpleCommand : string, ctx: GuardContext) => boolean;
}

const rmTargets = (args: readonly string[]) => {
	let recursive = false;
	let force = false;
	let options = true;
	let skipNext = false;
	const targets: string[] = [];
	for (const arg of args) {
		if (skipNext) {
			skipNext = false;
		} else if (isRedirect(arg)) {
			skipNext = /^\d*[<>]+&?$/.test(arg);
		} else if (options && arg === "--") {
			options = false;
		} else if (options && arg.startsWith("--")) {
			recursive ||= arg === "--recursive";
			force ||= arg === "--force";
		} else if (options && arg.startsWith("-") && arg.length > 1) {
			recursive ||= /[rR]/.test(arg);
			force ||= arg.includes("f");
		} else targets.push(arg);
	}
	return recursive && force ? targets : [];
};

const unsafeTarget = (target: string, command: SimpleCommand, { root, home }: GuardContext) => {
	const expanded = expandPath(target, home);
	if (expanded === undefined) return true;
	if (isAbsolute(expanded)) return !isInside(root, resolve(expanded));
	return command.cwd === undefined || !isInside(root, resolve(command.cwd, expanded));
};

const GIT_VALUE_OPTIONS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace"]);

const gitSubcommand = (argv: readonly string[]) => {
	let i = 1;
	while (i < argv.length) {
		const arg = argv[i] ?? "";
		if (GIT_VALUE_OPTIONS.has(arg)) i += 2;
		else if (arg.startsWith("-")) i++;
		else break;
	}
	return { sub: argv[i], rest: argv.slice(i + 1) };
};

const isForcePush = (arg: string) =>
	arg === "--force" ||
	(/^-[a-zA-Z]+$/.test(arg) && arg.includes("f")) ||
	(arg.startsWith("+") && arg.length > 1);

const EXAMPLE_ENV = /^\.env\.(example|sample|template)$/;

const BASH_BUILTINS: Builtin<"bash">[] = [
	{
		id: "rm-rf-outside",
		target: "bash",
		label: "rm -rf outside the workspace",
		description:
			"recursive force delete of a path outside the workspace, the workspace itself, or a path that cannot be resolved",
		test: (command, ctx) =>
			command.program === "rm" &&
			rmTargets(command.argv.slice(1)).some((target) => unsafeTarget(target, command, ctx)),
	},
	{
		id: "git-push-force",
		target: "bash",
		label: "git push --force",
		description: "force-push rewrites the remote branch history for everyone",
		test: (command) => {
			if (command.program !== "git") return false;
			const { sub, rest } = gitSubcommand(command.argv);
			return sub === "push" && rest.some(isForcePush);
		},
	},
	{
		id: "git-reset-hard",
		target: "bash",
		label: "git reset --hard",
		description: "discards uncommitted work in the checkout",
		test: (command) => {
			if (command.program !== "git") return false;
			const { sub, rest } = gitSubcommand(command.argv);
			return sub === "reset" && rest.includes("--hard");
		},
	},
	{
		id: "curl-pipe-shell",
		target: "bash",
		label: "curl | sh",
		description: "runs a script downloaded from the network without review",
		test: (command) =>
			isShell(command.program) &&
			command.upstream.some((program) => program === "curl" || program === "wget"),
	},
];

const PATH_BUILTINS: Builtin<"path">[] = [
	{
		id: "env-files",
		target: "path",
		label: ".env files",
		description: ".env files hold secrets",
		test: (path) => {
			const name = basename(path);
			return /^\.env(\..+)?$/.test(name) && !EXAMPLE_ENV.test(name);
		},
	},
	{
		id: "ssh-dir",
		target: "path",
		label: "~/.ssh",
		description: "~/.ssh holds keys and ssh config",
		test: (path, { home }) => {
			const ssh = join(home, ".ssh");
			return path === ssh || isInside(ssh, path);
		},
	},
];

export const BUILTIN_IDS = [...BASH_BUILTINS, ...PATH_BUILTINS].map((rule) => rule.id);

interface Compiled<S> {
	ref: RuleRef;
	action: RuleAction;
	why: string;
	test: (subject: S) => boolean;
	testLine?: (line: string) => boolean;
}

const userRef = (rule: UserRule) => ({ id: rule.id, label: rule.pattern });
const userWhy = (rule: UserRule) => rule.note?.trim() || "a user rule";

const regexCache = new Map<string, RegExp>();
const regexOf = (pattern: string) => {
	const cached = regexCache.get(pattern);
	if (cached) return cached;
	const regex = new RegExp(pattern);
	if (regexCache.size > 500) regexCache.clear();
	regexCache.set(pattern, regex);
	return regex;
};

const compileBash = (rules: RuleSet, ctx: GuardContext): Compiled<SimpleCommand>[] => [
	...rules.user
		.filter((rule) => rule.enabled && rule.target === "bash")
		.map((rule) => {
			const regex = regexOf(rule.pattern);
			return {
				ref: userRef(rule),
				action: rule.action,
				why: userWhy(rule),
				test: (command: SimpleCommand) =>
					regex.test(command.argv.join(" ")) || regex.test(command.words.join(" ")),
				...(rule.action === "block" ? { testLine: (line: string) => regex.test(line) } : {}),
			};
		}),
	...BASH_BUILTINS.filter((rule) => !rules.disabled.has(rule.id)).map((rule) => ({
		ref: { id: rule.id, label: rule.label },
		action: "block" as const,
		why: rule.description,
		test: (command: SimpleCommand) => rule.test(command, ctx),
	})),
];

const compilePath = (rules: RuleSet, ctx: GuardContext): Compiled<string>[] => [
	...rules.user
		.filter((rule) => rule.enabled && rule.target === "path")
		.map((rule) => ({
			ref: userRef(rule),
			action: rule.action,
			why: userWhy(rule),
			test: pathMatcher({ pattern: rule.pattern, ...ctx }),
		})),
	...PATH_BUILTINS.filter((rule) => !rules.disabled.has(rule.id)).map((rule) => ({
		ref: { id: rule.id, label: rule.label },
		action: "block" as const,
		why: rule.description,
		test: (path: string) => rule.test(path, ctx),
	})),
];

type Explained = Pick<Compiled<never>, "ref" | "why">;

const blockReason = (rule: Explained) =>
	`tool-guard blocked this call (rule "${rule.ref.label}": ${rule.why}). Do not retry it or work around the rule. Tell the user what you wanted to do and why; they can run it themselves or change the rule in the Tool guard panel.`;

const blocked = (rule: Explained): Verdict => ({
	verdict: "block",
	rule: rule.ref,
	reason: blockReason(rule),
});

export const evaluateBash = ({
	command,
	rules,
	ctx,
}: {
	command: string;
	rules: RuleSet;
	ctx: GuardContext;
}): Verdict => {
	const compiled = compileBash(rules, ctx);
	const lineBlock = compiled.find((rule) => rule.testLine?.(command));
	if (lineBlock) return blocked(lineBlock);
	let allowedBy: RuleRef | undefined;
	for (const simple of parseCommandLine({ line: command, cwd: ctx.root, home: ctx.home })) {
		const rule = compiled.find((candidate) => candidate.test(simple));
		if (rule?.action === "block") return blocked(rule);
		allowedBy ??= rule?.ref;
	}
	return allowedBy ? { verdict: "allow", rule: allowedBy } : { verdict: "allow" };
};

export const resolveToolPath = (path: string, ctx: GuardContext) => {
	const bare = path.startsWith("@") ? path.slice(1) : path;
	const expanded = expandPath(bare, ctx.home) ?? bare;
	return resolve(ctx.root, expanded);
};

export const evaluatePath = ({
	path,
	rules,
	ctx,
}: {
	path: string;
	rules: RuleSet;
	ctx: GuardContext;
}): Verdict => {
	const absolute = resolveToolPath(path, ctx);
	const rule = compilePath(rules, ctx).find((candidate) => candidate.test(absolute));
	if (!rule) return { verdict: "allow" };
	return rule.action === "block" ? blocked(rule) : { verdict: "allow", rule: rule.ref };
};

export const ruleViews = (rules: RuleSet): RuleView[] => [
	...rules.user.map((rule) => ({
		id: rule.id,
		source: "user" as const,
		target: rule.target,
		action: rule.action,
		enabled: rule.enabled,
		label: rule.pattern,
		...(rule.note ? { description: rule.note } : {}),
	})),
	...[...BASH_BUILTINS, ...PATH_BUILTINS].map((rule) => ({
		id: rule.id,
		source: "builtin" as const,
		target: rule.target,
		action: "block" as const,
		enabled: !rules.disabled.has(rule.id),
		label: rule.label,
		description: rule.description,
	})),
];

export const createRule = ({
	input,
	existing,
	id,
}: {
	input: NewRule;
	existing: number;
	id: string;
}): AddResult => {
	const pattern = input.pattern.trim();
	if (!pattern) return { ok: false, error: "Enter a pattern." };
	if (pattern.length > PATTERN_LIMIT)
		return { ok: false, error: `Keep the pattern under ${PATTERN_LIMIT} characters.` };
	if (existing >= RULE_LIMIT)
		return { ok: false, error: `At most ${RULE_LIMIT} rules. Remove one first.` };
	if (input.target === "bash") {
		try {
			regexOf(pattern);
		} catch (error) {
			return { ok: false, error: `Not a valid regular expression: ${String(error)}` };
		}
	}
	const note = input.note?.trim().slice(0, PATTERN_LIMIT);
	return {
		ok: true,
		rule: {
			id,
			target: input.target,
			pattern,
			action: input.action,
			enabled: true,
			...(note ? { note } : {}),
		},
	};
};
