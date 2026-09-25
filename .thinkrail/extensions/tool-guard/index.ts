import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { relative } from "node:path";
import { defineExtension } from "@thinkrail/ext";
import {
	type AddResult,
	type CheckResult,
	clip,
	type Decision,
	idPayload,
	isCheckRequest,
	isDecision,
	isNewRule,
	isUserRule,
	LOG_LIMIT,
	SUMMARY_LIMIT,
	type UserRule,
	type Verdict,
} from "./model";
import { type GuardCall, guardPi } from "./pi";
import {
	BUILTIN_IDS,
	createRule,
	evaluateBash,
	evaluatePath,
	type GuardContext,
	type RuleSet,
	resolveToolPath,
	ruleViews,
} from "./rules";
import { isInside } from "./shell";

const FLUSH_MS = 1_000;

const readArray = async <T>(
	store: { get<V>(key: string): Promise<V | undefined> },
	key: string,
	is: (value: unknown) => value is T,
) => {
	const value = await store.get<unknown>(key);
	return Array.isArray(value) ? value.filter(is) : [];
};

const isString = (value: unknown): value is string => typeof value === "string";

const summaryOf = (call: Pick<GuardCall, "tool" | "input">, ctx: GuardContext) => {
	if (call.tool === "bash") return clip(call.input.trim(), SUMMARY_LIMIT);
	const path = resolveToolPath(call.input, ctx);
	return clip(isInside(ctx.root, path) ? relative(ctx.root, path) : path, SUMMARY_LIMIT);
};

export default defineExtension(async (tr) => {
	const home = homedir();
	let user: UserRule[] = await readArray(tr.store, "rules", isUserRule);
	const disabled = new Set(
		(await readArray(tr.store, "disabled", isString)).filter((id) => BUILTIN_IDS.includes(id)),
	);
	let log: Decision[] = (await readArray(tr.store, "log", isDecision)).slice(0, LOG_LIMIT);
	let dirty = false;

	const ruleSet = (): RuleSet => ({ user, disabled });

	const publishRules = () => tr.publish("rules", ruleViews(ruleSet()));
	const publishLog = () => tr.publish("log", log);

	const saveRules = async () => {
		await tr.store.set("rules", user);
		await tr.store.set("disabled", [...disabled]);
		publishRules();
	};

	const flush = async () => {
		if (!dirty) return;
		dirty = false;
		await tr.store.set("log", log);
	};

	const evaluate = (call: Pick<GuardCall, "tool" | "input">, ctx: GuardContext): Verdict =>
		call.tool === "bash"
			? evaluateBash({ command: call.input, rules: ruleSet(), ctx })
			: evaluatePath({ path: call.input, rules: ruleSet(), ctx });

	const record = (call: GuardCall, ctx: GuardContext, verdict: Verdict) => {
		const title = tr.sessions.list().find((session) => session.sessionId === call.sessionId)?.title;
		const decision: Decision = {
			id: randomUUID(),
			at: Date.now(),
			sessionId: call.sessionId,
			...(title ? { sessionTitle: title } : {}),
			tool: call.tool,
			summary: summaryOf(call, ctx),
			verdict: verdict.verdict,
			...(verdict.rule ? { rule: verdict.rule } : {}),
			...(verdict.verdict === "block" ? { reason: verdict.reason } : {}),
		};
		log = [decision, ...log].slice(0, LOG_LIMIT);
		dirty = true;
		publishLog();
	};

	tr.pi(
		guardPi((call) => {
			const ctx = { root: call.cwd, home };
			const verdict = evaluate(call, ctx);
			record(call, ctx, verdict);
			if (verdict.verdict === "allow") return undefined;
			tr.log(`blocked ${call.tool} in ${call.sessionId}: ${verdict.rule.label}`);
			return { block: true, reason: verdict.reason };
		}),
	);

	tr.every(FLUSH_MS, flush);

	tr.action("addRule", async (payload): Promise<AddResult> => {
		if (!isNewRule(payload)) return { ok: false, error: "Invalid rule." };
		const result = createRule({ input: payload, existing: user.length, id: `u-${randomUUID()}` });
		if (!result.ok) return result;
		user = [result.rule, ...user];
		await saveRules();
		return result;
	});

	tr.action("toggleRule", async (payload) => {
		const id = idPayload(payload);
		if (!id) return { ok: false };
		if (BUILTIN_IDS.includes(id)) {
			if (disabled.has(id)) disabled.delete(id);
			else disabled.add(id);
		} else if (user.some((rule) => rule.id === id)) {
			user = user.map((rule) => (rule.id === id ? { ...rule, enabled: !rule.enabled } : rule));
		} else return { ok: false };
		await saveRules();
		return { ok: true };
	});

	tr.action("removeRule", async (payload) => {
		const id = idPayload(payload);
		if (!id || !user.some((rule) => rule.id === id)) return { ok: false };
		user = user.filter((rule) => rule.id !== id);
		await saveRules();
		return { ok: true };
	});

	tr.action("clearLog", async () => {
		log = [];
		dirty = false;
		publishLog();
		await tr.store.set("log", log);
		return { ok: true };
	});

	tr.action("check", (payload, actionCtx): CheckResult => {
		if (!isCheckRequest(payload)) return { verdict: "error", error: "Invalid request." };
		if (!payload.input.trim()) return { verdict: "error", error: "Enter a command or path." };
		const root = actionCtx.workspaceId ? tr.workspaces.get(actionCtx.workspaceId)?.path : undefined;
		if (!root) return { verdict: "error", error: "Open a workspace to try a rule." };
		return evaluate(payload, { root, home });
	});

	publishRules();
	publishLog();

	return flush;
});
