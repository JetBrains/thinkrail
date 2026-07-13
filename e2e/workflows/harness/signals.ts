// Stop conditions — predicates over the EventLog. First match aborts the session, which is the harness's
// main cost control: a routing scenario ends the moment its question is answered, not at turn end.
// Scenario surface: `stopWhen` (pass-signals) and `forbid` (fail-signals — abort + deterministic fail).
import type { CapturedToolCall, EventLog } from "./events";

export interface Signal {
	description: string;
	tag?: "activation" | "outcome";
	test: (log: EventLog) => boolean;
}

export interface ToolCallMatcher {
	/** Matches when the call's path-ish arg (path / file_path) ends with this suffix. */
	pathEndsWith?: string;
	/** Arbitrary predicate on the call. */
	where?: (call: CapturedToolCall) => boolean;
}

/**
 * The ONE `ToolCallMatcher` semantics — shared by signals and checks so `stopWhen: signals.toolCall(…)`
 * and `expect: checks.expectToolCalled(…)` can never drift apart for the same matcher.
 */
export function matchesToolCall(call: CapturedToolCall, matcher?: ToolCallMatcher): boolean {
	if (!matcher) return true;
	if (matcher.pathEndsWith) {
		const path = String(call.args.path ?? call.args.file_path ?? "");
		if (!path.endsWith(matcher.pathEndsWith)) return false;
	}
	return matcher.where ? matcher.where(call) : true;
}

export const signals = {
	/** The agent loaded a skill (read its SKILL.md). */
	skillRead(name: string): Signal {
		return {
			description: `skill "${name}" read`,
			tag: "activation",
			test: (log) => log.skillReads().includes(name),
		};
	},
	toolCall(name: string, matcher?: ToolCallMatcher): Signal {
		const suffix = matcher?.pathEndsWith ? ` (…${matcher.pathEndsWith})` : "";
		return {
			description: `tool ${name}${suffix} called`,
			tag: "outcome",
			test: (log) => log.toolCalls(name).some((call) => matchesToolCall(call, matcher)),
		};
	},
	assistantText(pattern: RegExp): Signal {
		return {
			description: `assistant text matching ${pattern}`,
			tag: "outcome",
			test: (log) => log.assistantTexts().some((text) => pattern.test(text)),
		};
	},
	turnEnd(count = 1): Signal {
		return {
			description: `${count} turn(s) completed`,
			test: (log) => log.turnCount() >= count,
		};
	},
};

export interface SignalHit {
	kind: "stop" | "forbid";
	signal: Signal;
}

/**
 * Watch the log until a stop- or forbid-signal fires. Resolves with the hit; never rejects — the
 * scenario loop owns timeouts (via its turn promise) and budget trips (watchdog). Call `cancel()` in
 * the scenario's `finally` so no watcher outlives its run.
 */
export function watchSignals(
	log: EventLog,
	stopWhen: Signal[],
	forbid: Signal[],
): { hit: Promise<SignalHit>; peek: () => SignalHit | null; cancel: () => void } {
	let resolved: SignalHit | null = null;
	let resolveHit: (hit: SignalHit) => void = () => {};
	const hit = new Promise<SignalHit>((resolve) => {
		resolveHit = resolve;
	});
	const check = (): void => {
		if (resolved) return;
		for (const signal of forbid) {
			if (signal.test(log)) {
				resolved = { kind: "forbid", signal };
				resolveHit(resolved);
				return;
			}
		}
		for (const signal of stopWhen) {
			if (signal.test(log)) {
				resolved = { kind: "stop", signal };
				resolveHit(resolved);
				return;
			}
		}
	};
	const unsubscribe = log.onGrow(check);
	check();
	return { hit, peek: () => resolved, cancel: unsubscribe };
}
