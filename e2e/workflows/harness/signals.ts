import type { CapturedToolCall, EventLog } from "./events";

export interface Signal {
	description: string;
	test: (log: EventLog) => boolean;
}

export interface ToolCallMatcher {
	pathEndsWith?: string;
	where?: (call: CapturedToolCall) => boolean;
}

export function matchesToolCall(call: CapturedToolCall, matcher?: ToolCallMatcher): boolean {
	if (!matcher) return true;
	if (matcher.pathEndsWith) {
		const path = String(call.args.path ?? call.args.file_path ?? "");
		if (!path.endsWith(matcher.pathEndsWith)) return false;
	}
	return matcher.where ? matcher.where(call) : true;
}

export const signals = {
	skillRead(name: string): Signal {
		return {
			description: `skill "${name}" read`,
			test: (log) => log.skillReads().includes(name),
		};
	},
	toolCall(name: string, matcher?: ToolCallMatcher): Signal {
		const suffix = matcher?.pathEndsWith ? ` (…${matcher.pathEndsWith})` : "";
		return {
			description: `tool ${name}${suffix} called`,
			test: (log) => log.toolCalls(name).some((call) => matchesToolCall(call, matcher)),
		};
	},
	assistantText(pattern: RegExp): Signal {
		return {
			description: `assistant text matching ${pattern}`,
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
