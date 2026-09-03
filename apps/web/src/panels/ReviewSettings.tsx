import type { ThinkingLevel, WireModel } from "@thinkrail/contracts";
import { useEffect, useState } from "react";
import { ModelSelector } from "@/chat/ModelSelector";
import { ThinkingSelector } from "@/chat/ThinkingSelector";
import { useModelCatalog } from "@/chat/useModelCatalog";
import { toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";
import { SettingsSwitch } from "./SettingsSwitch";

export function ReviewSettings() {
	const reviewModel = useAppStore((s) => s.reviewModel);
	const reviewEffort = useAppStore((s) => s.reviewEffort);
	const autoFix = useAppStore((s) => s.reviewAutoFix);
	const { models, refreshing, refresh } = useModelCatalog(true);
	const [fallback, setFallback] = useState<{
		model: WireModel | null;
		thinkingLevel: ThinkingLevel;
	} | null>(null);

	useEffect(() => {
		getTransport()
			.request("model.default", {})
			.then(setFallback)
			.catch(() => {});
	}, []);

	const update = (config: {
		reviewModel?: WireModel | null;
		reviewEffort?: ThinkingLevel | null;
	}) => {
		getTransport()
			.request("settings.update", { config })
			.catch(() => toast.error("Couldn't change the review model"));
	};

	const effortModel = reviewModel ?? fallback?.model ?? null;
	const effortLevel =
		reviewEffort ?? (reviewModel ? "medium" : (fallback?.thinkingLevel ?? "medium"));
	const defaultLabel = fallback?.model
		? `Your default model (${fallback.model.name})`
		: "Your default model";
	const setAutoFix = (reviewAutoFix: boolean) => {
		getTransport()
			.request("settings.update", { config: { reviewAutoFix } })
			.catch(() => toast.error("Couldn't change the auto-fix setting"));
	};

	return (
		<section data-testid="settings-review" className="flex flex-col gap-16">
			<div className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">Reviewer model</h3>
				<p className="text-text-muted tr-text-metadata">
					The model the plan reviewer (and its reflector) runs on. Leave unset to use your default
					model. Your choice is saved on the host and follows you across devices.
				</p>
			</div>
			<div className="flex flex-wrap items-center gap-8">
				<ModelSelector
					models={models}
					current={reviewModel ?? null}
					refreshing={refreshing}
					onRefresh={refresh}
					onSelect={(m) => update({ reviewModel: m })}
					placeholder={defaultLabel}
					defaultOption={defaultLabel}
					onSelectDefault={() => update({ reviewModel: null, reviewEffort: null })}
				/>
				<ThinkingSelector
					level={effortLevel}
					levels={effortModel?.thinkingLevels ?? []}
					onSelect={(level) => update({ reviewEffort: level })}
				/>
			</div>

			<div className="flex flex-col gap-4">
				<h3 className="tr-title-section text-text-default">Automatic fix cycle</h3>
				<p className="text-text-muted tr-text-metadata">
					When on, a “changes requested” verdict is sent to the worker chat automatically (once) and
					the fix is re-reviewed without asking. When off, the reviewer only records its findings
					and waits for you.
				</p>
			</div>
			<div className="flex items-center justify-between gap-12 rounded-[var(--radius-sm)] border border-border-default bg-control-bg px-12 py-8">
				<div className="flex flex-col gap-2">
					<span className="tr-title-compact text-text-default">Auto-fix requested changes</span>
					<span className="text-text-muted tr-text-metadata">
						{autoFix
							? "On — the reviewer's findings are auto-sent to the worker and re-reviewed once."
							: "Off — findings wait for you; nothing is auto-sent."}
					</span>
				</div>
				<SettingsSwitch
					checked={autoFix}
					label="Auto-fix requested changes"
					testId="review-autofix-toggle"
					onChange={setAutoFix}
				/>
			</div>
		</section>
	);
}
