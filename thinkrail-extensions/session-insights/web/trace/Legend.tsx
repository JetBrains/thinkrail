import { useT } from "@thinkrail/locales/react";
import type { ToolFamily } from "@thinkrail/pi-session-insights/core";
import { cn } from "@thinkrail/ui/utils";
import type { ReactNode } from "react";
import { FAMILY_SERIES, LLM_SERIES, type TraceModel } from "./model";
import { SERIES_SWATCH } from "./TraceTree";

export const FAMILY_LABEL = {
	discovery: "sessionInsights.trace.family.discovery",
	reading: "sessionInsights.trace.family.reading",
	writing: "sessionInsights.trace.family.writing",
	execution: "sessionInsights.trace.family.execution",
	planning: "sessionInsights.trace.family.planning",
	subagent: "sessionInsights.trace.family.subagent",
	ask: "sessionInsights.trace.family.ask",
	other: "sessionInsights.trace.family.other",
} as const;

export const FAMILY_ORDER: readonly ToolFamily[] = [
	"discovery",
	"reading",
	"writing",
	"execution",
	"planning",
	"subagent",
	"ask",
	"other",
];

/** The tool families a trace uses, in legend order, and whether it has model calls. */
export function presentFamilies(model: TraceModel): { calls: boolean; families: ToolFamily[] } {
	const families = new Set<ToolFamily>();
	let calls = false;
	for (const event of model.events) {
		if (event.kind === "tool") families.add(event.family);
		if (event.kind === "subagent") families.add("subagent");
		if (event.kind === "llm") calls = true;
	}
	return { calls, families: FAMILY_ORDER.filter((family) => families.has(family)) };
}

export function Swatch({ className, children }: { className: string; children: ReactNode }) {
	return (
		<span className="inline-flex items-center gap-4">
			<span className={cn("size-8 shrink-0 rounded-sm", className)} />
			{children}
		</span>
	);
}

/** The categorical legend of a trace: model calls, the tool families present, failures, then `children`. */
export function Legend({
	model,
	testId,
	hint,
	children,
}: {
	model: TraceModel;
	testId: string;
	hint?: ReactNode;
	children?: ReactNode;
}) {
	const t = useT();
	const { calls, families } = presentFamilies(model);
	return (
		<div
			data-testid={testId}
			className="flex shrink-0 flex-wrap items-center gap-x-12 gap-y-2 border-border-default border-t px-12 py-4 tr-text-caption text-text-muted"
		>
			{calls ? (
				<Swatch className={SERIES_SWATCH[LLM_SERIES]}>
					{t("sessionInsights.trace.family.llm")}
				</Swatch>
			) : null}
			{families.map((family) => (
				<Swatch key={family} className={SERIES_SWATCH[FAMILY_SERIES[family]]}>
					{t(FAMILY_LABEL[family])}
				</Swatch>
			))}
			<Swatch className="bg-feedback-error">{t("sessionInsights.trace.legend.error")}</Swatch>
			{children}
			{hint ? <span className="ml-auto text-text-subtle">{hint}</span> : null}
		</div>
	);
}
