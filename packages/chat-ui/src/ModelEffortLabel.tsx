import type { ThinkingLevel } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { cn } from "@thinkrail/ui/utils";
import type { ReactNode } from "react";
import { useChatActions } from "./ChatActions";
import { EFFORT_BAR_HEIGHTS, LEVEL_LABEL, type LevelTone, levelTone, litBars } from "./modelPicker";
import { ProviderGlyph } from "./ProviderGlyph";

export const TONE_TEXT: Record<LevelTone, string> = {
	cool: "text-feedback-info",
	accent: "text-primary",
	hot: "text-feedback-warning",
};

function EffortBars({
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

export function parseModelRef(ref: string): { provider: string; id: string } | null {
	const slash = ref.indexOf("/");
	if (slash <= 0 || slash === ref.length - 1) return null;
	return { provider: ref.slice(0, slash), id: ref.slice(slash + 1) };
}

export function ModelEffortPill({
	icon,
	name,
	detail,
	level,
	levels,
	levelTestId,
}: {
	icon: ReactNode;
	name: ReactNode;
	detail?: ReactNode;
	level: ThinkingLevel | undefined;
	levels: readonly ThinkingLevel[] | undefined;
	levelTestId?: string;
}) {
	const t = useT();
	return (
		<>
			{icon}
			<span className="truncate">{name}</span>
			{detail ? <span className="truncate text-text-muted tr-text-metadata">{detail}</span> : null}
			{level ? (
				<span
					data-testid={levelTestId}
					data-level={level}
					className="flex shrink-0 items-center gap-4 text-text-muted tr-text-metadata capitalize"
				>
					{levels ? (
						<EffortBars level={level} levels={levels} className={TONE_TEXT[levelTone(level)]} />
					) : null}
					{t(LEVEL_LABEL[level])}
				</span>
			) : null}
		</>
	);
}

export function RunModelLabel({
	model,
	thinkingLevel,
}: {
	model: string | undefined;
	thinkingLevel: ThinkingLevel | undefined;
}) {
	const actions = useChatActions();
	if (!model) return null;
	const catalogModel = actions?.findModel?.(model);
	const provider = parseModelRef(model)?.provider;
	return (
		<span
			data-testid="model-effort-label"
			title={model}
			className="flex min-w-0 items-center gap-8 tr-text-ui text-text-default"
		>
			<ModelEffortPill
				icon={
					provider ? (
						<ProviderGlyph provider={provider} className="size-14 text-text-muted" />
					) : null
				}
				name={catalogModel?.name ?? model}
				level={thinkingLevel}
				levels={catalogModel?.thinkingLevels}
			/>
		</span>
	);
}
