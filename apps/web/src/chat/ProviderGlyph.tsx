import { cn } from "@thinkrail/ui/utils";
import { PROVIDER_GLYPHS } from "./generated/providerGlyphs";

/** A vendor mark for a pi provider id; providers without a known mark get a monogram. */
export function ProviderGlyph({ provider, className }: { provider: string; className?: string }) {
	const paths = PROVIDER_GLYPHS[provider];
	if (!paths) {
		return (
			<span
				aria-hidden="true"
				className={cn(
					"flex size-16 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-control-bg-selected tr-code-text-small uppercase leading-none",
					className,
				)}
			>
				{provider.slice(0, 1)}
			</span>
		);
	}
	return (
		<svg
			aria-hidden="true"
			viewBox="0 0 24 24"
			fill="currentColor"
			fillRule="evenodd"
			className={cn("size-16 shrink-0", className)}
		>
			{paths.map((path) => (
				<path key={path.d} d={path.d} fillOpacity={path.opacity} />
			))}
		</svg>
	);
}
