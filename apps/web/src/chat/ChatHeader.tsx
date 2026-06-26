import type { Model, SessionStats, ThinkingLevel } from "@thinkrail-pi/contracts";
import { ModelSelector } from "./ModelSelector";
import { SessionStatsBar } from "./SessionStatsBar";
import { ThinkingSelector } from "./ThinkingSelector";

/** The chat tab's top bar: model + thinking pickers (left), extension status + token/cost stats (right). */
export function ChatHeader({
	models,
	currentModel,
	thinkingLevel,
	stats,
	statusEntries,
	onSelectModel,
	onSelectThinking,
}: {
	models: Model<string>[];
	currentModel: Model<string> | null;
	thinkingLevel: ThinkingLevel;
	stats: SessionStats | null;
	statusEntries: [string, string][];
	onSelectModel: (model: Model<string>) => void;
	onSelectThinking: (level: ThinkingLevel) => void;
}) {
	return (
		<div className="flex shrink-0 flex-wrap items-center gap-sm border-border2 border-b bg-bg-dark px-sm py-xs">
			<ModelSelector models={models} current={currentModel} onSelect={onSelectModel} />
			<ThinkingSelector level={thinkingLevel} onSelect={onSelectThinking} />
			<div className="ml-auto flex items-center gap-md">
				{statusEntries.map(([key, text]) => (
					<span key={key} className="text-muted text-xs">
						{text}
					</span>
				))}
				<SessionStatsBar stats={stats} />
			</div>
		</div>
	);
}
