import { Check, X } from "lucide-react";
import type { ToolRenderProps } from "../../toolRegistry";
import { strArg } from "../toolHelpers";
import { parseComparisonOptions } from "./args";
import { MermaidView } from "./MermaidView";

/**
 * Body for `visualize` type="comparison": option cards with pros/cons, a `recommended` highlight, and an
 * optional per-option inline diagram.
 */
export function ComparisonCard({ args }: ToolRenderProps) {
	const title = strArg(args, "title");
	const options = parseComparisonOptions(args.options);

	if (options.length === 0) {
		return <span className="text-text-muted tr-text-metadata italic">(no options)</span>;
	}
	return (
		<div data-testid="tool-visualize-comparison" className="flex flex-col gap-sm">
			{title ? <div className="tr-title-compact text-text-default">{title}</div> : null}
			<div className="grid gap-sm sm:grid-cols-2">
				{options.map((opt) => (
					<div
						key={opt.name}
						data-recommended={opt.recommended || undefined}
						className={`flex flex-col gap-xs rounded-[var(--radius-sm)] border p-sm ${
							opt.recommended ? "border-primary bg-container-elevated-bg" : "border-border-default"
						}`}
					>
						<div className="flex items-center gap-xs">
							<span className="tr-text-ui text-text-default">{opt.name}</span>
							{opt.recommended ? (
								<span className="rounded-[var(--radius-sm)] bg-primary px-1.5 py-0.5 text-text-on-primary tr-text-metadata">
									Recommended
								</span>
							) : null}
						</div>
						{opt.description ? (
							<p className="text-text-muted tr-text-metadata">{opt.description}</p>
						) : null}
						{opt.pros.length > 0 ? (
							<ul className="flex flex-col gap-0.5">
								{opt.pros.map((p) => (
									<li
										key={p}
										className="flex items-start gap-xs text-text-default tr-text-metadata"
									>
										<Check className="mt-0.5 size-3 shrink-0 text-feedback-success" />
										<span>{p}</span>
									</li>
								))}
							</ul>
						) : null}
						{opt.cons.length > 0 ? (
							<ul className="flex flex-col gap-0.5">
								{opt.cons.map((c) => (
									<li
										key={c}
										className="flex items-start gap-xs text-text-default tr-text-metadata"
									>
										<X className="mt-0.5 size-3 shrink-0 text-feedback-error" />
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
