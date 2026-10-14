import { RiArrowDownSLine, RiArrowRightSLine, RiSearchLine } from "@remixicon/react";
import { sameModel, type WireModel } from "@thinkrail/contracts";
import { cn } from "@thinkrail/ui/utils";
import { useId, useMemo, useState } from "react";
import { formatContext } from "@/chat/modelPicker";
import { ProviderGlyph } from "@/chat/ProviderGlyph";
import { useAppStore } from "@/store";
import { SettingsSwitch } from "./SettingsSwitch";

interface Props {
	models: WireModel[];
}

export function VisibleModelsSettings({ models }: Props) {
	const [expanded, setExpanded] = useState(false);
	const [search, setSearch] = useState("");
	const listId = useId();
	const hiddenModels = useAppStore((s) => s.hiddenModels);
	const toggleModelVisibility = useAppStore((s) => s.toggleModelVisibility);
	const isHidden = (model: WireModel) => hiddenModels.some((hidden) => sameModel(hidden, model));

	const filteredModels = useMemo(() => {
		if (!search.trim()) return models;
		const lower = search.toLowerCase();
		return models.filter(
			(m) =>
				m.name.toLowerCase().includes(lower) ||
				m.id.toLowerCase().includes(lower) ||
				m.provider.toLowerCase().includes(lower),
		);
	}, [models, search]);

	const hiddenCount = models.filter(isHidden).length;

	return (
		<div className="flex flex-col">
			<button
				type="button"
				data-testid="visible-models-toggle"
				aria-expanded={expanded}
				aria-controls={listId}
				onClick={() => setExpanded(!expanded)}
				className="flex w-full items-start gap-8 py-12 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary"
			>
				<span className="flex flex-1 flex-col gap-2">
					<span className="tr-text-ui text-text-default">Visible models</span>
					<span className="tr-text-metadata text-text-muted">
						{hiddenCount === 0
							? "New models are shown automatically."
							: `${hiddenCount} model${hiddenCount === 1 ? "" : "s"} hidden. New models are shown automatically.`}
					</span>
				</span>
				<span className="mt-2 shrink-0">
					{expanded ? (
						<RiArrowDownSLine className="size-20 text-text-muted" />
					) : (
						<RiArrowRightSLine className="size-20 text-text-muted" />
					)}
				</span>
			</button>

			{expanded && (
				<div id={listId} className="flex flex-col gap-8 pb-12">
					<div className="relative">
						<RiSearchLine className="pointer-events-none absolute top-1/2 left-8 size-14 -translate-y-1/2 text-text-muted" />
						<input
							type="text"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Search models…"
							aria-label="Search models to show"
							className="h-32 w-full rounded-sm border border-control-border-default bg-control-bg pl-24 pr-8 tr-text-ui text-text-default placeholder:text-text-muted outline-none transition-colors focus:border-control-border-active"
						/>
					</div>

					<div className="max-h-320 overflow-y-auto">
						{filteredModels.length === 0 ? (
							<div className="px-12 py-16 text-center text-text-muted tr-text-metadata">
								{search.trim() ? "No models match your search." : "No models available."}
							</div>
						) : (
							filteredModels.map((model, index) => {
								const isVisible = !isHidden(model);
								return (
									<div
										key={`${model.provider}:${model.id}`}
										className={cn(
											"flex items-start gap-8 py-8",
											index > 0 && "border-border-muted border-t",
										)}
									>
										<ProviderGlyph
											provider={model.provider}
											className="mt-4 size-14 shrink-0 text-text-muted"
										/>
										<span className="flex min-w-0 flex-1 flex-col">
											<span
												className={cn(
													"truncate tr-text-ui",
													isVisible ? "text-text-default" : "text-text-muted",
												)}
											>
												{model.name}
											</span>
											<span className="truncate tr-text-metadata text-text-muted">
												{model.provider} · {formatContext(model.contextWindow)}
												{model.reasoning ? " · reasoning" : ""}
											</span>
										</span>
										<SettingsSwitch
											checked={isVisible}
											label={`Show ${model.name}`}
											testId={`model-visibility-${model.provider}-${model.id}`}
											onChange={() => toggleModelVisibility(model)}
										/>
									</div>
								);
							})
						)}
					</div>
				</div>
			)}
		</div>
	);
}
