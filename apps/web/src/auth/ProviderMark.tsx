import { KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The auth surface's provider marks. Simple schematic SVGs (not lucide — these are brand-evocative
 * glyphs), colored via the `--brand-*` tokens so themes stay in charge. `jetbrains` is the gradient
 * square that reads "JetBrains" at a glance; `api-key` is the generic key tile.
 */
export type ProviderMarkId =
	| "jetbrains"
	| "anthropic"
	| "openai-codex"
	| "github-copilot"
	| "api-key";

const SIZE = {
	sm: "size-6 rounded-[6px]",
	md: "size-8 rounded-[var(--radius-md)]",
	lg: "size-11 rounded-[10px]",
} as const;

const GLYPH = { sm: 13, md: 16, lg: 22 } as const;

export function ProviderMark({
	id,
	size = "md",
	className,
}: {
	id: ProviderMarkId | string;
	size?: keyof typeof SIZE;
	className?: string;
}) {
	const glyph = GLYPH[size];
	const base = cn("grid shrink-0 place-items-center", SIZE[size], className);

	switch (id) {
		case "jetbrains":
			return (
				<span
					className={cn(
						base,
						"bg-[conic-gradient(from_210deg,var(--brand-jb-1),var(--brand-jb-2),var(--brand-jb-3),var(--brand-jb-1))]",
					)}
				>
					<span
						className={cn(
							"grid place-items-center bg-bg-dark font-[var(--font-accent)] font-extrabold text-text",
							size === "lg" ? "size-9 rounded-[7px] text-md" : "size-6 rounded-[4px] text-xs",
						)}
					>
						jb
					</span>
				</span>
			);
		case "anthropic":
			return (
				<span className={cn(base, "bg-[var(--brand-claude)]")}>
					<svg
						width={glyph}
						height={glyph}
						viewBox="0 0 24 24"
						fill="var(--on-accent)"
						aria-hidden="true"
					>
						<path d="M12 2.2l1.2 6 4.3-4.3-3 5.4 6.1-.6-5.6 2.6 5.6 2.6-6.1-.6 3 5.4-4.3-4.3-1.2 6-1.2-6-4.3 4.3 3-5.4-6.1.6 5.6-2.6-5.6-2.6 6.1.6-3-5.4 4.3 4.3z" />
					</svg>
				</span>
			);
		case "openai-codex":
			return (
				<span className={cn(base, "border border-border2 bg-[var(--brand-openai)]")}>
					<svg
						width={glyph}
						height={glyph}
						viewBox="0 0 24 24"
						fill="none"
						stroke="var(--on-accent)"
						strokeWidth="1.7"
						aria-hidden="true"
					>
						<circle cx="12" cy="12" r="4.2" />
						<path d="M12 2.6v5.2M12 16.2v5.2M3.9 7.3l4.5 2.6M15.6 14.1l4.5 2.6M3.9 16.7l4.5-2.6M15.6 9.9l4.5-2.6" />
					</svg>
				</span>
			);
		case "github-copilot":
			return (
				<span className={cn(base, "border border-border2 bg-[var(--brand-github)]")}>
					<svg
						width={glyph}
						height={glyph}
						viewBox="0 0 24 24"
						fill="var(--on-accent)"
						aria-hidden="true"
					>
						<path d="M4 10.5C4 7 7.6 5.5 12 5.5S20 7 20 10.5v3.2c0 .9-.4 1.7-1.2 2.2C16.9 17.2 14.6 18.5 12 18.5s-4.9-1.3-6.8-2.6c-.8-.5-1.2-1.3-1.2-2.2z" />
						<rect x="7.4" y="10.4" width="2.6" height="3.6" rx="1.2" fill="var(--brand-github)" />
						<rect x="14" y="10.4" width="2.6" height="3.6" rx="1.2" fill="var(--brand-github)" />
					</svg>
				</span>
			);
		default:
			return (
				<span className={cn(base, "border border-[var(--primary-40)] bg-[var(--primary-10)]")}>
					<KeyRound className="text-primary" size={glyph} aria-hidden="true" />
				</span>
			);
	}
}
