import type { ThinkingLevel, WireModel } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import { useChatActions } from "./ChatActions";
import { EFFORT_BAR_HEIGHTS, LEVEL_LABEL, type LevelTone, levelTone, litBars } from "./modelPicker";
import { ProviderGlyph } from "./ProviderGlyph";

const ALL_LEVELS = Object.keys(LEVEL_LABEL) as ThinkingLevel[];

export const TONE_TEXT: Record<LevelTone, string> = {
	cool: "text-feedback-info",
	accent: "text-primary",
	hot: "text-feedback-warning",
};

export function EffortBars({
	level,
	levels,
	className,
}: {
	level: ThinkingLevel;
	levels: readonly ThinkingLevel[];
	className?: string;
}) {
	const lit = litBars(level, levels);
	return (
		<span aria-hidden className={cn("inline-flex h-12 shrink-0 items-end gap-2", className)}>
			{EFFORT_BAR_HEIGHTS.map((height, index) => (
				<span
					key={height}
					className={cn("w-2 rounded-xs bg-current", height, index >= lit && "opacity-30")}
				/>
			))}
		</span>
	);
}

/** Split a run's `provider/id` reference; model ids may themselves contain `/`. */
export function parseModelRef(ref: string): { provider: string; id: string } | null {
	const slash = ref.indexOf("/");
	if (slash <= 0 || slash === ref.length - 1) return null;
	return { provider: ref.slice(0, slash), id: ref.slice(slash + 1) };
}

export function ModelEffortLabel({
	model,
	thinkingLevel,
	catalogModel,
	className,
}: {
	model: string;
	thinkingLevel?: ThinkingLevel | undefined;
	catalogModel?: WireModel | null | undefined;
	className?: string;
}) {
	const t = useT();
	const provider = parseModelRef(model)?.provider;
	const levelText = thinkingLevel ? t(LEVEL_LABEL[thinkingLevel]) : undefined;
	return (
		<span
			data-testid="model-effort-label"
			title={levelText ? t("chat.modelEffortLabel.title", { model, level: levelText }) : model}
			className={cn("inline-flex min-w-0 items-center gap-4", className)}
		>
			{provider ? <ProviderGlyph provider={provider} className="size-12" /> : null}
			<span className={cn("min-w-0 truncate", !catalogModel && "tr-code-text-small")}>
				{catalogModel?.name ?? model}
			</span>
			{thinkingLevel ? (
				<>
					<span aria-hidden>·</span>
					<span
						data-testid="model-effort-level"
						className={cn(
							"inline-flex shrink-0 items-center gap-4",
							TONE_TEXT[levelTone(thinkingLevel)],
						)}
					>
						<EffortBars level={thinkingLevel} levels={catalogModel?.thinkingLevels ?? ALL_LEVELS} />
						{levelText}
					</span>
				</>
			) : null}
		</span>
	);
}

/** A delegation run's label, resolved against the chat's model catalog through `ChatActions`. */
export function RunModelLabel({
	model,
	thinkingLevel,
}: {
	model: string | undefined;
	thinkingLevel: ThinkingLevel | undefined;
}) {
	const actions = useChatActions();
	if (!model) return null;
	return (
		<ModelEffortLabel
			model={model}
			thinkingLevel={thinkingLevel}
			catalogModel={actions?.findModel?.(model)}
		/>
	);
}
