import { RiArrowDownSLine, RiArrowRightSLine, RiSearchLine } from "@remixicon/react";
import type { WireModel } from "@thinkrail/contracts";
import { cn } from "@thinkrail/ui/utils";
import { useMemo, useState } from "react";
import { formatContext } from "@/chat/modelPicker";
import { ProviderGlyph } from "@/chat/ProviderGlyph";
import { useModelVisibility } from "@/chat/useModelVisibility";
import { SettingsSwitch } from "./SettingsSwitch";

interface Props {
	models: WireModel[];
}

export function VisibleModelsSettings({ models }: Props) {
	const [expanded, setExpanded] = useState(false);
	const [search, setSearch] = useState("");
	const visibility = useModelVisibility();

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

	const hiddenCount = visibility.hiddenModels.length;

	return (
		<div className="flex flex-col">
			<button
				type="button"
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
				{/* Chevron right-aligned, vertically aligned with title line */}
				<span className="mt-2 shrink-0">
					{expanded ? (
						<RiArrowDownSLine className="size-20 text-text-muted" />
					) : (
						<RiArrowRightSLine className="size-20 text-text-muted" />
					)}
				</span>
			</button>

			{expanded && (
				<div className="flex flex-col gap-8 pb-12">
					{/* Search input */}
					<div className="relative">
						<RiSearchLine className="pointer-events-none absolute top-1/2 left-8 size-14 -translate-y-1/2 text-text-muted" />
						<input
							type="text"
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder="Search models…"
							className="h-32 w-full rounded-sm border border-control-border-default bg-control-bg pl-24 pr-8 tr-text-ui text-text-default placeholder:text-text-muted outline-none transition-colors focus:border-control-border-active"
						/>
					</div>

					{/* Model list - no outer border, clean integrated list */}
					<div className="max-h-[320px] overflow-y-auto">
						{filteredModels.length === 0 ? (
							<div className="px-12 py-16 text-center text-text-muted tr-text-metadata">
								{search.trim() ? "No models match your search." : "No models available."}
							</div>
						) : (
							filteredModels.map((model, index) => {
								const isVisible = visibility.isVisible(model);
								return (
									<div
										key={`${model.provider}:${model.id}`}
										className={cn(
											"flex items-start gap-8 py-8",
											index > 0 && "border-border-muted border-t",
											!isVisible && "opacity-60",
										)}
									>
										{/* Logo aligned with model name line */}
										<ProviderGlyph
											provider={model.provider}
											className="mt-4 size-14 shrink-0 text-text-muted"
										/>
										<span className="flex min-w-0 flex-1 flex-col">
											<span className="truncate tr-text-ui text-text-default">{model.name}</span>
											<span className="truncate tr-text-metadata text-text-muted">
												{model.provider} · {formatContext(model.contextWindow)}
												{model.reasoning ? " · reasoning" : ""}
											</span>
										</span>
										{/* Toggle switch instead of checkmark */}
										<SettingsSwitch
											checked={isVisible}
											label={`Toggle visibility for ${model.name}`}
											testId={`model-visibility-${model.provider}-${model.id}`}
											onChange={() => visibility.toggleVisibility(model)}
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
