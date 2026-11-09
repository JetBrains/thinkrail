import { RiArrowDownSLine, RiCheckLine } from "@remixicon/react";
import { ModelEffortPill } from "@thinkrail/chat-ui/ModelEffortLabel";
import {
	EffortSlider,
	type ModelEffortPickerHandle,
	type ModelSelection,
} from "@thinkrail/chat-ui/ModelEffortPicker";
import { formatContext } from "@thinkrail/chat-ui/modelPicker";
import { ProviderGlyph } from "@thinkrail/chat-ui/ProviderGlyph";
import { sameModel, type ThinkingLevel, type WireModel } from "@thinkrail/contracts";
import { useT } from "@thinkrail/locales/react";
import { forwardRef, useImperativeHandle, useState } from "react";
import { modelSections, SEARCH_THRESHOLD } from "./modelSections";
import { PageSheet } from "./sheet";

export interface ModelSheetProps {
	models: WireModel[];
	current: WireModel | null;
	level: ThinkingLevel;
	onSelect: (selection: ModelSelection) => void;
	onSelectLevel: (level: ThinkingLevel) => void;
}

/**
 * The phone's model picker, in place of the desktop popover: the composer pill opens a full page (back arrow closes) with the
 * IDE's effort slider (it applies at once) over the models grouped by provider (a tap picks one
 * and closes). Its search field only appears for a long list and never takes focus by itself, so opening the
 * page never raises the keyboard. `/model <query>` opens it through the same handle as on desktop.
 */
export const ModelSheet = forwardRef<ModelEffortPickerHandle, ModelSheetProps>(function ModelSheet(
	{ models, current, level, onSelect, onSelectLevel },
	handle,
) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const show = (next = ""): void => {
		setQuery(next);
		setOpen(true);
	};
	useImperativeHandle(handle, () => ({ open: show }));

	const sections = modelSections(models, current, query);
	/** The catalog entry carries the model's effort levels even when the chat's own copy lags. */
	const effortModel = models.find((model) => sameModel(model, current)) ?? current;
	const levels = effortModel?.thinkingLevels ?? [];

	return (
		<>
			<button
				type="button"
				data-testid="model-selector"
				data-open={open}
				onClick={() => show()}
				className="flex h-touch min-w-0 max-w-full items-center gap-8 rounded-sm border-0 bg-transparent px-8 tr-text-ui text-text-default active:bg-control-bg-hovered data-[open=true]:bg-control-bg-selected"
			>
				<ModelEffortPill
					icon={
						current ? (
							<ProviderGlyph provider={current.provider} className="size-14 text-text-muted" />
						) : null
					}
					name={current?.name ?? t("chat.modelPicker.selectModel")}
					level={current ? level : undefined}
					levels={levels}
					levelTestId="thinking-selector"
				/>
				<RiArrowDownSLine aria-hidden className="size-14 shrink-0 text-text-muted" />
			</button>
			<PageSheet
				open={open}
				onOpenChange={setOpen}
				title={t("mobile.model.title")}
				autoFocus={false}
				testId="model-sheet"
			>
				{effortModel && levels.length > 0 ? (
					<div className="border-b border-border-muted px-4 pb-8">
						<EffortSlider
							model={effortModel}
							level={level}
							defaultLevel={undefined}
							onSelectLevel={onSelectLevel}
						/>
					</div>
				) : null}

				{models.length > SEARCH_THRESHOLD ? (
					<div className="border-b border-border-muted px-16 py-8">
						<input
							type="search"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder={t("chat.modelPicker.search")}
							aria-label={t("chat.modelPicker.search")}
							autoCapitalize="off"
							autoCorrect="off"
							spellCheck={false}
							data-testid="model-search"
							className="h-touch w-full rounded-md border border-control-border-default bg-control-bg px-12 text-text-default tr-text-reading outline-none focus:border-control-border-active"
						/>
					</div>
				) : null}

				{sections.length === 0 ? (
					<p className="m-0 px-16 py-24 text-center text-text-muted tr-text-reading">
						{t("chat.modelPicker.noMatch")}
					</p>
				) : (
					sections.map((section) => (
						<section key={section.provider} className="flex flex-col">
							<h3 className="m-0 flex items-center gap-8 px-16 pt-12 pb-4 text-text-subtle tr-text-eyebrow">
								<ProviderGlyph provider={section.provider} className="size-12" />
								{section.provider}
							</h3>
							<ul className="m-0 list-none p-0">
								{section.models.map((model) => {
									const selected = sameModel(model, current);
									return (
										<li key={`${model.provider}/${model.id}`}>
											<button
												type="button"
												data-testid="model-option"
												data-model-id={model.id}
												aria-pressed={selected}
												onClick={() => {
													if (!selected) onSelect({ model });
													setOpen(false);
												}}
												className={`flex min-h-touch w-full items-center gap-12 border-0 px-16 py-8 text-left active:bg-control-bg-hovered ${
													selected ? "bg-primary-subtle" : "bg-transparent"
												}`}
											>
												<span className="flex min-w-0 flex-1 flex-col gap-2">
													<span className="truncate text-text-default tr-text-ui">
														{model.name}
													</span>
													<span className="truncate text-text-subtle tr-text-metadata">
														{formatContext(model.contextWindow)}
													</span>
												</span>
												{selected ? (
													<RiCheckLine aria-hidden className="size-20 shrink-0 text-primary" />
												) : null}
											</button>
										</li>
									);
								})}
							</ul>
						</section>
					))
				)}
			</PageSheet>
		</>
	);
});
