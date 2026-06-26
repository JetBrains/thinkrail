import type { Model } from "@thinkrail-pi/contracts";
import { Check, ChevronDown } from "lucide-react";
import { Fragment } from "react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** The per-session model picker (cheap win #1) — models grouped by provider. Props-driven, no store. */
export function ModelSelector({
	models,
	current,
	onSelect,
}: {
	models: Model<string>[];
	current: Model<string> | null;
	onSelect: (model: Model<string>) => void;
}) {
	const providers = [...new Set(models.map((m) => m.provider))];

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				data-testid="model-selector"
				disabled={models.length === 0}
				className="flex h-7 max-w-[200px] items-center gap-xs rounded-[var(--radius-md)] border border-border2 bg-elevated px-sm text-sm text-text outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
			>
				<span className="truncate">{current?.name ?? "No model"}</span>
				<ChevronDown className="size-3.5 shrink-0 text-muted" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="max-h-[60vh] overflow-y-auto">
				{providers.map((provider, i) => (
					<Fragment key={provider}>
						{i > 0 ? <DropdownMenuSeparator /> : null}
						<DropdownMenuLabel>{provider}</DropdownMenuLabel>
						{models
							.filter((m) => m.provider === provider)
							.map((m) => {
								const isCurrent = current?.provider === m.provider && current?.id === m.id;
								return (
									<DropdownMenuItem
										key={`${m.provider}:${m.id}`}
										data-testid="model-option"
										data-model-id={m.id}
										onSelect={() => onSelect(m)}
									>
										<span className="flex-1 truncate">{m.name}</span>
										{isCurrent ? <Check className="size-3.5 text-primary" /> : null}
									</DropdownMenuItem>
								);
							})}
					</Fragment>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
