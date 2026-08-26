import type { ComposerGrowthLimit } from "@thinkrail/contracts";
import { Check } from "lucide-react";
import { cn } from "@/lib";
import { toast, useAppStore } from "@/store";
import { getTransport } from "@/transport";

const GROWTH_CHOICES: {
	id: ComposerGrowthLimit;
	label: string;
	hint: string;
	description: string;
}[] = [
	{
		id: "compact",
		label: "Compact",
		hint: "6 lines",
		description: "Keeps long drafts to six visual lines before scrolling.",
	},
	{
		id: "roomy",
		label: "Roomy",
		hint: "10 lines",
		description: "Keeps long drafts to ten visual lines before scrolling.",
	},
	{
		id: "half-chat",
		label: "Half chat",
		hint: "Default",
		description: "Uses up to half of the mounted chat panel before scrolling.",
	},
];

export function ChatSettings() {
	const growthLimit = useAppStore((state) => state.composerGrowthLimit);

	const select = (composerGrowthLimit: ComposerGrowthLimit) => {
		if (composerGrowthLimit === growthLimit) return;
		getTransport()
			.request("settings.update", { config: { composerGrowthLimit } })
			.catch(() => toast.error("Couldn't change composer growth"));
	};

	return (
		<section data-testid="settings-chat" className="flex flex-col gap-sm">
			<div className="flex flex-col gap-xs">
				<h3 className="tr-title-section text-text-default">Composer growth</h3>
				<p className="text-text-muted tr-text-metadata">
					Choose how tall long drafts may grow before the message field scrolls. Your choice is
					saved on the host and follows you across devices.
				</p>
			</div>
			<div role="radiogroup" aria-label="Composer growth limit" className="flex flex-col gap-xs">
				{GROWTH_CHOICES.map(({ id, label, hint, description }) => {
					const active = id === growthLimit;
					return (
						<button
							key={id}
							type="button"
							role="radio"
							aria-checked={active}
							data-testid={`composer-growth-${id}`}
							data-active={active}
							onClick={() => select(id)}
							className={cn(
								"flex items-center gap-sm rounded-[var(--radius-sm)] border px-md py-sm text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
								active
									? "border-primary-muted bg-clip-padding bg-primary-subtle"
									: "border-border-default hover:bg-control-bg-hovered",
							)}
						>
							<span className="min-w-0 flex-1">
								<span className="flex items-center gap-xs tr-title-compact text-text-default">
									{label}
									<span className="text-text-muted tr-text-metadata">{hint}</span>
								</span>
								<span className="block text-text-muted tr-text-metadata">{description}</span>
							</span>
							{active ? <Check className="size-4 shrink-0 text-primary" /> : null}
						</button>
					);
				})}
			</div>
		</section>
	);
}
