import { RiCheckLine as Check, RiCloseLine as X } from "@remixicon/react";
import type { ToolRenderProps } from "../../toolRegistry";
import { strArg } from "../toolHelpers";
import { parseComparisonOptions } from "./args";
import { MermaidView } from "./MermaidView";

export function ComparisonCard({ args }: ToolRenderProps) {
	const title = strArg(args, "title");
	const options = parseComparisonOptions(args.options);

	if (options.length === 0) {
		return <span className="text-text-muted tr-text-metadata italic">(no options)</span>;
	}
	return (
		<div data-testid="tool-visualize-comparison" className="flex flex-col gap-8">
			{title ? <div className="tr-title-compact text-text-default">{title}</div> : null}
			<div className="grid gap-8 sm:grid-cols-2">
				{options.map((opt) => (
					<div
						key={opt.name}
						data-recommended={opt.recommended || undefined}
						className={`flex flex-col gap-4 rounded-[var(--radius-sm)] border p-8 ${
							opt.recommended ? "border-primary bg-container-elevated-bg" : "border-border-default"
						}`}
					>
						<div className="flex items-center gap-4">
							<span className="tr-text-ui text-text-default">{opt.name}</span>
							{opt.recommended ? (
								<span className="rounded-[var(--radius-sm)] bg-primary px-8 py-2 text-text-on-primary tr-text-metadata">
									Recommended
								</span>
							) : null}
						</div>
						{opt.description ? (
							<p className="text-text-muted tr-text-metadata">{opt.description}</p>
						) : null}
						{opt.pros.length > 0 ? (
							<ul className="flex flex-col gap-2">
								{opt.pros.map((p) => (
									<li key={p} className="flex items-start gap-4 text-text-default tr-text-metadata">
										<Check className="mt-2 size-12 shrink-0 text-feedback-success" />
										<span>{p}</span>
									</li>
								))}
							</ul>
						) : null}
						{opt.cons.length > 0 ? (
							<ul className="flex flex-col gap-2">
								{opt.cons.map((c) => (
									<li key={c} className="flex items-start gap-4 text-text-default tr-text-metadata">
										<X className="mt-2 size-12 shrink-0 text-feedback-error" />
										<span>{c}</span>
									</li>
								))}
							</ul>
						) : null}
						{opt.mermaid ? <MermaidView source={opt.mermaid} title={opt.name} /> : null}
					</div>
				))}
			</div>
		</div>
	);
}
