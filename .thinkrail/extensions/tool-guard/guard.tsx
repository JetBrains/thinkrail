import { remixicon, ui, useAction } from "@thinkrail/ext/view";
import { useState } from "react";
import { RulesEditor } from "./editor";
import { useLog, useNow } from "./hooks";
import { DecisionRow, Empty, Segmented } from "./parts";

const { RiShieldCheckLine, RiDeleteBin6Line } = remixicon;

type View = "log" | "rules";
type Filter = "all" | "block";

const VIEWS = [
	{ value: "log", label: "Log" },
	{ value: "rules", label: "Rules" },
] as const satisfies readonly { value: View; label: string }[];

const FILTERS = [
	{ value: "all", label: "All" },
	{ value: "block", label: "Blocked" },
] as const satisfies readonly { value: Filter; label: string }[];

const Count = ({ value, label, tone }: { value: number; label: string; tone: string }) => (
	<span className="flex items-center gap-4 tr-text-metadata">
		<span className={value > 0 ? tone : "text-text-subtle"}>{value}</span>
		<span className="text-text-muted">{label}</span>
	</span>
);

const DecisionLog = () => {
	const log = useLog();
	const now = useNow();
	const clear = useAction("clearLog");
	const [filter, setFilter] = useState<Filter>("all");
	const shown = filter === "all" ? log : log.filter((decision) => decision.verdict === "block");
	return (
		<div data-testid="tool-guard-log" className="flex min-h-0 flex-1 flex-col">
			<div className="flex shrink-0 items-center gap-8 border-b border-border-muted px-12 py-8">
				<Segmented
					options={FILTERS}
					value={filter}
					onChange={setFilter}
					testId="tool-guard-filter"
				/>
				<span className="ml-auto" />
				<ui.Button
					variant="ghost"
					size="sm"
					data-testid="tool-guard-clear"
					disabled={log.length === 0}
					onClick={() => void clear().catch(() => {})}
				>
					<RiDeleteBin6Line className="size-14" /> Clear
				</ui.Button>
			</div>
			{shown.length === 0 ? (
				<Empty
					title={filter === "all" ? "No tool calls yet" : "Nothing blocked"}
					detail="bash, write, and edit calls from every chat show up here."
				/>
			) : (
				<ul className="min-h-0 flex-1 overflow-y-auto">
					{shown.map((decision) => (
						<DecisionRow key={decision.id} decision={decision} now={now} />
					))}
				</ul>
			)}
		</div>
	);
};

const Guard = () => {
	const log = useLog();
	const [view, setView] = useState<View>("log");
	const blocked = log.filter((decision) => decision.verdict === "block").length;
	return (
		<div
			data-testid="tool-guard-panel"
			className="flex h-full min-h-0 flex-col bg-container-workspace-bg"
		>
			<header className="flex shrink-0 flex-wrap items-center gap-8 border-b border-border-muted px-12 py-8">
				<RiShieldCheckLine className="size-16 shrink-0 text-primary" />
				<h2 className="tr-title-compact text-text-default">Tool guard</h2>
				<Count value={blocked} label="blocked" tone="text-feedback-error" />
				<Count value={log.length - blocked} label="allowed" tone="text-feedback-success" />
				<span className="ml-auto" />
				<Segmented options={VIEWS} value={view} onChange={setView} testId="tool-guard-view" />
			</header>
			{view === "log" ? <DecisionLog /> : <RulesEditor />}
		</div>
	);
};

export default Guard;
