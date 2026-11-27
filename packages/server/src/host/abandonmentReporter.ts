import type { Logger } from "../log";
import { AbandonmentReportBudget } from "./requestReplayCache";

function formatCounts(counts: ReadonlyMap<string, number>): string {
	return [...counts].map(([method, count]) => `${method} ×${count}`).join(", ");
}

export class AbandonmentReporter {
	private readonly counts = new Map<string, number>();
	private readonly budget = new AbandonmentReportBudget();
	private readonly log: Pick<Logger, "debug" | "warn">;
	private readonly report: (method: string) => void;

	constructor(log: Pick<Logger, "debug" | "warn">, report: (method: string) => void) {
		this.log = log;
		this.report = report;
	}

	record(methods: readonly string[]): void {
		if (methods.length === 0) return;
		const batch = new Map<string, number>();
		for (const method of methods) {
			batch.set(method, (batch.get(method) ?? 0) + 1);
			this.counts.set(method, (this.counts.get(method) ?? 0) + 1);
		}
		this.log.debug(`requests abandoned before their handlers settled: ${formatCounts(batch)}`);
		for (const method of batch.keys()) {
			if (this.budget.admit(method)) this.report(method);
		}
	}

	flush(): void {
		if (this.counts.size === 0) return;
		this.log.warn(`abandoned request summary: ${formatCounts(this.counts)}`);
		this.counts.clear();
	}
}
