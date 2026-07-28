import { type ModelCatalogEntry, modelRef } from "@thinkrail/contracts";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn, formatContextWindow } from "@/lib";
import { toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";

/** One provider's models, in the host's order (the catalog arrives grouped, newest first). */
function groupByProvider(catalog: ModelCatalogEntry[]): [string, ModelCatalogEntry[]][] {
	const groups = new Map<string, ModelCatalogEntry[]>();
	for (const entry of catalog) {
		const group = groups.get(entry.model.provider);
		if (group) group.push(entry);
		else groups.set(entry.model.provider, [entry]);
	}
	return [...groups];
}

/**
 * The "Models" settings section: which models the picker offers day to day.
 *
 * This edits **pi's own `enabledModels` setting**, not a ThinkRail one — so a list curated here is the
 * list `pi` honors in its CLI/TUI too (and vice versa). Every toggle sends the *whole* list
 * (`model.setEnabled`) and the UI repaints from the host's `model.catalogChanged` broadcast, the same
 * converge-on-broadcast pattern as the theme and analytics switches — so there is no dirty state and no
 * Save button. Turning everything off means "all models available", which is how pi stores "no filter".
 */
export function ModelsSettings() {
	const catalog = useAppStore((s) => s.modelCatalog);
	const [busy, setBusy] = useState(false);

	// The catalog is host-global and normally already loaded by a chat/dialog picker — fetch it if this
	// panel is the first surface to need it (a user who opens Settings before any chat).
	useEffect(() => {
		if (catalog.length > 0) return;
		getTransport()
			.request("model.list", {})
			.then((fresh) => useAppStore.getState().setModelCatalog(fresh))
			.catch(() => {});
	}, [catalog.length]);

	const enabledCount = catalog.filter((entry) => entry.enabled).length;
	const curated = enabledCount < catalog.length;

	const save = (refs: string[] | null) => {
		setBusy(true);
		getTransport()
			.request("model.setEnabled", { enabled: refs })
			.catch(() => toast.error("Couldn't save your model selection"))
			.finally(() => setBusy(false));
	};

	// Always send the WHOLE list, never a delta: pi's setting *is* the list. "Every model on" is sent as
	// `null` (no filter), which is also what the host stores when the last enabled model is switched off.
	const toggle = (entry: ModelCatalogEntry) => {
		const next = catalog
			.filter((candidate) => (candidate === entry ? !entry.enabled : candidate.enabled))
			.map((candidate) => modelRef(candidate.model));
		save(next.length === catalog.length ? null : next);
	};

	return (
		<section data-testid="settings-models" className="flex flex-col gap-lg">
			<div className="flex flex-col gap-xs">
				<h3 className="font-medium text-md text-text">Available models</h3>
				<p className="text-hint text-xs">
					Pick the models you actually use — the chat picker offers those first and keeps the rest
					behind “Show all”. This is pi's own{" "}
					<span className="font-[var(--font-mono)]">enabledModels</span> setting, so the pi CLI
					follows it too; patterns you wrote by hand are saved as explicit model ids, and selecting
					none means every model is available.
				</p>
			</div>

			<div className="flex items-center justify-between gap-md">
				<span data-testid="models-enabled-count" className="text-muted text-sm">
					{catalog.length === 0
						? "No models yet — sign in to a provider first."
						: curated
							? `${enabledCount} of ${catalog.length} models enabled`
							: `All ${catalog.length} models available`}
				</span>
				{curated ? (
					<Button
						size="sm"
						variant="outline"
						data-testid="models-enable-all"
						disabled={busy}
						onClick={() => save(null)}
					>
						Enable all
					</Button>
				) : null}
			</div>

			<div className="flex flex-col gap-md">
				{groupByProvider(catalog).map(([provider, entries]) => (
					<div key={provider} className="flex flex-col gap-xs">
						<h4 className="font-medium text-hint text-xs uppercase tracking-wider">{provider}</h4>
						<div className="flex flex-col divide-y divide-border rounded-[var(--radius-md)] border border-border2">
							{entries.map((entry) => (
								<div
									key={modelRef(entry.model)}
									data-testid="model-setting-row"
									data-model-id={entry.model.id}
									data-enabled={entry.enabled}
									className="flex items-center justify-between gap-md px-md py-sm"
								>
									<div className="flex min-w-0 flex-col gap-0.5">
										<span className="truncate text-sm text-text">{entry.model.name}</span>
										<span className="truncate font-[var(--font-mono)] text-hint text-xs">
											{entry.model.id} · {formatContextWindow(entry.model.contextWindow)} context
											{entry.model.reasoning ? " · reasoning" : ""}
										</span>
									</div>
									<button
										type="button"
										data-testid="model-toggle"
										data-on={entry.enabled}
										disabled={busy}
										aria-label={`${entry.enabled ? "Disable" : "Enable"} ${entry.model.name}`}
										onClick={() => toggle(entry)}
										className={cn(
											"shrink-0 rounded-[var(--radius-sm)] border px-sm py-0.5 text-xs transition-colors disabled:opacity-50",
											entry.enabled
												? "border-[var(--primary-40)] bg-[var(--primary-10)] text-primary"
												: "border-border2 text-muted hover:bg-hover",
										)}
									>
										{entry.enabled ? "on" : "off"}
									</button>
								</div>
							))}
						</div>
					</div>
				))}
			</div>
		</section>
	);
}
